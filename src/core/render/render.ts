/**
 * Draws a NUI window the way the client does: the skin's textures on each widget, the skin's font at its size, text
 * clipped where the client clips it, images from the game and the haks; and lists what is wrong with it. A port of
 * nwn-module tools/nui-preview/render.py (whose numbers were matched against a screenshot of the 8193.37-17 client at
 * 1440x900, NUI scale 1.0; it draws as the client does since nwn-module PR #1115), on a Canvas 2D surface. Beyond
 * nui-preview: curves and arcs, the window font on the title, the client's image lookup order and nui_i_check's
 * required-size check. See DESIGN.md.
 */
import { pyRound } from "../font/font.js";
import type { NuiFont } from "../font/font.js";
import {
  LayoutNode,
  type Rect,
  SELECT_LISTS,
  SPANS,
  selectHorizontal,
  selectLabels,
  type Solved,
  UnsatisfiableLayout,
  solveContent,
  solveRowTemplate,
  templateCells,
} from "../layout/layout.js";
import { type Binds, type JsonObject, type JsonValue, isObject, num } from "../model/types.js";
import { type RGBAImage, crop, newImage } from "../res/image.js";
import type { Images } from "../res/images.js";
import { type Skin, color } from "../skin/skin.js";
import { resize, resizeMask } from "./resample.js";
import type { Point, Surface } from "./surface.js";
import { skinSlice } from "./slice.js";
import { type SliceCache, sliceCacheOf } from "./slicecache.js";
import { type RGBA, textClamp, textLayer, wrap } from "./text.js";
import { pyFloat, pyStr, truthy } from "./values.js";
import { checkRequiredSizes } from "./check.js";
import { windowChrome, windowPosition } from "../model/window.js";

/** The window's frame, from the screenshot: a title bar 33 high, the body below it, and the content inset in it. */
export const CHROME = {
  header_h: 33,
  /** The body's frame starts right under the title bar's (the in-game deity window at 1.8x: DESIGN.md). */
  body_gap: 0,
  title_x: 7,
  button: 16,
  button_right: 9,
  button_gap: 10,
  content_x: 8,
  content_y: 8,
  content_bottom: 8,
};
export const SCROLLBAR = 18;
export const LIST_INSET_X = 4;
export const LIST_INSET_Y = 4;
export const LIST_SPACING = 4;
export const TEXT_INSET_X = 2;
/** A text box wraps this much short of its width: room for a scrollbar, even with none. Measured on the in-game deity
 * window with the Nuklear text model: the client's wrap width for a 500 px box is in [480, 488) (DESIGN.md). */
export const TEXT_WRAP_LESS = SCROLLBAR;
/** The first line of a text box starts this far below its top (2: the in-game deity window at 1.8x; DESIGN.md). */
export const TEXT_INSET_Y = 2;
export const TEXT_BORDER_INSET = 4;
/** A wrapped text's line pitch is the font's size plus this (17 + 4 = 21). */
export const LINE_SPACING = 4;
/**
 * A tooltip is one line in a popup the text's width + 16 wide, its left edge 21 px right of the mouse, with no clamp
 * to the screen (docs/CLIENT-BEHAVIOUR.md#tooltips).
 */
export const TOOLTIP_PAD = 16;
export const TOOLTIP_MOUSE_X = 21;
export const EDIT_PAD_X = 8;
/**
 * The open list of a combo (nk_combo_callback; docs/CLIENT-BEHAVIOUR.md#combo-boxes): a popup from the combo's left edge,
 * overlapping its bottom by the combo border (style.window.combo_border: the border image's slice margin + 1, 4 px), as
 * wide as the widest label + 50 + a scrollbar, rows a font height + 2 high and spacing.y (Nuklear's 4) apart, at most
 * 300 high (it scrolls past that), opened downward and never clipped to the window or the screen.
 */
export const COMBO_BORDER = 4;
export const COMBO_SPACING_Y = 4;
export const COMBO_LIST_EXTRA_W = 50;
export const COMBO_LIST_MAX_H = 300;
/** A group's or a list's padding (Nuklear's style.window.group_padding, which the skin does not set). */
export const GROUP_PADDING_Y = 4;
/** The window's padding when the skin sets no window.padding_y (Nuklear's default). */
export const WINDOW_PADDING_Y = 4;
export const DISABLED_ALPHA = 0.5;
export const EMPTY_H = 48;
const PLACEHOLDER: RGBA = [128, 128, 128, 255];
const GOLD_FRAME: RGBA = [173, 142, 96, 255];
/** Draw-list circles are drawn this many times larger and averaged down (anti-aliased edges). */
const CIRCLE_SUPERSAMPLE = 8;

/** A JSON number, or def (as nui-preview's number()). */
function num0(v: unknown, def: number): number {
  return typeof v === "number" ? v : def;
}

export type ClipBox = [x0: number, y0: number, x1: number, y1: number];

/** Where a combo's open list is, and how its rows are laid out (comboList). */
export interface ComboList {
  rect: Rect;
  /** A row's height (the font's + 2), the spacing between rows, and the containing panel's padding.y. */
  rowH: number;
  spacing: number;
  pad: number;
  /** The rows' whole height, and whether the list scrolls (it is cut at 300 · s). */
  content: number;
  scrolls: boolean;
}

/**
 * The open list of a combo at combo rect r, as nk_combo_callback sizes it (docs/CLIENT-BEHAVIOUR.md#combo-boxes): widest is
 * the widest entry label, count the entries, line the font's height, pad the containing panel's padding.y, scrollbar
 * the skin's scrollbar size, s the GUI scale. An empty list still opens, s · 2 · (pad + spacing) high.
 */
export function comboList(r: Rect, widest: number, count: number, line: number, pad: number, scrollbar: number, s = 1): ComboList {
  const rowH = line + 2;
  const sp = COMBO_SPACING_Y;
  const content = s * ((sp + rowH) * count + 2 * (pad + sp));
  const h = Math.min(COMBO_LIST_MAX_H * s, content);
  const w = s * widest + COMBO_LIST_EXTRA_W + scrollbar;
  return { rect: [r[0], r[1] + r[3] - COMBO_BORDER, w, h], rowH, spacing: sp, pad, content, scrolls: content > h + 0.01 };
}

export interface Problem {
  path: string;
  kind: string;
  text: string;
  rect: Rect;
  /** The element it is about (the same object as in the window), when there is one: the editor marks it. */
  elem?: JsonObject;
}

export function problemString(p: Problem): string {
  return `${p.kind}: ${p.path}: ${p.text}`;
}

/**
 * The problems as the editor lists them (DESIGN.md, "Problems and house style"): the solver's "unsolvable layout" is folded into the
 * static "unsolvable size" it follows from, as one entry that says why (the span and the sizes that do not fit) and
 * names the element whose constraint was refused. They are related when one path is inside the other (a list row's
 * solver path is compared from the list: `.../list/row 3/...`). A solver problem with no static one stays on its own
 * (the static check does not catch everything). The renderer's own list keeps both, as nui-preview reports them.
 */
export function foldUnsolvable(problems: readonly Problem[]): Problem[] {
  const sizes = problems.filter((p) => p.kind === "unsolvable size");
  if (!sizes.length) return [...problems];
  const folded = new Map<Problem, string[]>();
  const out: Problem[] = [];
  for (const p of problems) {
    if (p.kind !== "unsolvable layout") {
      out.push(p);
      continue;
    }
    const base = p.path.replace(/\/row \d+(\/.*)?$/, "");
    const into = sizes.find((s) => p.path.startsWith(s.path) || s.path.startsWith(base));
    if (!into) {
      out.push(p);
      continue;
    }
    folded.set(into, [...(folded.get(into) ?? []), p.path]);
  }
  return out.map((p) => {
    const at = folded.get(p);
    return at ? { ...p, text: `${p.text}; the layout is refused at ${at.join(", ")}` } : p;
  });
}

/** An element's place on the canvas (the overlay's outlines, the editor's hit testing). */
export interface Outline {
  rect: Rect;
  path: string;
  isSpan: boolean;
  visible: boolean;
  type: string;
  /** The element's JSON (the same object as in the window). */
  elem: JsonObject;
  /** The list row it is drawn in, if any. */
  row: number | null;
}

interface Ctx {
  ox: number;
  oy: number;
  clip: ClipBox;
  row: number | null;
  disabled: boolean;
  /** The copy of a draw-list item with array binds being drawn (each bound array is indexed by it, after the row). */
  item?: number | null;
  /** The padding.y of the panel the element is in (a group's or list's); unset in the window's own content. */
  padY?: number;
}

function intersect(a: ClipBox, b: ClipBox): ClipBox {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

function short(s: string, n = 48): string {
  const chars = [...s];
  return chars.length <= n ? s : chars.slice(0, n - 3).join("") + "...";
}

/** The part of s that shows in room. */
function fits(s: string, font: NuiFont, room: number): string {
  let w = 0;
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    w += font.advance(chars[i]!);
    if (w > room) return short(chars.slice(0, i).join(""), 40);
  }
  return short(s, 40);
}

function f0(v: number): string {
  // Python's f"{v:.0f}": round half to even.
  const r = pyRound(v);
  return Object.is(r, -0) ? "0" : String(r === 0 ? 0 : r);
}

function withAlpha(im: RGBAImage, alpha: number): RGBAImage {
  if (alpha >= 1) return im;
  const out = { width: im.width, height: im.height, data: new Uint8ClampedArray(im.data) };
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = Math.trunc(out.data[i]! * alpha);
  return out;
}

export class Renderer {
  problems: Problem[] = [];
  outlines: Outline[] = [];
  /** The screen's size, for the tooltip and combo list checks (set by window()). */
  private screenW = Infinity;
  private screenH = Infinity;
  /** The combo whose open list is drawn (on top of the window, past its edge if need be), if any. */
  openCombo: JsonObject | null = null;
  /** The popups drawn past the window (an open combo list): a crop keeps them. */
  popups: Rect[] = [];
  /** Popups to draw once the window is drawn (they are on top of it). */
  private deferred: (() => void)[] = [];
  /** Lay out and check, draw nothing (list rows scrolled out of sight). */
  dry = false;
  private panes: Record<string, JsonObject> = {};
  /** Nine-slices and resized textures, kept across redraws per skin (slicecache.ts). */
  private readonly sliceCache: SliceCache;

  constructor(
    readonly skin: Skin,
    readonly images: Images,
    readonly binds: Binds,
    readonly surface: Surface,
  ) {
    this.sliceCache = sliceCacheOf(skin);
  }

  // --- values ---------------------------------------------------------------------------------------------------

  value(elem: JsonObject, key: string, ctx: Ctx, def: JsonValue | undefined = undefined): JsonValue | undefined {
    let v: JsonValue | undefined = key in elem ? elem[key] : def;
    if (isObject(v) && "bind" in v) {
      const name = String(v.bind);
      if (!(name in this.binds)) {
        return def !== undefined && def !== null ? def : key === "label" || key === "value" ? `{${name}}` : null;
      }
      v = this.binds[name];
      if (Array.isArray(v) && ctx.row !== null) v = ctx.row < v.length ? v[ctx.row] : def;
      if (Array.isArray(v) && ctx.item !== undefined && ctx.item !== null) v = ctx.item < v.length ? v[ctx.item] : def;
    }
    if (isObject(v) && "strref" in v) v = `<strref ${pyStr(v.strref)}>`;
    return v;
  }

  text(elem: JsonObject, key: string, ctx: Ctx): string {
    const v = this.value(elem, key, ctx, "");
    if (v === null || v === undefined) return "";
    return pyStr(v);
  }

  flag(elem: JsonObject, key: string, ctx: Ctx, def = true): boolean {
    const v = this.value(elem, key, ctx, def);
    if (v === null || v === undefined) return def;
    return truthy(v);
  }

  tex(name: string | null | undefined): RGBAImage | null {
    if (!name) return null;
    return this.images.peek(name) ?? null;
  }

  private skinStr(path: string, def: string): string {
    const v = this.skin.get(path);
    return typeof v === "string" ? v : def;
  }

  // --- drawing helpers --------------------------------------------------------------------------------------

  paste(im: RGBAImage | null, x: number, y: number, alpha = 1, clip: ClipBox | null = null): void {
    if (!im || this.dry) return;
    let px = pyRound(x);
    let py = pyRound(y);
    let img = withAlpha(im, alpha);
    if (clip) {
      const [cx0, cy0, cx1, cy1] = clip.map(pyRound) as ClipBox;
      const x0 = Math.max(px, cx0);
      const y0 = Math.max(py, cy0);
      const x1 = Math.min(px + img.width, cx1);
      const y1 = Math.min(py + img.height, cy1);
      if (x1 <= x0 || y1 <= y0) return;
      if (x0 !== px || y0 !== py || x1 !== px + img.width || y1 !== py + img.height) {
        img = crop(img, x0 - px, y0 - py, x1 - px, y1 - py);
      }
      px = x0;
      py = y0;
    }
    this.surface.image(img, px, py);
  }

  /** The texture name as the skin key draws it over w x h (slice.ts: the key's margins, region and tiling). */
  private sliced(name: string, key: string, t: RGBAImage, w: number, h: number): RGBAImage {
    const k = `${name}|${key}|${pyRound(w)}x${pyRound(h)}`;
    return this.sliceCache.get(k, t, () => skinSlice(t, key, w, h));
  }

  private resized(name: string, t: RGBAImage, w: number, h: number): RGBAImage {
    const key = `${name}|r${Math.trunc(w)}x${Math.trunc(h)}`;
    return this.sliceCache.get(key, t, () => resize(t, w, h, "bilinear"));
  }

  /** The skin key's image (a texture, nine-sliced with the key's margins, or a #colour) over rect r; def is the
   * image when the skin does not set the key. */
  frame(key: string, def: string, r: Rect, ctx: Ctx, alpha = 1): void {
    const [x, y, w, h] = r;
    if (w < 1 || h < 1 || this.dry) return;
    const name = this.skinStr(key, def);
    if (name.startsWith("#")) {
      const c = color(name);
      if (c[3] === 0) return;
      this.paste(newImage(pyRound(w), pyRound(h), c), x, y, alpha, ctx.clip);
      return;
    }
    const t = this.tex(name);
    if (!t) return;
    this.paste(this.sliced(name, key, t, w, h), x, y, alpha, ctx.clip);
  }

  /** A box w x h at (x, y): filled and/or outlined 1 px (as PIL's rectangle), clipped to clip. */
  box(x: number, y: number, w: number, h: number, fill: RGBA | null, outline: RGBA | null, clip: ClipBox, alpha = 1): void {
    if (this.dry) return;
    const iw = Math.trunc(x + w - 1) - Math.trunc(x) + 1;
    const ih = Math.trunc(y + h - 1) - Math.trunc(y) + 1;
    if (iw < 1 || ih < 1) return;
    const im = newImage(iw, ih, fill ?? undefined);
    if (outline) {
      for (let j = 0; j < ih; j++) {
        for (let i = 0; i < iw; i++) {
          if (i !== 0 && j !== 0 && i !== iw - 1 && j !== ih - 1) continue;
          const o = (j * iw + i) * 4;
          im.data.set(outline, o);
        }
      }
    }
    // Whole pixels, as PIL truncates a rectangle's corners; clipped as the client's scissor clips.
    this.paste(im, Math.trunc(x), Math.trunc(y), alpha, clip);
  }

  line(font: NuiFont, s: string, x: number, y: number, fill: RGBA, clip: ClipBox, alpha = 1): void {
    if (this.dry) return;
    if (alpha < 1) fill = [fill[0], fill[1], fill[2], Math.trunc(fill[3] * alpha)];
    const l = textLayer(font, s, x, y, fill, clip);
    if (l) this.surface.image(l.im, l.x, l.y);
  }

  /** One line of text in rect r, placed as Nuklear's nk_widget_text places it, clipped to r. Reports text wider
   * than the room. */
  textIn(
    node: LayoutNode,
    ctx: Ctx,
    s: string,
    r: Rect,
    font: NuiFont,
    fill: RGBA,
    halign = "center",
    valign = "middle",
    alpha = 1,
    padX = 0,
  ): [number, number] {
    const [x, y, w, h] = r;
    const tw = font.width(s);
    const room = w - 2 * padX;
    let tx: number;
    if (halign === "left") tx = x + padX;
    else if (halign === "right") tx = Math.max(x + padX, x + w - padX - tw);
    else tx = Math.max(x + padX, x + padX + (room - tw) / 2);
    let ty: number;
    if (valign === "top") ty = y;
    else if (valign === "bottom") ty = y + h - font.line;
    else ty = y + (h - font.line) / 2;
    const clip = intersect(ctx.clip, [x, y, x + w, y + h]);
    this.line(font, s, tx, ty, fill, clip, alpha);
    if (s && tw > room + 0.5) {
      this.problem(node, "clipped text", `"${short(s)}" is ${f0(tw)} px wide, ${f0(room)} px fit: cut after "${fits(s, font, room)}"`, [x, y, w, h]);
    } else if (s && Math.min(tx + tw, x + w) > ctx.clip[2] + 0.5) {
      const hidden = Math.min(tx + tw, x + w) - ctx.clip[2];
      this.problem(
        node,
        "hidden text",
        `"${short(s)}": its last ${f0(hidden)} px are cut off by the edge of its list or group ` +
          `(a scrollbar's ${SCROLLBAR} px?); it shows up to "${fits(s, font, ctx.clip[2] - tx)}"`,
        [x, y, w, h],
      );
    }
    return [tx, tw];
  }

  problem(node: { path: string; elem?: JsonObject }, kind: string, text: string, r: Rect): void {
    this.problems.push({ path: node.path, kind, text, rect: r, elem: node.elem });
  }

  /**
   * s as the client draws it in a label, a button, a text box or a draw list's text, and a problem if it is not
   * plain ASCII: the client gives a bound string to Nuklear in its own code page, and Nuklear's UTF-8 decoder takes
   * every byte from 0x80 up as invalid, so the font's fallback glyph ("?") is drawn.
   */
  shown(node: { path: string; elem?: JsonObject }, s: string, r: Rect): string {
    const bad = [...new Set([...s].filter((c) => c.codePointAt(0)! > 0x7e))].sort();
    if (!bad.length) return s;
    const names = bad
      .map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} '${c}'`)
      .join(", ");
    this.problem(
      node,
      "non-ASCII text",
      `"${short(s)}" has ${names}: the game draws each as the font's fallback glyph, not as itself ` +
        "(NUI text must be plain ASCII: the client hands it to Nuklear, which reads bytes above 0x7F as invalid UTF-8)",
      r,
    );
    return [...s].map((c) => (c.codePointAt(0)! <= 0x7e ? c : "?")).join("");
  }

  /**
   * The client draws a tooltip (and a disabled control's disabled tooltip) on one line, never wrapped, from 21 px right
   * of the mouse, and does not keep it on the screen (docs/CLIENT-BEHAVIOUR.md#tooltips). A problem when it runs off
   * the screen's right edge even with the mouse at the element's left edge, the window where it opens.
   */
  tooltips(n: LayoutNode, r: Rect, ctx: Ctx): void {
    for (const key of ["tooltip", "disabled_tooltip"]) {
      const v = this.value(n.elem, key, ctx, null);
      if (typeof v !== "string" || !v) continue;
      // \r is skipped; \n and anything past ASCII are the font's fallback glyph, on the same line.
      const s = [...v.replace(/\r/g, "")].map((c) => (c.codePointAt(0)! >= 0x20 && c.codePointAt(0)! <= 0x7e ? c : "?")).join("");
      const w = Math.ceil(this.fontOf(n.elem, ctx).width(s) + TOOLTIP_PAD);
      const x = Math.max(0, r[0]) + TOOLTIP_MOUSE_X;
      if (x + w <= this.screenW) continue;
      const what = key === "tooltip" ? "tooltip" : "disabled tooltip";
      const nl = v.includes("\n") ? ' (its "\\n" does not start a line: the client draws a "?")' : "";
      this.problem(
        n,
        "tooltip off screen",
        `its ${what} "${short(v, 40)}" is drawn on one line, ${w} px wide, and runs ${f0(x + w - this.screenW)} px off the ` +
          `${this.screenW} px screen${nl}: shorten it, and put longer help in the window as wrapped text`,
        r,
      );
    }
  }

  fontOf(elem: JsonObject, ctx: Ctx): NuiFont {
    return this.skin.font(this.value(elem, "font", ctx, null));
  }

  fg(elem: JsonObject, ctx: Ctx, def: RGBA): RGBA {
    const c = this.value(elem, "foreground_color", ctx, null);
    return c !== null && c !== undefined ? color(c, def) : def;
  }

  // --- the window -------------------------------------------------------------------------------------------

  /** Draws the window centred on a canvasW x canvasH screen (unless its geometry places it); returns its rect. */
  window(win: JsonObject, canvasW: number, canvasH: number, panes: Record<string, JsonObject>): [number, number, number, number] {
    this.screenW = canvasW;
    this.screenH = canvasH;
    const ctx0: Ctx = { ox: 0, oy: 0, clip: [0, 0, canvasW, canvasH], row: null, disabled: false };
    const geoV = this.value(win, "geometry", ctx0, null);
    const geo = isObject(geoV) ? geoV : null;
    const g = (k: string, d: number) => {
      if (!geo) return d;
      const v = pyFloat(k in geo ? geo[k] : d);
      return Number.isNaN(v) ? d : v;
    };
    const ww = g("w", 400);
    const wh = g("h", 300);
    // -1 centres, -2 and -3 place at the mouse (the canvas centre here), below 0 clamps to 0 (window.ts).
    const wx = pyRound(windowPosition(g("x", -1), ww, canvasW));
    const wy = pyRound(windowPosition(g("y", -1), wh, canvasH));
    const chrome = windowChrome(win, this.binds);
    const hh = chrome.header ? CHROME.header_h : 0;
    const ctx: Ctx = { ox: 0, oy: 0, clip: [wx, wy, wx + ww, wy + wh], row: null, disabled: false };
    // A window font (NuiWindow's jFont) sets the title's font too.
    const winFont = this.skin.font(this.value(win, "font", ctx0, null));
    if (chrome.header) {
      this.frame("window.header.normal", "nui_windowh", [wx, wy, ww, hh], ctx);
      const font = winFont;
      const label = color(this.skin.get("window.header.label_normal", "#C8C8C8FF"));
      const bsize = CHROME.button;
      let right = wx + ww - CHROME.button_right;
      const buttons = (chrome.close ? 1 : 0) + (chrome.collapse ? 1 : 0);
      const tclip: ClipBox = [wx, wy, right - buttons * (bsize + CHROME.button_gap), wy + hh];
      if (chrome.title !== null) {
        // The title is a bound string drawn by Nuklear too: the same code page problem as a label's.
        const title = isObject(chrome.title) && "strref" in chrome.title ? `<strref ${pyStr(chrome.title.strref)}>` : pyStr(chrome.title);
        const shown = this.shown({ path: "/title" }, title, [wx, wy, ww, hh]);
        this.line(font, shown, wx + CHROME.title_x, wy + (hh - font.line) / 2, label, tclip);
      }
      const by = wy + (hh - bsize) / 2;
      if (chrome.close) {
        const name = this.skinStr("window.header.close_button.normal", "nui_close");
        const t = this.tex(name);
        if (t) this.paste(this.resized(name, t, bsize, bsize), right - bsize, by);
        right -= bsize + CHROME.button_gap;
      }
      if (chrome.collapse) {
        const mname = this.skinStr("window.header.minimize_button.normal", "nui_cnt_down");
        const t = this.tex(mname);
        if (t) this.paste(this.resized(mname, t, bsize, bsize), right - bsize, by);
      }
    }
    // A window that opens collapsed shows its title bar alone.
    if (chrome.collapsed) return [wx, wy, ww, hh];
    const bodyY = wy + hh + (chrome.header ? CHROME.body_gap : 0);
    if (!chrome.transparent) {
      const bg = color(this.skin.get("window.fixed_background", "#000000FF"));
      if (!this.dry) this.surface.fillRect(wx, bodyY, wx + ww - 1, wy + wh - 1, bg);
    }
    // The border is a window flag of its own: a transparent window keeps it.
    if (chrome.border) this.frame("window.border_image", "nui_windowh", [wx, bodyY, ww, wy + wh - bodyY], ctx);
    const cx = wx + CHROME.content_x;
    const cy = bodyY + CHROME.content_y;
    const cw = ww - 2 * CHROME.content_x;
    const ch = wy + wh - cy - CHROME.content_bottom;
    const root = win.root;
    if (isObject(root)) {
      this.panes = panes;
      for (const p of checkRequiredSizes(root)) this.problems.push({ ...p, rect: [cx, cy, cw, ch] });
      const solved = this.solve([root], cw, ch, "", [cx, cy, cw, ch]);
      if (solved) {
        this.content(solved, { ox: cx, oy: cy, clip: [cx, cy, cx + cw, cy + ch], row: null, disabled: false }, [cx, cy, cw, ch], "window");
      }
    }
    for (const draw of this.deferred.splice(0)) draw();
    return [wx, wy, ww, wh];
  }

  /** solveContent, reporting a layout the solver cannot build instead of throwing. */
  private solve(roots: JsonObject[], w: number, h: number, path: string, r: Rect): Solved | null {
    try {
      return solveContent(roots, w, h, path);
    } catch (e) {
      if (e instanceof UnsatisfiableLayout) {
        this.problems.push({ path: e.path, kind: "unsolvable layout", text: e.message, rect: r });
        return null;
      }
      throw e;
    }
  }

  /** Draws a solver's nodes; reports what reaches past region (the room it was given). */
  content(solved: Solved, ctx: Ctx, region: Rect, owner: string): void {
    const [rx, ry, rw, rh] = region;
    const [right, bottom] = solved.extent();
    for (const n of solved.nodes) this.node(n, ctx);
    const window = owner === "window";
    // The window is laid out in its whole body, and Nuklear scrolls what reaches past it. A scrollbar covers one edge
    // of the body, so content that overflows one way and fills the other gets both (seen in game on Layonara's
    // options window; docs/CLIENT-BEHAVIOUR.md#default-sizes). A group's content is told in wGroup.
    const overW = right > rw + 0.5;
    const overH = window && bottom > rh + 0.5;
    const wide = overW || (overH && right > rw - SCROLLBAR + 0.5);
    const tall = overH || (window && overW && bottom > rh - SCROLLBAR + 0.5);
    const bar = (b: string) => (window ? `: the client shows a ${b} scrollbar` : "");
    if (wide) {
      const why = overW ? `the ${owner} has ${f0(rw)}` : `the vertical scrollbar leaves ${f0(rw - SCROLLBAR)} of ${f0(rw)}`;
      this.problem(solved.nodes[0]!, "overflow", `the content is ${f0(right)} wide, ${why}${bar("horizontal")}`, [rx, ry, rw, rh]);
    }
    if (tall) {
      const why = overH ? `the ${owner} has ${f0(rh)}` : `the horizontal scrollbar leaves ${f0(rh - SCROLLBAR)} of ${f0(rh)}`;
      this.problem(solved.nodes[0]!, "overflow", `the content is ${f0(bottom)} high, ${why}${bar("vertical")}`, [rx, ry, rw, rh]);
    }
  }

  // --- elements ------------------------------------------------------------------------------------------------

  node(n: LayoutNode, ctx: Ctx): void {
    const [x, y, w, h] = n.rect;
    const r: Rect = [ctx.ox + x, ctx.oy + y, w, h];
    const elem = n.elem;
    const visible = this.flag(elem, "visible", ctx, true);
    const enabled = this.flag(elem, "enabled", ctx, true);
    const sub: Ctx = { ...ctx, disabled: ctx.disabled || !enabled };
    const t = n.type;
    this.outlines.push({ rect: r, path: n.path, isSpan: SPANS.has(t), visible, type: t, elem, row: ctx.row });
    // Checked hidden or not: visible and enabled change at runtime, and either tooltip can then show.
    this.tooltips(n, r, ctx);
    if (!visible) return;
    const dl = elem.draw_list;
    const items = Array.isArray(dl) ? dl.filter(isObject) : [];
    // NUI_DRAW_LIST_ITEM_ORDER_BEFORE items are painted before the widget (under it), the rest after it.
    if (items.length) this.drawList(n, r, sub, items, -1);
    if (SPANS.has(t)) {
      // A row's children must fit it along the row (else the end is clipped by the window, not an error). Only a span
      // of a fixed size can be overflowed: one without grows with its content (and a group scrolls it).
      const depth = n.path.split("/").length - 1;
      const fixedW = num(elem, "width", null) !== null || depth <= 1;
      const fixedH = num(elem, "height", null) !== null || depth <= 1;
      for (const c of n.children) {
        const [cx, cy, cw, chh] = c.rect;
        if (t === "row" && fixedW && cx + cw + c.margin > x + w - n.padding + 0.5) {
          this.problem(c, "overflow", `reaches ${f0(cx + cw + c.margin - (x + w))} px past its row's right edge`, [ctx.ox + cx, ctx.oy + cy, cw, chh]);
        }
        if (t === "col" && fixedH && cy + chh + c.margin > y + h - n.padding + 0.5) {
          this.problem(c, "overflow", `reaches ${f0(cy + chh + c.margin - (y + h))} px past its column's bottom edge`, [ctx.ox + cx, ctx.oy + cy, cw, chh]);
        }
        this.node(c, sub);
      }
    } else {
      if (SELECT_LISTS.has(t)) this.selectOverflow(n, r);
      const draw = this.widget(t);
      if (draw) draw(n, r, sub);
      else this.problem(n, "not drawn", `the preview does not draw '${t}' elements`, r);
    }
    if (items.length) this.drawList(n, r, sub, items, 1);
  }

  /** A SelectList of a fixed size whose entries reach past it along its direction (the end is clipped). */
  private selectOverflow(n: LayoutNode, r: Rect): void {
    const horizontal = selectHorizontal(n.elem);
    const fixed = num(n.elem, horizontal ? "width" : "height", null);
    const last = n.children[n.children.length - 1];
    if (fixed === null || !last) return;
    const [x, y, w, h] = n.rect;
    const [cx, cy, cw, ch] = last.rect;
    const over = horizontal ? cx + cw + last.margin - (x + w) : cy + ch + last.margin - (y + h);
    if (over > 0.5) {
      const need = horizontal ? cx + cw + last.margin - x : cy + ch + last.margin - y;
      this.problem(n, "overflow", `its ${n.children.length} entries are ${f0(need)} ${horizontal ? "wide" : "high"} (${horizontal ? "150 + 4" : "35 + 4"} each), it has ${f0(fixed)}: the last ${f0(over)} px are cut off`, r);
    }
  }

  private widget(t: string): ((n: LayoutNode, r: Rect, ctx: Ctx) => void) | null {
    switch (t) {
      case "spacer":
        return () => {};
      case "label":
        return (n, r, c) => this.wLabel(n, r, c);
      case "button":
        return (n, r, c) => this.wButton(n, r, c);
      case "button_select":
        return (n, r, c) => this.wButtonSelect(n, r, c);
      case "button_image":
        return (n, r, c) => this.wButtonImage(n, r, c);
      case "image":
        return (n, r, c) => this.wImage(n, r, c);
      case "progress":
        return (n, r, c) => this.wProgress(n, r, c);
      case "textedit":
        return (n, r, c) => this.wTextedit(n, r, c);
      case "text":
        return (n, r, c) => this.wText(n, r, c);
      case "combo":
        return (n, r, c) => this.wCombo(n, r, c);
      case "check":
        return (n, r, c) => this.wCheck(n, r, c);
      case "options":
        return (n, r, c) => this.wOptions(n, r, c);
      case "toggles":
        return (n, r, c) => this.wToggles(n, r, c);
      case "tabbar":
        // NuiToggles makes "tabbar": drawn as the toggles (its own look in the client is unverified).
        return (n, r, c) => this.wToggles(n, r, c);
      case "sliderf":
      case "slider":
        return (n, r, c) => this.wSlider(n, r, c);
      case "color_picker":
        return (n, r, c) => this.wColorPicker(n, r, c);
      case "chart":
        return (n, r, c) => this.wChart(n, r, c);
      case "group":
        return (n, r, c) => this.wGroup(n, r, c);
      case "list":
        return (n, r, c) => this.wList(n, r, c);
      default:
        return null;
    }
  }

  alpha(ctx: Ctx): number {
    return ctx.disabled ? DISABLED_ALPHA : 1;
  }

  wLabel(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const s = this.shown(n, this.text(e, "value", ctx).replace(/\n/g, " "), r);
    const ha = ({ 0: "center", 1: "left", 2: "right" } as Record<string, string>)[String(this.value(e, "text_halign", ctx, 1))] ?? "left";
    const va = ({ 0: "middle", 1: "top", 2: "bottom" } as Record<string, string>)[String(this.value(e, "text_valign", ctx, 0))] ?? "middle";
    const fill = this.fg(e, ctx, color(this.skin.get("text.color", "#FFFFFFFF")));
    this.textIn(n, ctx, s, r, this.fontOf(e, ctx), fill, ha, va, this.alpha(ctx));
  }

  buttonBg(r: Rect, ctx: Ctx, pressed = false, section = "button", encouraged = false): void {
    if (pressed) {
      const na = this.skin.get(`${section}.normal_active`);
      this.frame(typeof na === "string" && na ? `${section}.normal_active` : `${section}.active`, "nui_button_a", r, ctx, this.alpha(ctx));
    } else {
      // An encouraged button is drawn with its hover image (and the hover image's wider slices).
      this.frame(encouraged ? `${section}.hover` : `${section}.normal`, "nui_button_n", r, ctx, this.alpha(ctx));
    }
  }

  wButton(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    this.buttonBg(r, ctx, false, "button", this.flag(e, "encouraged", ctx, false));
    const fill = this.fg(e, ctx, color(this.skin.get("button.text_normal", "#FFFFFFFF")));
    this.textIn(n, ctx, this.shown(n, this.text(e, "label", ctx).replace(/\n/g, " "), r), r, this.fontOf(e, ctx), fill, "center", "middle", this.alpha(ctx));
  }

  wButtonSelect(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const pressed = this.flag(e, "value", ctx, false);
    this.buttonBg(r, ctx, pressed, "selectable");
    const fill = this.fg(e, ctx, color(this.skin.get("button.text_normal", "#FFFFFFFF")));
    this.textIn(n, ctx, this.shown(n, this.text(e, "label", ctx).replace(/\n/g, " "), r), r, this.fontOf(e, ctx), fill, "center", "middle", this.alpha(ctx));
  }

  wButtonImage(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    this.buttonBg(r, ctx, false, "button", this.flag(e, "encouraged", ctx, false));
    const [x, y, w, h] = r;
    this.image(n, [x + 4, y + 4, w - 8, h - 8], ctx, this.text(e, "label", ctx), 0, 0, 0, null);
  }

  wImage(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    this.image(
      n,
      r,
      ctx,
      this.text(e, "value", ctx),
      this.value(e, "image_aspect", ctx, 0),
      this.value(e, "image_halign", ctx, 0),
      this.value(e, "image_valign", ctx, 0),
      this.value(e, "image_region", ctx, null),
    );
  }

  /** An image in rect r, as NUI_ASPECT_* places it. */
  image(n: LayoutNode, r: Rect, ctx: Ctx, resref: string, aspect: unknown, halign: unknown, valign: unknown, region: unknown): void {
    if (!resref) return;
    const found = this.images.peek(resref);
    const [x, y, w, h] = r;
    if (found === undefined) return; // not loaded yet: the caller draws again once it is
    if (found === null) {
      const info = this.images.describe(resref);
      const why = info?.error ? `: ${info.error}` : "";
      this.problem(n, "missing image", `no texture "${resref}" in the game or the haks${why}`, r);
      // Clipped like the image would be: a row of a list draws nothing past the list.
      this.box(x, y, w, h, null, [200, 0, 200, 255], ctx.clip);
      return;
    }
    let im = found;
    if (isObject(region)) {
      const rx = Math.trunc(pyFloat(region.x ?? 0) || 0);
      const ry = Math.trunc(pyFloat(region.y ?? 0) || 0);
      const rw = Math.trunc(pyFloat(region.w ?? im.width));
      const rh = Math.trunc(pyFloat(region.h ?? im.height));
      im = crop(im, rx, ry, rx + rw, ry + rh);
    }
    const iw = im.width;
    const ih = im.height;
    if (iw <= 0 || ih <= 0 || w <= 0 || h <= 0) return;
    const asp = typeof aspect === "number" ? aspect : 0;
    let dw: number;
    let dh: number;
    if (asp === 0) {
      const s = Math.min(w / iw, h / ih);
      dw = iw * s;
      dh = ih * s;
    } else if (asp === 1) {
      const s = Math.max(w / iw, h / ih);
      dw = iw * s;
      dh = ih * s;
    } else if (asp === 2) {
      const s = Math.min(1, w / iw, h / ih);
      dw = iw * s;
      dh = ih * s;
    } else if (asp === 3 || asp === 4) {
      dw = iw;
      dh = ih;
    } else {
      dw = w;
      dh = h;
    }
    const ha = typeof halign === "number" ? halign : 0;
    const va = typeof valign === "number" ? valign : 0;
    const dx = x + (ha === 1 ? 0 : ha === 2 ? w - dw : (w - dw) / 2);
    const dy = y + (va === 1 ? 0 : va === 2 ? h - dh : (h - dh) / 2);
    if (this.dry) return;
    const scaled = resize(im, Math.max(1, pyRound(dw)), Math.max(1, pyRound(dh)), "bilinear");
    this.paste(scaled, dx, dy, this.alpha(ctx), intersect(ctx.clip, [x, y, x + w, y + h]));
  }

  wProgress(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const [x, y, w, h] = r;
    this.frame("progress.normal", "nui_button_n", r, ctx, this.alpha(ctx));
    let v = pyFloat(this.value(e, "value", ctx, 0));
    v = Number.isNaN(v) ? 0 : Math.max(0, Math.min(1, v));
    const name = this.skinStr("progress.cursor_normal", "nui_progress");
    const cur = this.tex(name);
    const pad = 2;
    const cw = (w - 2 * pad) * v;
    if (cur && cw >= 1) {
      this.paste(resize(cur, pyRound(cw), pyRound(h - 2 * pad), "bilinear"), x + pad, y + pad, this.alpha(ctx), ctx.clip);
    }
  }

  wTextedit(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const [x, y, w, h] = r;
    this.frame("edit.normal", "nui_windowh", r, ctx, this.alpha(ctx));
    const font = this.fontOf(e, ctx);
    const val = this.text(e, "value", ctx);
    const multiline = truthy(e.multiline);
    if (!val) {
      const ph = this.text(e, "label", ctx);
      this.textIn(n, ctx, ph, [x, y, w, h], font, PLACEHOLDER, "left", multiline ? "top" : "middle", this.alpha(ctx), EDIT_PAD_X);
      return;
    }
    const fill = color(this.skin.get("edit.text_normal", "#FFFFFFFF"));
    if (multiline) {
      this.wrapped(n, [x + EDIT_PAD_X, y + 4, w - 2 * EDIT_PAD_X, h - 8], ctx, val, font, fill, false);
    } else {
      this.textIn(n, ctx, val, [x, y, w, h], font, fill, "left", "middle", this.alpha(ctx), EDIT_PAD_X);
    }
  }

  /** Word-wrapped text from the top of r, a line every font size + 4; reports lines that do not fit. */
  wrapped(n: LayoutNode, r: Rect, ctx: Ctx, s: string, font: NuiFont, fill: RGBA, scroll: boolean): [number, number] {
    const [x, y, w, h] = r;
    const lines = wrap(s, font, w);
    const pitch = font.line + LINE_SPACING;
    const clip = intersect(ctx.clip, [x, y, x + w, y + h]);
    for (let i = 0; i < lines.length; i++) {
      const ly = y + i * pitch;
      if (ly > y + h) break;
      this.line(font, lines[i]!, x, ly, fill, clip, this.alpha(ctx));
    }
    const need = lines.length * pitch - LINE_SPACING;
    // A line shows if its baseline is inside the box (only its descenders may be cut).
    const baseline = (font.line - (font.ascent + font.descent)) / 2 + font.ascent;
    let fit = 0;
    for (let i = 0; i < lines.length; i++) if (i * pitch + baseline <= h + 0.5) fit++;
    if (fit < lines.length && !scroll) {
      this.problem(n, "clipped text", `${lines.length} lines need ${f0(need)} px, ${f0(h)} px show ${fit}: cut from "${short(lines[fit]!)}"`, r);
    }
    return [lines.length, need];
  }

  wText(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const [x, y, w, h] = r;
    const border = this.flag(e, "border", ctx, true);
    const scrollbars = this.value(e, "scrollbars", ctx, 4);
    const inset = border ? TEXT_BORDER_INSET : 0;
    if (border) this.frame("window.border_image", "nui_windowh", r, ctx, this.alpha(ctx));
    const font = this.fontOf(e, ctx);
    const fill = this.fg(e, ctx, color(this.skin.get("text.color", "#FFFFFFFF")));
    const s = this.shown(n, this.text(e, "value", ctx), r);
    let inner: Rect = [x + inset + TEXT_INSET_X, y + inset + TEXT_INSET_Y, w - 2 * inset - TEXT_WRAP_LESS, h - 2 * inset - TEXT_INSET_Y];
    const pitch = font.line + LINE_SPACING;
    const lines = wrap(s, font, inner[2]);
    const need = lines.length * pitch - LINE_SPACING;
    const scroll = scrollbars === 2 || scrollbars === 3 || (scrollbars === 4 && need > inner[3]);
    if (scroll) {
      inner = [inner[0], inner[1], inner[2] - SCROLLBAR, inner[3]];
      this.scrollbar([x + w - inset - SCROLLBAR, y + inset, SCROLLBAR, h - 2 * inset], ctx, inner[3] / Math.max(need, 1));
    }
    this.wrapped(n, inner, ctx, s, font, fill, scroll);
    if (!s.trim() && h >= EMPTY_H) {
      this.problem(n, "empty", `a ${f0(w)} x ${f0(h)} text box with nothing in it (wasted room?)`, r);
    }
  }

  wCombo(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const [x, y, w, h] = r;
    this.frame("combo.normal", "nui_button_n", r, ctx, this.alpha(ctx));
    const sel = this.value(e, "value", ctx, 0);
    let label = "";
    const els = this.value(e, "elements", ctx, []);
    for (const el of Array.isArray(els) ? els : []) {
      if (Array.isArray(el) && el.length >= 2 && el[1] === sel) label = pyStr(el[0]);
    }
    const aname = this.skinStr("combo.button.normal", "nui_shld_down");
    const arrow = this.tex(aname);
    const a = Math.min(h - 8, 22);
    if (arrow && a > 2) this.paste(this.resized(aname, arrow, Math.trunc(a), Math.trunc(a)), x + w - a - 6, y + (h - a) / 2, this.alpha(ctx), ctx.clip);
    const pad = this.skin.numOf("combo.content_padding_x", 10);
    this.textIn(n, ctx, label, [x, y, w - a - 6, h], this.fontOf(e, ctx), color(this.skin.get("text.color", "#FFFFFFFF")), "left", "middle", this.alpha(ctx), pad);
    this.comboOpen(n, r, ctx, Array.isArray(els) ? els : []);
  }

  /**
   * A combo's open list: a problem when it would run off the screen (the client neither clips nor moves it; window
   * clipping does not apply), and drawn on top of the window when the combo is openCombo (in a list, its first row).
   */
  private comboOpen(n: LayoutNode, r: Rect, ctx: Ctx, entries: JsonValue[]): void {
    const font = this.fontOf(n.elem, ctx);
    const labels = entries.map((el) => (Array.isArray(el) && el.length ? pyStr(el[0]) : ""));
    const widest = labels.reduce((m, l) => Math.max(m, font.width(l)), 0);
    const pad = ctx.padY ?? this.skin.numOf("window.padding_y", WINDOW_PADDING_Y);
    const sbw = this.skin.numOf("window.scrollbar_size_x", SCROLLBAR);
    const g = comboList(r, widest, entries.length, font.line, pad, sbw);
    const [px, py, pw, ph] = g.rect;
    const offR = px + pw - this.screenW;
    const offB = py + ph - this.screenH;
    if (entries.length && (offR > 0.5 || offB > 0.5)) {
      const edges = [offR > 0.5 ? `${f0(offR)} px past the right edge` : "", offB > 0.5 ? `${f0(offB)} px past the bottom` : ""].filter(Boolean).join(" and ");
      this.problem(
        n,
        "combo list off screen",
        `its open list (${f0(pw)} x ${f0(ph)}, ${entries.length} entries) runs ${edges} of the ${this.screenW} x ${this.screenH} screen: ` +
          "the client opens it below the combo and never moves or clips it to the screen; move the combo up or left, or shorten its labels",
        r,
      );
    }
    if (this.openCombo !== n.elem || this.dry || (ctx.row !== null && ctx.row !== 0)) return;
    this.deferred.push(() => this.drawComboList(g, labels, font));
  }

  /** Draws an open combo list (the window's background and border, a row per entry, a scrollbar past 300 high). */
  private drawComboList(g: ComboList, labels: string[], font: NuiFont): void {
    const [px, py, pw, ph] = g.rect;
    const clip: ClipBox = [px, py, px + pw, py + ph];
    const ctx: Ctx = { ox: 0, oy: 0, clip, row: null, disabled: false };
    this.popups.push(g.rect);
    this.frame("window.fixed_background", "#000000FF", g.rect, ctx);
    this.frame("window.border_image", "nui_windowh", g.rect, ctx);
    const sbw = this.skin.numOf("window.scrollbar_size_x", SCROLLBAR);
    const fill = color(this.skin.get("text.color", "#FFFFFFFF"));
    const padX = this.skin.numOf("contextual_button.padding_x", 4);
    const rx = px + COMBO_BORDER;
    const rw = pw - 2 * COMBO_BORDER - sbw;
    labels.forEach((label, i) => {
      const ry = py + g.pad + g.spacing + i * (g.rowH + g.spacing);
      if (ry >= py + ph) return;
      const cell: Rect = [rx, ry, rw, g.rowH];
      this.frame("contextual_button.normal", "#00000000", cell, ctx);
      this.line(font, label, rx + padX, ry + (g.rowH - font.line) / 2, fill, intersect(clip, [rx, ry, rx + rw, ry + g.rowH]));
    });
    if (g.scrolls) this.scrollbar([px + pw - COMBO_BORDER - sbw, py + COMBO_BORDER, sbw, ph - 2 * COMBO_BORDER], ctx, ph / Math.max(g.content, 1));
  }

  wCheck(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const [x, y, w, h] = r;
    const bname = this.skinStr("checkbox.normal", "nui_checkbox_n");
    const box = this.tex(bname);
    const b = Math.min(h, 22);
    const by = y + (h - b) / 2;
    if (box) this.paste(this.resized(bname, box, Math.trunc(b), Math.trunc(b)), x, by, this.alpha(ctx), ctx.clip);
    if (this.flag(e, "value", ctx, false)) {
      const xname = this.skinStr("checkbox.cursor_normal", "nui_checkbox_x");
      const xm = this.tex(xname);
      if (xm) {
        const s = Math.trunc(b * 0.65);
        this.paste(this.resized(xname, xm, s, s), x + (b - s) / 2, by + (b - s) / 2, this.alpha(ctx), ctx.clip);
      }
    }
    const fill = this.fg(e, ctx, color(this.skin.get("text.color", "#FFFFFFFF")));
    this.textIn(n, ctx, this.shown(n, this.text(e, "label", ctx), r), [x + b + 4, y, w - b - 4, h], this.fontOf(e, ctx), fill, "left", "middle", this.alpha(ctx));
  }

  private elementsOf(e: JsonObject, ctx: Ctx): JsonValue[] {
    const v = this.value(e, "elements", ctx, []);
    return Array.isArray(v) ? v : [];
  }

  /**
   * A SelectList's entries and the cells they are drawn in: the solver's entries (SelectList::MakeButtons) when the
   * labels are in the JSON; for bound labels (which the solver does not see) the bind's sample labels, sharing the box.
   */
  private selectCells(n: LayoutNode, r: Rect, ctx: Ctx): [JsonValue, Rect][] {
    if (n.children.length) {
      const labels = selectLabels(n.elem);
      return n.children.map((c, i) => {
        const [cx, cy, cw, ch] = c.rect;
        return [labels[i] ?? "", [ctx.ox + cx, ctx.oy + cy, cw, ch]];
      });
    }
    const [x, y, w, h] = r;
    const els = this.elementsOf(n.elem, ctx);
    const horizontal = selectHorizontal(n.elem);
    const k = Math.max(1, els.length);
    return els.map((label, i) => [label, horizontal ? [x + (i * w) / k, y, w / k, h] : [x, y + (i * h) / k, w, h / k]]);
  }

  wOptions(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const sel = this.value(e, "value", ctx, -1);
    this.selectCells(n, r, ctx).forEach(([label, cell], i) => {
      const [cx, cy, cw, chh] = cell;
      const b = Math.min(chh, 22);
      const by = cy + (chh - b) / 2;
      const oname = this.skinStr("option.normal", "nui_radial_n");
      const t = this.tex(oname);
      if (t) this.paste(this.resized(oname, t, Math.trunc(b), Math.trunc(b)), cx, by, this.alpha(ctx), ctx.clip);
      if (i === sel) {
        const dname = this.skinStr("option.cursor_normal", "nui_radial_x");
        const d = this.tex(dname);
        if (d) {
          const s = Math.trunc(b * 0.6);
          this.paste(this.resized(dname, d, s, s), cx + (b - s) / 2, by + (b - s) / 2, this.alpha(ctx), ctx.clip);
        }
      }
      this.textIn(n, ctx, pyStr(label), [cx + b + 4, cy, cw - b - 4, chh], this.fontOf(e, ctx), color(this.skin.get("text.color", "#FFFFFFFF")), "left", "middle", this.alpha(ctx));
    });
  }

  wToggles(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const sel = this.value(e, "value", ctx, -1);
    // nk_button_label in each entry; the chosen one drawn pressed (how the client marks it is not traced).
    const fill = color(this.skin.get("button.text_normal", "#FFFFFFFF"));
    this.selectCells(n, r, ctx).forEach(([label, cell], i) => {
      this.buttonBg(cell, ctx, i === sel, "button");
      this.textIn(n, ctx, this.shown(n, pyStr(label), cell), cell, this.fontOf(e, ctx), fill, "center", "middle", this.alpha(ctx));
    });
  }

  wSlider(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const [x, y, w, h] = r;
    const v = pyFloat(this.value(e, "value", ctx, 0) || 0) || 0;
    const lo = pyFloat(this.value(e, "min", ctx, 0) || 0) || 0;
    const hi = pyFloat(this.value(e, "max", ctx, 1) || 1) || 1;
    const f = hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    const mid = y + h / 2;
    const bar = color(this.skin.get("slider.bar_filled", "#AD8E60FF"));
    if (!this.dry) {
      // PIL's 2-wide line at mid: rows trunc(mid) - 1 .. trunc(mid) (approximately: see docs/GAPS.md). Clipped to the list
      // or group it is in.
      const clip = ctx.clip;
      this.surface.polyline([[x + 6, Math.trunc(mid) - 0.5], [x + w - 6, Math.trunc(mid) - 0.5]], [80, 60, 40, 255], 2, clip);
      this.surface.polyline([[x + 6, Math.trunc(mid) - 0.5], [x + 6 + (w - 12) * f, Math.trunc(mid) - 0.5]], bar, 2, clip);
    }
    const knob = this.tex(this.skinStr("slider.cursor_normal", "nui_slider"));
    if (knob) this.paste(knob, x + 6 + (w - 12) * f - knob.width / 2, mid - knob.height / 2, this.alpha(ctx), ctx.clip);
  }

  wColorPicker(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const [x, y, w, h] = r;
    const c = color(this.value(n.elem, "value", ctx, null) ?? {}, [255, 255, 255, 255]);
    this.box(x, y, w, h, c, GOLD_FRAME, ctx.clip);
  }

  wChart(_n: LayoutNode, r: Rect, ctx: Ctx): void {
    const [x, y, w, h] = r;
    this.box(x, y, w, h, [0, 0, 0, 255], GOLD_FRAME, ctx.clip);
  }

  /** A vertical scrollbar in r: its track, up and down buttons, and its cursor at the top. */
  scrollbar(r: Rect, ctx: Ctx, visibleFraction: number): void {
    const [x, y, w, h] = r;
    if (h < 2 * w) return;
    this.frame("scrollv.normal", "nui_windowv", r, ctx);
    const uname = this.skinStr("scrollv.dec_button.normal", "nui_cnt_up");
    const dname = this.skinStr("scrollv.inc_button.normal", "nui_cnt_down");
    const up = this.tex(uname);
    const down = this.tex(dname);
    if (up) this.paste(this.resized(uname, up, Math.trunc(w), Math.trunc(w)), x, y, 1, ctx.clip);
    if (down) this.paste(this.resized(dname, down, Math.trunc(w), Math.trunc(w)), x, y + h - w, 1, ctx.clip);
    const track = h - 2 * w;
    const cname = this.skinStr("scrollv.cursor_normal", "nui_scrollv");
    const cur = this.tex(cname);
    // nk_do_scrollbarv: the cursor is inset by the skin's padding (border 0): x + padding_x, w - 2 padding_x (10 of 18
    // px, measured on the in-game deity window), y + padding_y, its length less 2 padding_y.
    const px = this.skin.numOf("scrollv.padding_x", 4);
    const py = this.skin.numOf("scrollv.padding_y", 2);
    const ch = Math.max(8, track * Math.max(0, Math.min(1, visibleFraction)) - 2 * py);
    // The thumb: the texture's striped middle, repeated along the bar (slice.ts).
    if (cur && w - 2 * px > 1) this.paste(this.sliced(cname, "scrollv.cursor_normal", cur, w - 2 * px, ch), x + px, y + w + py, 1, ctx.clip);
  }

  wGroup(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const [x, y, w, h] = r;
    const border = this.flag(e, "border", ctx, true);
    const scrollbars = this.value(e, "scrollbars", ctx, 4);
    if (border) this.frame("window.border_image", "nui_windowh", r, ctx);
    const insetX = border ? LIST_INSET_X : 0;
    const insetY = border ? LIST_INSET_Y : 0;
    const pad = n.padding;
    const inner: Rect = [x + insetX + pad, y + insetY + pad, w - 2 * insetX - 2 * pad, h - 2 * insetY - 2 * pad];
    let child: JsonValue | undefined = undefined;
    const pid = e.id;
    if (typeof pid === "string" && pid && pid in this.panes) child = this.panes[pid];
    else if (Array.isArray(e.children) && e.children.length) child = e.children[0];
    if (!isObject(child)) return;
    let solved = this.solve([child], inner[2], inner[3], n.path, r);
    if (!solved) return;
    let [right, bottom] = solved.extent();
    const scrollY = scrollbars === 2 || scrollbars === 3 || (scrollbars === 4 && bottom > inner[3] + 0.5);
    if (scrollY) {
      solved = this.solve([child], inner[2] - SCROLLBAR, inner[3], n.path, r);
      if (!solved) return;
      [right, bottom] = solved.extent();
      this.scrollbar([x + w - insetX - SCROLLBAR, y + insetY, SCROLLBAR, h - 2 * insetY], ctx, inner[3] / Math.max(bottom, 1));
    }
    const clip = intersect(ctx.clip, [inner[0], inner[1], inner[0] + inner[2] - (scrollY ? SCROLLBAR : 0), inner[1] + inner[3]]);
    const sub: Ctx = { ox: inner[0], oy: inner[1], clip, row: ctx.row, disabled: ctx.disabled, item: ctx.item, padY: GROUP_PADDING_Y };
    for (const c of solved.nodes) this.node(c, sub);
    if (bottom > inner[3] + 0.5 && scrollbars === 0) {
      this.problem(n, "clipped content", `its content is ${f0(bottom)} high, ${f0(inner[3])} show (no scrollbar)`, r);
    }
    if (right > inner[2] - (scrollY ? SCROLLBAR : 0) + 0.5 && (scrollbars === 0 || scrollbars === 2)) {
      this.problem(n, "clipped content", `its content is ${f0(right)} wide, ${f0(inner[2] - (scrollY ? SCROLLBAR : 0))} show`, r);
    }
  }

  wList(n: LayoutNode, r: Rect, ctx: Ctx): void {
    const e = n.elem;
    const [x, y, w, h] = r;
    const border = this.flag(e, "border", ctx, true);
    const scrollbars = this.value(e, "scrollbars", ctx, 2);
    if (border) this.frame("window.border_image", "nui_windowh", r, ctx);
    let rows = Math.trunc(pyFloat(this.value(e, "row_count", ctx, 0)));
    if (!Number.isFinite(rows)) rows = 0;
    const rh = typeof e.row_height === "number" ? e.row_height : 25;
    const inner: Rect = [x + LIST_INSET_X, y + LIST_INSET_Y, w - 2 * LIST_INSET_X, h - 2 * LIST_INSET_Y];
    const need = rows * (rh + LIST_SPACING);
    const overflow = need - LIST_SPACING > inner[3];
    const showBar = scrollbars === 2 || scrollbars === 3 || (scrollbars === 4 && overflow);
    // The rows take the room the scrollbar leaves.
    const rowW = inner[2] - (showBar ? SCROLLBAR : 0);
    if (showBar) {
      this.scrollbar([x + w - LIST_INSET_X - SCROLLBAR, y + LIST_INSET_Y, SCROLLBAR, h - 2 * LIST_INSET_Y], ctx, inner[3] / Math.max(need, 1));
    }
    const clipR = inner[0] + inner[2] - (showBar ? SCROLLBAR : 0);
    const clip = intersect(ctx.clip, [inner[0], inner[1], clipR, inner[1] + inner[3]]);
    const cells = templateCells(e);
    if (!cells.length) return;
    const first = new Map<string, Problem>();
    const repeats = new Map<string, number>();
    for (let i = 0; i < rows; i++) {
      const ry = inner[1] + i * (rh + LIST_SPACING);
      let nodes: LayoutNode[];
      try {
        nodes = solveRowTemplate(cells, rowW, rh, `${n.path}/row ${i}`);
      } catch (err) {
        if (err instanceof UnsatisfiableLayout) {
          // Named by the cell element whose constraint was refused (as nui-preview); the list is what can be selected.
          this.problems.push({ path: err.path, kind: "unsolvable layout", text: err.message, rect: r, elem: n.elem });
          return;
        }
        throw err;
      }
      // Rows below the list are checked too (scrolling shows them), drawn where nobody sees them.
      const hidden = ry > inner[1] + inner[3];
      const rclip: ClipBox = hidden ? [clip[0], -1e9, clip[2], 1e9] : clip;
      const sub: Ctx = { ox: inner[0], oy: ry, clip: rclip, row: i, disabled: ctx.disabled, padY: GROUP_PADDING_Y };
      const before = this.problems.length;
      const outlines = this.outlines.length;
      const wasDry = this.dry;
      this.dry = this.dry || hidden;
      for (const c of nodes) this.node(c, sub);
      this.dry = wasDry;
      if (hidden) this.outlines.length = outlines;
      // Report a template cell's problem once, for the first row that has it, with how many rows do.
      const fresh = this.problems.slice(before);
      this.problems.length = before;
      for (const p of fresh) {
        const tail = p.path.split(`${n.path}/row `);
        const rest = tail[tail.length - 1]!;
        const slash = rest.indexOf("/");
        const key = `${p.kind}\u0000${slash >= 0 ? rest.slice(slash + 1) : rest}`;
        if (first.has(key)) repeats.set(key, repeats.get(key)! + 1);
        else {
          first.set(key, p);
          repeats.set(key, 0);
          this.problems.push(p);
        }
      }
    }
    for (const [key, p] of first) {
      const k = repeats.get(key)!;
      if (k) p.text += ` (and ${k} more of the ${rows} rows)`;
    }
    if (overflow && scrollbars === 0) {
      this.problem(n, "clipped content", `${rows} rows need ${f0(need - LIST_SPACING)} px, ${f0(inner[3])} show`, r);
    }
  }

  // --- draw lists ----------------------------------------------------------------------------------------------

  /**
   * The element's draw-list items of one order, as listed: -1 the ORDER_BEFORE items (painted before the widget,
   * under it), 1 the others (after it, over it).
   */
  drawList(n: LayoutNode, r: Rect, ctx: Ctx, items: JsonObject[], order: -1 | 1): void {
    const [x, y, w, h] = r;
    const scissor = this.flag(n.elem, "draw_list_scissor", ctx, false);
    const clip = scissor ? intersect(ctx.clip, [x, y, x + w, y + h]) : ctx.clip;
    const dctx: Ctx = { ...ctx, clip };
    for (const it of items) {
      if ((order === -1) !== (it.order === -1)) continue;
      // NuiDrawList*(nBindArrays = TRUE): each bound value is an array, and the item is drawn once per entry, the k-th
      // copy with the k-th value of every array (after a list's row picks its own array).
      if (it.arrayBinds === true) {
        const copies = this.arrayLength(it, ctx);
        for (let k = 0; k < copies; k++) this.drawItem(n, r, { ...ctx, item: k }, { ...dctx, item: k }, clip, it);
      } else this.drawItem(n, r, ctx, dctx, clip, it);
    }
  }

  /** How many copies an item with array binds draws: the length of its longest bound array (in its list row). */
  private arrayLength(it: JsonObject, ctx: Ctx): number {
    let len = 0;
    for (const v of Object.values(it)) {
      if (isObject(v) && typeof v.bind === "string") {
        let b = this.binds[v.bind];
        if (Array.isArray(b) && ctx.row !== null) b = ctx.row < b.length ? b[ctx.row] : undefined;
        if (Array.isArray(b)) len = Math.max(len, b.length);
      }
    }
    return len;
  }

  private num(it: JsonObject, key: string, ctx: Ctx, def: number): number {
    const v = pyFloat(this.value(it, key, ctx, def));
    return Number.isNaN(v) ? def : v;
  }

  /**
   * nui-preview's draw-list layer: the pixels inside(px, py) of the box (x0, y0, x1, y1, inclusive) in colour c,
   * cropped to the clip (truncated to whole pixels) and pasted at the clip's rounded corner.
   */
  private pilLayer(clip: ClipBox, c: RGBA, box: ClipBox, inside: (px: number, py: number) => boolean): void {
    if (this.dry) return;
    const cb = clip.map(Math.trunc) as ClipBox;
    const shiftX = pyRound(clip[0]) - cb[0];
    const shiftY = pyRound(clip[1]) - cb[1];
    if (cb[2] - cb[0] <= 0 || cb[3] - cb[1] <= 0) return;
    const ix0 = Math.max(box[0], cb[0], 0);
    const iy0 = Math.max(box[1], cb[1], 0);
    const ix1 = Math.min(box[2], cb[2] - 1, this.surface.width - 1);
    const iy1 = Math.min(box[3], cb[3] - 1, this.surface.height - 1);
    if (ix1 < ix0 || iy1 < iy0) return;
    const layer = newImage(ix1 - ix0 + 1, iy1 - iy0 + 1);
    for (let py = iy0; py <= iy1; py++) {
      for (let px = ix0; px <= ix1; px++) {
        if (!inside(px, py)) continue;
        const o = ((py - iy0) * layer.width + (px - ix0)) * 4;
        layer.data[o] = c[0];
        layer.data[o + 1] = c[1];
        layer.data[o + 2] = c[2];
        layer.data[o + 3] = c[3];
      }
    }
    this.surface.image(layer, ix0 + shiftX, iy0 + shiftY);
  }

  private drawItem(n: LayoutNode, r: Rect, ctx: Ctx, dctx: Ctx, clip: ClipBox, it: JsonObject): void {
    const [x, y, w, h] = r;
    if (!this.flag(it, "enabled", ctx, true)) return;
    const render = this.value(it, "render", ctx, 0);
    if (!(render === 0 || render === 1 || render === null || render === undefined)) return; // only on hover or a click
    const t = it.type;
    if (this.dry && t !== 4 && t !== 5) return; // images and text are checked in rows scrolled out of sight too
    const c = color(this.value(it, "color", ctx, null) ?? {}, [255, 255, 255, 255]);
    const fill = this.flag(it, "fill", ctx, false);
    const thick = pyFloat(this.value(it, "line_thickness", ctx, 1) || 1) || 1;
    const rectOf = () => {
      const v = this.value(it, "rect", ctx, null);
      return isObject(v) ? v : {};
    };
    const vec = (key: string): Point => {
      const v = this.value(it, key, ctx, null);
      const o = isObject(v) ? v : {};
      return [x + (pyFloat(o.x ?? 0) || 0), y + (pyFloat(o.y ?? 0) || 0)];
    };
    if (t === 4) {
      // text: nk_draw_text. The rect's corner cut to whole pixels (the command's shorts), the text from there on one
      // line (no wrapping, newlines included), clamped to the glyphs that start inside the rect's width (nk_text_clamp
      // keeps the one that crosses its edge), and clipped only by the draw list's clip.
      const rc = rectOf();
      const rx = Math.trunc(x + num0(rc.x, 0));
      const ry = Math.trunc(y + num0(rc.y, 0));
      const rw = num0(rc.w, w);
      const rhh = num0(rc.h, h);
      const s = this.shown(n, this.text(it, "text", ctx), [rx, ry, rw, rhh]);
      const font = this.skin.font(this.value(it, "font", ctx, null));
      this.line(font, textClamp(s, font, rw), rx, ry, c, clip);
      const tw = font.width(s);
      if (s && tw > rw + 0.5) {
        this.problem(n, "clipped text", `draw-list text "${short(s)}" is ${f0(tw)} px wide, its rect ${f0(rw)}: drawn on one line, cut after "${fits(s, font, rw)}"`, [rx, ry, rw, rhh]);
      }
    } else if (t === 5) {
      // image
      const rc = rectOf();
      const rr: Rect = [x + (pyFloat(rc.x ?? 0) || 0), y + (pyFloat(rc.y ?? 0) || 0), pyFloat(rc.w ?? w), pyFloat(rc.h ?? h)];
      this.image(
        n,
        rr,
        dctx,
        this.text(it, "image", ctx),
        this.value(it, "image_aspect", ctx, 0),
        this.value(it, "image_halign", ctx, 0),
        this.value(it, "image_valign", ctx, 0),
        this.value(it, "image_region", ctx, null),
      );
    } else if (t === 7) {
      // rect: nui-preview draws it on a layer the size of the canvas, crops that to the clip (truncated) and pastes it
      // at the clip's rounded corner: emulated pixel for pixel.
      const rc = rectOf();
      const rx = x + (pyFloat(rc.x ?? 0) || 0);
      const ry = y + (pyFloat(rc.y ?? 0) || 0);
      const rr = [rx, ry, rx + (pyFloat(rc.w ?? 0) || 0) - 1, ry + (pyFloat(rc.h ?? 0) || 0) - 1].map(Math.trunc) as ClipBox;
      if (rr[2] < rr[0] || rr[3] < rr[1]) return;
      const tw = Math.max(1, pyRound(thick));
      this.pilLayer(clip, c, [rr[0], rr[1], rr[2], rr[3]], (px, py) => fill || px < rr[0] + tw || px > rr[2] - tw || py < rr[1] + tw || py > rr[3] - tw);
    } else if (t === 2) {
      // circle
      const rc = rectOf();
      this.circle(x + num0(rc.x, 0), y + num0(rc.y, 0), num0(rc.w, 0), num0(rc.h, 0), c, fill, thick, clip);
    } else if (t === 0 || t === 6) {
      // polyline, line
      let pts: Point[];
      if (t === 6) pts = [vec("a"), vec("b")];
      else {
        const raw = this.value(it, "points", ctx, []);
        const arr = Array.isArray(raw) ? raw.map((v) => pyFloat(v) || 0) : [];
        pts = [];
        for (let k = 0; k + 1 < arr.length; k += 2) pts.push([x + arr[k]!, y + arr[k + 1]!]);
      }
      if (pts.length >= 2) {
        const width = Math.max(1, pyRound(thick));
        // Anti-aliased, as Nuklear draws lines (nui-preview draws them aliased with Pillow).
        if (fill && t === 0) this.surface.polygon(pts, c, clip);
        else this.surface.polyline(pts, c, width, clip);
      }
    } else if (t === 1) {
      // curve (cubic Bezier)
      this.surface.bezier(vec("a"), vec("ctrl0"), vec("ctrl1"), vec("b"), c, Math.max(1, thick), clip);
    } else if (t === 3) {
      // arc: centre, radius, angles in radians
      const [cx, cy] = vec("c");
      this.surface.arc(cx, cy, this.num(it, "radius", ctx, 0), this.num(it, "amin", ctx, 0), this.num(it, "amax", ctx, 0), c, fill, Math.max(1, thick), clip);
    }
  }

  /**
   * nk_fill_circle / nk_stroke_circle as nk_convert draws them: the rect's corner and size cut to whole pixels (the
   * command's shorts), a circle of radius w / 2 around the rect's centre (h only moves the centre), a stroke of
   * whole-pixel thickness centred on that radius; anti-aliased (8x supersampled, as nui-preview since #1115), blended
   * with the colour's alpha, and clipped like the rest of the draw list.
   */
  private circle(rx: number, ry: number, rw: number, rh: number, c: RGBA, fill: boolean, thick: number, clip: ClipBox): void {
    if (this.dry) return;
    const X = Math.trunc(rx);
    const Y = Math.trunc(ry);
    const W = Math.trunc(Math.max(rw, 0));
    const H = Math.trunc(Math.max(rh, 0));
    if (W <= 0 || H <= 0 || c[3] === 0 || (!fill && thick <= 0)) return;
    const cx = X + W / 2;
    const cy = Y + H / 2;
    const rad = W / 2;
    const t = fill ? 0 : Math.max(1, Math.trunc(thick));
    const outer = rad + t / 2;
    const inner = rad - t / 2;
    const k = CIRCLE_SUPERSAMPLE;
    const x0 = Math.floor(cx - outer) - 1;
    const y0 = Math.floor(cy - outer) - 1;
    const size = Math.ceil(2 * outer) + 3;
    const S = size * k;
    const big = new Uint8ClampedArray(S * S);
    const ox = (cx - x0) * k;
    const oy = (cy - y0) * k;
    const ro = (outer * k) ** 2;
    const ri = !fill && inner * k >= 1 ? (inner * k) ** 2 : -1;
    for (let j = 0; j < S; j++) {
      const dy = j + 0.5 - oy;
      for (let i = 0; i < S; i++) {
        const dx = i + 0.5 - ox;
        const d = dx * dx + dy * dy;
        // The supersampled pixels whose centres are inside the ring.
        if (d <= ro && d > ri) big[j * S + i] = 255;
      }
    }
    const mask = resizeMask(big, S, S, size, size, "box");
    const layer = newImage(size, size);
    for (let i = 0; i < size * size; i++) {
      layer.data[i * 4] = c[0];
      layer.data[i * 4 + 1] = c[1];
      layer.data[i * 4 + 2] = c[2];
      layer.data[i * 4 + 3] = Math.trunc((mask[i]! * c[3] + 127) / 255);
    }
    this.paste(layer, x0, y0, 1, clip);
  }
}

export { LayoutNode };
