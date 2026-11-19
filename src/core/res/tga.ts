/**
 * Truevision TGA: colour-mapped, true-colour and grey images, plain or run-length encoded, 8 to 32 bits, either
 * origin. Written from the TGA 2.0 specification.
 */
import { MAX_IMAGE_SIDE, type RGBAImage, newImage } from "./image.js";

export function decodeTga(bytes: Uint8Array): RGBAImage {
  if (bytes.length < 18) throw new Error("TGA: too short");
  const idLen = bytes[0]!;
  const cmapType = bytes[1]!;
  const imageType = bytes[2]!;
  const cmapFirst = bytes[3]! | (bytes[4]! << 8);
  const cmapLen = bytes[5]! | (bytes[6]! << 8);
  const cmapBits = bytes[7]!;
  const width = bytes[12]! | (bytes[13]! << 8);
  const height = bytes[14]! | (bytes[15]! << 8);
  const bits = bytes[16]!;
  const desc = bytes[17]!;
  const rle = imageType >= 9 && imageType <= 11;
  const kind = imageType & 7; // 1: colour-mapped, 2: true colour, 3: grey
  if (kind < 1 || kind > 3) throw new Error(`TGA: unsupported image type ${imageType}`);
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) throw new Error(`TGA: bad size ${width}x${height}`);
  if (![8, 15, 16, 24, 32].includes(bits)) throw new Error(`TGA: unsupported ${bits} bits a pixel`);
  const alphaBits = desc & 0x0f;
  const rightToLeft = (desc & 0x10) !== 0;
  const topToBottom = (desc & 0x20) !== 0;

  let p = 18 + idLen;
  // The colour map, as RGBA.
  let cmap: Uint8Array | null = null;
  if (cmapType === 1) {
    const eb = Math.ceil(cmapBits / 8);
    cmap = new Uint8Array((cmapFirst + cmapLen) * 4);
    for (let i = 0; i < cmapLen; i++) {
      readPixel(bytes, p + i * eb, cmapBits, cmap, (cmapFirst + i) * 4, alphaBits);
    }
    p += cmapLen * eb;
  }

  const bpp = Math.ceil(bits / 8);
  const n = width * height;
  // Pixels in file order, as RGBA.
  const px = new Uint8Array(n * 4);
  const tmp = new Uint8Array(4);
  const decode = (src: number, dst: number) => {
    if (kind === 1) {
      const idx = bits === 16 ? bytes[src]! | (bytes[src + 1]! << 8) : bytes[src]!;
      if (cmap && idx * 4 + 3 < cmap.length) {
        px[dst] = cmap[idx * 4]!;
        px[dst + 1] = cmap[idx * 4 + 1]!;
        px[dst + 2] = cmap[idx * 4 + 2]!;
        px[dst + 3] = cmap[idx * 4 + 3]!;
      }
    } else if (kind === 3) {
      const v = bytes[src]!;
      px[dst] = px[dst + 1] = px[dst + 2] = v;
      px[dst + 3] = bits === 16 ? bytes[src + 1]! : 255;
    } else {
      readPixel(bytes, src, bits, tmp, 0, alphaBits);
      px[dst] = tmp[0]!;
      px[dst + 1] = tmp[1]!;
      px[dst + 2] = tmp[2]!;
      px[dst + 3] = tmp[3]!;
    }
  };
  if (!rle) {
    for (let i = 0; i < n && p + bpp <= bytes.length; i++, p += bpp) decode(p, i * 4);
  } else {
    let i = 0;
    while (i < n && p < bytes.length) {
      const h = bytes[p++]!;
      const count = (h & 0x7f) + 1;
      if (h & 0x80) {
        decode(p, i * 4);
        const s = i * 4;
        p += bpp;
        for (let k = 1; k < count && i + k < n; k++) px.copyWithin((i + k) * 4, s, s + 4);
        i += count;
      } else {
        for (let k = 0; k < count && i < n; k++, i++, p += bpp) decode(p, i * 4);
      }
    }
  }

  const out = newImage(width, height);
  for (let y = 0; y < height; y++) {
    const sy = topToBottom ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const sx = rightToLeft ? width - 1 - x : x;
      const s = (sy * width + sx) * 4;
      const d = (y * width + x) * 4;
      out.data[d] = px[s]!;
      out.data[d + 1] = px[s + 1]!;
      out.data[d + 2] = px[s + 2]!;
      out.data[d + 3] = px[s + 3]!;
    }
  }
  return out;
}

/** One BGR(A) pixel of 15, 16, 24 or 32 bits at bytes[o], to RGBA at out[d]. */
function readPixel(bytes: Uint8Array, o: number, bits: number, out: Uint8Array, d: number, alphaBits: number): void {
  if (bits === 24 || bits === 32) {
    out[d] = bytes[o + 2]!;
    out[d + 1] = bytes[o + 1]!;
    out[d + 2] = bytes[o]!;
    // 32-bit TGAs carry alpha even when the descriptor forgets to say so (PIL reads them as RGBA too).
    out[d + 3] = bits === 32 ? bytes[o + 3]! : 255;
  } else if (bits === 15 || bits === 16) {
    const v = bytes[o]! | (bytes[o + 1]! << 8);
    const r = (v >> 10) & 31;
    const g = (v >> 5) & 31;
    const b = v & 31;
    // 5 bits to 8 as PIL widens them.
    out[d] = (r << 3) | (r >> 2);
    out[d + 1] = (g << 3) | (g >> 2);
    out[d + 2] = (b << 3) | (b >> 2);
    out[d + 3] = bits === 16 && alphaBits > 0 ? (v & 0x8000 ? 255 : 0) : 255;
  } else if (bits === 8) {
    out[d] = out[d + 1] = out[d + 2] = bytes[o]!;
    out[d + 3] = 255;
  }
}

/** A 32-bit uncompressed TGA, top-left origin. */
export function encodeTga(im: RGBAImage): Uint8Array {
  if (im.width > 0xffff || im.height > 0xffff) throw new Error(`a TGA is at most 65535 px a side (${im.width} x ${im.height})`);
  const out = new Uint8Array(18 + im.width * im.height * 4);
  out[2] = 2;
  out[12] = im.width & 255;
  out[13] = im.width >> 8;
  out[14] = im.height & 255;
  out[15] = im.height >> 8;
  out[16] = 32;
  out[17] = 0x28;
  for (let i = 0; i < im.width * im.height; i++) {
    out[18 + i * 4] = im.data[i * 4 + 2]!;
    out[18 + i * 4 + 1] = im.data[i * 4 + 1]!;
    out[18 + i * 4 + 2] = im.data[i * 4]!;
    out[18 + i * 4 + 3] = im.data[i * 4 + 3]!;
  }
  return out;
}
