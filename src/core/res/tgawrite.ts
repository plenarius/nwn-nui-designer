/**
 * The skin's TGA writer: 32-bit uncompressed (type 2), 8 alpha bits, rows bottom to top (the TGA default and what the
 * game's own NUI textures use), and the TGA 2.0 footer. It is the layout Pillow writes (the open skin's generator
 * saved assets/skin/ with Pillow), so the same pixels give the same bytes.
 */
import type { RGBAImage } from "./image.js";

const FOOTER = new TextEncoder().encode("TRUEVISION-XFILE.\0");

export function encodeTga32(im: RGBAImage): Uint8Array {
  const { width: w, height: h } = im;
  if (w > 0xffff || h > 0xffff) throw new Error(`a TGA is at most 65535 px a side (${w} x ${h})`);
  const out = new Uint8Array(18 + w * h * 4 + 8 + FOOTER.length);
  out[2] = 2;
  out[12] = w & 255;
  out[13] = w >> 8;
  out[14] = h & 255;
  out[15] = h >> 8;
  out[16] = 32;
  out[17] = 8;
  let o = 18;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[o++] = im.data[i + 2]!;
      out[o++] = im.data[i + 1]!;
      out[o++] = im.data[i]!;
      out[o++] = im.data[i + 3]!;
    }
  }
  out.set(FOOTER, o + 8);
  return out;
}

/** A 24-bit uncompressed TGA (no alpha), rows bottom to top, as the original GUI's opaque textures are stored. */
export function encodeTga24(im: RGBAImage): Uint8Array {
  const { width: w, height: h } = im;
  if (w > 0xffff || h > 0xffff) throw new Error(`a TGA is at most 65535 px a side (${w} x ${h})`);
  const out = new Uint8Array(18 + w * h * 3);
  out[2] = 2;
  out[12] = w & 255;
  out[13] = w >> 8;
  out[14] = h & 255;
  out[15] = h >> 8;
  out[16] = 24;
  let o = 18;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[o++] = im.data[i + 2]!;
      out[o++] = im.data[i + 1]!;
      out[o++] = im.data[i]!;
    }
  }
  return out;
}
