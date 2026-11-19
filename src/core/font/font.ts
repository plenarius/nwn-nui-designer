/**
 * A skin font: its TTF at font_size pixels, measured and drawn the way nui-preview's skin.py does (which was matched
 * against the client's screenshots): the font's own advances (no kerning, as Nuklear's baked font has none), each
 * glyph on a whole pixel (pixel_snap), unhinted outlines rasterised at 4x and averaged down.
 *
 * Metrics follow FreeType at the font's integer pixel size, as Pillow reports them: advances are the hmtx advance
 * scaled in 16.16 fixed point and rounded to 1/64 px; the ascent and descent are FreeType's size metrics (ceiling and floor).
 *
 * TextModel "nuklear" (the default) follows nuklear.h's font baker instead: stbtt_ScaleForPixelHeight (font_size over
 * the hhea ascent-descent height, not the em), advances plus spacing_h rounded to whole pixels when pixel_snap is on.
 * It is what the 8193.37 client draws: checked against an in-game screenshot of the deity window at 1.8x (glyph
 * heights and word positions; DESIGN.md, "Checked against the client"). "nui-preview" (the em model) is kept to
 * compare with nwn-module's nui-preview, which uses it.
 */
import opentype from "opentype.js";
import type { Font as OtFont } from "opentype.js";
import { type CanvasFactory, ctx2d } from "../render/canvas.js";

export type TextModel = "nui-preview" | "nuklear";

export const SUPERSAMPLE = 4;

/** Python's round(): halves to even. */
export function pyRound(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** FreeType's FT_DivFix (16.16, rounded). */
function ftDivFix(a: number, b: number): number {
  const s = Math.sign(a) * Math.sign(b) || 1;
  return s * Math.floor((Math.abs(a) * 65536 + Math.abs(b) / 2) / Math.abs(b));
}

/** FreeType's FT_MulFix (16.16, rounded). */
function ftMulFix(a: number, b: number): number {
  const s = Math.sign(a) * Math.sign(b) || 1;
  return s * Math.floor((Math.abs(a) * Math.abs(b) + 0x8000) / 65536);
}

const PIX_CEIL = (x: number) => Math.ceil(x / 64) * 64;
const PIX_FLOOR = (x: number) => Math.floor(x / 64) * 64;

/** A glyph's coverage at SUPERSAMPLE x, placed relative to the pen (x0, y0: its top-left from the pen on the
 * baseline). */
export interface GlyphMask {
  x0: number;
  y0: number;
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

export interface FontFace {
  /** The parsed TTF (shared by every size of it). */
  ot: OtFont;
  resref: string;
  familyName: string;
}

export function parseFace(bytes: Uint8Array, resref: string): FontFace {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const ot = opentype.parse(buf);
  const names = ot.names as Record<string, Record<string, Record<string, string>>>;
  const fam = names.windows?.fontFamily ?? names.macintosh?.fontFamily ?? names.unicode?.fontFamily;
  return { ot, resref, familyName: fam ? (fam.en ?? Object.values(fam)[0] ?? resref) : resref };
}

/** FreeType's face ascender and descender (font units): hhea, else OS/2 typo, else OS/2 win. */
function faceAscDesc(ot: OtFont): [number, number] {
  const hh = ot.tables.hhea;
  if (hh.ascender || hh.descender) return [hh.ascender, hh.descender];
  const os2 = ot.tables.os2;
  if (os2 && (os2.sTypoAscender || os2.sTypoDescender)) return [os2.sTypoAscender, os2.sTypoDescender];
  if (os2) return [os2.usWinAscent, -os2.usWinDescent];
  return [ot.unitsPerEm, 0];
}

export class NuiFont {
  /** The height Nuklear lays a line out with (the font's pixel size). */
  readonly line: number;
  readonly ascent: number;
  readonly descent: number;
  /** The supersampled face's ascent: the baseline's distance from the top of a 4x line mask. */
  readonly bigAscent: number;
  /** Pixels per font unit, for outlines at 1x. */
  readonly scale: number;
  private readonly adv = new Map<string, number>();
  private readonly glyphs = new Map<string, GlyphMask>();
  private readonly xScale: number;

  constructor(
    readonly name: string,
    readonly face: FontFace,
    readonly size: number,
    readonly model: TextModel = "nuklear",
    readonly spacingH = 0.5,
    private readonly makeCanvas: CanvasFactory | null = null,
  ) {
    const ot = face.ot;
    const upem = ot.unitsPerEm;
    const [asc, desc] = faceAscDesc(ot);
    this.line = size;
    if (model === "nuklear") {
      const hh = ot.tables.hhea;
      this.scale = size / (hh.ascender - hh.descender);
      this.ascent = Math.round(hh.ascender * this.scale);
      this.descent = Math.round(-hh.descender * this.scale);
      this.xScale = 0;
      this.bigAscent = Math.round(hh.ascender * this.scale * SUPERSAMPLE);
    } else {
      const ppem = pyRound(size);
      this.scale = ppem / upem;
      const metrics = (px: number): [number, number, number] => {
        const s = ftDivFix(px * 64, upem);
        // Ceiling and floor, as FT_Request_Metrics sets them for a scalable face (Pillow's FreeType does not round
        // them even when the head flags ask for integer scaling: checked against Pillow 13 on four fonts).
        const a = PIX_CEIL(ftMulFix(asc, s));
        const d = PIX_FLOOR(ftMulFix(desc, s));
        // Pillow's getmetrics: PIXEL(ascender), -PIXEL(descender), PIXEL(x) = (x + 63) >> 6.
        return [Math.floor((a + 63) / 64), -Math.floor((d + 63) / 64), s];
      };
      const [a, d, s] = metrics(ppem);
      this.ascent = a;
      this.descent = d;
      this.xScale = s;
      this.bigAscent = metrics(ppem * SUPERSAMPLE)[0];
    }
  }

  advance(ch: string): number {
    let a = this.adv.get(ch);
    if (a === undefined) {
      const g = this.face.ot.charToGlyph(ch);
      const aw = g.advanceWidth ?? 0;
      if (this.model === "nuklear") {
        a = Math.floor(aw * this.scale + this.spacingH + 0.5);
      } else {
        a = ftMulFix(aw, this.xScale) / 64;
      }
      this.adv.set(ch, a);
    }
    return a;
  }

  width(text: string): number {
    let w = 0;
    for (const ch of text) w += this.advance(ch);
    return w;
  }

  /** Whether the font has a drawing for ch (not .notdef). */
  hasGlyph(ch: string): boolean {
    return this.face.ot.charToGlyphIndex(ch) > 0;
  }

  /** The glyph's coverage at SUPERSAMPLE x (unhinted outline, non-zero fill, the canvas's anti-aliasing). */
  glyph(ch: string): GlyphMask {
    let m = this.glyphs.get(ch);
    if (m) return m;
    m = this.rasterise(ch);
    this.glyphs.set(ch, m);
    return m;
  }

  private rasterise(ch: string): GlyphMask {
    const empty: GlyphMask = { x0: 0, y0: 0, w: 0, h: 0, data: new Uint8ClampedArray(0) };
    if (!this.makeCanvas) return empty;
    const g = this.face.ot.charToGlyph(ch);
    const px = this.scale * SUPERSAMPLE * this.face.ot.unitsPerEm;
    const cmds = g.getPath(0, 0, px).commands;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of cmds) {
      for (const [x, y] of [
        [c.x, c.y],
        [c.x1, c.y1],
        [c.x2, c.y2],
      ] as const) {
        if (x === undefined || y === undefined) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (!Number.isFinite(minX)) return empty;
    const x0 = Math.floor(minX) - 1;
    const y0 = Math.floor(minY) - 1;
    const w = Math.ceil(maxX) + 1 - x0;
    const h = Math.ceil(maxY) + 1 - y0;
    const c = this.makeCanvas(w, h);
    const ctx = ctx2d(c);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    for (const cmd of cmds) {
      if (cmd.type === "M") ctx.moveTo(cmd.x! - x0, cmd.y! - y0);
      else if (cmd.type === "L") ctx.lineTo(cmd.x! - x0, cmd.y! - y0);
      else if (cmd.type === "Q") ctx.quadraticCurveTo(cmd.x1! - x0, cmd.y1! - y0, cmd.x! - x0, cmd.y! - y0);
      else if (cmd.type === "C")
        ctx.bezierCurveTo(cmd.x1! - x0, cmd.y1! - y0, cmd.x2! - x0, cmd.y2! - y0, cmd.x! - x0, cmd.y! - y0);
      else if (cmd.type === "Z") ctx.closePath();
    }
    ctx.fill("nonzero");
    const id = ctx.getImageData(0, 0, w, h);
    const data = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) data[i] = id.data[i * 4 + 3]!;
    return { x0, y0, w, h, data };
  }
}
