/**
 * The old GUI's chrome drawn again in the skin's style, at the stock size and with its alpha layout, from the models'
 * own UV rectangles and animations (which part of an atlas is the normal, pressed, hover or disabled frame):
 *
 * - button atlases: each frame a button in its state (outer edge, one rule, flat face; hover adds the glow rule;
 *   pressed the pressed fill), with the sub-cell rules of a normal frame of the same size;
 * - panels: the window fill, each stock rule one 1 px rule on the brightest line of its bevel, where the stock draws
 *   it, so strips cut from different places of a texture still meet;
 * - colour-cell strips: every grey ramp a flat level (fill or rule), signal colours kept, list rows flat;
 * - shapes: the cut-out filled flat with a rule along its edge.
 *
 * Then every cell a model stretches is made one colour along the stretch (flattenStretched): filtering spreads any
 * change along a stretched axis over the whole stretch.
 */
import { type Cell, MISALIGNED, claimed, edgeOnly, halfCover, isStretched, spans } from "../cells.js";
import type { UvEntry } from "../cells.js";
import { type Mask, type Pic, boxes, dilate, erode, label, lumOf, mask, pic } from "./raster.js";
import { type Seg, drawRectFrame, ruleCores, ruleMask, segments } from "./rules.js";
import type { OldGuiStyle, State } from "./style.js";

type Rect = [number, number, number, number];

export function stateOf(anims: ReadonlySet<string>): State {
  const has = (...xs: string[]) => xs.some((x) => anims.has(x));
  if (has("down", "checkedup", "checkeddown")) return "pressed";
  if (has("hilite", "checkedhilite")) return "hilite";
  if (anims.size && [...anims].every((a) => a === "disabled")) return "disabled";
  return "normal";
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const rectKey = (r: readonly number[]) => r.map(r3).join(",");

/** UV rect to texels (display order), rounded; null when it tiles or is a sliver. */
function pxRect(e: UvEntry, w: number, h: number, uLo = -0.02, uHi = 1.02): Rect | null {
  const [u0, v0, u1, v1] = e.rect;
  if (u1 - u0 > 1.01 || v1 - v0 > 1.01 || u0 < uLo || u1 > uHi) return null;
  let x0 = Math.round(u0 * w);
  let x1 = Math.round(u1 * w);
  let y0 = Math.round((1 - v1) * h);
  let y1 = Math.round((1 - v0) * h);
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(w, x1);
  y1 = Math.min(h, y1);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return [x0, y0, x1, y1];
}

/** [(rect, state)] from animated nodes only: a node whose UVs change between animations shows its state's rect. */
export function nodeStates(uv: readonly UvEntry[], w: number, h: number): [Rect, State][] {
  const per = new Map<string, UvEntry[]>();
  for (const e of uv) per.set(`${e.model}/${e.node}`, [...(per.get(`${e.model}/${e.node}`) ?? []), e]);
  const out = new Map<string, { r: Rect; anims: Set<string> }>();
  for (const es of per.values()) {
    if (new Set(es.map((e) => rectKey(e.rect))).size < 2) continue;
    for (const e of es) {
      const [u0, v0, u1, v1] = e.rect.map(r3) as Rect;
      if (u1 - u0 > 1.01 || v1 - v0 > 1.01) continue;
      const r: Rect = [Math.round(u0 * w), Math.round((1 - v1) * h), Math.round(u1 * w), Math.round((1 - v0) * h)];
      const k = r.join(",");
      let o = out.get(k);
      if (!o) out.set(k, (o = { r, anims: new Set() }));
      o.anims.add(e.anim);
    }
  }
  return [...out.values()].map(({ r, anims }) => {
    const a = new Set([...anims].filter((x) => x !== ""));
    return [r, a.size ? stateOf(a) : "normal"];
  });
}

/** Whole button frames: per model and animation, the slices its nodes sample joined where they touch -> rect to
 * state. Only nodes whose UVs change between animations vote for a state. */
export function frameRects(uv: readonly UvEntry[], w: number, h: number): Map<string, { r: Rect; st: State }> {
  const per = new Map<string, UvEntry[]>();
  for (const e of uv) per.set(`${e.model}/${e.node}`, [...(per.get(`${e.model}/${e.node}`) ?? []), e]);
  const animated = new Set([...per].filter(([, es]) => new Set(es.map((e) => rectKey(e.rect))).size > 1).map(([k]) => k));
  const groups = new Map<string, { r: Rect; anim: boolean }[]>();
  for (const [k, es] of per) {
    for (const e of es) {
      const r = pxRect(e, w, h);
      if (!r) continue;
      const g = `${e.model}\u0000${e.anim}`;
      groups.set(g, [...(groups.get(g) ?? []), { r, anim: animated.has(k) }]);
    }
  }
  const votes = new Map<string, { r: Rect; anims: Set<string> }>();
  for (const [g, rs] of groups) {
    const anim = g.split("\u0000")[1]!;
    const bx = rs.map(({ r, anim: a }) => [...r, a ? 1 : 0]);
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < bx.length; i++) {
        for (let j = i + 1; j < bx.length; j++) {
          const a = bx[i]!;
          const b = bx[j]!;
          const side = Math.abs(a[1]! - b[1]!) <= 1 && Math.abs(a[3]! - b[3]!) <= 1 && (Math.abs(a[2]! - b[0]!) <= 1 || Math.abs(b[2]! - a[0]!) <= 1);
          const stack = Math.abs(a[0]! - b[0]!) <= 1 && Math.abs(a[2]! - b[2]!) <= 1 && (Math.abs(a[3]! - b[1]!) <= 1 || Math.abs(b[3]! - a[1]!) <= 1);
          if (side || stack) {
            bx[i] = [Math.min(a[0]!, b[0]!), Math.min(a[1]!, b[1]!), Math.max(a[2]!, b[2]!), Math.max(a[3]!, b[3]!), a[4]! || b[4]! ? 1 : 0];
            bx.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
    for (const b of bx) {
      const r = b.slice(0, 4) as Rect;
      const k = r.join(",");
      let v = votes.get(k);
      if (!v) votes.set(k, (v = { r, anims: new Set() }));
      if (b[4] && anim) v.anims.add(anim);
    }
  }
  return new Map([...votes].map(([k, v]) => [k, { r: v.r, st: v.anims.size ? stateOf(v.anims) : "normal" }]));
}

const area = (r: Rect) => (r[2] - r[0]) * (r[3] - r[1]);
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
const inside = (a: Rect, b: Rect) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

/** Sub-cell rules that reach the frame, or a rule that does (stray texels inside a face are dropped). */
function connectedRules(hs: Seg[], vs: Seg[], w: number, h: number, k: number, tol = 4): { hs: Seg[]; vs: Seg[] } {
  const near = (a: number, edge: number) => Math.abs(a - edge) <= k + tol;
  const kh = new Set<number>();
  const kv = new Set<number>();
  hs.forEach(([, a, b], i) => (near(a, 0) || near(b, w)) && kh.add(i));
  vs.forEach(([, a, b], i) => (near(a, 0) || near(b, h)) && kv.add(i));
  let changed = true;
  while (changed) {
    changed = false;
    hs.forEach(([y, a, b], i) => {
      if (kh.has(i)) return;
      if ([...kv].some((j) => a - tol <= vs[j]![0] && vs[j]![0] <= b + tol && vs[j]![1] - tol <= y && y <= vs[j]![2] + tol)) {
        kh.add(i);
        changed = true;
      }
    });
    vs.forEach(([x, a, b], i) => {
      if (kv.has(i)) return;
      if ([...kh].some((j) => a - tol <= hs[j]![0] && hs[j]![0] <= b + tol && hs[j]![1] - tol <= x && x <= hs[j]![2] + tol)) {
        kv.add(i);
        changed = true;
      }
    });
  }
  return { hs: hs.filter((_, i) => kh.has(i)), vs: vs.filter((_, i) => kv.has(i)) };
}

const meanIn = (m: Mask, w: number, r: Rect): number => {
  let s = 0;
  for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) s += m[y * w + x]!;
  return area(r) > 0 ? s / area(r) : 0;
};

/** Opaque where the stock is drawn at all, transparent where it is not. */
function cutAlpha(img: Pic, st: Pic): void {
  for (let i = 0; i < img.w * img.h; i++) img.d[i * 4 + 3] = st.d[i * 4 + 3] === 0 ? 0 : 255;
}

/** Button atlases: every frame a model reads, drawn as a button in its state. */
export function redrawAtlas(st: Pic, uv: readonly UvEntry[], s: OldGuiStyle, alpha: (a: number) => number): Pic {
  const { w, h } = st;
  let frames = [...frameRects(uv, w, h).values()];
  if (!frames.length) return redrawRegions(st, uv, s, alpha, "out");
  const img = pic(w, h, s.out);
  const { rule, thick, cloud } = ruleMask(st, 20, null, 2);
  const near = dilate(rule.map((v, i) => v | thick[i]!), w, h, 5);
  const borderScore = (r: Rect) => {
    let n = 0;
    let on = 0;
    const add = (x: number, y: number) => {
      n++;
      on += near[y * w + x]!;
    };
    for (let x = r[0]; x < r[2]; x++) {
      add(x, r[1]);
      add(x, r[3] - 1);
    }
    for (let y = r[1]; y < r[3]; y++) {
      add(r[0], y);
      add(r[2] - 1, y);
    }
    return n ? on / n : 0;
  };
  const score = new Map(frames.map((f) => [f.r.join(","), borderScore(f.r)]));
  const sc = (r: Rect) => score.get(r.join(","))!;
  const keep = frames.filter((f) => {
    const rival = frames.filter((g) => g !== f && overlap(f.r, g.r) > 0.2 * Math.min(area(f.r), area(g.r)) && !inside(g.r, f.r) && !inside(f.r, g.r));
    // where two controls read the same texels as different frames, keep the one the stock art outlines
    if (rival.some((g) => sc(g.r) > sc(f.r) + 0.1)) return false;
    // a slice from the middle of a bigger frame (a 3-slice button's stretched centre): no frame of its own
    const within = frames.filter((g) => g !== f && inside(f.r, g.r));
    return !(within.length && sc(f.r) < 0.5);
  });
  frames = keep.length ? keep : frames;
  // a frame holding a near-copy of itself (two models reading one frame 1-3 px apart): the inner one is drawn
  frames = frames.filter((f) => !frames.some((g) => g !== f && g.st === f.st && inside(g.r, f.r) && area(g.r) >= 0.8 * area(f.r)));
  // a disabled frame that is nearly another state's: the stock has no disabled art there, the other state wins
  frames = frames.filter((f) => !(f.st === "disabled" && frames.some((g) => g !== f && g.st !== "disabled" && overlap(f.r, g.r) >= 0.8 * area(f.r))));
  // sub-cell rules come from a normal frame of the same size (the pressed frame's cloud fakes rules)
  const patterns = new Map<string, { inner: Mask; k: number; fw: number; fh: number }>();
  for (const { r, st: state } of frames) {
    if (state !== "normal" || meanIn(cloud, w, r) > 0.2) continue;
    const fw = r[2] - r[0];
    const fh = r[3] - r[1];
    const k = Math.min(fw, fh) > 16 ? 5 : 3;
    const inner = mask(fw, fh);
    for (let y = k; y < fh - k; y++) for (let x = k; x < fw - k; x++) inner[y * fw + x] = rule[(r[1] + y) * w + r[0] + x]!;
    const key = `${fw}x${fh}`;
    if (!patterns.has(key)) patterns.set(key, { inner, k, fw, fh });
  }
  for (const f of [...frames].sort((a, b) => area(b.r) - area(a.r))) {
    const [x0, y0, x1, y1] = f.r;
    let state = f.st;
    const cm = meanIn(cloud, w, f.r);
    if (cm > 0.35) state = "pressed";
    else if (state === "pressed") state = "normal"; // the stock marks its pressed frames with the blue cloud
    drawRectFrame(img, x0, y0, x1, y1, state, s);
    const fw = x1 - x0;
    const fh = y1 - y0;
    const p = patterns.get(`${fw}x${fh}`);
    const inner = p?.inner ?? mask(fw, fh);
    const k = p?.k ?? 5;
    let seg = segments(inner, fw, fh, 8, 2);
    seg = connectedRules(seg.hs, seg.vs, fw, fh, k);
    const lc = s.states[state].line;
    for (const [y, a, b] of seg.hs) {
      const xa = a - k <= 3 ? x0 + 1 : x0 + a;
      const xb = fw - b - k <= 3 ? x1 - 1 : x0 + b;
      for (let x = xa; x < xb; x++) setC(img, x, y0 + y, lc);
    }
    for (const [x, a, b] of seg.vs) {
      const ya = a - k <= 3 ? y0 + 1 : y0 + a;
      const yb = fh - b - k <= 3 ? y1 - 1 : y0 + b;
      for (let y = ya; y < yb; y++) setC(img, x0 + x, y, lc);
    }
  }
  cutAlpha(img, st);
  return img;
}

function setC(img: Pic, x: number, y: number, c: readonly number[]): void {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const o = (y * img.w + x) * 4;
  img.d[o] = c[0]!;
  img.d[o + 1] = c[1]!;
  img.d[o + 2] = c[2]!;
}

/** Stock rules as 1 px rules; every face they enclose flat in its state's colour; the field around the frames the
 * outer edge colour (atlases) or the window fill (panels). */
export function redrawRegions(st: Pic, uv: readonly UvEntry[], s: OldGuiStyle, alpha: (a: number) => number, background: "out" | "panel", protect?: Rect): Pic {
  const { w, h } = st;
  const { rule, cloud } = ruleMask(st, 20);
  const { lab, n } = label(rule.map((v) => (v ? 0 : 1)), w, h);
  const img = pic(w, h, background === "out" ? s.out : s.panel);
  const states = nodeStates(uv, w, h);
  const border = new Set<number>();
  for (let x = 0; x < w; x++) border.add(lab[x]!).add(lab[(h - 1) * w + x]!);
  for (let y = 0; y < h; y++) border.add(lab[y * w]!).add(lab[y * w + w - 1]!);
  const bb = boxes(lab, n, w, h);
  const lineCol: (readonly number[])[] = Array.from({ length: w * h }, () => s.line);
  const glowMask = mask(w, h);
  const cloudSum = new Float64Array(n + 1);
  const size = new Int32Array(n + 1);
  for (let i = 0; i < w * h; i++) {
    size[lab[i]!]!++;
    cloudSum[lab[i]!]! += cloud[i]!;
  }
  for (let id = 1; id <= n; id++) {
    const b = bb[id];
    if (!b || border.has(id)) continue;
    if (size[id]! < 2) {
      for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) if (lab[y * w + x] === id) setC(img, x, y, s.line);
      continue;
    }
    const cy = (b[1] + b[3]) / 2;
    const cx = (b[0] + b[2]) / 2;
    let state: State = background === "out" ? "normal" : "panel";
    let best: [number, State] | null = null;
    for (const [[x0, y0, x1, y1], ss] of states) {
      if (x0 <= cx && cx < x1 && y0 <= cy && cy < y1) {
        const a = (x1 - x0) * (y1 - y0);
        if (!best || a < best[0]) best = [a, ss];
      }
    }
    if (best && background === "out") state = best[1];
    if (cloudSum[id]! / size[id]! > 0.35) state = "pressed";
    const { face, line, glow } = s.states[state];
    const reg = mask(w, h);
    for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) if (lab[y * w + x] === id) reg[y * w + x] = 1;
    for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) if (reg[y * w + x]) setC(img, x, y, face);
    if (state !== "panel") {
      // the rules around this face take the state's rule colour
      for (let y = Math.max(0, b[1] - 1); y < Math.min(h, b[3] + 1); y++) {
        for (let x = Math.max(0, b[0] - 1); x < Math.min(w, b[2] + 1); x++) {
          if (!rule[y * w + x]) continue;
          let hit = false;
          for (let dy = -1; dy <= 1 && !hit; dy++) {
            for (let dx = -1; dx <= 1 && !hit; dx++) {
              const yy = y + dy;
              const xx = x + dx;
              if (yy >= 0 && yy < h && xx >= 0 && xx < w && reg[yy * w + xx]) hit = true;
            }
          }
          if (hit) lineCol[y * w + x] = line;
        }
      }
      if (glow) {
        const er = erode(reg, w, h, 3);
        for (let i = 0; i < w * h; i++) if (reg[i] && !er[i]) glowMask[i] = 1;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (rule[i]) setC(img, i % w, Math.floor(i / w), lineCol[i]!);
    if (glowMask[i]) setC(img, i % w, Math.floor(i / w), s.glow);
  }
  for (let i = 0; i < w * h; i++) {
    const sa = st.d[i * 4 + 3]!;
    img.d[i * 4 + 3] = background === "out" ? (sa === 0 ? 0 : 255) : rule[i] && sa > 0 ? 255 : sa === 0 ? 0 : alpha(sa);
  }
  if (protect) copyRect(img, st, protect);
  return img;
}

export function copyRect(img: Pic, src: Pic, r: Rect): void {
  for (let y = Math.max(0, r[1]); y < Math.min(img.h, r[3]); y++) {
    for (let x = Math.max(0, r[0]); x < Math.min(img.w, r[2]); x++) {
      const o = (y * img.w + x) * 4;
      for (let k = 0; k < 4; k++) img.d[o + k] = src.d[o + k]!;
    }
  }
}

/** Panel and frame art: the window fill, each stock rule one 1 px rule where the stock draws it. */
export function redrawTrace(st: Pic, s: OldGuiStyle, alpha: (a: number) => number, protect?: Rect): Pic {
  const { w, h } = st;
  const { core } = ruleCores(st);
  const img = pic(w, h, s.panel);
  for (let i = 0; i < w * h; i++) {
    const sa = st.d[i * 4 + 3]!;
    if (core[i]) setC(img, i % w, Math.floor(i / w), s.line);
    img.d[i * 4 + 3] = core[i] && sa > 0 ? 255 : sa === 0 ? 0 : alpha(sa);
  }
  if (protect) copyRect(img, st, protect);
  return img;
}

/** Alpha cut-outs: the shape filled flat, a rule along its edge. */
export function redrawShape(st: Pic, s: OldGuiStyle, state: State = "normal"): Pic {
  const { w, h } = st;
  const ins = mask(w, h);
  for (let i = 0; i < w * h; i++) ins[i] = st.d[i * 4 + 3]! > 40 ? 1 : 0;
  const er = erode(ins, w, h, 3);
  const { face, line } = s.states[state];
  const img = pic(w, h, face);
  for (let i = 0; i < w * h; i++) {
    if (ins[i] && !er[i]) setC(img, i % w, Math.floor(i / w), line);
    const a = st.d[i * 4 + 3]!;
    // the anti-aliased rim's faintest texels dropped, so DXT5 keeps every transparent texel transparent
    img.d[i * 4 + 3] = a < 24 ? 0 : ins[i] ? 255 : a;
  }
  return img;
}

// --- colour-cell strips ---------------------------------------------------------------------------------------------

/** List rows in a strip: [first column, state] of each 4-texel group a row stretches across. */
export const LIST_ROW_CELLS: Record<string, [number, "normal" | "hilite" | "pressed"][]> = {
  gui_boxes_ingame: [
    [156, "normal"],
    [160, "hilite"],
    [164, "hilite"],
    [168, "pressed"],
    [172, "pressed"],
    // the journal quest rows' "encouraged" (new) state
    [208, "hilite"],
    [212, "hilite"],
  ],
};

/** Translucent black cells laid over an icon to dim it (disabled icon buttons, spell level buttons): kept at the
 * stock's density. */
export const STOCK_ALPHA: Record<string, [number, number][]> = { gui_boxes_ingame: [[233, 235]] };

/** The list rows' shared strip carries its rule on its last row: the rows read it unfiltered from half a texel inside
 * row 0 to half a texel past row 15, so a rule on row 0 showed at both ends of every row. */
export const ROW_RULE_LAST: Record<string, [number, number][]> = { gui_boxes_ingame: [[224, 228]] };
/** Hover cells made clear like another column (one hover look across a row, no face). */
export const CLEAR_AS: Record<string, [[number, number], number][]> = { gui_boxes_ingame: [[[216, 220], 245]] };

const keyOf = (d: Float32Array, o: number) => `${Math.round(d[o]!)},${Math.round(d[o + 1]!)},${Math.round(d[o + 2]!)},${Math.round(d[o + 3]!)}`;

/** The commonest RGBA among the given texel offsets (ties: the smallest, as numpy's unique and argmax). */
function commonest(d: Float32Array, offs: number[]): number[] | null {
  const c = new Map<string, number>();
  for (const o of offs) c.set(keyOf(d, o), (c.get(keyOf(d, o)) ?? 0) + 1);
  let best: string | null = null;
  let bn = -1;
  const cmp = (a: string, b: string) => {
    const x = a.split(",").map(Number);
    const y = b.split(",").map(Number);
    for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return 0;
  };
  for (const [k, n] of c) if (n > bn || (n === bn && best !== null && cmp(k, best) < 0)) [best, bn] = [k, n];
  return best ? best.split(",").map(Number) : null;
}

/** A dark brown or gold (hue 15-55 degrees, no channel above 160): a thumb, not a bright signal outline. */
function isGold(r: number, g: number, b: number): boolean {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn || mx !== r || mx > 160) return false;
  const h = (60 * (g - b)) / (mx - mn);
  return h >= 15 && h <= 55;
}

/** Colour-cell strips: every neutral texel to a flat level (fill or rule) by how it shows, signal colours kept, the
 * cells a model stretches over a panel made one colour along the stretch, list rows flat. */
export function redrawSwatch(name: string, st: Pic, uv: readonly UvEntry[], s: OldGuiStyle, alpha: (a: number) => number): Pic {
  const { w, h } = st;
  const img = pic(w, h, s.panel);
  const L = lumOf(st);
  const Lp = (x: number, y: number) => {
    const xx = ((x % w) + w) % w;
    const yy = ((y % h) + h) % h;
    return L[yy * w + xx]! * (st.d[(yy * w + xx) * 4 + 3]! > 0 ? 1 : 0);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const a = st.d[o + 3]!;
      const opaque = a >= 200;
      const l = L[i]!;
      if (opaque && l >= 60) setC(img, x, y, s.line);
      if (!opaque && l >= 200) setC(img, x, y, s.line);
      // a single grey row or column brighter than both its neighbours across it: a separator rule
      const peakH = l >= Lp(x, y - 1) + 30 && l >= Lp(x, y + 1) + 30;
      const peakV = l >= Lp(x - 1, y) + 30 && l >= Lp(x + 1, y) + 30;
      if (!opaque && l >= 60 && l < 200 && a >= 60 && (peakH || peakV)) setC(img, x, y, s.tline);
      const sat = Math.max(st.d[o]!, st.d[o + 1]!, st.d[o + 2]!) - Math.min(st.d[o]!, st.d[o + 1]!, st.d[o + 2]!);
      // signal colours kept (health tints, the quick bar's outlines); a brown or gold cell (a thumb) is the brass
      if (sat > 70) setC(img, x, y, isGold(st.d[o]!, st.d[o + 1]!, st.d[o + 2]!) ? s.brass : [st.d[o]!, st.d[o + 1]!, st.d[o + 2]!]);
      img.d[o + 3] = alpha(a);
    }
  }
  // cells a model stretches over a whole panel (more than 4x): one flat colour per line, else filtering turns their
  // edge texels into a wide glow
  for (const e of uv) {
    const [u0, v0, u1, v1] = e.rect;
    if (u1 - u0 > 1.01 || v1 - v0 > 1.01) continue;
    const x0 = Math.max(0, Math.floor(u0 * w + 1e-6));
    const x1 = Math.min(w, Math.ceil(u1 * w - 1e-6));
    const y0 = Math.max(0, Math.floor((1 - v1) * h + 1e-6));
    const y1 = Math.min(h, Math.ceil((1 - v0) * h - 1e-6));
    if (x1 <= x0 || y1 <= y0) continue;
    const sx = (e.size[0] * 100) / Math.max(1, x1 - x0);
    const sy = (e.size[1] * 100) / Math.max(1, y1 - y0);
    const cw = x1 - x0;
    const ch = y1 - y0;
    let hollow = ch > 2 && cw > 2;
    for (let y = y0 + 1; y < y1 - 1 && hollow; y++) for (let x = x0 + 1; x < x1 - 1 && hollow; x++) if (img.d[(y * w + x) * 4 + 3] !== 0) hollow = false;
    if (hollow) continue; // an outline cell (item footprints): its edge texels are the outline
    if (sx > 4 && cw >= 3 && cw <= 8) {
      for (let y = y0; y < y1; y++) {
        const offs: number[] = [];
        for (let x = x0 + 1; x < x1 - 1; x++) offs.push((y * w + x) * 4);
        const c = commonest(img.d, offs);
        if (c) for (let x = x0; x < x1; x++) if (img.d[(y * w + x) * 4 + 3]! > 0) for (let k = 0; k < 4; k++) img.d[(y * w + x) * 4 + k] = c[k]!;
      }
    }
    if (sy > 4 && ch >= 3 && ch <= 8) {
      for (let x = x0; x < x1; x++) {
        const offs: number[] = [];
        for (let y = y0 + 1; y < y1 - 1; y++) offs.push((y * w + x) * 4);
        const c = commonest(img.d, offs);
        if (c) for (let y = y0; y < y1; y++) if (img.d[(y * w + x) * 4 + 3]! > 0) for (let k = 0; k < 4; k++) img.d[(y * w + x) * 4 + k] = c[k]!;
      }
    }
  }
  // pure black opaque cells stay pure black (the loading screen's backdrop)
  for (let i = 0; i < w * h; i++) {
    if (st.d[i * 4 + 3] === 255 && Math.max(st.d[i * 4]!, st.d[i * 4 + 1]!, st.d[i * 4 + 2]!) === 0) {
      setC(img, i % w, Math.floor(i / w), [0, 0, 0]);
      img.d[i * 4 + 3] = 255;
    }
  }
  for (const [x0, state] of LIST_ROW_CELLS[name] ?? []) {
    const face = state === "pressed" ? s.press : s.btn;
    for (let y = 0; y < h; y++) {
      for (let x = x0; x < x0 + 4; x++) {
        setC(img, x, y, y === 1 ? s.line : state === "hilite" && y === 2 ? s.glow : face);
        img.d[(y * w + x) * 4 + 3] = 255;
      }
    }
  }
  for (const [x0, x1] of STOCK_ALPHA[name] ?? []) {
    for (let y = 0; y < h; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * w + x) * 4;
        const r = (1 * w + x) * 4;
        for (let k = 0; k < 3; k++) img.d[o + k] = img.d[r + k]!;
        img.d[o + 3] = st.d[r + 3]!;
      }
    }
  }
  return img;
}

/** ROW_RULE_LAST and CLEAR_AS, after the flattening. */
export function rowsAfterFlatten(name: string, img: Pic): void {
  const { w, h } = img;
  for (const [x0, x1] of ROW_RULE_LAST[name] ?? []) {
    for (let x = x0; x < x1; x++) {
      const top = img.d.slice(x * 4, x * 4 + 4);
      for (let k = 0; k < 4; k++) {
        img.d[x * 4 + k] = img.d[(w + x) * 4 + k]!;
        img.d[((h - 1) * w + x) * 4 + k] = top[k]!;
      }
    }
  }
  for (const [[x0, x1], src] of CLEAR_AS[name] ?? []) {
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) for (let k = 0; k < 4; k++) img.d[(y * w + x) * 4 + k] = img.d[(y * w + src) * 4 + k]!;
  }
}

// --- stretched cells ------------------------------------------------------------------------------------------------

/** Every cell a model draws stretched gets one colour along the stretch on each line it reads (the commonest of the
 * texels it covers); texels inside `protect` (a picture) are left alone. Signal colours never win a line. */
export function flattenStretched(img: Pic, allCells: readonly Cell[], s: OldGuiStyle, protect?: Rect, rounds = 3): void {
  const { w, h, d } = img;
  const keep = mask(w, h);
  if (protect) for (let y = Math.max(0, protect[1]); y < Math.min(h, protect[3]); y++) for (let x = Math.max(0, protect[0]); x < Math.min(w, protect[2]); x++) keep[y * w + x] = 1;
  const named = new Set([s.line, s.glow, s.mark, s.press, s.tline].map((c) => c.join(",")));
  const signal = mask(w, h);
  for (let i = 0; i < w * h; i++) {
    const r = Math.round(d[i * 4]!);
    const g = Math.round(d[i * 4 + 1]!);
    const b = Math.round(d[i * 4 + 2]!);
    signal[i] = Math.max(r, g, b) - Math.min(r, g, b) > 70 && d[i * 4 + 3]! > 0 && !named.has(`${r},${g},${b}`) ? 1 : 0;
  }
  const cells = allCells.filter((c) => !(c.slice(6) as string[]).some((ref) => MISALIGNED.has(ref)));
  const mine = claimed(cells, w, h);
  const edge = cells.map((c) => ({ 1: edgeOnly(c, w, h, 1), 0: edgeOnly(c, w, h, 0) }));
  const free = (ci: number, axis: 0 | 1, idx: number[]) =>
    idx.filter((p) => {
      const x = p % w;
      const y = (p - x) / w;
      return !(edge[ci]![axis].has(axis === 1 ? x : y) && mine[axis][p]);
    });
  const lineIdx = (axis: 0 | 1, line: number, xs: number[], ys: number[]) => (axis === 1 ? xs.map((x) => line * w + x) : ys.map((y) => y * w + line));
  const same = (p: number, c: number[]) => [0, 1, 2, 3].every((k) => Math.round(d[p * 4 + k]!) === c[k]);
  for (let r = 0; r < rounds; r++) {
    let changed = false;
    cells.forEach((c, ci) => {
      const [xs, ys] = spans(c, w, h);
      const [x0, y0, x1, y1, sx, sy] = c;
      for (const [axis, sc] of [
        [1, sx],
        [0, sy],
      ] as const) {
        if (!isStretched(sc)) continue;
        const inner = axis === 1 ? halfCover(x0, x1, w) : halfCover(y0, y1, h);
        const lines = axis === 1 ? halfCover(y0, y1, h) : halfCover(x0, x1, w);
        for (const line of lines) {
          const idx = lineIdx(axis, line, xs, ys);
          const src = (axis === 1 ? inner.map((x) => line * w + x) : inner.map((y) => y * w + line)).filter((p) => !signal[p]);
          if (!src.length || idx.some((p) => keep[p])) continue;
          const best = commonest(d, src.map((p) => p * 4))!;
          for (const p of free(ci, axis, idx)) {
            if (same(p, best)) continue;
            for (let k = 0; k < 4; k++) d[p * 4 + k] = best[k]!;
            changed = true;
          }
        }
      }
    });
    if (!changed) return;
  }
  // cells that disagree (one stretched across a texel another stretches down): lines still changing take their
  // cell's commonest colour, which every cell reading them accepts
  for (let r = 0; r < rounds; r++) {
    let changed = false;
    cells.forEach((c, ci) => {
      const [xs, ys] = spans(c, w, h);
      if (!(isStretched(c[4]) || isStretched(c[5]))) return;
      const block: number[] = [];
      for (const y of ys) for (const x of xs) if (!signal[y * w + x]) block.push((y * w + x) * 4);
      if (!block.length) return;
      const face = commonest(d, block)!;
      for (const [axis, sc] of [
        [1, c[4]],
        [0, c[5]],
      ] as const) {
        if (!isStretched(sc)) continue;
        const lines = axis === 1 ? halfCover(c[1], c[3], h) : halfCover(c[0], c[2], w);
        for (const line of lines) {
          const idx = lineIdx(axis, line, xs, ys);
          if (idx.some((p) => keep[p])) continue;
          const f = free(ci, axis, idx);
          if (f.length && f.some((p) => !same(p, commonest(d, [f[0]! * 4])!))) {
            for (const p of f) for (let k = 0; k < 4; k++) d[p * 4 + k] = face[k]!;
            changed = true;
          }
        }
      }
    });
    if (!changed) break;
  }
}
