/**
 * Frame continuity of a theme, screen by screen: the stock and the theme drawn without text, and their rules (thin
 * lines clearly brighter than the fill around them) compared:
 *
 *   missing  stock rule pixels with no theme rule within GONE px: a frame line that vanished
 *   stray    theme rule pixels with no stock rule within GONE px: a line the stock does not draw (the hover glow
 *            excepted)
 *   ends     a theme line that stops where the stock's goes on (a break, or a step to another row), and a line that
 *            jogs one pixel to the side where the stock's runs straight
 *   spurs    theme stubs of 1-4 px standing off a line where the stock draws no line across (a separator's end cut
 *            into a frame's edge piece, seen as a dot or tick on the frame)
 *
 * Runs shorter than MINRUN pixels are ignored. Pictures, icons and text that are the same in both are not chrome and
 * are left out (only where the two renders differ counts).
 */
import { type Mask, dilate, label, mask } from "../draw/raster.js";
import type { Canvas } from "./render.js";

export const TOL = 3;
export const GONE = 6;
export const MINRUN = 12;

export interface FrameFindings {
  /** Boxes [x0, y0, x1, y1, pixels] of missing and stray rules. */
  missing: number[][];
  stray: number[][];
  /** Points [x, y] of bad ends and jogs, and of spurs. */
  ends: [number, number][];
  spurs: [number, number][];
  /** The overlay: the theme dimmed, stock rules blue, theme rules brass, missing red, stray green (RGBA, w x h). */
  overlay?: Uint8ClampedArray;
}

const lumOf = (cv: Canvas) => {
  const L = new Float32Array(cv.w * cv.h);
  for (let i = 0; i < L.length; i++) L[i] = cv.d[i * 4]! * 0.299 + cv.d[i * 4 + 1]! * 0.587 + cv.d[i * 4 + 2]! * 0.114;
  return L;
};

/** A median over a size x size window (edges reflected), on values rounded to 0-255. */
function median(L: Float32Array, w: number, h: number, size = 9): Float32Array {
  const r = size >> 1;
  const out = new Float32Array(w * h);
  const q = new Uint8Array(w * h);
  for (let i = 0; i < q.length; i++) q[i] = Math.max(0, Math.min(255, Math.round(L[i]!)));
  const refl = (i: number, n: number) => (i < 0 ? -i - 1 : i >= n ? 2 * n - i - 1 : i);
  const half = Math.floor((size * size) / 2);
  for (let y = 0; y < h; y++) {
    const hist = new Int32Array(256);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) hist[q[refl(y + dy, h) * w + refl(dx, w)]!]!++;
    for (let x = 0; x < w; x++) {
      if (x > 0) {
        for (let dy = -r; dy <= r; dy++) {
          const yy = refl(y + dy, h) * w;
          hist[q[yy + refl(x - r - 1, w)]!]!--;
          hist[q[yy + refl(x + r, w)]!]!++;
        }
      }
      let acc = 0;
      let v = 0;
      for (; v < 256; v++) {
        acc += hist[v]!;
        if (acc > half) break;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Erosion or dilation by a rectangle [x0, x1] x [y0, y1] of offsets (even sizes as scipy places them). */
function morph(m: Mask, w: number, h: number, x0: number, x1: number, y0: number, y1: number, erode: boolean): Mask {
  const out = mask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = erode ? 1 : 0;
      for (let dy = y0; dy <= y1 && v === (erode ? 1 : 0); dy++) {
        for (let dx = x0; dx <= x1; dx++) {
          const yy = erode ? y + dy : y - dy;
          const xx = erode ? x + dx : x - dx;
          const on = yy >= 0 && yy < h && xx >= 0 && xx < w && m[yy * w + xx] === 1;
          if (erode && !on) {
            v = 0;
            break;
          }
          if (!erode && on) {
            v = 1;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Thin lines brighter than their surroundings. faint: the stock's faint grey separators too. */
export function rules(cv: Canvas, faint = false): Mask {
  const { w, h } = cv;
  const L = lumOf(cv);
  const bg = median(L, w, h, 9);
  const r = mask(w, h);
  for (let i = 0; i < w * h; i++) r[i] = (L[i]! >= 50 && L[i]! >= bg[i]! + 28) || (faint && L[i]! >= 30 && L[i]! >= bg[i]! + 12) ? 1 : 0;
  // blocks (4 x 4 or more) are not lines
  const blob = morph(morph(r, w, h, -2, 1, -2, 1, true), w, h, -2, 1, -2, 1, false);
  const near = dilate(blob, w, h, 3);
  return r.map((v, i) => (v && !near[i] ? 1 : 0));
}

/** Zhang-Suen thinning to 1 px lines. */
export function skeleton(m: Mask, w: number, h: number): Mask {
  const s = m.slice();
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? s[y * w + x]! : 0);
  let live: number[] = [];
  for (let i = 0; i < w * h; i++) if (s[i]) live.push(i);
  let changed = true;
  const p = [0, 0, 0, 0, 0, 0, 0, 0];
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const del: number[] = [];
      for (const i of live) {
        if (!s[i]) continue;
        const x = i % w;
        const y = (i - x) / w;
        p[0] = at(x, y - 1);
        p[1] = at(x + 1, y - 1);
        p[2] = at(x + 1, y);
        p[3] = at(x + 1, y + 1);
        p[4] = at(x, y + 1);
        p[5] = at(x - 1, y + 1);
        p[6] = at(x - 1, y);
        p[7] = at(x - 1, y - 1);
        const b = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + p[7];
        if (b < 2 || b > 6) continue;
        let a = 0;
        for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
        if (a !== 1) continue;
        const [p2, , p4, , p6, , p8] = p;
        if (step === 0 ? p2! * p4! * p6! === 0 && p4! * p6! * p8! === 0 : p2! * p4! * p8! === 0 && p2! * p6! * p8! === 0) del.push(i);
      }
      for (const i of del) s[i] = 0;
      if (del.length) changed = true;
    }
    live = live.filter((i) => s[i]);
  }
  return s;
}

/** Squared-distance transform (Felzenszwalb): each pixel's distance to the nearest set pixel of m. */
export function distance(m: Mask, w: number, h: number): Float32Array {
  const INF = 1e12;
  const f = new Float64Array(Math.max(w, h));
  const d1 = (n: number, get: (i: number) => number, set: (i: number, v: number) => void) => {
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    let k = 0;
    for (let i = 0; i < n; i++) f[i] = get(i);
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k--;
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1]! < q) k++;
      set(q, (q - v[k]!) ** 2 + f[v[k]!]!);
    }
  };
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = m[i] ? 0 : INF;
  for (let x = 0; x < w; x++) d1(h, (i) => g[i * w + x]!, (i, v) => (g[i * w + x] = v));
  for (let y = 0; y < h; y++) d1(w, (i) => g[y * w + i]!, (i, v) => (g[y * w + i] = v));
  return Float32Array.from(g, (v) => Math.sqrt(v));
}

/** Length of the straight run (along axis: 1 rows, 0 columns) each pixel sits in. */
function runlen(m: Mask, w: number, h: number, axis: 0 | 1): Int32Array {
  const out = new Int32Array(w * h);
  if (axis === 1) {
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if (!m[y * w + x]) {
          x++;
          continue;
        }
        let e = x;
        while (e < w && m[y * w + e]) e++;
        for (let k = x; k < e; k++) out[y * w + k] = e - x;
        x = e;
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        if (!m[y * w + x]) {
          y++;
          continue;
        }
        let e = y;
        while (e < h && m[e * w + x]) e++;
        for (let k = y; k < e; k++) out[k * w + x] = e - y;
        y = e;
      }
    }
  }
  return out;
}

/** m shifted by k along axis (1 x, 0 y), wrapping as numpy's roll. */
function roll(m: Mask, w: number, h: number, k: number, axis: 0 | 1): Mask {
  const out = mask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = axis === 1 ? (((x - k) % w) + w) % w : x;
      const sy = axis === 0 ? (((y - k) % h) + h) % h : y;
      out[y * w + x] = m[sy * w + sx]!;
    }
  }
  return out;
}

/** Stubs of theme rule, 1-4 px long, standing off a straight theme line where the stock draws no line across. */
function spurs(ri: Mask, rs: Mask, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (const axis of [1, 0] as const) {
    const across = axis === 1 ? 0 : 1;
    const rl = runlen(ri, w, h, axis);
    const line = ri.map((v, i) => (v && rl[i]! >= 8 ? 1 : 0));
    const rest = ri.map((v, i) => (v && !line[i] ? 1 : 0));
    const rr = runlen(rest, w, h, across);
    const stub = rest.map((v, i) => (v && rr[i]! <= 4 ? 1 : 0));
    const along = (1 - across) as 0 | 1;
    const s0 = roll(rest, w, h, -1, along);
    const s1 = roll(rest, w, h, 1, along);
    const l0 = roll(line, w, h, 1, across);
    const l1 = roll(line, w, h, -1, across);
    const rsl = runlen(rs, w, h, across);
    const stockAcross = dilate(rs.map((v, i) => (v && rsl[i]! >= 3 ? 1 : 0)), w, h, 3);
    const bad = stub.map((v, i) => (v && !s0[i] && !s1[i] && (l0[i] || l1[i]) && !stockAcross[i] ? 1 : 0));
    const { lab, n } = label(dilate(bad, w, h, 3), w, h, true);
    const bx = Array.from({ length: n + 1 }, () => [Infinity, Infinity, -Infinity, -Infinity]);
    for (let i = 0; i < w * h; i++) {
      const id = lab[i]!;
      if (!id) continue;
      const x = i % w;
      const y = (i - x) / w;
      const b = bx[id]!;
      b[0] = Math.min(b[0]!, x);
      b[1] = Math.min(b[1]!, y);
      b[2] = Math.max(b[2]!, x + 1);
      b[3] = Math.max(b[3]!, y + 1);
    }
    for (let id = 1; id <= n; id++) out.push([Math.floor((bx[id]![0]! + bx[id]![2]!) / 2), Math.floor((bx[id]![1]! + bx[id]![3]!) / 2)]);
  }
  return out;
}

/** Steps: a theme line that goes on one pixel to the side where the stock's line runs straight through. */
function jogs(ri: Mask, rs: Mask, W: number, H: number): [number, number][] {
  const out: [number, number][] = [];
  for (const axis of [1, 0] as const) {
    // work on rows: transpose for columns
    const [w, h] = axis === 1 ? [W, H] : [H, W];
    const T = (m: Mask) => {
      if (axis === 1) return m;
      const t = mask(w, h);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) t[x * w + y] = m[y * W + x]!;
      return t;
    };
    const m = T(ri);
    const sm = T(rs);
    const rl = runlen(m, w, h, 1);
    const long = m.map((v, i) => (v && rl[i]! >= 6 ? 1 : 0));
    const sl = runlen(sm, w, h, 1);
    const at = (a: Mask, x: number, y: number) => (y >= 0 && y < h && x >= 0 && x < w ? a[y * w + x]! : 0);
    const straight = (x: number, yy: number) => {
      if (yy < 0 || yy >= h) return false;
      let mn = Infinity;
      for (let xx = Math.max(0, x - 6); xx < Math.min(w, x + 8); xx++) mn = Math.min(mn, sl[yy * w + xx]!);
      return mn >= 14;
    };
    const push = (x: number, y: number) => out.push(axis === 1 ? [x, y] : [y, x]);
    for (const dy of [-1, 1]) {
      for (let y = 0; y < h; y++) {
        if ((dy === -1 && y === h - 1) || (dy === 1 && y === 0)) continue;
        const yr = (((y - dy) % h) + h) % h;
        for (let x = 0; x < w - 1; x++) {
          // a run ends here and the row above / below takes over
          if (at(long, x, y) && !at(m, x + 1, y) && at(long, x + 1, yr) && !at(m, x, yr)) {
            if (straight(x, y) || straight(x, y - dy)) push(x, y);
          }
          // a run starts here where the row above / below stops
          if (at(long, x + 1, y) && !at(m, x, y) && at(long, x, yr) && !at(m, x + 1, yr)) {
            if (straight(x, y) || straight(x, y - dy)) push(x + 1, y);
          }
        }
      }
    }
  }
  return out;
}

function runs(m: Mask, w: number, h: number): number[][] {
  const { lab, n } = label(m, w, h, true);
  const b = Array.from({ length: n + 1 }, () => [Infinity, Infinity, -Infinity, -Infinity, 0]);
  for (let i = 0; i < w * h; i++) {
    const id = lab[i]!;
    if (!id) continue;
    const x = i % w;
    const y = (i - x) / w;
    const r = b[id]!;
    r[0] = Math.min(r[0]!, x);
    r[1] = Math.min(r[1]!, y);
    r[2] = Math.max(r[2]!, x + 1);
    r[3] = Math.max(r[3]!, y + 1);
    r[4]!++;
  }
  return b.slice(1).filter((r) => r[4]! >= MINRUN);
}

/** Compares the stock and theme renders of one screen (same size, no text). glow: the theme's hover rule colour. */
export function checkFrames(st: Canvas, th: Canvas, glow: readonly number[], overlay = false): FrameFindings {
  const { w, h } = st;
  let rs = rules(st);
  let ri = rules(th);
  const rsFaint = rules(st, true);
  // only where the two differ: art kept as it is (pictures, icons) is not chrome
  const diff0 = mask(w, h);
  for (let i = 0; i < w * h; i++) {
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(Math.round(st.d[i * 4 + k]!) - Math.round(th.d[i * 4 + k]!)));
    diff0[i] = d > 12 ? 1 : 0;
  }
  const diff = dilate(diff0, w, h, 2 * TOL + 3);
  rs = rs.map((v, i) => v & diff[i]!);
  ri = ri.map((v, i) => v & diff[i]!);
  // the hover glow rule inside a hovered button is the NUI's own, not a stray line
  const g0 = mask(w, h);
  for (let i = 0; i < w * h; i++) g0[i] = Math.max(...[0, 1, 2].map((k) => Math.abs(th.d[i * 4 + k]! - glow[k]!))) < 40 ? 1 : 0;
  const glowM = dilate(g0, w, h, 3);
  const ds = distance(rs, w, h);
  const dsf = distance(rsFaint, w, h);
  const di = distance(ri, w, h);
  const missing = rs.map((v, i) => (v && di[i]! > GONE ? 1 : 0));
  const stray = ri.map((v, i) => (v && dsf[i]! > GONE && !glowM[i] ? 1 : 0));
  // a theme line that stops where the stock line goes on: from each end, 3-7 px further along its direction the stock
  // has a rule all the way and the theme none
  const sk = skeleton(ri, w, h);
  const { lab } = label(sk, w, h, true);
  const ends: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!sk[y * w + x]) continue;
      let nb = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && y + dy >= 0 && y + dy < h && x + dx >= 0 && x + dx < w && sk[(y + dy) * w + x + dx]) nb++;
      if (nb !== 1) continue;
      const id = lab[y * w + x];
      let sy = 0;
      let sx = 0;
      let n = 0;
      for (let yy = Math.max(0, y - 5); yy < Math.min(h, y + 6); yy++) {
        for (let xx = Math.max(0, x - 5); xx < Math.min(w, x + 6); xx++) {
          if (lab[yy * w + xx] === id) {
            sy += yy;
            sx += xx;
            n++;
          }
        }
      }
      if (n < 3) continue;
      let ddy = y - sy / n;
      let ddx = x - sx / n;
      const len = Math.hypot(ddy, ddx);
      if (len < 0.5) continue;
      ddy /= len;
      ddx /= len;
      const pts: [number, number][] = [3, 4, 5, 6, 7].map((k) => [Math.round(y + ddy * k), Math.round(x + ddx * k)]);
      if (pts.some(([q, p]) => q < 0 || q >= h || p < 0 || p >= w)) continue;
      if (pts.every(([q, p]) => ds[q * w + p]! <= 1.5) && pts.every(([q, p]) => di[q * w + p]! > 1.5)) ends.push([x, y]);
    }
  }
  ends.push(...jogs(ri, rs, w, h));
  // stubs the stock has too (within TOL px) are part of art kept as it is
  const sp0 = spurs(rs, rs, w, h);
  const sp = spurs(ri, rs, w, h).filter(([x, y]) => sp0.every(([a, b]) => Math.abs(x - a) > TOL || Math.abs(y - b) > TOL));
  const out: FrameFindings = { missing: runs(missing, w, h), stray: runs(stray, w, h), ends, spurs: sp };
  if (overlay) {
    const o = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      let c = [th.d[i * 4]! * 0.35, th.d[i * 4 + 1]! * 0.35, th.d[i * 4 + 2]! * 0.35];
      if (rs[i]) c = [60, 110, 230];
      if (ri[i]) c = [200, 160, 90];
      if (missing[i]) c = [255, 40, 40];
      if (stray[i]) c = [40, 230, 60];
      o.set([c[0]!, c[1]!, c[2]!, 255], i * 4);
    }
    const box = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
      for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) if (x >= 0 && x < w && y >= 0 && y < h) o.set(c, (y * w + x) * 4);
      for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) if (x >= 0 && x < w && y >= 0 && y < h) o.set(c, (y * w + x) * 4);
    };
    for (const [x, y] of ends) box(x - 4, y - 4, x + 4, y + 4, [255, 255, 255, 255]);
    for (const [x, y] of sp) box(x - 5, y - 5, x + 5, y + 5, [255, 0, 255, 255]);
    for (const r of [...out.missing, ...out.stray]) box(r[0]! - 3, r[1]! - 3, r[2]! + 2, r[3]! + 2, [255, 80, 80, 255]);
    out.overlay = o;
  }
  return out;
}
