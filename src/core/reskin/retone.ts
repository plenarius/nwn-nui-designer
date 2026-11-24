/**
 * Recolouring a stock texture in place: the same file, header, size, format, pixel or block order and mip chain,
 * with only the colours (and, for DXT5 with an opaque skin, the alpha) changed. So nothing a model's UVs point at can
 * move, and a DDS stays stored the way the client reads it.
 *
 * - BioWare DDS: every block of every mip level, in the file's own order. Each colour block is decoded, mapped and
 *   fitted again (DXT1 texels that were transparent stay so); DXT5 alpha blocks are copied byte for byte, or with
 *   an alpha curve decoded, mapped and fitted again (0 stays 0), and the header's mean alpha updated.
 * - TGA (uncompressed true colour, 24 or 32 bits): the same bytes with each pixel mapped exactly. A 32-bit TGA keeps
 *   its alpha byte for byte (its cut-out shapes' soft edges would harden under a curve).
 */
import { BIOWARE_DDS_HEADER, blockCount, decodeAlphaBlock, decodeColourBlock, fitAlphaBlock, fitColourBlock, mipLevels, readBiowareHeader, writeBiowareHeader } from "./bc.js";
import { type RGBAImage, newImage } from "../res/image.js";
import type { ColourMap } from "./colour.js";

export interface RetoneResult {
  bytes: Uint8Array;
  /** Worst difference (0-255) between a fitted DXT texel and its mapped colour, on visible texels of level 0. */
  worstColour: number;
  notes: string[];
}

/** Retones a BioWare DDS. alpha: the DXT5 alpha mapping, or null to copy the alpha blocks unchanged. */
export function retoneDds(raw: Uint8Array, map: ColourMap, alpha: ((a: number) => number) | null): RetoneResult {
  const h = readBiowareHeader(raw);
  if (!h) throw new Error("not a BioWare DDS (a standard DDS or another format: not changed)");
  const dxt5 = h.bpp === 4;
  const bs = dxt5 ? 16 : 8;
  const out = new Uint8Array(raw.length);
  out.set(raw.subarray(0, BIOWARE_DDS_HEADER));
  let off = BIOWARE_DDS_HEADER;
  let worst = 0;
  const notes: string[] = [];
  let alphaSum = 0;
  const T = new Float64Array(48);
  const W = new Float64Array(16);
  const levels = mipLevels(h.width, h.height);
  for (let li = 0; li < levels.length; li++) {
    const [lw, lh] = levels[li]!;
    const n = blockCount(lw, lh);
    if (off + n * bs > raw.length) {
      notes.push(`the file ends after ${li} of ${levels.length} mip levels`);
      break;
    }
    for (let k = 0; k < n; k++) {
      const b = raw.subarray(off + k * bs, off + (k + 1) * bs);
      const o = off + k * bs;
      let a: Uint8Array;
      let newA: Uint8Array;
      if (dxt5) {
        a = decodeAlphaBlock(b.subarray(0, 8));
        if (alpha) {
          const ab = fitAlphaBlock(Array.from(a, alpha));
          out.set(ab, o);
          newA = decodeAlphaBlock(ab);
        } else {
          out.set(b.subarray(0, 8), o);
          newA = a;
        }
        if (li === 0) {
          // the texels inside the picture (a level smaller than 4 x 4 repeats its texels in the block)
          const bw = Math.max(1, Math.ceil(lw / 4));
          const bx = (k % bw) * 4;
          const by = Math.floor(k / bw) * 4;
          for (let i = 0; i < 16; i++) if (bx + (i & 3) < lw && by + (i >> 2) < lh) alphaSum += newA[i]!;
        }
      } else {
        a = new Uint8Array(16).fill(255);
        newA = a;
      }
      const cb = decodeColourBlock(dxt5 ? b.subarray(8) : b, dxt5);
      let keep3: Uint8Array | null = null;
      if (!dxt5 && !cb.four && cb.ids.includes(3)) keep3 = Uint8Array.from(cb.ids, (v) => (v === 3 ? 1 : 0));
      for (let i = 0; i < 16; i++) {
        const c = map(cb.rgb[i * 3]!, cb.rgb[i * 3 + 1]!, cb.rgb[i * 3 + 2]!, a[i]!);
        T[i * 3] = Math.min(255, Math.max(0, Math.round(c[0])));
        T[i * 3 + 1] = Math.min(255, Math.max(0, Math.round(c[1])));
        T[i * 3 + 2] = Math.min(255, Math.max(0, Math.round(c[2])));
        W[i] = dxt5 ? newA[i]! / 255 + 0.02 : 1;
      }
      const nb = fitColourBlock(T, W, dxt5, keep3);
      out.set(nb, dxt5 ? o + 8 : o);
      if (li === 0) {
        const dec = decodeColourBlock(nb, dxt5);
        for (let i = 0; i < 16; i++) {
          if ((dxt5 && newA[i] === 0) || (keep3 && keep3[i])) continue;
          for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(dec.rgb[i * 3 + c]! - T[i * 3 + c]!));
        }
      }
    }
    off += n * bs;
  }
  if (off < raw.length) {
    out.set(raw.subarray(off), off);
    notes.push(`${raw.length - off} bytes after the mip chain copied unchanged`);
  }
  if (dxt5 && alpha && h.width * h.height >= 16) {
    out.set(writeBiowareHeader({ ...h, alphaMean: alphaSum / (h.width * h.height) / 255 }), 0);
  }
  return { bytes: out, worstColour: worst, notes };
}

export interface TgaInfo {
  width: number;
  height: number;
  bits: number;
  topDown: boolean;
  pixelOffset: number;
}

/** The header of an uncompressed true-colour TGA (24 or 32 bits), or null for any other kind. */
export function tgaInfo(raw: Uint8Array): TgaInfo | null {
  if (raw.length < 18 || raw[1] !== 0 || raw[2] !== 2) return null;
  const bits = raw[16]!;
  if (bits !== 24 && bits !== 32) return null;
  const width = raw[12]! | (raw[13]! << 8);
  const height = raw[14]! | (raw[15]! << 8);
  const pixelOffset = 18 + raw[0]!;
  if (raw.length < pixelOffset + width * height * (bits / 8)) return null;
  return { width, height, bits, topDown: (raw[17]! & 0x20) !== 0, pixelOffset };
}

/**
 * Retones an uncompressed 24- or 32-bit TGA: same bytes, pixels mapped (alpha kept). protect: a rectangle (left,
 * top, right, bottom in the picture as shown, exclusive) copied unchanged.
 */
export function retoneTga(raw: Uint8Array, map: ColourMap, protect?: [number, number, number, number], alpha?: ((a: number) => number) | null): RetoneResult {
  const t = tgaInfo(raw);
  if (!t) throw new Error("not an uncompressed 24- or 32-bit TGA: not changed");
  const out = raw.slice();
  const bp = t.bits / 8;
  for (let row = 0; row < t.height; row++) {
    const y = t.topDown ? row : t.height - 1 - row;
    for (let x = 0; x < t.width; x++) {
      if (protect && x >= protect[0] && x < protect[2] && y >= protect[1] && y < protect[3]) continue;
      const o = t.pixelOffset + (row * t.width + x) * bp;
      const a = bp === 4 ? raw[o + 3]! : 255;
      const c = map(raw[o + 2]!, raw[o + 1]!, raw[o]!, a);
      out[o] = Math.min(255, Math.max(0, Math.round(c[2])));
      out[o + 1] = Math.min(255, Math.max(0, Math.round(c[1])));
      out[o + 2] = Math.min(255, Math.max(0, Math.round(c[0])));
      if (alpha && bp === 4) out[o + 3] = alpha(a);
    }
  }
  return { bytes: out, worstColour: 0, notes: [] };
}

/**
 * A decoded picture recoloured texel by texel, exactly (no DXT): what a recolour means before it is stored. alpha:
 * the alpha mapping, or null to keep it; protect: texels kept as they are (retoneTga's). The checks judge a recolour's
 * layout, orientation and contrast on this, and DXT's own losses apart.
 */
export function mapPicture(im: RGBAImage, map: ColourMap, alpha: ((a: number) => number) | null, protect?: [number, number, number, number]): RGBAImage {
  const out = newImage(im.width, im.height);
  const d = im.data;
  for (let i = 0; i < im.width * im.height; i++) {
    const p = i * 4;
    const x = i % im.width;
    const y = Math.floor(i / im.width);
    if (protect && x >= protect[0] && x < protect[2] && y >= protect[1] && y < protect[3]) {
      out.data.set(d.subarray(p, p + 4), p);
      continue;
    }
    const c = map(d[p]!, d[p + 1]!, d[p + 2]!, d[p + 3]!);
    out.data[p] = c[0];
    out.data[p + 1] = c[1];
    out.data[p + 2] = c[2];
    out.data[p + 3] = alpha ? alpha(d[p + 3]!) : d[p + 3]!;
  }
  return out;
}
