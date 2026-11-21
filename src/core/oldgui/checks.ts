/**
 * The checks an original-GUI theme must pass, run on the inventory (inventory.ts) and the theme's files, without
 * the game. Each comes from a fault seen in game:
 *
 *   categories   a texture nobody has looked at (a hak's, a newer client's) has no role
 *   coverage     a drawn chrome texture left stock, or only recoloured: a recolour keeps the stock bevels, gradients
 *                and parchment, so the window still looks stock in the new colours
 *   state icons  an atlas kept whole as icons, that a control reads a different cell of per state, held that
 *                control's frames (a checkbox drew its box and mark from a tab-icon atlas, and stayed stock)
 *   fill bars    a bar the client fills was redrawn as a panel, and showed nothing while it filled
 *   flatness     a face with a gradient, noise or a pale fill; a stretched cell that changes along its stretch
 *                (filtering spreads any change over the whole stretch: fades at row ends, soft bands)
 *   fonts        the old GUI's three font files replaced only in part
 */
import type { RGBAImage } from "../res/image.js";
import { type Cell, cellRefs, claimed, edgeOnly, halfCover, isStretched, spans, stateControls } from "./cells.js";
import type { CellsFile, InventoryRow } from "./inventory.js";
import { FILL_BARS, type FillBar, ICONS, OLD_GUI_FONTS, PICTURES, STATE_ICONS } from "./roles.js";

export type CheckName = "categories" | "coverage" | "state icons" | "fill bars" | "flatness" | "fonts";

export interface Finding {
  check: CheckName;
  texture: string;
  message: string;
  /** true: a failure; false: a note (skipped on purpose, with the reason). */
  fail: boolean;
}

/** How a theme file was made, from the export's manifest: "redrawn", "recoloured", or "" when unknown. */
export type Made = "redrawn" | "recoloured" | "";

export interface ThemeFile {
  name: string;
  ext: string;
  made: Made;
}

// ------------------------------------------------------------------------------------------------- categories

export function checkCategories(rows: readonly InventoryRow[]): Finding[] {
  return rows
    .filter((r) => r.drawn && (!r.treatment || r.group === "uncategorised"))
    .map((r) => ({
      check: "categories" as const,
      texture: r.resref,
      message: `drawn (${where(r)}) but has no role: look at it and add it to your old-gui-roles.json, then run the inventory again`,
      fail: true,
    }));
}

function where(r: InventoryRow): string {
  const out: string[] = [];
  if (r.models.length) out.push(`models ${r.models.slice(0, 3).join(" ")}`);
  if (r.layouts.length) out.push(`layouts ${r.layouts.slice(0, 2).join(" ")}`);
  if (r.client) out.push("the client's code");
  if (r.txiFrom.length) out.push(`the txi of ${r.txiFrom.slice(0, 2).join(" ")}`);
  return out.join("; ") || "unknown";
}

// --------------------------------------------------------------------------------------------------- coverage

/** Every drawn chrome texture is in the theme, and redrawn (not recoloured). Flat chrome may stay stock. */
export function checkCoverage(rows: readonly InventoryRow[], theme: ReadonlyMap<string, ThemeFile>): Finding[] {
  const out: Finding[] = [];
  for (const r of rows) {
    if (!r.drawn || r.treatment !== "redraw") continue;
    const f = theme.get(r.resref);
    if (!f) out.push({ check: "coverage", texture: r.resref, message: `chrome (${r.role}) with no file in the theme: it stays stock`, fail: true });
    else if (f.made === "recoloured") {
      out.push({ check: "coverage", texture: r.resref, message: `chrome (${r.role}) only recoloured: it keeps the stock bevels, gradients and texture; redraw it`, fail: true });
    }
  }
  const known = new Set(rows.map((r) => r.resref));
  for (const f of theme.values()) {
    if (!known.has(f.name) && /^(ctl_|pnl_|gui_|ct_btn|edit_box|inv_|pb_|qb_|pre_load|dth_|cg_main)/.test(f.name)) {
      out.push({ check: "coverage", texture: f.name, message: "in the theme under a GUI name, but the inventory has no such texture (a typo, or a texture of another client?)", fail: true });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ state icons

/** A kept icon or held texture that a control reads in a different cell per state must be one known to hold only
 * icons (STATE_ICONS, or the user's roles file's stateIcon). */
export function checkStateIcons(rows: readonly InventoryRow[], cells: CellsFile): Finding[] {
  const out: Finding[] = [];
  for (const r of rows) {
    if (!r.drawn || (r.treatment !== "icon" && r.treatment !== "hold")) continue;
    const t = cells.textures[r.resref];
    const ctl = t ? stateControls(t.cells) : new Map();
    if (!ctl.size) continue;
    if (STATE_ICONS[r.resref] || r.stateIcon) continue;
    out.push({
      check: "state icons",
      texture: r.resref,
      message: `kept as ${r.treatment}, but ${[...ctl.keys()].slice(0, 3).join(", ")} read a different cell of it per state (a control's frames?): redraw its frames, or say in old-gui-roles.json (stateIcon) what it holds`,
      fail: true,
    });
  }
  return out;
}

// -------------------------------------------------------------------------------------------------- fill bars

/** Every bar the client fills (a progress-bar role, or a cell a model draws with its "percentage" animation) has
 * previews at three levels or more, from empty to full. */
export function checkFillBars(rows: readonly InventoryRow[], cells: CellsFile, bars: readonly FillBar[] = FILL_BARS): Finding[] {
  const listed = new Map<string, Set<string>>();
  for (const b of bars) {
    let s = listed.get(b.texture);
    if (!s) listed.set(b.texture, (s = new Set()));
    s.add(b.model);
  }
  const drawn = new Set(rows.filter((r) => r.drawn).map((r) => r.resref));
  const need = new Map<string, Set<string>>();
  for (const r of rows) if (r.drawn && (r.kind === "bar" || r.role.startsWith("progress bar"))) need.set(r.resref, need.get(r.resref) ?? new Set());
  for (const [tex, t] of Object.entries(cells.textures)) {
    if (!drawn.has(tex)) continue;
    for (const c of t.cells) {
      for (const ref of cellRefs(c)) {
        const [model, , anim] = ref.split("/");
        if (anim === "percentage" && model) {
          let s = need.get(tex);
          if (!s) need.set(tex, (s = new Set()));
          s.add(model);
        }
      }
    }
  }
  const out: Finding[] = [];
  for (const [tex, models] of [...need].sort(([a], [b]) => a.localeCompare(b))) {
    const have = listed.get(tex);
    if (!have) {
      out.push({ check: "fill bars", texture: tex, message: "a bar the client fills, with no fill-level previews (FILL_BARS in src/core/oldgui/roles.ts)", fail: true });
      continue;
    }
    for (const m of [...models].sort()) {
      if (!have.has(m)) out.push({ check: "fill bars", texture: tex, message: `${m} fills it (percentage animation) but has no fill-level previews`, fail: true });
    }
  }
  for (const b of bars) {
    const lv = [...b.levels].sort((x, y) => x - y);
    if (lv.length < 3 || lv[0] !== 0 || lv[lv.length - 1] !== 1) {
      out.push({ check: "fill bars", texture: b.texture, message: `${b.model}: needs at least three levels, from 0 to 1`, fail: true });
    }
  }
  return out;
}

// --------------------------------------------------------------------------------------------------- flatness

/** Neighbouring texels closer than this (max channel, alpha-weighted) belong to the same region. */
export const STEP = 12;
/** A face's colour may spread this much (DXT rounding is 0-4). */
export const SPREAD = 10;
/** Luminance above which a face is pale (for a dark skin; a light skin's limit is its own fill's plus PALE_OVER). */
export const PALE = 80;
export const PALE_OVER = 24;
/** The second world colour a translucent texel is seen over. */
const BG = 80;
/** A stretched cell's texels may differ this much along the stretch. */
export const SAME = 10;

type Rect = [number, number, number, number];

const DXT_CORNERS = "16 px button: DXT1 stores each 4x4 corner block (edge, rule and face together) a few levels off the face; a compression error at the corners, not shading";

/** Not faults, with the reason: [rect, or null for the whole texture, reason]. */
export const FLAT_EXCEPTIONS: Record<string, [Rect | null, string][]> = {
  gui_boxes_ingame: [
    [[68, 0, 80, 16], "the health bar's disease and poison tints: signal colours, kept"],
    [
      [224, 0, 228, 17],
      "the list rows' strip (spell tree, spell boxes, journal, Player List, store rows) keeps its rule on its last row, one rule under each row; the loot window's right box (pnl_container) stretches the strip down its height and shows that rule as a short band at its bottom",
    ],
  ],
  gui_boxes_chrgen: [[[29, 0, 33, 17], "ctl_btn_srv_110's checked state samples across two cells (the stock's UVs): its top rule fades at its right end"]],
  gui_boxes_chrsht: [[[20, 0, 24, 17], "pnl_chrsht_famlr's pieces read these texels stretched across and down at once (the stock's UVs); no layout and no client name draws it"]],
  gui_chr_arrowbtn: [
    [[2, 2, 14, 14], DXT_CORNERS],
    [[18, 2, 30, 14], DXT_CORNERS],
  ],
  // three columns of 16 px buttons, one row per state (up, down, disabled, hover)
  gui_map_pieces: [0, 16, 32, 48].flatMap((y) => [0, 16, 32].map((x) => [[x + 2, y + 2, x + 14, y + 14], DXT_CORNERS] as [Rect, string])),
  gui_gring01: [[null, "the ring under the 3D pointer, mapped onto a polygon, not a stretched GUI cell"]],
  gui_textbubble: [[null, "the speech bubble's corner: a quarter disc its models stretch into the bubble's rounded ends; a curve cannot be one colour along the stretch"]],
  gui_lightning: [[null, "the full-screen lightning flash (pnl_lightning): a light overlay on purpose"]],
};

export interface FlatOptions {
  /** Light faces allowed besides the fills (the skin's pressed, accent, glow and mark colours), as RGB. */
  allowed?: readonly (readonly number[])[];
  /** The skin's panel fill: a light skin's faces are pale by design, so the limit rises above it. */
  ink?: readonly number[];
}

/** The light colours a theme fills faces with on purpose, from its palette: the pressed and selected fills, the
 * accent and the darker brass a thumb, knob or progress fill uses, the hover glow, the marks and a disabled mark's
 * grey. */
export function lightFills(p: { ink: readonly number[]; accent: readonly number[]; activeLo: readonly number[]; active: readonly number[]; glow: readonly number[]; glowHi: readonly number[]; mark: readonly number[] }): number[][] {
  const mix = (a: readonly number[], b: readonly number[], t: number) => [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t));
  const grey = (c: readonly number[]) => {
    const l = Math.round(lum(c));
    return [l, l, l];
  };
  return [p.activeLo, p.active, p.accent, mix(p.accent, p.ink, 0.15), p.glow, p.glowHi, p.mark, grey(mix(p.mark, p.ink, 0.5))].map((c) => [...c]);
}

const lum = (c: readonly number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;


/** The faults of one chrome texture (display order, row 0 at the top), given its cells. */
export function checkFlat(name: string, img: RGBAImage, cells: readonly Cell[], skip: readonly Rect[], o: FlatOptions = {}, soft?: Set<string>): Finding[] {
  const { width: w, height: h, data } = img;
  // as it shows over a black and over a mid-grey world: colour and opacity changes alike
  const pm = new Float64Array(w * h * 6);
  const alive = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3]! / 255;
    for (let k = 0; k < 3; k++) {
      const c = data[i * 4 + k]!;
      pm[i * 6 + k] = c * a;
      pm[i * 6 + 3 + k] = c * a + BG * (1 - a);
    }
    alive[i] = data[i * 4 + 3]! > 0 ? 1 : 0;
  }
  for (const r of skip) for (let y = Math.max(0, r[1]); y < Math.min(h, r[3]); y++) for (let x = Math.max(0, r[0]); x < Math.min(w, r[2]); x++) alive[y * w + x] = 0;
  const out: Finding[] = [];
  const whereBox = (b: Rect) => {
    const hit = cells.filter((c) => c[0] < b[2] && c[2] > b[0] && c[1] < b[3] && c[3] > b[1]);
    return [...new Set(hit.flatMap(cellRefs))].sort().slice(0, 4);
  };
  const fmt = (b: Rect) => `x${b[0]}-${b[2]} y${b[1]}-${b[3]}`;
  const hx = (c: readonly number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

  // faces: 4-connected regions of near-equal texels
  const pr = new Int16Array(pm.length);
  for (let i = 0; i < pm.length; i++) pr[i] = Math.round(pm[i]!);
  const lab = new Int32Array(w * h).fill(-1);
  let n = 0;
  const queue = new Int32Array(w * h);
  const near = (p: number, q: number) => {
    const a = p * 6;
    const b = q * 6;
    for (let k = 0; k < 6; k++) {
      const d = pr[a + k]! - pr[b + k]!;
      if (d > STEP || d < -STEP) return false;
    }
    return true;
  };
  for (let s = 0; s < w * h; s++) {
    if (!alive[s] || lab[s]! >= 0) continue;
    lab[s] = n;
    let qh = 0;
    let qt = 0;
    queue[qt++] = s;
    while (qh < qt) {
      const p = queue[qh++]!;
      const x = p % w;
      if (p >= w) {
        const q = p - w;
        if (alive[q] && lab[q]! < 0 && near(p, q)) {
          lab[q] = n;
          queue[qt++] = q;
        }
      }
      if (p + w < w * h) {
        const q = p + w;
        if (alive[q] && lab[q]! < 0 && near(p, q)) {
          lab[q] = n;
          queue[qt++] = q;
        }
      }
      if (x > 0) {
        const q = p - 1;
        if (alive[q] && lab[q]! < 0 && near(p, q)) {
          lab[q] = n;
          queue[qt++] = q;
        }
      }
      if (x < w - 1) {
        const q = p + 1;
        if (alive[q] && lab[q]! < 0 && near(p, q)) {
          lab[q] = n;
          queue[qt++] = q;
        }
      }
    }
    n++;
  }
  // per region: its size, bounds, and its thick core's colours (texels whose whole 3x3 neighbourhood is in it)
  const size = new Int32Array(n);
  const bx0 = new Int32Array(n).fill(w);
  const by0 = new Int32Array(n).fill(h);
  const bx1 = new Int32Array(n);
  const by1 = new Int32Array(n);
  const coreCount = new Int32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = lab[y * w + x]!;
      if (id < 0) continue;
      size[id] = size[id]! + 1;
      if (x < bx0[id]!) bx0[id] = x;
      if (y < by0[id]!) by0[id] = y;
      if (x + 1 > bx1[id]!) bx1[id] = x + 1;
      if (y + 1 > by1[id]!) by1[id] = y + 1;
    }
  }
  const isCore = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const id = lab[p]!;
      if (id < 0 || size[id]! < 9) continue;
      let all = true;
      for (let dy = -w; dy <= w && all; dy += w) for (let dx = -1; dx <= 1; dx++) if (lab[p + dy + dx] !== id) all = false;
      if (all) {
        isCore[p] = 1;
        coreCount[id] = coreCount[id]! + 1;
      }
    }
  }
  // the 2nd and 98th percentile and the mean of each channel, by histogram over the rounded values (0-255)
  const faces = [...Array(n).keys()].filter((id) => coreCount[id]! > 0);
  const slot = new Int32Array(n).fill(-1);
  faces.forEach((id, i) => (slot[id] = i));
  const hist = new Int32Array(faces.length * 6 * 256);
  const sums = new Float64Array(faces.length * 3);
  for (let p = 0; p < w * h; p++) {
    if (!isCore[p]) continue;
    const i = slot[lab[p]!]!;
    for (let k = 0; k < 6; k++) {
      const at = (i * 6 + k) * 256 + Math.max(0, Math.min(255, pr[p * 6 + k]!));
      hist[at] = hist[at]! + 1;
    }
    for (let k = 0; k < 3; k++) sums[i * 3 + k] = sums[i * 3 + k]! + pm[p * 6 + 3 + k]!;
  }
  const pct = (i: number, k: number, q: number) => {
    // numpy's linear interpolation between closest ranks, on the histogram
    const total = coreCount[faces[i]!]!;
    const rank = (total - 1) * q;
    const at = (r: number) => {
      let acc = 0;
      for (let v = 0; v < 256; v++) {
        acc += hist[(i * 6 + k) * 256 + v]!;
        if (acc > r) return v;
      }
      return 255;
    };
    const f = Math.floor(rank);
    const a = at(f);
    const b = at(Math.min(total - 1, f + 1));
    return a + (b - a) * (rank - f);
  };
  const allowed = o.allowed ?? [];
  const paleLimit = Math.max(PALE, o.ink ? lum(o.ink) + PALE_OVER : 0);
  for (let i = 0; i < faces.length; i++) {
    const id = faces[i]!;
    const box: Rect = [bx0[id]!, by0[id]!, bx1[id]!, by1[id]!];
    let spread = 0;
    const lo: number[] = [];
    const hi: number[] = [];
    for (let k = 0; k < 6; k++) {
      lo.push(pct(i, k, 0.02));
      hi.push(pct(i, k, 0.98));
      spread = Math.max(spread, hi[k]! - lo[k]!);
    }
    const mean = [0, 1, 2].map((k) => sums[i * 3 + k]! / coreCount[id]!);
    if (spread > SPREAD) {
      out.push({ check: "flatness", texture: name, message: `${fmt(box)}: gradient or noise: a face's colour spreads ${Math.round(spread)} levels (${hx(lo.slice(3))} to ${hx(hi.slice(3))}) [${whereBox(box).join("; ")}]`, fail: true });
    }
    if (lum(mean) > paleLimit && !allowed.some((c) => Math.max(...[0, 1, 2].map((k) => Math.abs(mean[k]! - c[k]!))) <= 14)) {
      out.push({ check: "flatness", texture: name, message: `${fmt(box)}: a pale face ${hx(mean)} [${whereBox(box).join("; ")}]`, fail: true });
    }
  }

  // stretched cells: flat along the stretch (a frame's 1:1 rule a cell reaches only at its very end stays)
  const mine = claimed(cells, w, h);
  const inRect = (b: Rect, r: Rect) => b[0] >= r[0] && b[1] >= r[1] && b[2] <= r[2] && b[3] <= r[3];
  const range = (pts: [number, number][]) => {
    if (!pts.length) return 0;
    let worst = 0;
    for (let k = 0; k < 6; k++) {
      let a = Infinity;
      let b = -Infinity;
      for (const [x, y] of pts) {
        const v = pm[(y * w + x) * 6 + k]!;
        a = Math.min(a, v);
        b = Math.max(b, v);
      }
      worst = Math.max(worst, b - a);
    }
    return worst;
  };
  for (const c of cells) {
    const [x0, y0, x1, y1, sx, sy] = c;
    const box: Rect = [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
    if (skip.some((r) => inRect(box, r))) continue;
    const [tx, ty] = spans(c, w, h);
    for (const [axis, s] of [
      [1, sx],
      [0, sy],
    ] as const) {
      if (!isStretched(s)) continue;
      const edge = edgeOnly(c, w, h, axis);
      const bad: number[] = [];
      const lines = axis === 1 ? halfCover(y0, y1, h) : halfCover(x0, x1, w);
      for (const line of lines) {
        const every: [number, number][] = axis === 1 ? tx.map((x) => [x, line]) : ty.map((y) => [line, y]);
        const pts = every.filter(([x, y]) => !(edge.has(axis === 1 ? x : y) && mine[axis][y * w + x]));
        if (range(pts) > SAME) bad.push(line);
        else if (range(every) > SAME) soft?.add(`${name}/${line}/${axis}`);
      }
      if (bad.length) {
        const how = s === 0 ? "at run time" : `${Math.round(s)} px per texel`;
        const along = axis === 1 ? "across" : "down";
        const what = `${axis === 1 ? "rows" : "columns"} ${bad.slice(0, 8).join(",")}${bad.length > 8 ? "..." : ""}`;
        out.push({ check: "flatness", texture: name, message: `${fmt(box)}: stretched fade: stretched ${along} ${how}, ${what} change along it [${cellRefs(c).join("; ")}]`, fail: true });
      }
    }
  }
  return out;
}

/** The rectangles the flatness check skips in a texture, and why (pictures, icons, exceptions). */
export function flatSkips(name: string): { rects: Rect[]; whole: string | null; notes: string[] } {
  const rects: Rect[] = [];
  const notes: string[] = [];
  let whole: string | null = null;
  const pic = PICTURES[name];
  if (pic) {
    rects.push(pic);
    notes.push(`x${pic[0]}-${pic[2]} y${pic[1]}-${pic[3]}: a picture inside the frame`);
  }
  for (const r of ICONS[name] ?? []) {
    rects.push(r);
    notes.push(`x${r[0]}-${r[2]} y${r[1]}-${r[3]}: an icon beside the frames`);
  }
  for (const [r, why] of FLAT_EXCEPTIONS[name] ?? []) {
    if (r === null) whole = why;
    else {
      rects.push(r);
      notes.push(`x${r[0]}-${r[2]} y${r[1]}-${r[3]}: ${why}`);
    }
  }
  return { rects, whole, notes };
}

// ------------------------------------------------------------------------------------------------------ fonts

/** The three font names the client draws the old GUI with: replaced together or not at all. */
export function checkFonts(fonts: ReadonlyMap<string, Uint8Array>): Finding[] {
  const names = Object.keys(OLD_GUI_FONTS);
  const present = names.filter((n) => fonts.has(n));
  if (!present.length) return [];
  const out: Finding[] = [];
  for (const n of names) {
    if (!fonts.has(n)) out.push({ check: "fonts", texture: n, message: `the theme replaces ${present.join(", ")} but not ${n}: the old GUI would mix two fonts`, fail: true });
  }
  return out;
}
