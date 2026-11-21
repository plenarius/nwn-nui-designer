/**
 * A software renderer for the original GUI's panel models, as the client lays them out: orthographic, 100 px per model
 * unit at UI scale 1, y up. A model is drawn in the state of an animation (its first frame's texture vertices,
 * vertices, position, orientation and alpha), or at a fill level between a "percentage" animation's first and last
 * frame ("percentage@0.4"). Each texture is sampled as its txi says: `filter 0` without blending (each pixel takes the
 * texel it falls in), `clamp` repeating the edge texel past the texture's edge on that axis.
 */
import type { RGBAImage } from "../../res/image.js";
import type { Mdl, MdlNode, Quat, Vec3 } from "../mdl.js";

export const PPU = 100;

/** A float RGBA canvas, rows top to bottom. */
export interface Canvas {
  w: number;
  h: number;
  d: Float32Array;
}

export function canvas(w: number, h: number, bg: readonly number[]): Canvas {
  const d = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = bg[0]!;
    d[i * 4 + 1] = bg[1]!;
    d[i * 4 + 2] = bg[2]!;
    d[i * 4 + 3] = 255;
  }
  return { w, h, d };
}

/** A texture as the renderer samples it: the picture (display order) and its txi's filter and clamp. */
export interface Tex {
  img: RGBAImage;
  /** txi `filter 0`. */
  nearest: boolean;
  /** txi `clamp`: 1 u, 2 v, 3 both. */
  clamp: number;
}

export type TexSource = (name: string) => Tex | null;
export type ModelSource = (name: string) => Mdl | null;

type Mat = number[]; // 3 x 3, row-major

function quatMat([x, y, z, w]: Quat): Mat {
  const n = Math.hypot(x, y, z, w) || 1;
  [x, y, z, w] = [x / n, y / n, z / n, w / n];
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}

const mul = (a: Mat, b: Mat): Mat => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!));
const apply = (m: Mat, v: readonly number[]): Vec3 => [m[0]! * v[0]! + m[1]! * v[1]! + m[2]! * v[2]!, m[3]! * v[0]! + m[4]! * v[1]! + m[5]! * v[2]!, m[6]! * v[0]! + m[7]! * v[1]! + m[8]! * v[2]!];

/** "percentage@0.4" -> ["percentage", 0.4]; a plain name -> [name, null]. */
export function splitAnim(anim: string | null | undefined): [string | null, number | null] {
  if (anim && anim.includes("@")) {
    const [a, f] = anim.split("@");
    return [a!, Number(f)];
  }
  return [anim ?? null, null];
}

/** Each node's world transform (rotation, translation), with the animation's first position and orientation keys. */
export function nodeWorld(m: Mdl, anim?: string | null): Map<string, { R: Mat; t: Vec3 }> {
  const [a] = splitAnim(anim);
  const an = a ? m.anims.get(a) : undefined;
  const by = new Map(m.nodes.map((n) => [n.name, n]));
  const out = new Map<string, { R: Mat; t: Vec3 }>();
  const get = (n: MdlNode, depth = 0): { R: Mat; t: Vec3 } => {
    const hit = out.get(n.name);
    if (hit) return hit;
    let pos: number[] = n.position;
    let ori: Quat = n.orientation;
    const ak = an?.nodes.get(n.name)?.keys;
    if (ak?.positionkey?.[0]) pos = ak.positionkey[0].slice(1, 4);
    if (ak?.orientationkey?.[0] && ak.orientationkey[0].length >= 5) ori = ak.orientationkey[0].slice(1, 5) as Quat;
    const R = quatMat(ori);
    const parent = n.parent ? by.get(n.parent) : undefined;
    let res: { R: Mat; t: Vec3 };
    if (parent && parent !== n && depth < 64) {
      const p = get(parent, depth + 1);
      const tp = apply(p.R, pos);
      res = { R: mul(p.R, R), t: [tp[0] + p.t[0], tp[1] + p.t[1], tp[2] + p.t[2]] };
    } else res = { R, t: [pos[0]!, pos[1]!, pos[2]!] };
    out.set(n.name, res);
    return res;
  };
  for (const n of m.nodes) get(n);
  return out;
}

/** A textured triangle (pixel positions P, texture coordinates UV), alpha-blended over the canvas. Pixel centres
 * inside the triangle are drawn; each samples the texture as its txi says. */
export function drawTri(cv: Canvas, P: number[][], UV: number[][], tex: Tex, alpha: number): void {
  const [[ax, ay], [bx, by], [cx, cy]] = P as [[number, number], [number, number], [number, number]];
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const y1 = Math.min(cv.h, Math.ceil(Math.max(ay, by, cy)));
  const xa = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const xb = Math.min(cv.w, Math.ceil(Math.max(ax, bx, cx)));
  if (xb <= xa || y1 <= y0) return;
  const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(den) < 1e-9) return;
  const [u0, v0] = UV[0] as [number, number];
  const [u1, v1] = UV[1] as [number, number];
  const [u2, v2] = UV[2] as [number, number];
  const img = tex.img;
  const tw = img.width;
  const th = img.height;
  const td = img.data;
  const cu = (tex.clamp & 1) !== 0;
  const cvv = (tex.clamp & 2) !== 0;
  const near = tex.nearest;
  const d = cv.d;
  const W = cv.w;
  // l1 and l2 are linear in x: their step per pixel
  const s1 = (by - cy) / den;
  const s2 = (cy - ay) / den;
  const eps = -1e-6;
  const wx = (x: number) => (cu ? (x < 0 ? 0 : x >= tw ? tw - 1 : x) : ((x % tw) + tw) % tw);
  const wy = (y: number) => (cvv ? (y < 0 ? 0 : y >= th ? th - 1 : y) : ((y % th) + th) % th);
  for (let y = y0; y < y1; y++) {
    const gy = y + 0.5;
    const gx0 = xa + 0.5;
    const b1 = ((by - cy) * (gx0 - cx) + (cx - bx) * (gy - cy)) / den;
    const b2 = ((cy - ay) * (gx0 - cx) + (ax - cx) * (gy - cy)) / den;
    // the x range where l1, l2 and 1 - l1 - l2 are all >= eps
    let lo = 0;
    let hi = xb - xa - 1;
    const clip = (b: number, st: number) => {
      // b + st * k >= eps
      if (Math.abs(st) < 1e-12) {
        if (b < eps) hi = -1;
        return;
      }
      const k = (eps - b) / st;
      if (st > 0) lo = Math.max(lo, Math.ceil(k - 1e-9));
      else hi = Math.min(hi, Math.floor(k + 1e-9));
    };
    clip(b1, s1);
    clip(b2, s2);
    clip(1 - b1 - b2, -s1 - s2);
    for (let k = lo; k <= hi; k++) {
      const l1 = b1 + s1 * k;
      const l2 = b2 + s2 * k;
      const l3 = 1 - l1 - l2;
      if (l1 < eps || l2 < eps || l3 < eps) continue;
      let u = l1 * u0 + l2 * u1 + l3 * u2;
      let v = l1 * v0 + l2 * v1 + l3 * v2;
      u = cu ? (u < 0 ? 0 : u > 1 ? 1 : u) : u - Math.floor(u);
      v = cvv ? (v < 0 ? 0 : v > 1 ? 1 : v) : v - Math.floor(v);
      const fx = u * tw - 0.5;
      const fy = (1 - v) * th - 0.5;
      let r: number;
      let g: number;
      let bl: number;
      let al: number;
      if (near) {
        const o = (wy(Math.floor(fy + 0.5)) * tw + wx(Math.floor(fx + 0.5))) * 4;
        r = td[o]!;
        g = td[o + 1]!;
        bl = td[o + 2]!;
        al = td[o + 3]!;
      } else {
        const x0 = Math.floor(fx);
        const yy0 = Math.floor(fy);
        const ex = fx - x0;
        const ey = fy - yy0;
        const xA = wx(x0);
        const xB = wx(x0 + 1);
        const yA = wy(yy0) * tw;
        const yB = wy(yy0 + 1) * tw;
        const p = (yA + xA) * 4;
        const q = (yA + xB) * 4;
        const t = (yB + xA) * 4;
        const z = (yB + xB) * 4;
        const w00 = (1 - ex) * (1 - ey);
        const w10 = ex * (1 - ey);
        const w01 = (1 - ex) * ey;
        const w11 = ex * ey;
        r = td[p]! * w00 + td[q]! * w10 + td[t]! * w01 + td[z]! * w11;
        g = td[p + 1]! * w00 + td[q + 1]! * w10 + td[t + 1]! * w01 + td[z + 1]! * w11;
        bl = td[p + 2]! * w00 + td[q + 2]! * w10 + td[t + 2]! * w01 + td[z + 2]! * w11;
        al = td[p + 3]! * w00 + td[q + 3]! * w10 + td[t + 3]! * w01 + td[z + 3]! * w11;
      }
      const a = (al / 255) * alpha;
      if (a <= 0) continue;
      const o = (y * W + xa + k) * 4;
      d[o] = d[o]! * (1 - a) + r * a;
      d[o + 1] = d[o + 1]! * (1 - a) + g * a;
      d[o + 2] = d[o + 2]! * (1 - a) + bl * a;
      if (a * 255 > d[o + 3]!) d[o + 3] = a * 255;
    }
  }
}

/** Moves or stretches a node's world vertices (model units), for pieces the client resizes in code. */
export type Xform = (verts: Vec3[]) => Vec3[];

export interface RenderOptions {
  anim?: string | null;
  scale?: number;
  /** Per node: its world vertices changed before drawing. */
  xform?: Record<string, Xform>;
  /** Textures drawn in place of others (the icon the client puts on a button's gui_replace01). */
  swap?: Record<string, string>;
}

/** Draws a model with its origin at canvas pixel (ox, oy); returns its nodes' world positions in pixels (its hooks). */
export function renderModel(cv: Canvas, m: Mdl, ox: number, oy: number, texsrc: TexSource, o: RenderOptions = {}): Map<string, [number, number]> {
  const scale = o.scale ?? 1;
  const wm = nodeWorld(m, o.anim);
  const [an, frac] = splitAnim(o.anim);
  const anim = an ? m.anims.get(an) : undefined;
  const items: { z: number; i: number; nd: MdlNode; W: Vec3[]; TV: number[][]; a: number }[] = [];
  m.nodes.forEach((nd, idx) => {
    if (!nd.bitmap || !nd.faces.length || !nd.render) return;
    const { R, t } = wm.get(nd.name)!;
    let V: number[][] = nd.verts;
    let TV: number[][] = nd.tverts;
    let a = nd.alpha;
    const anode = anim?.nodes.get(nd.name);
    if (anode) {
      const av = anode.animverts;
      const n = nd.verts.length;
      if (av && frac !== null && av.length >= 2 * n) {
        // a fill level: the first and last frame mixed (the client sets the percentage animation's time)
        const last = av.slice(av.length - n);
        V = av.slice(0, n).map((p, i) => p.map((c, k) => c + (last[i]![k]! - c) * frac));
      } else if (av && av.length >= n) V = av.slice(0, n);
      const tv = anode.animtverts?.length ? anode.animtverts : anode.tverts;
      if (tv && tv.length >= nd.tverts.length) TV = tv.slice(0, nd.tverts.length);
      const ak = anode.keys.alphakey?.[0];
      if (ak) a = ak[1] ?? a;
    }
    if (a <= 0.001) return;
    let W = V.map((p) => {
      const q = apply(R, p);
      return [q[0] + t[0], q[1] + t[1], q[2] + t[2]] as Vec3;
    });
    const xf = o.xform?.[nd.name];
    if (xf) W = xf(W.map((p) => [...p] as Vec3));
    items.push({ z: W.reduce((s, p) => s + p[2], 0) / Math.max(1, W.length), i: idx, nd, W, TV, a });
  });
  items.sort((p, q) => p.z - q.z || p.i - q.i);
  for (const it of items) {
    const tex = texsrc(o.swap?.[it.nd.bitmap!] ?? it.nd.bitmap!);
    if (!tex) continue;
    const px = it.W.map((p) => [ox + p[0] * PPU * scale, oy - p[1] * PPU * scale]);
    for (const f of it.nd.faces) {
      let [i, j, k, ti, tj, tk] = f;
      if (Math.max(ti, tj, tk) >= it.TV.length) [ti, tj, tk] = [i, j, k];
      if (!px[i] || !px[j] || !px[k] || !it.TV[ti] || !it.TV[tj] || !it.TV[tk]) continue;
      drawTri(cv, [px[i]!, px[j]!, px[k]!], [it.TV[ti]!, it.TV[tj]!, it.TV[tk]!], tex, it.a);
    }
  }
  const hooks = new Map<string, [number, number]>();
  for (const [n, { t }] of wm) hooks.set(n, [ox + t[0] * PPU * scale, oy - t[1] * PPU * scale]);
  return hooks;
}

/** A model's drawn extent in model units [x0, y0, x1, y1], or null when it draws nothing. */
export function modelBounds(m: Mdl, anim?: string | null): [number, number, number, number] | null {
  const wm = nodeWorld(m, anim);
  let b: [number, number, number, number] | null = null;
  for (const nd of m.nodes) {
    if (!nd.verts.length || !nd.bitmap || !nd.render) continue;
    const { R, t } = wm.get(nd.name)!;
    for (const p of nd.verts) {
      const q = apply(R, p);
      const x = q[0] + t[0];
      const y = q[1] + t[1];
      if (!b) b = [x, y, x, y];
      else b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
    }
  }
  return b;
}

/** Each node's world position in model units (a model's hooks), at the origin. */
export function hooksOf(m: Mdl, x = 0, y = 0, anim?: string | null): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const [n, { t }] of nodeWorld(m, anim)) out.set(n, [x + t[0], y + t[1]]);
  return out;
}
