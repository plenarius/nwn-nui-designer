/**
 * What the skin editor tells about a font: which characters of the client's code page it has (the client bakes only
 * those and draws "?" for the rest), an estimate of the atlas the client bakes, and its widths against another font
 * (the stock fnt_maintext when a game folder is loaded) under both text models.
 *
 * The atlas estimate follows nuklear.h's baker (nk_font_bake_pre / nk_font_bake_pack, through stb_truetype and
 * stb_rect_pack): one box per glyph at stbtt_ScaleForPixelHeight(font_size) times the oversampling, plus 1 px of
 * padding and oversample - 1, packed into a 512 px wide atlas (1024 above 1000 glyphs) whose height is rounded up to a
 * power of two. The client logs the real size ("NUI: Font bake complete; texture is WxHpx").
 */
import { CODE_PAGES } from "../skin/keys.js";
import { type FontFace, NuiFont, type TextModel } from "./font.js";

/** Characters a font is never asked for: C0 and C1 controls, DEL; and two layout characters NWN text does not use. */
const SKIP = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0xa0 || cp === 0xad;

export interface Coverage {
  codePage: string;
  /** Printable characters in the code page's ranges. */
  total: number;
  have: number;
  missing: number[];
}

export function coverage(face: FontFace, codePage = "cp1252"): Coverage {
  const cp = CODE_PAGES.find((c) => c.id === codePage) ?? CODE_PAGES[0]!;
  const missing: number[] = [];
  let total = 0;
  for (const [a, b] of cp.ranges) {
    for (let c = a; c <= b; c++) {
      if (SKIP(c)) continue;
      total++;
      if (face.ot.charToGlyphIndex(String.fromCodePoint(c)) <= 0) missing.push(c);
    }
  }
  return { codePage: cp.id, total, have: total - missing.length, missing };
}

export const uplus = (c: number) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`;

export interface AtlasEntry {
  face: FontFace;
  size: number;
  oversampleH: number;
  oversampleV: number;
}

export interface AtlasEstimate {
  width: number;
  height: number;
  glyphs: number;
  /** Bytes of the RGBA atlas texture. */
  bytes: number;
}

/** The atlas the client bakes for these fonts together (every [[fonts]] entry shares one). */
export function estimateAtlas(entries: AtlasEntry[], codePage = "cp1252", guiScale = 1): AtlasEstimate {
  const cp = CODE_PAGES.find((c) => c.id === codePage) ?? CODE_PAGES[0]!;
  const rects: [number, number][] = [];
  for (const e of entries) {
    const ot = e.face.ot;
    const hh = ot.tables.hhea;
    const size = (e.size > 0 ? e.size : 16) * guiScale;
    const scale = size / (hh.ascender - hh.descender);
    const oh = Math.max(1, Math.trunc(e.oversampleH));
    const ov = Math.max(1, Math.trunc(e.oversampleV));
    for (const [a, b] of cp.ranges) {
      for (let c = a; c <= b; c++) {
        const g = ot.charToGlyph(String.fromCodePoint(c));
        const cmds = g.getPath(0, 0, ot.unitsPerEm).commands;
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const m of cmds) {
          if (m.x === undefined || m.y === undefined) continue;
          x0 = Math.min(x0, m.x);
          x1 = Math.max(x1, m.x);
          y0 = Math.min(y0, m.y);
          y1 = Math.max(y1, m.y);
        }
        // stbtt: an empty glyph (space) still gets a 1 x 1 box plus the padding.
        const w = Number.isFinite(x0) ? Math.ceil(x1 * scale * oh) - Math.floor(x0 * scale * oh) : 0;
        const h = Number.isFinite(y0) ? Math.ceil(y1 * scale * ov) - Math.floor(y0 * scale * ov) : 0;
        rects.push([w + 1 + oh - 1, h + 1 + ov - 1]);
      }
    }
  }
  const width = rects.length > 1000 ? 1024 : 512;
  const used = skylinePack(rects, width);
  let height = 1;
  while (height < used) height *= 2;
  return { width, height, glyphs: rects.length, bytes: width * height * 4 };
}

/** stb_rect_pack's default: skyline, bottom-left, rects sorted by height (then width), tallest first. Returns the
 * height used. */
function skylinePack(rects: [number, number][], width: number): number {
  const order = [...rects].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  // The skyline as [x, y, w] segments.
  let sky: [number, number, number][] = [[0, 0, width]];
  let top = 0;
  for (const [w, h] of order) {
    if (w > width) continue;
    let best = -1;
    let bestY = Infinity;
    for (let i = 0; i < sky.length; i++) {
      const x = sky[i]![0];
      if (x + w > width) break;
      let y = 0;
      let span = 0;
      for (let j = i; j < sky.length && span < w; j++) {
        y = Math.max(y, sky[j]![1]);
        span += sky[j]![2];
      }
      if (span < w) continue;
      if (y < bestY) {
        bestY = y;
        best = i;
      }
    }
    if (best < 0) continue;
    const x = sky[best]![0];
    const y = bestY + h;
    top = Math.max(top, y);
    const next: [number, number, number][] = [];
    for (const seg of sky) {
      const [sx, sy, sw] = seg;
      const ex = sx + sw;
      if (ex <= x || sx >= x + w) next.push(seg);
      else {
        if (sx < x) next.push([sx, sy, x - sx]);
        if (ex > x + w) next.push([x + w, sy, ex - (x + w)]);
      }
    }
    next.push([x, y, w]);
    next.sort((a, b) => a[0] - b[0]);
    // Merge neighbours of the same height.
    sky = [];
    for (const s of next) {
      const last = sky[sky.length - 1];
      if (last && last[1] === s[1] && last[0] + last[2] === s[0]) last[2] += s[2];
      else sky.push([...s]);
    }
  }
  return top;
}

/** Plain UI text for comparing widths (tools/open-skin/font_metrics.py's built-in sample, split into strings). */
export const WIDTH_SAMPLE = [
  "The smith hammers the blade while the apprentice keeps the forge hot.",
  "Wood Crafting: 28 XP.",
  "Choose this deity?",
  "Requirements: Strength 13, a hammer and tongs.",
  "You cannot carry more than 200 lbs.",
  "Achievements earned: 12 of 47 (25%).",
  "Bag of Sawdust, Planks x4, Oak Branch, Iron Nails.",
];

export interface WidthCompare {
  model: TextModel;
  /** Total width of the sample in this font over the reference's. */
  ratio: number;
  rows: { text: string; width: number; ref: number }[];
}

/** The font's widths against a reference font at the same size and spacing, under one text model. */
export function compareWidths(face: FontFace, ref: FontFace, size: number, spacingH: number, refSpacingH: number, model: TextModel, sample = WIDTH_SAMPLE): WidthCompare {
  const a = new NuiFont("a", face, size, model, spacingH);
  const b = new NuiFont("b", ref, 17, model, refSpacingH);
  const rows = sample.map((text) => ({ text, width: a.width(text), ref: b.width(text) }));
  const sa = rows.reduce((s, r) => s + r.width, 0);
  const sb = rows.reduce((s, r) => s + r.ref, 0);
  return { model, ratio: sb ? sa / sb : 0, rows };
}
