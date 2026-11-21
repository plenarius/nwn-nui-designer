/**
 * Image resizing that gives the same pixels as Pillow's Image.resize with BILINEAR or BOX: a separable convolution,
 * horizontal pass first, with Pillow's filter support, coefficient normalisation and 22-bit fixed-point rounding, on
 * premultiplied alpha for RGBA images (Pillow converts RGBA to RGBa to resize it). Written from the algorithm Pillow
 * documents in libImaging/Resample.c; nui-preview draws every skin texture and every text mask through it, so
 * matching it is what makes the golden pixel diffs small.
 */
import { type RGBAImage, newImage } from "../res/image.js";

/** "gpu": bilinear without Pillow's widening on a shrink, as a GPU samples a texture with no mipmaps. */
export type Filter = "bilinear" | "box" | "gpu";

const PRECISION_BITS = 32 - 8 - 2;

function filterFn(f: Filter): [(x: number) => number, number] {
  if (f === "box") return [(x) => (x > -0.5 && x <= 0.5 ? 1 : 0), 0.5];
  return [
    (x) => {
      if (x < 0) x = -x;
      return x < 1 ? 1 - x : 0;
    },
    1,
  ];
}

interface Coeffs {
  bounds: Int32Array; // xmin, xcount for each output pixel
  k: Int32Array; // ksize fixed-point coefficients for each output pixel
  ksize: number;
}

function precompute(inSize: number, outSize: number, f: Filter): Coeffs {
  const [fn, support0] = filterFn(f);
  const scale = inSize / outSize;
  const filterscale = scale < 1 || f === "gpu" ? 1 : scale;
  const support = support0 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2);
  const k = new Int32Array(outSize * ksize);
  const kk = new Float64Array(ksize);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    let ww = 0;
    const ss = 1 / filterscale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    for (let x = 0; x < xmax; x++) {
      const w = fn((x + xmin - center + 0.5) * ss);
      kk[x] = w;
      ww += w;
    }
    for (let x = 0; x < xmax; x++) if (ww !== 0) kk[x]! /= ww;
    for (let x = xmax; x < ksize; x++) kk[x] = 0;
    for (let x = 0; x < ksize; x++) {
      const v = kk[x]!;
      k[xx * ksize + x] = Math.trunc(v < 0 ? v * (1 << PRECISION_BITS) - 0.5 : v * (1 << PRECISION_BITS) + 0.5);
    }
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  return { bounds, k, ksize };
}

function clip8(v: number): number {
  // v is the accumulated sum; (v >> PRECISION_BITS) clipped to 0..255. Sums can exceed 2^31, so divide.
  const r = Math.floor(v / (1 << PRECISION_BITS));
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

/** Resizes channels-per-pixel data (1 or 4 channels, already premultiplied if RGBA). */
function resampleRaw(src: Uint8ClampedArray, w: number, h: number, ch: number, ow: number, oh: number, f: Filter): Uint8ClampedArray {
  let cur = src;
  let cw = w;
  const ch_ = h;
  if (ow !== w) {
    const c = precompute(w, ow, f);
    const out = new Uint8ClampedArray(ow * ch_ * ch);
    for (let y = 0; y < ch_; y++) {
      for (let xx = 0; xx < ow; xx++) {
        const xmin = c.bounds[xx * 2]!;
        const xmax = c.bounds[xx * 2 + 1]!;
        const kb = xx * c.ksize;
        for (let b = 0; b < ch; b++) {
          let ss = 1 << (PRECISION_BITS - 1);
          for (let x = 0; x < xmax; x++) ss += cur[(y * w + x + xmin) * ch + b]! * c.k[kb + x]!;
          out[(y * ow + xx) * ch + b] = clip8(ss);
        }
      }
    }
    cur = out;
    cw = ow;
  }
  if (oh !== h) {
    const c = precompute(h, oh, f);
    const out = new Uint8ClampedArray(cw * oh * ch);
    for (let yy = 0; yy < oh; yy++) {
      const ymin = c.bounds[yy * 2]!;
      const ymax = c.bounds[yy * 2 + 1]!;
      const kb = yy * c.ksize;
      for (let x = 0; x < cw; x++) {
        for (let b = 0; b < ch; b++) {
          let ss = 1 << (PRECISION_BITS - 1);
          for (let y = 0; y < ymax; y++) ss += cur[((y + ymin) * cw + x) * ch + b]! * c.k[kb + y]!;
          out[(yy * cw + x) * ch + b] = clip8(ss);
        }
      }
    }
    cur = out;
  }
  return cur === src ? new Uint8ClampedArray(src) : cur;
}

function mulDiv255(a: number, b: number): number {
  const t = a * b + 128;
  return ((t >> 8) + t) >> 8;
}

/** An RGBA image resized as Pillow's im.resize((w, h), BILINEAR | BOX). */
export function resize(im: RGBAImage, w: number, h: number, f: Filter = "bilinear"): RGBAImage {
  w = Math.max(1, Math.trunc(w));
  h = Math.max(1, Math.trunc(h));
  if (w === im.width && h === im.height) return { width: w, height: h, data: new Uint8ClampedArray(im.data) };
  if (im.width === 0 || im.height === 0) return newImage(w, h);
  const pre = new Uint8ClampedArray(im.data.length);
  for (let i = 0; i < im.data.length; i += 4) {
    const a = im.data[i + 3]!;
    if (a === 255) {
      pre[i] = im.data[i]!;
      pre[i + 1] = im.data[i + 1]!;
      pre[i + 2] = im.data[i + 2]!;
    } else if (a !== 0) {
      pre[i] = mulDiv255(im.data[i]!, a);
      pre[i + 1] = mulDiv255(im.data[i + 1]!, a);
      pre[i + 2] = mulDiv255(im.data[i + 2]!, a);
    }
    pre[i + 3] = a;
  }
  const out = resampleRaw(pre, im.width, im.height, 4, w, h, f);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3]!;
    if (a !== 255 && a !== 0) {
      out[i] = Math.min(255, Math.trunc((255 * out[i]!) / a));
      out[i + 1] = Math.min(255, Math.trunc((255 * out[i + 1]!) / a));
      out[i + 2] = Math.min(255, Math.trunc((255 * out[i + 2]!) / a));
    }
  }
  return { width: w, height: h, data: out };
}

/** A one-channel image (a mask) resized as Pillow's L-mode resize. */
export function resizeMask(data: Uint8ClampedArray, w: number, h: number, ow: number, oh: number, f: Filter): Uint8ClampedArray {
  if (ow === w && oh === h) return new Uint8ClampedArray(data);
  return resampleRaw(data, w, h, 1, ow, oh, f);
}
