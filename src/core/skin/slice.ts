/**
 * How a skin key's image is drawn on a widget of w x h, for the skin editor's previews and the widget sheet: the
 * renderer's skinSlice (render/slice.ts: the client's margins per key, the scrollbar thumbs' repeated strip), so the
 * editor shows exactly what the window canvas draws. And artDepth, which tells when a texture's art reaches further in
 * than the key's margins.
 */
import { skinSlice } from "../render/slice.js";
import type { RGBAImage } from "../res/image.js";
import type { Margins } from "./keys.js";

export function sliceForKey(key: string, tex: RGBAImage, w: number, h: number): RGBAImage {
  return skinSlice(tex, key, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/**
 * How far in from each edge the art keeps changing (left, top, right, bottom, in source px): the last column (row) in
 * the outer half whose pixels differ clearly from the next one in, plus one. A rim, bevel, glow or corner ornament
 * deeper than the key's margin lies in the part the client stretches, so it grows and shrinks with the widget.
 * Gentle gradients and noise inside the frame are not counted.
 */
export function artDepth(tex: RGBAImage, threshold = 8): Margins {
  const { width: w, height: h, data } = tex;
  const diff = (a: number, b: number) => {
    let m = 0;
    for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(data[a + c]! - data[b + c]!));
    return m;
  };
  const colStep = (x: number) => {
    let s = 0;
    for (let y = 0; y < h; y++) s += diff((y * w + x) * 4, (y * w + x + 1) * 4);
    return s / h;
  };
  const rowStep = (y: number) => {
    let s = 0;
    for (let x = 0; x < w; x++) s += diff((y * w + x) * 4, ((y + 1) * w + x) * 4);
    return s / w;
  };
  const deepest = (n: number, step: (i: number) => number, mirror: boolean) => {
    let d = 0;
    for (let i = 0; i < Math.floor(n / 2); i++) {
      const v = mirror ? step(n - 2 - i) : step(i);
      if (v > threshold) d = i + 1;
    }
    return d;
  };
  return [deepest(w, colStep, false), deepest(h, rowStep, false), deepest(w, colStep, true), deepest(h, rowStep, true)];
}
