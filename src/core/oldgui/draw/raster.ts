/**
 * Pictures and masks for the old GUI's redraw. A Pic is float RGBA in display order (row 0 at the top, v = 1); a
 * Mask is one byte a texel (0 or 1), row by row. The morphology follows scipy.ndimage's binary operations (square
 * structuring elements, erosion's border off), which the hand-made reference redraw used.
 */
import { type RGBAImage, newImage } from "../../res/image.js";

export type RGB = readonly [number, number, number] | readonly number[];

export interface Pic {
  w: number;
  h: number;
  d: Float32Array;
}

export type Mask = Uint8Array;

export function pic(w: number, h: number, c: RGB = [0, 0, 0], a = 255): Pic {
  const d = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = c[0]!;
    d[i * 4 + 1] = c[1]!;
    d[i * 4 + 2] = c[2]!;
    d[i * 4 + 3] = a;
  }
  return { w, h, d };
}

export function fromImage(im: RGBAImage): Pic {
  return { w: im.width, h: im.height, d: Float32Array.from(im.data) };
}

export function toImage(p: Pic): RGBAImage {
  const im = newImage(p.w, p.h);
  for (let i = 0; i < p.d.length; i++) im.data[i] = Math.round(Math.min(255, Math.max(0, p.d[i]!)));
  return im;
}

export const clonePic = (p: Pic): Pic => ({ w: p.w, h: p.h, d: p.d.slice() });

export function setRgb(p: Pic, x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const o = (y * p.w + x) * 4;
  p.d[o] = c[0]!;
  p.d[o + 1] = c[1]!;
  p.d[o + 2] = c[2]!;
}

export function setA(p: Pic, x: number, y: number, a: number): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  p.d[(y * p.w + x) * 4 + 3] = a;
}

export const rgbAt = (p: Pic, x: number, y: number): number[] => {
  const o = (y * p.w + x) * 4;
  return [p.d[o]!, p.d[o + 1]!, p.d[o + 2]!];
};
export const alphaAt = (p: Pic, x: number, y: number): number => p.d[(y * p.w + x) * 4 + 3]!;

/** Fills [x0, x1) x [y0, y1) with a colour (and an alpha, when given), clipped to the picture. */
export function fillRect(p: Pic, x0: number, y0: number, x1: number, y1: number, c: RGB | null, a?: number): void {
  for (let y = Math.max(0, y0); y < Math.min(p.h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(p.w, x1); x++) {
      if (c) setRgb(p, x, y, c);
      if (a !== undefined) setA(p, x, y, a);
    }
  }
}

/** A 1 px rectangle outline along the inside of [x0, x1) x [y0, y1). */
export function ring(p: Pic, x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  fillRect(p, x0, y0, x1, y0 + 1, c);
  fillRect(p, x0, y1 - 1, x1, y1, c);
  fillRect(p, x0, y0, x0 + 1, y1, c);
  fillRect(p, x1 - 1, y0, x1, y1, c);
}

export const lum = (c: RGB): number => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;

/** Luminance of each texel, times its alpha when `alpha` is set. */
export function lumOf(p: Pic, alpha = false): Float32Array {
  const out = new Float32Array(p.w * p.h);
  for (let i = 0; i < out.length; i++) {
    const l = 0.299 * p.d[i * 4]! + 0.587 * p.d[i * 4 + 1]! + 0.114 * p.d[i * 4 + 2]!;
    out[i] = alpha ? (l * p.d[i * 4 + 3]!) / 255 : l;
  }
  return out;
}

// --- masks ------------------------------------------------------------------------------------------------------------

export const mask = (w: number, h: number): Mask => new Uint8Array(w * h);
export const or = (a: Mask, b: Mask): Mask => a.map((v, i) => v | b[i]!);
export const and = (a: Mask, b: Mask): Mask => a.map((v, i) => v & b[i]!);
export const andNot = (a: Mask, b: Mask): Mask => a.map((v, i) => (v && !b[i] ? 1 : 0));
export const not = (a: Mask): Mask => a.map((v) => (v ? 0 : 1));
export const any = (a: Mask): boolean => a.some((v) => v !== 0);
export const count = (a: Mask): number => a.reduce((s, v) => s + v, 0);

function erode1(m: Mask, w: number, h: number, r: number, axis: 0 | 1): Mask {
  const out = mask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let k = -r; k <= r && ok; k++) {
        const xx = axis === 1 ? x + k : x;
        const yy = axis === 0 ? y + k : y;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !m[yy * w + xx]) ok = 0;
      }
      out[y * w + x] = ok;
    }
  }
  return out;
}

function dilate1(m: Mask, w: number, h: number, r: number, axis: 0 | 1): Mask {
  const out = mask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let k = -r; k <= r && !hit; k++) {
        const xx = axis === 1 ? x + k : x;
        const yy = axis === 0 ? y + k : y;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx]) hit = 1;
      }
      out[y * w + x] = hit;
    }
  }
  return out;
}

/** Erosion by a k x k square (k odd), `iter` times; texels beyond the edge count as off. */
export function erode(m: Mask, w: number, h: number, k = 3, iter = 1): Mask {
  let o = m;
  for (let i = 0; i < iter; i++) o = erode1(erode1(o, w, h, k >> 1, 1), w, h, k >> 1, 0);
  return o;
}

export function dilate(m: Mask, w: number, h: number, k = 3, iter = 1): Mask {
  let o = m;
  for (let i = 0; i < iter; i++) o = dilate1(dilate1(o, w, h, k >> 1, 1), w, h, k >> 1, 0);
  return o;
}

export const opening = (m: Mask, w: number, h: number, k: number, iter = 1): Mask => dilate(erode(m, w, h, k, iter), w, h, k, iter);
export const closing = (m: Mask, w: number, h: number, k: number, iter = 1): Mask => erode(dilate(m, w, h, k, iter), w, h, k, iter);

/** Connected regions of set texels: labels 1..n (0 off), 4- or 8-connected. */
export function label(m: Mask, w: number, h: number, eight = false): { lab: Int32Array; n: number } {
  const lab = new Int32Array(w * h);
  const q = new Int32Array(w * h);
  let n = 0;
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s]) continue;
    n++;
    lab[s] = n;
    let qh = 0;
    let qt = 0;
    q[qt++] = s;
    while (qh < qt) {
      const p = q[qh++]!;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (!eight && dx && dy)) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const t = yy * w + xx;
          if (m[t] && !lab[t]) {
            lab[t] = n;
            q[qt++] = t;
          }
        }
      }
    }
  }
  return { lab, n };
}

/** Holes (off regions not reaching the edge, 4-connected) filled. */
export function fillHoles(m: Mask, w: number, h: number): Mask {
  const { lab, n } = label(not(m), w, h);
  const edge = new Uint8Array(n + 1);
  for (let x = 0; x < w; x++) {
    edge[lab[x]!] = 1;
    edge[lab[(h - 1) * w + x]!] = 1;
  }
  for (let y = 0; y < h; y++) {
    edge[lab[y * w]!] = 1;
    edge[lab[y * w + w - 1]!] = 1;
  }
  return m.map((v, i) => (v || !edge[lab[i]!] ? 1 : 0));
}

/** The length of the run of set texels each texel is in, along rows (axis 1) or columns (axis 0). */
export function runLength(m: Mask, w: number, h: number, axis: 0 | 1): Int32Array {
  const out = new Int32Array(w * h);
  const [outer, inner] = axis === 1 ? [h, w] : [w, h];
  const at = (o: number, i: number) => (axis === 1 ? o * w + i : i * w + o);
  for (let o = 0; o < outer; o++) {
    let i = 0;
    while (i < inner) {
      if (!m[at(o, i)]) {
        i++;
        continue;
      }
      let j = i;
      while (j < inner && m[at(o, j)]) j++;
      for (let k = i; k < j; k++) out[at(o, k)] = j - i;
      i = j;
    }
  }
  return out;
}

/** Bounding boxes [x0, y0, x1, y1) of each label 1..n. */
export function boxes(lab: Int32Array, n: number, w: number, h: number): ([number, number, number, number] | null)[] {
  const out: ([number, number, number, number] | null)[] = Array.from({ length: n + 1 }, () => null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = lab[y * w + x]!;
      if (!id) continue;
      const b = out[id];
      if (!b) out[id] = [x, y, x + 1, y + 1];
      else {
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x + 1 > b[2]) b[2] = x + 1;
        if (y + 1 > b[3]) b[3] = y + 1;
      }
    }
  }
  return out;
}
