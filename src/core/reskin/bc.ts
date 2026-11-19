/**
 * BC1 (DXT1) and BC3 (DXT5) blocks for the reskin: decoding single blocks, fitting new ones, and the BioWare DDS the
 * original GUI's textures are stored in (a 20-byte header: width, height, bytes per pixel (3 = DXT1, 4 = DXT5), the
 * first level's size in bytes, the mean alpha (a float); then every mip level down to 1 x 1, the first stored row the
 * bottom of the picture). Written from Microsoft's BCn documentation; the fitting is a port of the Ink and brass
 * retone scripts (principal axis endpoints, then a local search over neighbouring 5:6:5 values).
 */
import { type RGBAImage, newImage } from "../res/image.js";

export const BIOWARE_DDS_HEADER = 20;

export interface BiowareHeader {
  width: number;
  height: number;
  /** 3: DXT1, 4: DXT5. */
  bpp: 3 | 4;
  size0: number;
  alphaMean: number;
}

export function readBiowareHeader(b: Uint8Array): BiowareHeader | null {
  if (b.length < BIOWARE_DDS_HEADER) return null;
  if (b.length >= 4 && b[0] === 0x44 && b[1] === 0x44 && b[2] === 0x53 && b[3] === 0x20) return null; // "DDS "
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const bpp = v.getUint32(8, true);
  if (bpp !== 3 && bpp !== 4) return null;
  return { width: v.getUint32(0, true), height: v.getUint32(4, true), bpp, size0: v.getUint32(12, true), alphaMean: v.getFloat32(16, true) };
}

export function writeBiowareHeader(h: BiowareHeader): Uint8Array {
  const out = new Uint8Array(BIOWARE_DDS_HEADER);
  const v = new DataView(out.buffer);
  v.setUint32(0, h.width, true);
  v.setUint32(4, h.height, true);
  v.setUint32(8, h.bpp, true);
  v.setUint32(12, h.size0, true);
  v.setFloat32(16, h.alphaMean, true);
  return out;
}

/** The mip chain's sizes, down to 1 x 1. */
export function mipLevels(w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (;;) {
    out.push([w, h]);
    if (w === 1 && h === 1) return out;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
}

export const blockCount = (w: number, h: number) => Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4));

// --- colour blocks ------------------------------------------------------------------------------------------------

export type RGBf = [number, number, number];

export function unpack565(c: number): RGBf {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

export function pack565(c: readonly number[]): number {
  const q = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return ((q(c[0]!) >> 3) << 11) | ((q(c[1]!) >> 2) << 5) | (q(c[2]!) >> 3);
}

/** The block's palette: 4 colours, or 3 and transparent black (DXT1 with c0 <= c1). As the decoders round. */
export function colourPalette(c0: number, c1: number, four: boolean): RGBf[] {
  const p0 = unpack565(c0);
  const p1 = unpack565(c1);
  if (four) {
    return [p0, p1, [0, 1, 2].map((k) => Math.floor((2 * p0[k]! + p1[k]!) / 3)) as RGBf, [0, 1, 2].map((k) => Math.floor((p0[k]! + 2 * p1[k]!) / 3)) as RGBf];
  }
  return [p0, p1, [0, 1, 2].map((k) => Math.floor((p0[k]! + p1[k]!) / 2)) as RGBf, [0, 0, 0]];
}

export interface ColourBlock {
  /** 16 colours, texel i at [i*3 .. i*3+2] (row by row as stored). */
  rgb: Float64Array;
  ids: Uint8Array;
  four: boolean;
}

/** One 8-byte colour block. dxt5: the colour half of a DXT5 block (always four colours). */
export function decodeColourBlock(b: Uint8Array, dxt5: boolean): ColourBlock {
  const c0 = b[0]! | (b[1]! << 8);
  const c1 = b[2]! | (b[3]! << 8);
  const four = dxt5 || c0 > c1;
  const pal = colourPalette(c0, c1, four);
  let idx = (b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! << 24)) >>> 0;
  const rgb = new Float64Array(48);
  const ids = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const k = idx & 3;
    idx >>>= 2;
    ids[i] = k;
    rgb.set(pal[k]!, i * 3);
  }
  return { rgb, ids, four };
}

function neighbours(v: number): number[] {
  const r = (v >> 11) & 31;
  const g = (v >> 5) & 63;
  const b = v & 31;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dg = -1; dg <= 1; dg++) {
      for (let db = -1; db <= 1; db++) {
        const rr = r + dr;
        const gg = g + dg;
        const bb = b + db;
        if (rr >= 0 && rr < 32 && gg >= 0 && gg < 64 && bb >= 0 && bb < 32) out.push((rr << 11) | (gg << 5) | bb);
      }
    }
  }
  return out;
}

const palBuf = new Float64Array(12);

/** Fills palBuf with the block's palette (as colourPalette, without allocating). */
function fillPalette(c0: number, c1: number, four: boolean): void {
  const r0 = (c0 >> 11) & 31, g0 = (c0 >> 5) & 63, b0 = c0 & 31;
  const r1 = (c1 >> 11) & 31, g1 = (c1 >> 5) & 63, b1 = c1 & 31;
  const p0r = (r0 << 3) | (r0 >> 2), p0g = (g0 << 2) | (g0 >> 4), p0b = (b0 << 3) | (b0 >> 2);
  const p1r = (r1 << 3) | (r1 >> 2), p1g = (g1 << 2) | (g1 >> 4), p1b = (b1 << 3) | (b1 >> 2);
  palBuf[0] = p0r;
  palBuf[1] = p0g;
  palBuf[2] = p0b;
  palBuf[3] = p1r;
  palBuf[4] = p1g;
  palBuf[5] = p1b;
  if (four) {
    palBuf[6] = Math.floor((2 * p0r + p1r) / 3);
    palBuf[7] = Math.floor((2 * p0g + p1g) / 3);
    palBuf[8] = Math.floor((2 * p0b + p1b) / 3);
    palBuf[9] = Math.floor((p0r + 2 * p1r) / 3);
    palBuf[10] = Math.floor((p0g + 2 * p1g) / 3);
    palBuf[11] = Math.floor((p0b + 2 * p1b) / 3);
  } else {
    palBuf[6] = Math.floor((p0r + p1r) / 2);
    palBuf[7] = Math.floor((p0g + p1g) / 2);
    palBuf[8] = Math.floor((p0b + p1b) / 2);
    palBuf[9] = palBuf[10] = palBuf[11] = 0;
  }
}

function blockError(T: Float64Array, w: Float64Array, c0: number, c1: number, four: boolean): number {
  fillPalette(c0, c1, four);
  const K = four ? 12 : 9;
  let tot = 0;
  for (let i = 0; i < 16; i++) {
    const wi = w[i]!;
    if (!wi) continue;
    const tr = T[i * 3]!, tg = T[i * 3 + 1]!, tb = T[i * 3 + 2]!;
    let best = Infinity;
    for (let k = 0; k < K; k += 3) {
      const dr = tr - palBuf[k]!;
      const dg = tg - palBuf[k + 1]!;
      const db = tb - palBuf[k + 2]!;
      const e = dr * dr + dg * dg + db * db;
      if (e < best) best = e;
    }
    tot += best * wi;
  }
  return tot;
}

const fitCache = new Map<string, Uint8Array>();

/**
 * The best 8-byte colour block for 16 target colours T (0-255) with weights w. keep3: DXT1 texels that stay
 * transparent (the 3-colour mode's index 3); without it a DXT1 block is written in 4-colour mode (c0 > c1) and a
 * DXT5 block's colour half is always 4-colour.
 */
export function fitColourBlock(T: Float64Array, w: Float64Array, dxt5: boolean, keep3: Uint8Array | null = null): Uint8Array {
  const key = `${dxt5 ? 5 : 1}|${Array.from(T, Math.round).join(",")}|${Array.from(w, (x) => x.toFixed(3)).join(",")}|${keep3 ? keep3.join("") : ""}`;
  const hit = fitCache.get(key);
  if (hit) return hit;
  const four = keep3 === null;
  const ww = new Float64Array(16);
  for (let i = 0; i < 16; i++) ww[i] = keep3 && keep3[i] ? 0 : w[i]!;
  let wsum = 0;
  const m = [0, 0, 0];
  for (let i = 0; i < 16; i++) {
    wsum += ww[i]!;
    for (let k = 0; k < 3; k++) m[k]! += T[i * 3 + k]! * ww[i]!;
  }
  for (let k = 0; k < 3; k++) m[k] = wsum > 0 ? m[k]! / wsum : 0;
  // principal axis by power iteration on the weighted covariance
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 16; i++) {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a * 3 + b]! += (T[i * 3 + a]! - m[a]!) * (T[i * 3 + b]! - m[b]!) * ww[i]!;
  }
  let ax = [0.577, 0.577, 0.577];
  for (let it = 0; it < 8; it++) {
    const n = [0, 1, 2].map((a) => cov[a * 3]! * ax[0]! + cov[a * 3 + 1]! * ax[1]! + cov[a * 3 + 2]! * ax[2]!);
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (len < 1e-9) break;
    ax = n.map((x) => x / len);
  }
  let tmin = Infinity;
  let tmax = -Infinity;
  for (let i = 0; i < 16; i++) {
    if (!ww[i]) continue;
    const t = (T[i * 3]! - m[0]!) * ax[0]! + (T[i * 3 + 1]! - m[1]!) * ax[1]! + (T[i * 3 + 2]! - m[2]!) * ax[2]!;
    tmin = Math.min(tmin, t);
    tmax = Math.max(tmax, t);
  }
  if (!Number.isFinite(tmin)) tmin = tmax = 0;
  const hi = m.map((v, k) => v + ax[k]! * tmax);
  const lo = m.map((v, k) => v + ax[k]! * tmin);
  let best: [number, number, number] | null = null;
  for (const start of [
    [pack565(hi), pack565(lo)],
    [pack565(m), pack565(m)],
  ] as [number, number][]) {
    let [c0, c1] = start;
    let err = blockError(T, ww, c0, c1, four);
    // coordinate descent over the 26 neighbours of each endpoint in turn
    for (let it = 0; it < 64; it++) {
      let improved = false;
      for (const n of neighbours(c0)) {
        const e = blockError(T, ww, n, c1, four);
        if (e < err - 1e-9) [err, c0, improved] = [e, n, true];
      }
      for (const n of neighbours(c1)) {
        const e = blockError(T, ww, c0, n, four);
        if (e < err - 1e-9) [err, c1, improved] = [e, n, true];
      }
      if (!improved) break;
    }
    if (!best || err < best[0]) best = [err, c0, c1];
  }
  let [, c0, c1] = best!;
  const pal = colourPalette(c0, c1, four);
  const K = four ? 4 : 3;
  const ids = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    if (keep3 && keep3[i]) {
      ids[i] = 3;
      continue;
    }
    let bk = 0;
    let be = Infinity;
    for (let k = 0; k < K; k++) {
      const p = pal[k]!;
      const e = (T[i * 3]! - p[0]) ** 2 + (T[i * 3 + 1]! - p[1]) ** 2 + (T[i * 3 + 2]! - p[2]) ** 2;
      if (e < be) [be, bk] = [e, k];
    }
    ids[i] = bk;
  }
  if (four) {
    if (c0 < c1) {
      [c0, c1] = [c1, c0];
      for (let i = 0; i < 16; i++) ids[i] = [1, 0, 3, 2][ids[i]!]!;
    } else if (c0 === c1) ids.fill(0); // one colour: safe in either mode
  } else if (c0 > c1) {
    [c0, c1] = [c1, c0];
    for (let i = 0; i < 16; i++) ids[i] = [1, 0, 2, 3][ids[i]!]!;
  }
  let idx = 0;
  for (let i = 0; i < 16; i++) idx |= ids[i]! << (2 * i);
  const out = new Uint8Array(8);
  out[0] = c0 & 255;
  out[1] = c0 >> 8;
  out[2] = c1 & 255;
  out[3] = c1 >> 8;
  new DataView(out.buffer).setUint32(4, idx >>> 0, true);
  if (fitCache.size > 200000) fitCache.clear();
  fitCache.set(key, out);
  return out;
}

// --- alpha blocks -------------------------------------------------------------------------------------------------

export function alphaPalette(a0: number, a1: number): number[] {
  if (a0 > a1) return [a0, a1, ...[1, 2, 3, 4, 5, 6].map((i) => Math.floor(((7 - i) * a0 + i * a1) / 7))];
  return [a0, a1, ...[1, 2, 3, 4].map((i) => Math.floor(((5 - i) * a0 + i * a1) / 5)), 0, 255];
}

export function decodeAlphaBlock(b: Uint8Array): Uint8Array {
  const pal = alphaPalette(b[0]!, b[1]!);
  const out = new Uint8Array(16);
  let lo = b[2]! | (b[3]! << 8) | (b[4]! << 16);
  let hi = b[5]! | (b[6]! << 8) | (b[7]! << 16);
  for (let i = 0; i < 8; i++) {
    out[i] = pal[lo & 7]!;
    lo >>= 3;
  }
  for (let i = 8; i < 16; i++) {
    out[i] = pal[hi & 7]!;
    hi >>= 3;
  }
  return out;
}

const alphaCache = new Map<string, Uint8Array>();

/**
 * An 8-byte DXT5 alpha block for 16 target alphas. A texel's alpha 0 or not-0 is kept first (a faint rim texel must not
 * vanish from a cut-out, nor a hole fill in), then the block's lowest and highest level (a cut-out 0, a solid fill)
 * exact, then the worst texel, then the squared error: both modes are searched around the exact ends.
 */
export function fitAlphaBlock(t: ArrayLike<number>): Uint8Array {
  const vals = Array.from(t, (x) => Math.min(255, Math.max(0, Math.round(x))));
  const key = vals.join(",");
  const hit = alphaCache.get(key);
  if (hit) return hit;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const inner = vals.filter((v) => v !== 0 && v !== 255);
  const cands: [number, number][] = [];
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  for (let d0 = 0; d0 <= 6; d0++) {
    for (let d1 = 0; d1 <= 6; d1++) {
      const a0 = clamp(hi + d0);
      const a1 = clamp(lo - d1);
      if (a0 > a1) cands.push([a0, a1]);
      if (inner.length) {
        const b0 = clamp(Math.min(...inner) - d0);
        const b1 = clamp(Math.max(...inner) + d1);
        if (b0 <= b1) cands.push([b0, b1]);
      }
    }
  }
  if (!inner.length) cands.push([0, 0]);
  if (lo === hi) cands.push([hi, lo]);
  let bestScore = Infinity;
  let best: [number, number] = cands[0]!;
  for (const [a0, a1] of cands) {
    const pal = alphaPalette(a0, a1);
    let emax = 0;
    let esq = 0;
    let eend = 0;
    let zero = 0;
    for (const v of vals) {
      let e = 256;
      let bp = 0;
      for (const p of pal) {
        const d = Math.abs(v - p);
        if (d < e || (d === e && p !== 0 && v !== 0)) [e, bp] = [d, p];
      }
      if ((v === 0) !== (bp === 0)) zero++;
      emax = Math.max(emax, e);
      esq += e * e;
      if (v === lo || v === hi) eend = Math.max(eend, e);
    }
    const score = zero * 1e15 + eend * 1e12 + emax * 1e7 + esq;
    if (score < bestScore) [bestScore, best] = [score, [a0, a1]];
  }
  const pal = alphaPalette(best[0], best[1]);
  let bits = 0n;
  vals.forEach((v, i) => {
    let bk = 0;
    for (let k = 1; k < 8; k++) {
      const d = Math.abs(v - pal[k]!);
      const db = Math.abs(v - pal[bk]!);
      const zk = (v === 0) === (pal[k] === 0);
      const zb = (v === 0) === (pal[bk] === 0);
      if ((zk && !zb) || (zk === zb && d < db)) bk = k;
    }
    bits |= BigInt(bk) << BigInt(3 * i);
  });
  const out = new Uint8Array(8);
  out[0] = best[0];
  out[1] = best[1];
  for (let i = 0; i < 6; i++) out[2 + i] = Number((bits >> BigInt(8 * i)) & 255n);
  if (alphaCache.size > 100000) alphaCache.clear();
  alphaCache.set(key, out);
  return out;
}

// --- whole images -------------------------------------------------------------------------------------------------

/** A box-filtered half-size image (odd sides round down, at least 1). */
export function halve(im: RGBAImage): RGBAImage {
  const nw = Math.max(1, im.width >> 1);
  const nh = Math.max(1, im.height >> 1);
  const fx = im.width / nw;
  const fy = im.height / nh;
  const out = newImage(nw, nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let sy = Math.floor(y * fy); sy < Math.floor((y + 1) * fy); sy++) {
        for (let sx = Math.floor(x * fx); sx < Math.floor((x + 1) * fx); sx++) {
          const o = (sy * im.width + sx) * 4;
          for (let k = 0; k < 4; k++) acc[k]! += im.data[o + k]!;
          n++;
        }
      }
      for (let k = 0; k < 4; k++) out.data[(y * nw + x) * 4 + k] = Math.round(acc[k]! / n);
    }
  }
  return out;
}

/**
 * A BioWare DDS of a picture (rows top to bottom, as it is shown): DXT1 (bpp 3, opaque) or DXT5 (bpp 4), every mip
 * level, each level stored bottom row first.
 */
export function encodeBiowareDds(im: RGBAImage, bpp: 3 | 4): Uint8Array {
  const dxt5 = bpp === 4;
  const bs = dxt5 ? 16 : 8;
  const levels: RGBAImage[] = [im];
  while (levels.at(-1)!.width > 1 || levels.at(-1)!.height > 1) levels.push(halve(levels.at(-1)!));
  const parts: Uint8Array[] = [];
  for (const lv of levels) {
    const { width: lw, height: lh } = lv;
    const out = new Uint8Array(blockCount(lw, lh) * bs);
    let o = 0;
    const T = new Float64Array(48);
    const A = new Float64Array(16);
    for (let by = 0; by < Math.max(lh, 4); by += 4) {
      for (let bx = 0; bx < Math.max(lw, 4); bx += 4) {
        for (let i = 0; i < 16; i++) {
          const x = Math.min(bx + (i & 3), lw - 1);
          const sy = Math.min(by + (i >> 2), lh - 1);
          const y = lh - 1 - sy; // stored bottom row first
          const p = (y * lw + x) * 4;
          T[i * 3] = lv.data[p]!;
          T[i * 3 + 1] = lv.data[p + 1]!;
          T[i * 3 + 2] = lv.data[p + 2]!;
          A[i] = lv.data[p + 3]!;
        }
        if (dxt5) {
          const ab = fitAlphaBlock(A);
          const na = decodeAlphaBlock(ab);
          out.set(ab, o);
          out.set(fitColourBlock(T, Float64Array.from(na, (a) => a / 255 + 0.02), true), o + 8);
        } else out.set(fitColourBlock(T, new Float64Array(16).fill(1), false), o);
        o += bs;
      }
    }
    parts.push(out);
  }
  let alphaSum = 0;
  for (let i = 3; i < im.data.length; i += 4) alphaSum += im.data[i]!;
  const header = writeBiowareHeader({ width: im.width, height: im.height, bpp, size0: parts[0]!.length, alphaMean: dxt5 ? alphaSum / (im.width * im.height) / 255 : 1 });
  const total = new Uint8Array(BIOWARE_DDS_HEADER + parts.reduce((s, p) => s + p.length, 0));
  total.set(header, 0);
  let pos = BIOWARE_DDS_HEADER;
  for (const p of parts) {
    total.set(p, pos);
    pos += p.length;
  }
  return total;
}
