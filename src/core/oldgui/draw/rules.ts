/**
 * Finding the stock art's rules and frames, and drawing them again as 1 px rules: bands of bright texels (bevels,
 * doubled lines) become one line each, joined at corners; the pressed frames' blue cloud is found as an area.
 */
import { type Mask, type Pic, type RGB, closing, erode, fillHoles, label, mask, opening, ring, runLength } from "./raster.js";
import type { OldGuiStyle, State } from "./style.js";

/** A horizontal segment (y, x0, x1) or a vertical one (x, y0, y1), end exclusive. */
export type Seg = [number, number, number];

export interface LineMask {
  m: Mask;
  /** Luminance over black (times alpha). */
  L: Float32Array;
  blue: Mask;
}

/** Rules in the stock picture: visible brightness over black clearly above the dark field, not blue cloud. */
export function lineMask(st: Pic, thr = 34): LineMask {
  const n = st.w * st.h;
  const m = mask(st.w, st.h);
  const L = new Float32Array(n);
  const blue = mask(st.w, st.h);
  for (let i = 0; i < n; i++) {
    const r = st.d[i * 4]!;
    const g = st.d[i * 4 + 1]!;
    const b = st.d[i * 4 + 2]!;
    const a = st.d[i * 4 + 3]! / 255;
    L[i] = (0.299 * r + 0.587 * g + 0.114 * b) * a;
    blue[i] = b > r + 18 && b > 45 ? 1 : 0;
    m[i] = L[i]! >= thr && !blue[i] ? 1 : 0;
  }
  return { m, L, blue };
}

/** Horizontal bands of runs at least minrun long, rows within `merge` joined when their runs overlap:
 * [top, bottom, x0, x1]. */
function bands(m: Mask, w: number, h: number, minrun: number, merge: number): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!m[y * w + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < w && m[y * w + e]) e++;
      if (e - x >= minrun) {
        const hit = out.find((bd) => y - bd[1]! <= merge && x < bd[3]! + 2 && e > bd[2]! - 2);
        if (hit) {
          hit[1] = y;
          hit[2] = Math.min(hit[2]!, x);
          hit[3] = Math.max(hit[3]!, e);
        } else out.push([y, y, x, e]);
      }
      x = e;
    }
  }
  return out;
}

export function transpose(m: Mask, w: number, h: number): Mask {
  const t = mask(h, w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[x * h + y] = m[y * w + x]!;
  return t;
}

/** One segment per band, on its centre line. */
export function segments(m: Mask, w: number, h: number, minrun = 8, merge = 3): { hs: Seg[]; vs: Seg[] } {
  const pick = (t: number, b: number) => Math.floor((t + b) / 2);
  const hs = bands(m, w, h, minrun, merge).map(([t, b, x0, x1]) => [pick(t!, b!), x0!, x1!] as Seg);
  const vs = bands(transpose(m, w, h), h, w, minrun, merge).map(([t, b, y0, y1]) => [pick(t!, b!), y0!, y1!] as Seg);
  return { hs, vs };
}

/** Segment ends extended to meet a crossing segment within `gap` px (closes the corners). */
export function closeSegments(hs: Seg[], vs: Seg[], gap = 5): { hs: Seg[]; vs: Seg[] } {
  const hs2 = hs.map(([y, a, b]) => {
    let x0 = a;
    let x1 = b;
    for (const [x, y0, y1] of vs) {
      if (y0 - gap <= y && y <= y1 + gap) {
        if (Math.abs(x - x0) <= gap || (x < x0 && x0 - x <= gap)) x0 = Math.min(x0, x);
        if (Math.abs(x - (x1 - 1)) <= gap) x1 = Math.max(x1, x + 1);
      }
    }
    return [y, x0, x1] as Seg;
  });
  const vs2 = vs.map(([x, a, b]) => {
    let y0 = a;
    let y1 = b;
    for (const [y, x0, x1] of hs) {
      if (x0 - gap <= x && x <= x1 + gap) {
        if (Math.abs(y - y0) <= gap) y0 = Math.min(y0, y);
        if (Math.abs(y - (y1 - 1)) <= gap) y1 = Math.max(y1, y + 1);
      }
    }
    return [x, y0, y1] as Seg;
  });
  return { hs: hs2, vs: vs2 };
}

/** A rule's end that runs up to `gap` px past the perpendicular rule it meets, cut (no ticks at corners). */
export function trimOvershoot(hs: Seg[], vs: Seg[], gap = 5): { hs: Seg[]; vs: Seg[] } {
  const hs2 = hs.map(([y, a, b]) => {
    const xs = vs.filter(([, y0, y1]) => y0 - 1 <= y && y <= y1).map(([x]) => x);
    const left = xs.filter((x) => a <= x && x <= a + gap);
    const right = xs.filter((x) => b - 1 - gap <= x && x <= b - 1);
    return [y, left.length ? Math.min(...left) : a, right.length ? Math.max(...right) + 1 : b] as Seg;
  });
  const vs2 = vs.map(([x, a, b]) => {
    const ys = hs.filter(([, x0, x1]) => x0 - 1 <= x && x <= x1).map(([y]) => y);
    const top = ys.filter((y) => a <= y && y <= a + gap);
    const bot = ys.filter((y) => b - 1 - gap <= y && y <= b - 1);
    return [x, top.length ? Math.min(...top) : a, bot.length ? Math.max(...bot) + 1 : b] as Seg;
  });
  return { hs: hs2, vs: vs2 };
}

/** The pressed frames' blue cloud as a solid area (its dark and grey texels too). */
export function cloudArea(blue: Mask, w: number, h: number): Mask {
  if (!blue.some((v) => v)) return blue;
  const c = fillHoles(closing(blue, w, h, 5, 2), w, h);
  return opening(c, w, h, 5);
}

export function drawSegs(w: number, h: number, hs: Seg[], vs: Seg[]): Mask {
  const out = mask(w, h);
  for (const [y, x0, x1] of hs) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) if (y >= 0 && y < h) out[y * w + x] = 1;
  for (const [x, y0, y1] of vs) for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) if (x >= 0 && x < w) out[y * w + x] = 1;
  return out;
}

/** The stock's rules as straight 1 px segments joined at corners, the thick bright blocks, and the blue cloud. */
export function ruleMask(st: Pic, thr = 20, minrun: number | null = null, merge = 5): { rule: Mask; thick: Mask; cloud: Mask } {
  const { w, h } = st;
  const { m, blue } = lineMask(st, thr);
  for (let i = 0; i < w * h; i++) if (Math.min(st.d[i * 4]!, st.d[i * 4 + 1]!, st.d[i * 4 + 2]!) > 170) m[i] = 0;
  const cloud = cloudArea(blue, w, h);
  const core = erode(cloud, w, h, 3, 2);
  for (let i = 0; i < w * h; i++) if (core[i]) m[i] = 0;
  const thick = opening(m, w, h, 7);
  const rules = m.map((v, i) => (v && !thick[i] ? 1 : 0));
  const run = minrun ?? Math.max(8, Math.floor(Math.min(w, h) / 20));
  let s = segments(rules, w, h, run, merge);
  s = closeSegments(s.hs, s.vs);
  s = trimOvershoot(s.hs, s.vs);
  return { rule: drawSegs(w, h, s.hs, s.vs), thick, cloud };
}

/** Rule bands along one axis (1: rows, 0: columns) -> [pos, start, stop]: each band of up to `maxw` lines becomes one
 * 1 px rule on its brightest line, over the band's length; a wider band keeps each of its brightest lines. */
function bandsOf(m: Mask, L: Float32Array, w: number, h: number, axis: 0 | 1, minrun: number, maxw = 5): Seg[] {
  const run = runLength(m, w, h, axis);
  const long = m.map((v, i) => (v && run[i]! >= minrun ? 1 : 0));
  const { lab, n } = label(long, w, h);
  const out: Seg[] = [];
  // per region: its lines (across) and texels along
  const regions = new Map<number, Map<number, number[]>>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = lab[y * w + x]!;
      if (!id) continue;
      const [across, along] = axis === 1 ? [y, x] : [x, y];
      let r = regions.get(id);
      if (!r) regions.set(id, (r = new Map()));
      let l = r.get(across);
      if (!l) r.set(across, (l = []));
      l.push(along);
    }
  }
  for (let id = 1; id <= n; id++) {
    const r = regions.get(id);
    if (!r) continue;
    const lines = [...r.keys()].sort((a, b) => a - b);
    const sumL = (across: number) => (r.get(across) ?? []).reduce((s, along) => s + L[axis === 1 ? across * w + along : along * w + across]!, 0);
    if (lines.length <= maxw) {
      let best = lines[0]!;
      for (const ln of lines) if (sumL(ln) > sumL(best)) best = ln;
      const on = new Set(r.get(best)!);
      // a 1-texel hole in the line is closed when both its neighbours along the line are in the band's line
      const lo = Math.min(...on);
      const hi = Math.max(...on);
      const line: boolean[] = [];
      for (let a = lo; a <= hi; a++) line.push(on.has(a) || (on.has(a - 1) && on.has(a + 1)));
      let a = 0;
      while (a < line.length) {
        if (!line[a]) {
          a++;
          continue;
        }
        let b = a;
        while (b < line.length && line[b]) b++;
        if (b - a >= 3) out.push([best, lo + a, lo + b]);
        a = b;
      }
    } else {
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i]!;
        const cols = r.get(ln)!;
        const s = sumL(ln);
        const before = r.has(ln - 1) ? sumL(ln - 1) : -1;
        const after = r.has(ln + 1) ? sumL(ln + 1) : -1;
        if (cols.length >= minrun && s >= before && s >= after) out.push([ln, Math.min(...cols), Math.max(...cols) + 1]);
      }
    }
  }
  return out;
}

/** The stock's rules as 1 px lines where the stock draws them, joined at corners; and its thick bright blocks.
 * Atlas strips cut from different places of a texture still meet, as their stock rules do. */
export function ruleCores(st: Pic, thr = 24, minrun = 9): { core: Mask; thick: Mask } {
  const { w, h } = st;
  const { m, L, blue } = lineMask(st, thr);
  // pure white blocks lie outside every UV
  for (let i = 0; i < w * h; i++) if (blue[i] || Math.min(st.d[i * 4]!, st.d[i * 4 + 1]!, st.d[i * 4 + 2]!) > 250) m[i] = 0;
  const thick = opening(m, w, h, 7);
  for (let i = 0; i < w * h; i++) if (thick[i]) m[i] = 0;
  let s = { hs: bandsOf(m, L, w, h, 1, minrun), vs: bandsOf(m, L, w, h, 0, minrun) };
  s = closeSegments(s.hs, s.vs, 3);
  s = trimOvershoot(s.hs, s.vs, 3);
  return { core: drawSegs(w, h, s.hs, s.vs), thick };
}

/** A frame into [x0, x1) x [y0, y1): the outer edge, the rule, the hover glow inside it, a flat face. */
export function drawRectFrame(img: Pic, x0: number, y0: number, x1: number, y1: number, state: State, s: OldGuiStyle, outer = true): void {
  const { face, line, glow } = s.states[state];
  const h = y1 - y0;
  const w = x1 - x0;
  if (h <= 0 || w <= 0) return;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setFace(img, x, y, face);
  let k = 0;
  if (outer && h > 4 && w > 4) {
    ring(img, x0, y0, x1, y1, s.out);
    k = 1;
  }
  if (h > 2 * k + 1 && w > 2 * k + 1) ring(img, x0 + k, y0 + k, x1 - k, y1 - k, line);
  if (glow && h > 2 * k + 4 && w > 2 * k + 4) ring(img, x0 + k + 1, y0 + k + 1, x1 - k - 1, y1 - k - 1, glow);
}

function setFace(img: Pic, x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const o = (y * img.w + x) * 4;
  img.d[o] = c[0]!;
  img.d[o + 1] = c[1]!;
  img.d[o + 2] = c[2]!;
}
