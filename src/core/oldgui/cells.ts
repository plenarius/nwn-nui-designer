/**
 * How the original GUI's models read their textures: every UV rectangle a model samples (per node and per
 * animation, so per state), how many screen pixels each texel becomes along each axis, and which texels a stretched
 * cell really reads once filtering is counted.
 *
 * Model units: a GUI model is laid out at 100 screen pixels per unit (UI scale 1).
 */
import type { Mdl, MdlNode, Vec2, Vec3 } from "./mdl.js";

/** One UV rectangle a model samples from a texture. anim "" is the geometry's own texture vertices (what shows when
 * no animation runs). */
export interface UvEntry {
  model: string;
  node: string;
  anim: string;
  /** [u0, v0, u1, v1], the bounds of the texture vertices (v up, as the model stores them). */
  rect: [number, number, number, number];
  /** The quad's size in model units. */
  size: [number, number];
  render: boolean;
  /** Model units per unit of u and of v along the quad's own mapping (a rotated strip draws u down the screen);
   * null when every face's UVs are degenerate. */
  uvScale: [number, number] | null;
}

/** A sampled cell: [x0, y0, x1, y1, sx, sy, ...refs]. The span in texels (y 0 at the top, as the picture shows),
 * the pixels per texel the model draws it at (0 along an axis stretched at run time, or sampled under one texel),
 * then up to three "model/node/anim" references ("-" for the geometry). */
export type Cell = [number, number, number, number, number, number, ...string[]];

/** Animations that resize a piece at run time (the scrollbar's thumb and track, the radial band). A "percentage"
 * bar shrinks: it does not stretch. */
export const RUNTIME = new Set(["size", "thumbsize"]);
/** An axis drawn at this many pixels per texel or more is stretched. */
export const STRETCH = 3.0;
/** A control's states: a model that reads a different cell of a texture for these draws its state frames from it. */
export const STATES = new Set(["", "-", "up", "down", "hilite", "disabled", "encouraged", "checkedup", "checkeddown", "uncheckedup", "uncheckeddown", "checkedhilite"]);
/** Filtering reads half a texel past each end of a stretched span: at EDGE times or more (or at run time) that
 * reach is a visible fade and counts. */
export const EDGE = 8.0;
/** A frame's 1:1 rule reached at the end of a stretched cell may stay while the soft edge it leaves is at most
 * SOFT / 2 pixels. */
export const SOFT = 12.0;
/** Cells whose UVs straddle two cells of their strip in the stock model: flattening them would undo their
 * neighbours' rules. */
export const MISALIGNED = new Set(["ctl_btn_srv_110/plane169/checkedup"]);

function bounds(tv: readonly Vec2[]): [number, number, number, number] {
  let u0 = Infinity;
  let v0 = Infinity;
  let u1 = -Infinity;
  let v1 = -Infinity;
  for (const [u, v] of tv) {
    u0 = Math.min(u0, u);
    v0 = Math.min(v0, v);
    u1 = Math.max(u1, u);
    v1 = Math.max(v1, v);
  }
  return [u0, v0, u1, v1];
}

function extent(vs: readonly Vec3[]): [number, number] {
  if (!vs.length) return [0, 0];
  const xs = vs.map((v) => v[0]);
  const ys = vs.map((v) => v[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Model units per unit of u and v, from the first face whose UVs are not degenerate (rotation included). */
export function uvAxes(node: MdlNode, vs: readonly Vec3[], tv: readonly Vec2[]): [number, number] | null {
  for (const f of node.faces) {
    const [i, j, k, ti, tj, tk] = f;
    const pi = vs[i];
    const pj = vs[j];
    const pk = vs[k];
    const qi = tv[ti];
    const qj = tv[tj];
    const qk = tv[tk];
    if (!pi || !pj || !pk || !qi || !qj || !qk) continue;
    const a1 = [pj[0] - pi[0], pj[1] - pi[1]];
    const a2 = [pk[0] - pi[0], pk[1] - pi[1]];
    const b1 = [qj[0] - qi[0], qj[1] - qi[1]];
    const b2 = [qk[0] - qi[0], qk[1] - qi[1]];
    const det = b1[0]! * b2[1]! - b2[0]! * b1[1]!;
    if (Math.abs(det) < 1e-9) continue;
    // P = J T: the columns of J are dP/du and dP/dv
    const du = [(a1[0]! * b2[1]! - a2[0]! * b1[1]!) / det, (a1[1]! * b2[1]! - a2[1]! * b1[1]!) / det];
    const dv = [(a2[0]! * b1[0]! - a1[0]! * b2[0]!) / det, (a2[1]! * b1[0]! - a1[1]! * b2[0]!) / det];
    return [r6(Math.hypot(du[0]!, du[1]!)), r6(Math.hypot(dv[0]!, dv[1]!))];
  }
  return null;
}

/** Every UV rectangle a model samples, by texture. */
export function uvEntries(m: Mdl): Map<string, UvEntry[]> {
  const out = new Map<string, UvEntry[]>();
  const add = (t: string, e: UvEntry) => {
    let l = out.get(t);
    if (!l) out.set(t, (l = []));
    l.push(e);
  };
  for (const nd of m.nodes) {
    if (!nd.bitmap || !nd.tverts.length) continue;
    const size = extent(nd.verts);
    add(nd.bitmap, { model: m.name, node: nd.name, anim: "", rect: bounds(nd.tverts), size, render: nd.render, uvScale: uvAxes(nd, nd.verts, nd.tverts) });
    for (const [an, a] of m.anims) {
      const x = a.nodes.get(nd.name);
      if (!x) continue;
      const tv = x.animtverts?.length ? x.animtverts : x.tverts;
      if (!tv?.length) continue;
      const av = x.animverts;
      const n = nd.verts.length;
      const asize = av?.length ? extent(av) : size;
      add(x.bitmap ?? nd.bitmap, {
        model: m.name,
        node: nd.name,
        anim: an,
        rect: bounds(tv),
        size: asize,
        render: nd.render,
        uvScale: uvAxes(nd, av && av.length >= n ? av.slice(0, n) : nd.verts, tv.length >= nd.tverts.length ? tv.slice(0, nd.tverts.length) : tv),
      });
    }
  }
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** One texture's UV entries as cells (deduplicated, sorted), at its size w x h. */
export function cellsFor(entries: readonly UvEntry[], w: number, h: number): Cell[] {
  const stretched = new Set(entries.filter((e) => RUNTIME.has(e.anim)).map((e) => `${e.model}/${e.node}`));
  const cells = new Map<string, { k: number[]; refs: Set<string> }>();
  for (const e of entries) {
    if (!e.render && e.anim === "") continue;
    const [u0, v0, u1, v1] = e.rect;
    const x0 = u0 * w;
    const x1 = u1 * w;
    const y0 = (1 - v1) * h;
    const y1 = (1 - v0) * h;
    const qw = e.size[0] * 100;
    const qh = e.size[1] * 100;
    let sx = x1 - x0 < 1 ? 0 : qw / (x1 - x0);
    let sy = y1 - y0 < 1 ? 0 : qh / (y1 - y0);
    if (e.uvScale) {
      // the quad's own mapping (a rotated piece draws u down the screen): pixels per texel along each axis
      sx = x1 - x0 < 1 ? 0 : r3((e.uvScale[0] * 100) / w);
      sy = y1 - y0 < 1 ? 0 : r3((e.uvScale[1] * 100) / h);
    }
    // a stub quad (its geometry a sliver the client resizes) gives no scale: leave it unstretched
    if (sx > 0 && sx < 0.5) sx = 1;
    if (sy > 0 && sy < 0.5) sy = 1;
    if (stretched.has(`${e.model}/${e.node}`) && sx && sy) {
      if (x1 - x0 > y1 - y0) sx = 0;
      else sy = 0;
    }
    const k = [x0, y0, x1, y1, sx, sy].map(r2);
    const key = k.join(",");
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { k, refs: new Set() }));
    c.refs.add(`${e.model}/${e.node}/${e.anim || "-"}`);
  }
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  };
  return [...cells.values()].sort((a, b) => cmp(a.k, b.k)).map((c) => [...(c.k as [number, number, number, number, number, number]), ...[...c.refs].sort().slice(0, 3)] as Cell);
}

/** The controls that read more than one cell of a texture across their states: "model/node" to its cell count. */
export function stateControls(cells: readonly Cell[]): Map<string, number> {
  const by = new Map<string, Set<number>>();
  cells.forEach((c, i) => {
    for (const ref of c.slice(6) as string[]) {
      const [model, node, anim] = ref.split("/");
      if (anim === undefined || !STATES.has(anim)) continue;
      const k = `${model}/${node}`;
      let s = by.get(k);
      if (!s) by.set(k, (s = new Set()));
      s.add(i);
    }
  });
  return new Map([...by].filter(([, s]) => s.size > 1).map(([k, s]) => [k, s.size]));
}

/** Whether an axis's scale counts as stretched. */
export const isStretched = (s: number) => s === 0 || s >= STRETCH;

const mod = (i: number, n: number) => ((i % n) + n) % n;
const range = (lo: number, hi: number) => Array.from({ length: Math.max(0, hi - lo) }, (_, i) => lo + i);
const uniqSorted = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

/** Texels filtering reads for the span [a, b] of an axis n texels long, drawn stretched: the texels it covers and
 * the half texel beyond each end (wrapping only for a span that runs past the texture's edge). */
export function readSpan(a: number, b: number, n: number): number[] {
  if (b - a >= n) return range(0, n);
  let lo = Math.floor(a - 0.5);
  let hi = Math.floor(b - 0.5) + 1;
  if (a >= 0 && b <= n) {
    // a span inside the texture reaches no further than its edge texels
    lo = Math.max(lo, 0);
    hi = Math.min(hi, n - 1);
  }
  return uniqSorted(range(lo, hi + 1).map((i) => mod(i, n)));
}

/** Texels the span [a, b] covers (drawn about one pixel per texel: no reach beyond its ends). */
export function coverSpan(a: number, b: number, n: number): number[] {
  if (b - a >= n) return range(0, n);
  const lo = Math.floor(a + 1e-3);
  let hi = Math.ceil(b - 1e-3);
  if (hi <= lo) hi = lo + 1;
  return uniqSorted(range(lo, hi).map((i) => mod(i, n)));
}

/** Texels the span [a, b] covers at least half of. */
export function halfCover(a: number, b: number, n: number): number[] {
  if (b - a >= n) return range(0, n);
  const lo = Math.floor(a + 0.5);
  const hi = Math.floor(b + 0.5);
  return uniqSorted(range(lo, Math.max(hi, lo + 1)).map((i) => mod(i, n)));
}

/** The texel columns and rows a cell reads. */
export function spans(c: Cell, w: number, h: number): [number[], number[]] {
  const [x0, y0, x1, y1, sx, sy] = c;
  const reach = (s: number) => s === 0 || s >= EDGE;
  return [reach(sx) ? readSpan(x0, x1, w) : coverSpan(x0, x1, w), reach(sy) ? readSpan(y0, y1, h) : coverSpan(y0, y1, h)];
}

/** Texels a piece drawn about 1:1 along an axis covers, per axis, as masks over the texture (index y * w + x): [1]
 * for flattening across, [0] for flattening down. A stretched cell that only reaches such a texel at its very end
 * leaves it alone, so the 1:1 piece keeps its rule. */
export function claimed(cells: readonly Cell[], w: number, h: number): { 1: Uint8Array; 0: Uint8Array } {
  const out = { 1: new Uint8Array(w * h), 0: new Uint8Array(w * h) };
  for (const c of cells) {
    const [rx, ry] = spans(c, w, h);
    if (!isStretched(c[4])) for (const x of halfCover(c[0], c[2], w)) for (const y of ry) out[1][y * w + x] = 1;
    if (!isStretched(c[5])) for (const x of rx) for (const y of halfCover(c[1], c[3], h)) out[0][y * w + x] = 1;
  }
  return out;
}

/** The texels along axis (1 = x, 0 = y) a stretched cell reads only at its ends, where a frame's rule may stay. */
export function edgeOnly(c: Cell, w: number, h: number, axis: 0 | 1): Set<number> {
  const s = axis === 1 ? c[4] : c[5];
  if (!(s > 0 && s <= SOFT)) return new Set();
  const [a, b, n] = axis === 1 ? [c[0], c[2], w] : [c[1], c[3], h];
  const half = new Set(halfCover(a, b, n));
  return new Set(spans(c, w, h)[axis === 1 ? 0 : 1].filter((x) => !half.has(x)));
}

/** The refs of a cell. */
export const cellRefs = (c: Cell): string[] => c.slice(6) as string[];
