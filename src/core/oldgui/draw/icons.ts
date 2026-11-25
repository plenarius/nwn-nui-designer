/**
 * Icon buttons: atlases whose cells hold a pictogram (the party bar's column of parchment plates, pb_but_*, the map's
 * buttons, the creation wizard's arrows and help button). The redraw keeps each stock pictogram texel for texel (same
 * size and place) inside a frame on the cell's own edge, so no icon shrinks; the icon size check measures it against
 * the stock's extent (written by the inventory, numbers only).
 */
import { type Mask, type Pic, type RGB, fillHoles, label, lumOf, setRgb } from "./raster.js";

export type Rect = [number, number, number, number];
/** dark: a dark symbol on a parchment plate; outline: a dark outline on a shaded plate, filled; bright: a light symbol
 * on a dark button. */
export type IconKind = "dark" | "outline" | "bright";

/** Each atlas: its kind of symbol, its cells (or the plates of a column x0..x1), and which cell's pictogram each cell
 * shows ("pairs": the even plate before it, normal then hover; "first": the first plate; else its own). */
export const ICON_ATLASES: Record<string, { kind: IconKind; cells: Rect[] | { plates: [number, number] }; same?: "pairs" | "first" }> = {
  pnl_party_bar: { kind: "dark", cells: { plates: [83, 118] }, same: "pairs" },
  pb_but_pvp: { kind: "dark", cells: { plates: [14, 49] }, same: "first" },
  pb_but_rest: { kind: "dark", cells: { plates: [14, 49] }, same: "first" },
  pb_but_spell: { kind: "dark", cells: { plates: [14, 49] }, same: "first" },
  gui_chr_arrowbtn: {
    kind: "outline",
    cells: [
      [0, 0, 16, 16],
      [16, 0, 32, 16],
    ],
  },
  gui_map_pieces: { kind: "bright", cells: [0, 16, 32, 48].flatMap((y) => [0, 16, 32].map((x) => [x, y, x + 16, y + 16] as Rect)) },
  // inside its frame
  ctl_cg_btn_help: { kind: "bright", cells: [[8, 8, 24, 24]] },
};

/** One cell's stock pictogram: where it reaches inside the cell (left, top, right, bottom) and its texel count. */
export interface IconCell {
  rect: Rect;
  extent: Rect;
  area: number;
}

function percentile(v: ArrayLike<number>, q: number): number {
  const a = Array.from(v).sort((x, y) => x - y);
  const r = (a.length - 1) * q;
  const f = Math.floor(r);
  return a[f]! + (a[Math.min(a.length - 1, f + 1)]! - a[f]!) * (r - f);
}

function cellLum(p: Pic, [x0, y0, x1, y1]: Rect): { L: Float32Array; w: number; h: number } {
  const all = lumOf(p);
  const w = x1 - x0;
  const h = y1 - y0;
  const L = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) L[y * w + x] = all[(y0 + y) * p.w + x0 + x]!;
  return { L, w, h };
}

/** The plates of a column at texels x0..x1: runs of rows that are not black, cut into plates about h rows high. */
export function plates(st: Pic, x0: number, x1: number, h = 17): Rect[] {
  const L = lumOf(st);
  const lit = (y: number) => {
    for (let x = x0 + 1; x < x1 - 1; x++) if (st.d[(y * st.w + x) * 4 + 3]! > 0 && L[y * st.w + x]! > 30) return true;
    return false;
  };
  const out: Rect[] = [];
  for (let y = 0; y < st.h; ) {
    if (!lit(y)) {
      y++;
      continue;
    }
    let e = y;
    while (e < st.h && lit(e)) e++;
    const k = Math.max(1, Math.round((e - y) / h));
    for (let i = 0; i < k; i++) out.push([x0, y + Math.floor((i * (e - y)) / k), x1, y + Math.floor(((i + 1) * (e - y)) / k)]);
    y = e;
  }
  return out;
}

/** The stock pictogram of a cell, as a mask of the cell's texels. */
export function silhouette(st: Pic, rect: Rect, kind: IconKind): Mask {
  const { L, w, h } = cellLum(st, rect);
  const inner: number[] = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) inner.push(L[y * w + x]!);
  let m = new Uint8Array(w * h);
  if (kind === "outline") {
    const iw = w - 4;
    const ih = h - 4;
    const sub = new Uint8Array(iw * ih);
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) sub[y * iw + x] = L[(y + 2) * w + x + 2]! < 64 ? 1 : 0;
    const f = fillHoles(sub, iw, ih);
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) m[(y + 2) * w + x + 2] = f[y * iw + x]!;
  } else {
    const thr = kind === "dark" ? 0.55 * percentile(inner, 0.6) : percentile(inner, 0.3) + 20;
    m = m.map((_, i) => (kind === "dark" ? L[i]! < thr : L[i]! > thr) ? 1 : 0);
  }
  for (let x = 0; x < w; x++) m[x] = m[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) m[y * w] = m[y * w + w - 1] = 0;
  // drop specks and the bevel's shading: pieces that stay within 2 texels of the plate's edge
  const { lab, n } = label(m, w, h, true);
  const size = new Int32Array(n + 1);
  const deep = new Uint8Array(n + 1);
  for (let i = 0; i < w * h; i++) {
    const l = lab[i]!;
    if (!l) continue;
    size[l]!++;
    const x = i % w;
    const y = (i - x) / w;
    if (x >= 2 && y >= 2 && x < w - 2 && y < h - 2) deep[l] = 1;
  }
  return m.map((v, i) => (v && size[lab[i]!]! >= 3 && deep[lab[i]!] ? 1 : 0));
}

export function extent(m: Mask, w: number): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + 1);
    y1 = Math.max(y1, y + 1);
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/** An atlas's cells and, for each, the cell whose stock pictogram it shows. */
export function iconCells(name: string, st: Pic): { kind: IconKind; cells: Rect[]; src: number[] } {
  const a = ICON_ATLASES[name]!;
  const cells = Array.isArray(a.cells) ? a.cells : plates(st, a.cells.plates[0], a.cells.plates[1]);
  const src = cells.map((_, i) => (a.same === "pairs" ? i - (i % 2) : a.same === "first" ? 0 : i));
  return { kind: a.kind, cells, src };
}

/** The stock pictograms of an icon atlas, measured for the icon size check. */
export function measureIcons(name: string, st: Pic): IconCell[] {
  const { kind, cells, src } = iconCells(name, st);
  return cells.map((rect, i) => {
    const m = silhouette(st, cells[src[i]!]!, kind);
    return { rect, extent: extent(m, rect[2] - rect[0]) ?? [0, 0, 0, 0], area: m.reduce((s, v) => s + v, 0) };
  });
}

/** A flat pictogram into the cell at (x0, y0). No outline: a third colour in a 4x4 block makes DXT1 shade the face. */
export function putIcon(img: Pic, [x0, y0, x1]: Rect, m: Mask, col: RGB): void {
  const w = x1 - x0;
  for (let i = 0; i < m.length; i++) if (m[i]) setRgb(img, x0 + (i % w), y0 + Math.floor(i / w), col);
}

/** The pictogram of a theme's cell: texels 20 levels off the face (the inside, against its outer ring of texels) or
 * off their own frame ring (the outer three rings), less rows and columns that run across the cell (frame rules). */
export function themeIcon(img: Pic, rect: Rect, ring = 3, thr = 20): Mask {
  const { L, w, h } = cellLum(img, rect);
  const m = new Uint8Array(w * h);
  const median = (idx: number[]) => percentile(idx.map((i) => L[i]!), 0.5);
  const ringOf = (k: number) => {
    const out: number[] = [];
    for (let y = k; y < h - k; y++) for (let x = k; x < w - k; x++) if (y === k || y === h - k - 1 || x === k || x === w - k - 1) out.push(y * w + x);
    return out;
  };
  for (let k = 0; k < ring; k++) {
    const r = ringOf(k);
    const med = median(r);
    for (const i of r) if (Math.abs(L[i]! - med) > thr) m[i] = 1;
  }
  const face = median(ringOf(ring));
  for (let y = ring; y < h - ring; y++) for (let x = ring; x < w - ring; x++) if (Math.abs(L[y * w + x]! - face) > thr) m[y * w + x] = 1;
  const rows = Array.from({ length: h }, (_, y) => m.subarray(y * w, y * w + w).reduce((s, v) => s + v, 0) > 0.8 * w);
  const cols = Array.from({ length: w }, (_, x) => {
    let s = 0;
    for (let y = 0; y < h; y++) s += m[y * w + x]!;
    return s > 0.8 * h;
  });
  return m.map((v, i) => (v && !rows[Math.floor(i / w)] && !cols[i % w] ? 1 : 0));
}

/** Inward slack (texels) and the share of the stock's texels a theme's pictogram must keep. */
export const ICON_SLACK = 2;
export const ICON_AREA = 0.85;

/** Why a theme's icon cell is smaller than the stock's, or null when it is not. */
export function iconShrink(img: Pic, c: IconCell): string | null {
  const w = c.rect[2] - c.rect[0];
  const m = themeIcon(img, c.rect);
  const e = extent(m, w);
  const area = m.reduce((s, v) => s + v, 0);
  if (!e) return `cell x${c.rect[0]}-${c.rect[2]} y${c.rect[1]}-${c.rect[3]}: no pictogram (the stock's reaches ${c.extent.join(",")})`;
  const s = c.extent;
  const inward = Math.max(e[0] - s[0], e[1] - s[1], s[2] - e[2], s[3] - e[3]);
  if (inward <= ICON_SLACK && area >= ICON_AREA * c.area) return null;
  return `cell x${c.rect[0]}-${c.rect[2]} y${c.rect[1]}-${c.rect[3]}: the pictogram reaches ${e.join(",")} with ${area} texels, the stock's ${s.join(",")} with ${c.area}`;
}
