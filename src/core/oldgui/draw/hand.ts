/**
 * The old GUI's small controls, bars, tabs, radial pieces and the Player List's frame atlas, drawn by hand in the
 * skin's style at the stock size and layout. The texel positions are the stock models' (their UVs), not art.
 */
import { type UvEntry, cellsFor } from "../cells.js";
import { ICONS } from "../roles.js";
import { type Pic, type RGB, clonePic, fillRect, lumOf, pic, ring, setA, setRgb } from "./raster.js";
import { copyRect, redrawRegions, redrawShape, redrawTrace } from "./redraw.js";
import { iconCells, putIcon, silhouette } from "./icons.js";
import { drawRectFrame } from "./rules.js";
import type { OldGuiStyle, State } from "./style.js";

type Rect = [number, number, number, number];
export type Hand = (st: Pic, s: OldGuiStyle, ctx: { uv: readonly UvEntry[]; alpha: (a: number) => number }) => Pic;

const blank = (st: Pic, c: RGB, a = 255) => pic(st.w, st.h, c, a);

// --- scrollbar, slider, arrows, checkbox --------------------------------------------------------------------------

/** 16x16, the list scrollbar's thumb: rows 2-13 its cross-section (tiled along its length), rows 0-1 and 14-15 its
 * end caps (columns 2-13). A flat thumb of 8 of the quad's 12 px, a 1 px edge each side, 2 px of track beside it. */
const scrollbar: Hand = (st, s) => {
  const img = blank(st, s.out, 0);
  const cross: (RGB | null)[] = [null, null, s.out, ...Array<RGB>(6).fill(s.line), s.out, null, null];
  cross.forEach((c, i) => {
    if (c) fillRect(img, 0, 2 + i, img.w, 3 + i, c, 255);
  });
  cross.forEach((c, x) => {
    if (!c) return;
    for (const [y, col] of [
      [1, c],
      [14, c],
      [0, s.out],
      [15, s.out],
    ] as const) {
      setRgb(img, 2 + x, y, col);
      setA(img, 2 + x, y, 255);
    }
  });
  return img;
};

/** 16x16: rows 6-10 the groove (tiled along the whole width), the knob (columns 0-11) flat above and below it. */
const slider: Hand = (st, s) => {
  const img = blank(st, s.out, 0);
  [s.out, s.tline, s.track, s.tline, s.out].forEach((c, i) => fillRect(img, 0, 6 + i, img.w, 7 + i, c, 255));
  for (const [y0, y1] of [
    [0, 6],
    [11, 16],
  ] as const) {
    fillRect(img, 0, y0, 12, y1, s.out, 255);
    fillRect(img, 1, y0, 11, y1, s.line);
  }
  // the grip line
  fillRect(img, 5, 1, 7, 5, s.out);
  fillRect(img, 5, 12, 7, 15, s.out);
  return img;
};

/** A filled triangle pointing up or down, centred at (cx, cy), `size` rows tall. */
function triangle(img: Pic, cx: number, cy: number, size: number, up: boolean, col: RGB, outline: RGB | null): void {
  for (let i = 0; i < size; i++) {
    const half = up ? i : size - 1 - i;
    const y = cy - (size >> 1) + i;
    if (y < 0 || y >= img.h) continue;
    const xa = cx - half;
    const xb = cx + half + 1;
    fillRect(img, xa, y, xb, y + 1, col, 255);
    if (outline) {
      fillRect(img, xa - 1, y, xa, y + 1, outline, 255);
      fillRect(img, xb, y, xb + 1, y + 1, outline, 255);
    }
  }
}

/** 32x16: a down arrow button (left) and an up one (right), each the stock arrow's shape, flat. */
const arrowbtn: Hand = (st, s) => {
  const img = blank(st, s.out);
  const { kind, cells } = iconCells("gui_chr_arrowbtn", st);
  for (const r of cells) {
    drawRectFrame(img, r[0], r[1], r[2], r[3], "normal", s);
    putIcon(img, r, silhouette(st, r, kind), s.mark);
  }
  fillRect(img, 0, 0, img.w, img.h, null, 255);
  return img;
};

/** 16x16 checkbox and close face: edge, rule, the dark field, a flat X. */
const chk: Hand = (st, s) => {
  const img = blank(st, s.track);
  ring(img, 0, 0, 16, 16, s.out);
  ring(img, 1, 1, 15, 15, s.line);
  for (let i = 0; i < 8; i++) {
    for (const dd of [0, 1]) {
      const y = 4 + i;
      setRgb(img, 4 + i + dd - (dd && i === 7 ? 1 : 0), y, s.mark);
      setRgb(img, 11 - i - dd + (dd && i === 7 ? 1 : 0), y, s.mark);
    }
  }
  return img;
};

const splArrow =
  (up: boolean): Hand =>
  (st, s) => {
    const img = blank(st, s.out, 0);
    triangle(img, 8, 8, 6, up, s.mark, s.out);
    return img;
  };

/** An item cell: a flat fill with a rule along its top and left (the next cell's closes it). */
const cell =
  (fill: (s: OldGuiStyle) => RGB, line: ((s: OldGuiStyle) => RGB) | null): Hand =>
  (st, s, { alpha }) => {
    const img = blank(st, fill(s));
    for (let i = 0; i < st.w * st.h; i++) img.d[i * 4 + 3] = alpha(st.d[i * 4 + 3]!);
    if (line) {
      for (let x = 0; x < st.w; x++) {
        setRgb(img, x, 0, line(s));
        setA(img, x, 0, st.d[x * 4 + 3]! > 0 ? 255 : 0);
      }
      for (let y = 0; y < st.h; y++) {
        setRgb(img, 0, y, line(s));
        setA(img, 0, y, st.d[y * st.w * 4 + 3]! > 0 ? 255 : 0);
      }
    }
    return img;
  };

/** The item grid's rules only, two texels wide across the tile seam: the grid tiles at about 32.9 px per 32 texels,
 * so a 1 texel rule would land on another sub-pixel offset in every cell and draw every other rule at half strength. */
const linesOnly: Hand = (st, s) => {
  const img = blank(st, s.tline, 0);
  const { w, h } = st;
  const on = (x: number, y: number) => st.d[(((y + h) % h) * w + ((x + w) % w)) * 4 + 3]! > 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setA(img, x, y, on(x, y) || on(x, y + 1) || on(x + 1, y) ? 255 : 0);
  return img;
};

/** Icon buttons: each cell a button in its state (its frame on the cell's own edge), the stock pictogram of cell
 * src[i] at its own texels, flat: normal the mark, hover the glow on the pressed fill, disabled the disabled rule's. */
function iconButtons(img: Pic, st: Pic, s: OldGuiStyle, name: string, states: State[]): void {
  const { kind, cells, src } = iconCells(name, st);
  cells.forEach((r, i) => {
    const state = states[i % states.length]!;
    // hover: the pressed fill inside the rule (no glow rule: the icon covers most of it and merges with it)
    drawRectFrame(img, r[0], r[1], r[2], r[3], state === "hilite" ? "normal" : state, s);
    if (state === "hilite") fillRect(img, r[0] + 2, r[1] + 2, r[2] - 2, r[3] - 2, s.press);
    const col = state === "hilite" || state === "pressed" ? s.glow : state === "disabled" ? s.dline : s.mark;
    putIcon(img, r, silhouette(st, cells[src[i]!]!, kind), col);
  });
}

/** 32x32 help button: a button around the stock "?" at its own texels. */
const helpBtn: Hand = (st, s) => {
  const img = blank(st, s.out);
  let x0 = st.w;
  let y0 = st.h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < st.h; y++) {
    for (let x = 0; x < st.w; x++) {
      if (st.d[(y * st.w + x) * 4 + 3]! > 0) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
    }
  }
  drawRectFrame(img, x0, y0, x1, y1, "normal", s);
  const { kind, cells } = iconCells("ctl_cg_btn_help", st);
  putIcon(img, cells[0]!, silhouette(st, cells[0]!, kind), s.mark);
  for (let i = 0; i < st.w * st.h; i++) img.d[i * 4 + 3] = st.d[i * 4 + 3] === 0 ? 0 : 255;
  return img;
};

/** Party-bar buttons (64x64): plates x 14-49, up, hover and disabled, each with the up plate's pictogram. */
const pbBut: Hand = (st, s) => {
  const img = blank(st, s.out);
  iconButtons(img, st, s, "pb_but_pvp", ["normal", "hilite", "disabled"]);
  for (let i = 0; i < st.w * st.h; i++) img.d[i * 4 + 3] = st.d[i * 4 + 3] === 0 ? 0 : 255;
  return img;
};

/** 64x64: three columns of 16x16 map buttons (rows: up, down, disabled, hover) with the stock glyph, flat; the pins
 * column kept. */
const mapPieces: Hand = (st, s) => {
  const img = clonePic(st);
  const states: State[] = ["normal", "pressed", "disabled", "hilite"];
  const { kind, cells } = iconCells("gui_map_pieces", st);
  cells.forEach((r, i) => {
    const state = states[Math.floor(i / 3)]!;
    const g = silhouette(st, r, kind);
    drawRectFrame(img, r[0], r[1], r[2], r[3], state, s);
    putIcon(img, r, g, state === "hilite" ? s.glow : state === "disabled" ? s.dline : s.mark);
    fillRect(img, r[0], r[1], r[2], r[3], null, 255);
  });
  return img;
};

// --- bars -----------------------------------------------------------------------------------------------------------

/** 256x128, the load screen's bar: its frame is three 256x35 strips (left end, middle, right end) laid side by side,
 * each with its rules on the same rows so they run on through all three; the fill (rows 110-127) a left cap, a
 * middle cell the client stretches with the percentage, and a right cap: one flat band along the whole width. */
const loadstatus: Hand = (st, s) => {
  const img = blank(st, [0, 0, 0]);
  for (const [top, x0, x1] of [
    [0, 14, 256],
    [35, 0, 256],
    [70, 0, 242],
  ] as const) {
    const y0 = top + 2;
    const y1 = top + 33;
    fillRect(img, x0, y0, x1, y1 + 1, s.panel);
    fillRect(img, x0, y0, x1, y0 + 1, s.line);
    fillRect(img, x0, y1, x1, y1 + 1, s.line);
    if (top === 0) fillRect(img, x0, y0, x0 + 1, y1 + 1, s.line);
    if (top === 70) fillRect(img, x1 - 1, y0, x1, y1 + 1, s.line);
  }
  fillRect(img, 0, 110, 256, 128, s.panel);
  fillRect(img, 0, 112, 256, 126, s.line);
  return img;
};

/** 128x64, the rest popup (rows 0-59) and its bar: a 14-texel cell of row 62 turned on its side and stretched with the
 * percentage, so its columns are the bar's height: a flat band (x 2-13) on the panel's ink. */
const resting: Hand = (st, s, { alpha }) => {
  const img = redrawTrace(st, s, alpha);
  fillRect(img, 0, 60, img.w, img.h, [0, 0, 0]);
  fillRect(img, 0, 60, 14, img.h, s.panel);
  fillRect(img, 2, 60, 14, img.h, s.line);
  fillRect(img, 0, 0, img.w, img.h, null, 255);
  return img;
};

// --- buttons with shapes --------------------------------------------------------------------------------------------

/** 64x32: the creation wizard's left and right arrow buttons, the stock cut-out filled, a chevron pointing its way. */
const cgArrows: Hand = (st, s) => {
  const img = redrawShape(st, s);
  const h = st.h;
  for (const [k, dir] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const cx = k * 32 + 16;
    const cy = h >> 1;
    for (let i = 0; i < 6; i++) {
      for (let t = 0; t < 2; t++) {
        const x = dir > 0 ? cx - 3 + i + t : cx + 3 - i - t;
        for (const yy of [cy - 5 + i, cy + 5 - i]) if (yy >= 0 && yy < h && x >= 0 && x < img.w && img.d[(yy * img.w + x) * 4 + 3]! > 0) setRgb(img, x, yy, s.mark);
      }
    }
  }
  return img;
};

/** 512x32: the container label bar (x 0-300) and three arrow-button cells: normal, hover, pressed. */
const invContain: Hand = (st, s, { uv, alpha }) => {
  const img = redrawRegions(st, uv, s, alpha, "panel");
  fillRect(img, 300, 0, img.w, img.h, s.panel);
  for (const [x0, x1, state] of [
    [300, 329, "normal"],
    [328, 357, "hilite"],
    [356, 385, "pressed"],
  ] as const) {
    drawRectFrame(img, x0, 1, x1, 31, state, s);
    const cy = 16;
    const cx = ((x0 + x1) >> 1) - 2;
    for (let i = 0; i < 6; i++) fillRect(img, cx + i, cy - 5 + i, cx + i + 1, cy + 6 - i, s.mark);
  }
  for (let i = 0; i < st.w * st.h; i++) img.d[i * 4 + 3] = st.d[i * 4 + 3] === 0 ? 0 : 255;
  return img;
};

/** 128x256: member frames (panel art) and a column of 14 plates at x 83-118, each party-bar button's normal and hover
 * plate in turn (17 rows each; the models read them 1:1, pressed one row lower): buttons with the stock pictogram at
 * its full size and place. */
const partyBar: Hand = (st, s, { uv, alpha }) => {
  const img = redrawRegions(st, uv, s, alpha, "panel");
  fillRect(img, 82, 0, 120, img.h, s.out);
  iconButtons(img, st, s, "pnl_party_bar", ["normal", "hilite"]);
  for (let i = 0; i < st.w * st.h; i++) if (st.d[i * 4 + 3] === 0) img.d[i * 4 + 3] = 0;
  return img;
};

/** 128x128, ctl_btn_jnl_inv: an icon atlas that also holds two controls' frames, redrawn around the kept icons: the
 * checkbox (its box, its hover box, and its mark, a cell the model lays over a third box drawn whole so the mark's
 * cell matches the box under it), and the inventory's eye and gold buttons (normal and hover / pressed). */
const jnlInv: Hand = (st, s) => {
  const img = blank(st, s.out);
  for (const r of ICONS.ctl_btn_jnl_inv ?? []) copyRect(img, st, r);
  fillRect(img, 0, 0, img.w, img.h, null, 255);
  fillRect(img, 0, 0, 25, 52, s.out);
  fillRect(img, 24, 28, 48, 52, s.out);
  for (const [x0, y0, glow] of [
    [1, 7, false],
    [1, 29, false],
    [24, 29, true],
  ] as const) {
    const x1 = x0 + 23;
    const y1 = y0 + 22;
    fillRect(img, x0, y0, x1, y1, s.track);
    ring(img, x0, y0, x1, y1, s.out);
    ring(img, x0 + 1, y0 + 1, x1 - 1, y1 - 1, s.line);
    if (glow) ring(img, x0 + 2, y0 + 2, x1 - 2, y1 - 2, s.glow);
  }
  // the mark: an X of 2 texel strokes, 10 x 10, centred on the box
  for (let i = 0; i < 10; i++) for (const x of new Set([8 + i, Math.min(17, 9 + i), 17 - i, Math.max(8, 16 - i)])) setRgb(img, x, 35 + i, s.mark);
  const keep = clonePic(img);
  const L = lumOf(keep);
  for (const x0 of [48, 89]) {
    for (const [y0, state] of [
      [52, "normal"],
      [90, "hilite"],
    ] as const) {
      drawRectFrame(img, x0, y0, x0 + 38, y0 + 38, state, s);
      for (const [ix0, iy0, ix1, iy1] of ICONS.ctl_btn_jnl_inv ?? []) {
        if (!(x0 < ix0 && ix1 < x0 + 38 && y0 < iy0 && iy1 < y0 + 38)) continue;
        for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) if (L[y * img.w + x]! > 40) for (let k = 0; k < 4; k++) img.d[(y * img.w + x) * 4 + k] = keep.d[(y * img.w + x) * 4 + k]!;
      }
    }
  }
  return img;
};

// --- tabs -----------------------------------------------------------------------------------------------------------

/** Text tabs: (body columns b0-b1, cap columns c0-c1, cap rows top-bottom). Every tab texture is clamped (txi clamp 3)
 * and its body reads past the last row: one row stretched down. The selected tab is the one its model raises. */
const TEXT_TABS: Record<string, [[number, number], [number, number], [number, number]]> = {
  gui_pre_playtabs: [
    [4, 123],
    [5, 122],
    [1, 5],
  ],
  gui_ig_jourtabs: [
    [4, 123],
    [5, 122],
    [1, 5],
  ],
  gui_srv_lst_tab: [
    [1, 126],
    [2, 125],
    [1, 5],
  ],
  gui_inv_sto_tab: [
    [0, 66],
    [1, 65],
    [0, 4],
  ],
};

/** The tabs' ink everywhere, the stock alpha. */
function tabBase(st: Pic, s: OldGuiStyle): Pic {
  const img = blank(st, s.panel);
  for (let i = 0; i < st.w * st.h; i++) img.d[i * 4 + 3] = st.d[i * 4 + 3]!;
  return img;
}

const textTab =
  (name: string): Hand =>
  (st, s) => {
    const [[b0, b1], [c0, c1], [ct, cb]] = TEXT_TABS[name]!;
    const img = tabBase(st, s);
    fillRect(img, c0, ct, c1 + 1, cb + 1, null, 255);
    fillRect(img, b0, cb + 1, b1 + 1, img.h, null, 255);
    // outlined: a rule along the top and both sides, open at the bottom (it joins the panel)
    fillRect(img, c0, ct, c1 + 1, ct + 1, s.line);
    fillRect(img, c0, ct, c0 + 1, img.h, s.line);
    fillRect(img, c1, ct, c1 + 1, img.h, s.line);
    return img;
  };

/** 8x64, the inventory's side tabs: the body reads column 0 (clamped) over rows 0-33; the outer piece columns 2-5. */
const invTab: Hand = (st, s) => {
  const img = tabBase(st, s);
  fillRect(img, 0, 0, 6, 34, null, 255);
  fillRect(img, 0, 1, 6, 2, s.line);
  fillRect(img, 0, 32, 6, 33, s.line);
  fillRect(img, 5, 1, 6, 33, s.line);
  return img;
};

/** 128x16, the Character Record's icon tabs: selected cap rows 6 (top) to 2 and body rows 1-0; not selected cap rows
 * 9 to 13 and body rows 14-15. Every tab outlined (top and sides), the selected one's top rule doubled. */
const charTabs: Hand = (st, s) => {
  const img = tabBase(st, s);
  fillRect(img, 17, 0, 107, img.h, null, 255);
  const c0 = 18;
  const c1 = 105;
  for (const [top, r0, r1] of [
    [9, 9, 16],
    [6, 0, 7],
  ] as const) {
    fillRect(img, c0, top, c1 + 1, top + 1, s.line);
    fillRect(img, c0, r0, c0 + 1, r1, s.line);
    fillRect(img, c1, r0, c1 + 1, r1, s.line);
  }
  fillRect(img, c0, 5, c1 + 1, 6, s.line);
  return img;
};

/** The icons the tabs carry: their dark ground recoloured to the tabs' ink, so no icon shows as a box on its tab. */
export const ICON_GROUNDS = ["gui_char_icons", "gui_inv_icons", "gui_inv_sto_icon"];

export function iconGround(img: Pic, s: OldGuiStyle): void {
  for (let i = 0; i < img.w * img.h; i++) {
    const r = img.d[i * 4]!;
    const g = img.d[i * 4 + 1]!;
    const b = img.d[i * 4 + 2]!;
    const mx = Math.max(r, g, b);
    if (mx <= 27 && mx - Math.min(r, g, b) <= 9) setRgb(img, i % img.w, Math.floor(i / img.w), s.panel);
  }
}

// --- the radial menu ------------------------------------------------------------------------------------------------

const SS = 8;
const RIM_DISC = 2.2;
const RIM_SMALL = 1.3;
const DOT = 1.25;

type Inside = (x: number, y: number) => boolean;
const disc =
  (cx: number, cy: number, r: number): Inside =>
  (x, y) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Fraction of a texel's area where inside holds (SS x SS samples). */
function cover(x: number, y: number, f: Inside): number {
  let n = 0;
  for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) if (f(x + (i + 0.5) / SS, y + (j + 0.5) / SS)) n++;
  return n / (SS * SS);
}

/** Over the texels in `where`: alpha the coverage of `outer`; the fill inside `inner` (null: a ring), the rim between;
 * texels `outer` misses take the rim colour at alpha 0, so filtering mixes in no dark fringe. */
function paint(img: Pic, where: (x: number, y: number) => boolean, outer: Inside, inner: Inside | null, fill: RGB | null, rim: RGB): void {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (!where(x, y)) continue;
      const co = cover(x, y, outer);
      const ci = inner ? Math.min(cover(x, y, inner), co) : 0;
      const a = fill ? co : co - ci;
      const k = co > 0 ? ci / co : 0;
      setRgb(img, x, y, fill ? [0, 1, 2].map((c) => k * fill[c]! + (1 - k) * rim[c]!) : rim);
      const al = 255 * a;
      setA(img, x, y, al < 16 ? 0 : al);
    }
  }
}

const inRect = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => x >= Math.floor(x0) && x < Math.ceil(x1) && y >= Math.floor(y0) && y < Math.ceil(y1);

/** 128x128: the big disc in [0, 112]^2 (drawn at 56 and 128 px), the sub-menu circles (22 texel cells drawn 1:1, a dot
 * per stock count dot), the rest as a flat shape. */
const radialmenu: Hand = (st, s, { uv }) => {
  const img = redrawShape(st, s);
  const others: Rect[] = [];
  const subs: Rect[] = [];
  for (const c of cellsFor(uv, st.w, st.h)) {
    const refs = c.slice(6) as string[];
    if (refs.some((r) => /circle56|circle112|spl_plain/.test(r))) continue;
    const r: Rect = [c[0], c[1], c[2], c[3]];
    others.push(r);
    if (refs.some((x) => x.includes("multisub"))) subs.push(r.map(Math.trunc) as Rect);
  }
  // the stock's ninth circle cell (no model reads it): kept whole
  others.push([105, 88, 127, 110]);
  subs.push([105, 88, 127, 110]);
  const isOther = (x: number, y: number) => others.some((r) => inRect(...r)(x, y));
  const big = (x: number, y: number) => inRect(0, 0, 112, 112)(x, y) && !isOther(x, y);
  // the bar right of the disc's top corner: clear, or the 56 px button's corner pixel samples it
  const spare = (x: number, y: number) => inRect(112, 0, 128, 8)(x, y) && !isOther(x, y);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (spare(x, y)) {
        setRgb(img, x, y, s.btn);
        setA(img, x, y, 0);
      }
    }
  }
  const rr = 56 - 0.35;
  paint(img, big, disc(56, 56, rr), disc(56, 56, rr - RIM_DISC), s.btn, s.line);
  for (const [x0, y0, x1, y1] of subs) {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const r = (x1 - x0) / 2 - 0.35;
    // the stock's dark count dots inside the circle
    const dark = new Set<string>();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if ((st.d[(y * st.w + x) * 4]! + st.d[(y * st.w + x) * 4 + 1]! + st.d[(y * st.w + x) * 4 + 2]!) / 3 < 80 && (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 < (r - 2.5) ** 2) dark.add(`${x},${y}`);
    const dots: [number, number][] = [];
    const seen = new Set<string>();
    for (const k of dark) {
      if (seen.has(k)) continue;
      const q = [k];
      seen.add(k);
      let sx = 0;
      let sy = 0;
      let n = 0;
      while (q.length) {
        const [x, y] = q.pop()!.split(",").map(Number) as [number, number];
        sx += x;
        sy += y;
        n++;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const kk = `${x + dx},${y + dy}`;
          if (dark.has(kk) && !seen.has(kk)) {
            seen.add(kk);
            q.push(kk);
          }
        }
      }
      dots.push([sx / n + 0.5, sy / n + 0.5]);
    }
    const m = inRect(x0, y0, x1, y1);
    paint(img, m, disc(cx, cy, r), disc(cx, cy, r - RIM_SMALL), s.btn, s.line);
    if (dots.length) {
      const f: Inside = (x, y) => dots.some(([dx, dy]) => (x - dx) ** 2 + (y - dy) ** 2 <= DOT * DOT);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (cover(x, y, f) >= 0.5) setRgb(img, x, y, s.line);
    }
  }
  return img;
};

/** 32x32: the ring an icon sits in (texels 5-27, drawn 1:1): a flat disc with a rim. */
const radRing: Hand = (st, s) => {
  const img = blank(st, s.line);
  paint(img, () => true, disc(16, 16, 11 - 0.35), disc(16, 16, 11 - 0.35 - RIM_SMALL), s.btn, s.line);
  return img;
};

/** 128x64: the spell radial's focus disc (the upper left half of 1-57 x 0-56, mirrored across x + y = 57) and its ring
 * (the lower right half, mirrored across x + y = 63), both drawn 1:1; the rest a flat shape. */
const spellmenu: Hand = (st, s) => {
  const img = redrawShape(st, s);
  const area = inRect(0, 0, 58, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 58; x++) {
      setRgb(img, x, y, s.line);
      setA(img, x, y, 0);
    }
  }
  const rf = 28 - 0.35;
  paint(img, (x, y) => area(x, y) && x + y + 1 < 60, disc(29, 28, rf), disc(29, 28, rf - RIM_SMALL), s.btn, s.line);
  paint(img, (x, y) => area(x, y) && x + y + 1 >= 60, disc(29, 34, 26.1), disc(29, 34, 26.1 - RIM_SMALL), null, s.line);
  return img;
};

// --- the Player List ------------------------------------------------------------------------------------------------

/** 256x128, ctl_ig_btn_pvpre: rows 0-24 the attitude button (up, down, hover), rows 44-85 the top row's six button
 * cells, rows 86-127 one long box. The window cuts its pieces across these, so the cells and the box keep their rules
 * on the same rows and the separators stop short of them. */
const pvpre: Hand = (st, s) => {
  const img = blank(st, s.out);
  for (const [x0, state] of [
    [0, "normal"],
    [80, "pressed"],
    [160, "hilite"],
  ] as const)
    drawRectFrame(img, x0, 0, x0 + 80, 25, state, s);
  for (const [top, left] of [
    [86, 2],
    [44, 21],
  ] as const) {
    const y0 = top + 2;
    const y1 = top + 39;
    fillRect(img, left, y0, 255, y1 + 1, s.panel);
    fillRect(img, left, y0, 255, y0 + 1, s.line);
    fillRect(img, left, y1, 255, y1 + 1, s.line);
    fillRect(img, left, y0, left + 1, y1 + 1, s.line);
    fillRect(img, 254, y0, 255, y1 + 1, s.line);
  }
  fillRect(img, 19, 46, 21, 47, s.line);
  fillRect(img, 19, 83, 21, 84, s.line);
  for (const x of [60, 99, 138, 177, 216]) fillRect(img, x, 47, x + 1, 83, s.line);
  return img;
};

export const HAND: Record<string, Hand> = {
  ctl_ig_btn_pvpre: pvpre,
  gui_scrollbar: scrollbar,
  gui_slider: slider,
  gui_chr_arrowbtn: arrowbtn,
  ctl_chk_pre: chk,
  ctl_btn_x: chk,
  gui_spl_btn_up: splArrow(true),
  gui_spl_btn_down: splArrow(false),
  gui_inv_hilite: cell(
    (s) => s.press,
    (s) => s.line,
  ),
  gui_inv_unhilite: cell(
    (s) => s.track,
    (s) => s.tline,
  ),
  gui_inv_bkgnd: cell(
    (s) => s.track,
    (s) => s.tline,
  ),
  gui_inv_bkgnd2: linesOnly,
  gui_invm_hl: cell((s) => s.press, null),
  gui_invm_unhl: cell((s) => s.track, null),
  gui_invm_ocupied: cell((s) => s.btn, null),
  ctl_cg_btn_help: helpBtn,
  pb_but_pvp: pbBut,
  pb_but_rest: pbBut,
  pb_but_spell: pbBut,
  gui_map_pieces: mapPieces,
  gui_loadstatus: loadstatus,
  gui_resting: resting,
  ctl_cg_btn_right: cgArrows,
  gui_inv_contain: invContain,
  pnl_party_bar: partyBar,
  ctl_btn_jnl_inv: jnlInv,
  ...Object.fromEntries(Object.keys(TEXT_TABS).map((n) => [n, textTab(n)])),
  gui_inv_tab: invTab,
  gui_ig_chartabs: charTabs,
  gui_ig_chartabs2: charTabs,
  gui_radialmenu: radialmenu,
  gui_rad_ring: radRing,
  gui_spellmenu: spellmenu,
};
