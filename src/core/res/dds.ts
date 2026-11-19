/**
 * DDS textures as NWN uses them: BioWare's own header (width, height, bytes per pixel: 3 for DXT1, 4 for DXT5, the
 * base level's size, an alpha mean; then the mip chain), and the standard "DDS " header with DXT1, DXT3, DXT5 or
 * uncompressed RGB(A). Only the first (largest) level is decoded. Written from Microsoft's DDS and BCn documentation.
 *
 * NUI draws a DDS bottom row first: the first stored row is the bottom of the picture, as the game reads its model and
 * portrait DDS (checked in game with NuiImage, 2026-11-17; DESIGN.md, "Which way up images are drawn"). decodeDds
 * returns the picture that way up; decodeBc returns the blocks as stored.
 */
import { MAX_IMAGE_SIDE, type RGBAImage, newImage } from "./image.js";

/** A DDS as NUI shows it (bottom row first), as an RGBA image with rows top to bottom. */
export function decodeDds(bytes: Uint8Array): RGBAImage {
  return flipRows(decodeStored(bytes));
}

/** The image's rows in reverse order (in place). */
export function flipRows(im: RGBAImage): RGBAImage {
  const stride = im.width * 4;
  const tmp = new Uint8ClampedArray(stride);
  for (let top = 0, bottom = im.height - 1; top < bottom; top++, bottom--) {
    const a = top * stride;
    const b = bottom * stride;
    tmp.set(im.data.subarray(a, a + stride));
    im.data.copyWithin(a, b, b + stride);
    im.data.set(tmp, b);
  }
  return im;
}

/** A DDS's base level in stored row order (the first stored row first). */
export function decodeStored(bytes: Uint8Array): RGBAImage {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 128 && v.getUint32(0, true) === 0x20534444) return decodeStandard(bytes, v);
  // BioWare DDS.
  if (bytes.length < 20) throw new Error("DDS: too short");
  const w = v.getUint32(0, true);
  const h = v.getUint32(4, true);
  const bpp = v.getUint32(8, true);
  checkSize(w, h);
  const body = bytes.subarray(20);
  if (bpp === 3) return decodeBc(body, w, h, 1);
  if (bpp === 4) return decodeBc(body, w, h, 3);
  throw new Error(`DDS: unsupported BioWare format (${bpp} bytes a pixel)`);
}

function checkSize(w: number, h: number): void {
  if (!w || !h || w > MAX_IMAGE_SIDE || h > MAX_IMAGE_SIDE) throw new Error(`DDS: bad size ${w}x${h}`);
}

function decodeStandard(bytes: Uint8Array, v: DataView): RGBAImage {
  const h = v.getUint32(12, true);
  const w = v.getUint32(16, true);
  checkSize(w, h);
  const pfFlags = v.getUint32(80, true);
  const fourcc = String.fromCharCode(bytes[84]!, bytes[85]!, bytes[86]!, bytes[87]!);
  const body = bytes.subarray(128);
  if (pfFlags & 0x4) {
    if (fourcc === "DXT1") return decodeBc(body, w, h, 1);
    if (fourcc === "DXT3") return decodeBc(body, w, h, 2);
    if (fourcc === "DXT5") return decodeBc(body, w, h, 3);
    throw new Error(`DDS: unsupported format ${fourcc}`);
  }
  // Uncompressed, by bit masks.
  const bits = v.getUint32(88, true);
  const masks = [v.getUint32(92, true), v.getUint32(96, true), v.getUint32(100, true), v.getUint32(104, true)];
  const hasAlpha = (pfFlags & 0x1) !== 0;
  const bpp = bits / 8;
  if (!Number.isInteger(bpp) || bpp < 1 || bpp > 4) throw new Error(`DDS: unsupported ${bits} bits a pixel`);
  const out = newImage(w, h);
  const ch = (px: number, mask: number) => {
    if (!mask) return 255;
    let shift = 0;
    while (((mask >>> shift) & 1) === 0) shift++;
    const max = mask >>> shift;
    return Math.round((((px & mask) >>> shift) * 255) / max);
  };
  for (let i = 0; i < w * h; i++) {
    const o = i * bpp;
    if (o + bpp > body.length) break;
    let px = 0;
    for (let k = 0; k < bpp; k++) px |= body[o + k]! << (8 * k);
    px >>>= 0;
    out.data[i * 4] = ch(px, masks[0]!);
    out.data[i * 4 + 1] = ch(px, masks[1]!);
    out.data[i * 4 + 2] = ch(px, masks[2]!);
    out.data[i * 4 + 3] = hasAlpha ? ch(px, masks[3]!) : 255;
  }
  return out;
}

function rgb565(c: number): [number, number, number] {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/** BC1 (DXT1), BC2 (DXT3) or BC3 (DXT5) blocks to RGBA, as PIL's "bcn" decoder does. */
export function decodeBc(body: Uint8Array, w: number, h: number, n: 1 | 2 | 3): RGBAImage {
  const out = newImage(w, h);
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  const blockSize = n === 1 ? 8 : 16;
  const colors = new Uint8Array(16);
  const alpha = new Uint8Array(16);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const o = (by * bw + bx) * blockSize;
      if (o + blockSize > body.length) return out;
      let co = o;
      alpha.fill(255);
      if (n === 2) {
        for (let i = 0; i < 16; i++) {
          const a4 = (body[o + (i >> 1)]! >> ((i & 1) * 4)) & 15;
          alpha[i] = a4 * 17;
        }
        co = o + 8;
      } else if (n === 3) {
        const a0 = body[o]!;
        const a1 = body[o + 1]!;
        const pal = [a0, a1, 0, 0, 0, 0, 0, 0];
        if (a0 > a1) {
          for (let i = 1; i < 7; i++) pal[i + 1] = Math.floor(((7 - i) * a0 + i * a1) / 7);
        } else {
          for (let i = 1; i < 5; i++) pal[i + 1] = Math.floor(((5 - i) * a0 + i * a1) / 5);
          pal[6] = 0;
          pal[7] = 255;
        }
        // 48 bits of 3-bit indices.
        let lo = body[o + 2]! | (body[o + 3]! << 8) | (body[o + 4]! << 16);
        let hi = body[o + 5]! | (body[o + 6]! << 8) | (body[o + 7]! << 16);
        for (let i = 0; i < 8; i++) {
          alpha[i] = pal[lo & 7]!;
          lo >>= 3;
        }
        for (let i = 8; i < 16; i++) {
          alpha[i] = pal[hi & 7]!;
          hi >>= 3;
        }
        co = o + 8;
      }
      const c0 = body[co]! | (body[co + 1]! << 8);
      const c1 = body[co + 2]! | (body[co + 3]! << 8);
      const p0 = rgb565(c0);
      const p1 = rgb565(c1);
      const pal: [number, number, number, number][] = [
        [p0[0], p0[1], p0[2], 255],
        [p1[0], p1[1], p1[2], 255],
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ];
      if (n !== 1 || c0 > c1) {
        for (let k = 0; k < 3; k++) {
          pal[2]![k] = Math.floor((2 * p0[k]! + p1[k]!) / 3);
          pal[3]![k] = Math.floor((p0[k]! + 2 * p1[k]!) / 3);
        }
      } else {
        for (let k = 0; k < 3; k++) pal[2]![k] = Math.floor((p0[k]! + p1[k]!) / 2);
        pal[3] = [0, 0, 0, 0];
      }
      let idx = (body[co + 4]! | (body[co + 5]! << 8) | (body[co + 6]! << 16) | (body[co + 7]! << 24)) >>> 0;
      for (let i = 0; i < 16; i++) {
        colors[i] = idx & 3;
        idx >>>= 2;
      }
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3);
        const y = by * 4 + (i >> 2);
        if (x >= w || y >= h) continue;
        const c = pal[colors[i]!]!;
        const d = (y * w + x) * 4;
        out.data[d] = c[0];
        out.data[d + 1] = c[1];
        out.data[d + 2] = c[2];
        out.data[d + 3] = n === 1 ? c[3] : alpha[i]!;
      }
    }
  }
  return out;
}
