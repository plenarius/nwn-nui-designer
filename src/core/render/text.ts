/**
 * Text and skin images drawn the way nui-preview's skin.py draws them: one line of text as a coverage mask built at
 * 4x and averaged down, with the client's faint dark outline; Nuklear's word wrap. (Skin textures: slice.ts.)
 */
import { type NuiFont, SUPERSAMPLE, pyRound } from "../font/font.js";
import { type RGBAImage, crop, newImage } from "../res/image.js";
import { resizeMask } from "./resample.js";

export type RGBA = readonly [number, number, number, number];

/** round(255 * (v / 255) ** 0.75): the client's glyphs come out a little heavier than plain coverage. */
const GAMMA = Array.from({ length: 256 }, (_, v) => pyRound(255 * (v / 255) ** 0.75));

function div255(a: number): number {
  const t = a + 128;
  return ((t >> 8) + t) >> 8;
}

/** (x offset, character) for each character, each on a whole pixel. */
export function* glyphRuns(text: string, font: NuiFont): Generator<[number, string]> {
  let x = 0;
  for (const ch of text) {
    yield [pyRound(x), ch];
    x += font.advance(ch);
  }
}

/** One line of text's coverage at 1x (gamma applied), w x h, the glyphs' top-left at (2, 2). Cached per font. */
const maskCache = new WeakMap<NuiFont, Map<string, { w: number; h: number; mask: Uint8ClampedArray }>>();

export function lineMask(font: NuiFont, text: string): { w: number; h: number; mask: Uint8ClampedArray } {
  let per = maskCache.get(font);
  if (!per) maskCache.set(font, (per = new Map()));
  const hit = per.get(text);
  if (hit) return hit;
  const k = SUPERSAMPLE;
  const w = Math.trunc(font.width(text)) + 6;
  const h = Math.trunc(font.ascent + font.descent + 4);
  const W = w * k;
  const H = h * k;
  const big = new Uint8ClampedArray(W * H);
  const baseline = 2 * k + font.bigAscent;
  for (const [gx, ch] of glyphRuns(text, font)) {
    const g = font.glyph(ch);
    const ox = (2 + gx) * k + g.x0;
    const oy = baseline + g.y0;
    for (let y = 0; y < g.h; y++) {
      const ty = oy + y;
      if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < g.w; x++) {
        const tx = ox + x;
        if (tx < 0 || tx >= W) continue;
        const cov = g.data[y * g.w + x]!;
        if (!cov) continue;
        const i = ty * W + tx;
        // Pillow's fill_mask_L: BLEND(mask, out, ink) with ink 255.
        big[i] = div255(big[i]! * (255 - cov) + 255 * cov);
      }
    }
  }
  const small = resizeMask(big, W, H, w, h, "box");
  for (let i = 0; i < small.length; i++) small[i] = GAMMA[small[i]!]!;
  const out = { w, h, mask: small };
  if (per.size > 4000) per.clear();
  per.set(text, out);
  return out;
}

/** PIL's MaxFilter(3) (edges replicated). */
function maxFilter3(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const v = src[yy * w + xx]!;
          if (v > m) m = v;
        }
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

/** PIL's alpha_composite of src over dst (both straight RGBA), in place on dst. */
export function alphaCompositeInPlace(dst: RGBAImage, src: RGBAImage, ox = 0, oy = 0): void {
  for (let y = 0; y < src.height; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x + ox;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const d = (dy * dst.width + dx) * 4;
      const sa = src.data[s + 3]!;
      const da = dst.data[d + 3]!;
      const outa255 = sa * 255 + da * (255 - sa);
      if (outa255 === 0) {
        dst.data[d] = dst.data[d + 1] = dst.data[d + 2] = dst.data[d + 3] = 0;
        continue;
      }
      // Pillow's ImagingAlphaComposite (PRECISION_BITS 7).
      const coef1 = Math.trunc((sa * 255 * 255 * 128) / outa255);
      const coef2 = 255 * 128 - coef1;
      for (let c = 0; c < 3; c++) {
        const tmp = src.data[s + c]! * coef1 + dst.data[d + c]! * coef2 + (0x80 << 7);
        dst.data[d + c] = ((tmp >> 8) + tmp) >> 8 >> 7;
      }
      dst.data[d + 3] = div255(outa255);
    }
  }
}

/**
 * One line of text as an RGBA layer to composite at (px, py), already clipped to clip (x0, y0, x1, y1), or null if
 * nothing shows. The line box (font.line high) is centred on the glyphs' box (ascent + descent), as Nuklear's baked
 * font is; each glyph starts on a whole pixel. The client's TTF fonts have a faint dark outline (fnt_*.txi
 * ttfOutlineOpacity): outline is its opacity.
 */
export function textLayer(
  font: NuiFont,
  text: string,
  x: number,
  y: number,
  fill: RGBA,
  clip: readonly [number, number, number, number],
  outline = 0.25,
): { im: RGBAImage; x: number; y: number } | null {
  if (!text) return null;
  const [x0, y0, x1, y1] = clip.map((v) => pyRound(v)) as [number, number, number, number];
  if (x1 <= x0 || y1 <= y0) return null;
  const { w, h, mask } = lineMask(font, text);
  const top = y + (font.line - (font.ascent + font.descent)) / 2 - 2;
  const px = Math.ceil(x - 0.5) - 2;
  // The GPU fills the pixels whose centres the glyph quad covers, so a line that lands on a half pixel goes up and
  // left (docs/CLIENT-BEHAVIOUR.md#text).
  const py = Math.ceil(top - 0.5);
  const cx0 = Math.max(x0, px);
  const cy0 = Math.max(y0, py);
  const cx1 = Math.min(x1, px + w);
  const cy1 = Math.min(y1, py + h);
  if (cx1 <= cx0 || cy1 <= cy0) return null;
  const layer = newImage(w, h);
  if (outline > 0) {
    const shade = maxFilter3(mask, w, h);
    for (let i = 0; i < w * h; i++) layer.data[i * 4 + 3] = Math.trunc((shade[i]! * outline * fill[3]) / 255);
  }
  const ink = newImage(w, h);
  for (let i = 0; i < w * h; i++) {
    ink.data[i * 4] = fill[0];
    ink.data[i * 4 + 1] = fill[1];
    ink.data[i * 4 + 2] = fill[2];
    ink.data[i * 4 + 3] = Math.trunc((mask[i]! * fill[3]) / 255);
  }
  alphaCompositeInPlace(layer, ink);
  return { im: crop(layer, cx0 - px, cy0 - py, cx1 - px, cy1 - py), x: cx0, y: cy0 };
}

/**
 * Nuklear's word wrap (nk_text_clamp with separators): lines break at spaces when the next word would not fit, at
 * newlines always; a word longer than the line is cut where it no longer fits.
 */
export function wrap(text: string, font: NuiFont, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (para === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(" ")) {
      const cand = line === "" ? word : line + " " + word;
      if (font.width(cand) <= width || (line === "" && font.width(word) <= width)) {
        line = cand;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      while (font.width(line) > width && [...line].length > 1) {
        const chars = [...line];
        let cut = chars.length;
        while (cut > 1 && font.width(chars.slice(0, cut).join("")) > width) cut--;
        lines.push(chars.slice(0, cut).join(""));
        line = chars.slice(cut).join("");
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * nk_text_clamp with no separators: glyphs are taken while the width so far is less than room, so the one that
 * crosses room is kept (and drawn over the edge).
 */
export function textClamp(s: string, font: NuiFont, room: number): string {
  const chars = [...s];
  let k = 0;
  let width = 0;
  while (k < chars.length && width < room) {
    k++;
    width = font.width(chars.slice(0, k).join(""));
  }
  return chars.slice(0, k).join("");
}

/** Moved to slice.ts (with the client's margins per key); re-exported here for old imports. */
export { nineSlice } from "./slice.js";
