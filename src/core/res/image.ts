/** The largest side a decoder accepts (NWN's own textures are at most 4096; DDS has always had this limit here). A
 * damaged header that claims more would otherwise make the decoder allocate gigabytes. */
export const MAX_IMAGE_SIDE = 16384;

/** An RGBA image with straight (not premultiplied) alpha, 8 bits a channel, rows top to bottom. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function newImage(width: number, height: number, fill?: readonly [number, number, number, number]): RGBAImage {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const data = new Uint8ClampedArray(w * h * 4);
  if (fill && (fill[0] || fill[1] || fill[2] || fill[3])) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
    }
  }
  return { width: w, height: h, data };
}

/** The part (x0, y0)-(x1, y1) of im; outside it reads as transparent (as PIL's crop). */
export function crop(im: RGBAImage, x0: number, y0: number, x1: number, y1: number): RGBAImage {
  const out = newImage(x1 - x0, y1 - y0);
  for (let y = 0; y < out.height; y++) {
    const sy = y + y0;
    if (sy < 0 || sy >= im.height) continue;
    for (let x = 0; x < out.width; x++) {
      const sx = x + x0;
      if (sx < 0 || sx >= im.width) continue;
      const s = (sy * im.width + sx) * 4;
      const d = (y * out.width + x) * 4;
      out.data[d] = im.data[s]!;
      out.data[d + 1] = im.data[s + 1]!;
      out.data[d + 2] = im.data[s + 2]!;
      out.data[d + 3] = im.data[s + 3]!;
    }
  }
  return out;
}

/** Copies src into dst at (x, y), replacing what is there (PIL's paste without a mask). */
export function paste(dst: RGBAImage, src: RGBAImage, x: number, y: number): void {
  for (let j = 0; j < src.height; j++) {
    const dy = y + j;
    if (dy < 0 || dy >= dst.height) continue;
    for (let i = 0; i < src.width; i++) {
      const dx = x + i;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (j * src.width + i) * 4;
      const d = (dy * dst.width + dx) * 4;
      dst.data[d] = src.data[s]!;
      dst.data[d + 1] = src.data[s + 1]!;
      dst.data[d + 2] = src.data[s + 2]!;
      dst.data[d + 3] = src.data[s + 3]!;
    }
  }
}
