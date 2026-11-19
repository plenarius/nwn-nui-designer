/**
 * The procedural skin's drawing primitives: fills, value noise, bevelled rims, glows and small icons. A port of
 * tools/open-skin/draw.py (the Python generator, removed in phase 3; in git at e38d1ca), giving the same pixels: Python's Mersenne Twister for the noise (mt.ts), Python's rounding
 * (halves to even) and Pillow's drawing, compositing and resampling (pil.ts, render/resample.ts,
 * render/text.ts's alphaCompositeInPlace).
 */
import { type RGBAImage, newImage } from "../../res/image.js";
import { resize } from "../../render/resample.js";
import { alphaCompositeInPlace } from "../../render/text.js";
import { PyRandom } from "./mt.js";
import { Draw, type Ink, type Pt, alphaOf, copyImage, pasteMask, pyRoundInt } from "./pil.js";

/** A colour: [r, g, b], [r, g, b, a] or "#RRGGBB(AA)". */
export type Col = readonly number[] | string;

export const SS = 4;

export function rgba(c: Col, a = 255): Ink {
  if (typeof c === "string") {
    const h = c.replace(/^#/, "");
    const v: number[] = [];
    for (let i = 0; i + 1 < h.length; i += 2) v.push(parseInt(h.slice(i, i + 2), 16));
    return (v.length === 4 ? v : [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, a]) as unknown as Ink;
  }
  return (c.length === 4 ? [c[0]!, c[1]!, c[2]!, c[3]!] : [c[0]!, c[1]!, c[2]!, a]) as unknown as Ink;
}

export function mix(a: Col, b: Col, t: number): Ink {
  const x = rgba(a);
  const y = rgba(b);
  return [0, 1, 2, 3].map((i) => pyRoundInt(x[i]! + (y[i]! - x[i]!) * t)) as unknown as Ink;
}

/** Lighter (f > 0, towards white) or darker (f < 0, towards black). */
export function shade(c: Col, f: number): Ink {
  const x = rgba(c);
  return f >= 0 ? mix(x, [255, 255, 255, x[3]], f) : mix(x, [0, 0, 0, x[3]], -f);
}

/**
 * Seeded value noise in 0..1, w*h values row by row (draw.py value_noise). aspect > 1 stretches the cells
 * horizontally (streaks, as brushed metal); 1 gives the Python generator's exact values.
 */
export function valueNoise(w: number, h: number, seed: number, cell: number, octaves = 3, aspect = 1): Float64Array {
  const out = new Float64Array(w * h);
  let total = 0;
  let amp = 1;
  const rnd = new PyRandom(seed);
  let cellX = cell * aspect;
  for (let o = 0; o < octaves; o++) {
    const gw = Math.trunc(w / cellX) + 2;
    const gh = Math.trunc(h / cell) + 2;
    const grid = new Float64Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd.random();
    for (let y = 0; y < h; y++) {
      const fy = y / cell;
      const y0 = Math.trunc(fy);
      let ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = x / cellX;
        const x0 = Math.trunc(fx);
        let tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);
        const a = grid[y0 * gw + x0]!;
        const b = grid[y0 * gw + x0 + 1]!;
        const c = grid[(y0 + 1) * gw + x0]!;
        const d = grid[(y0 + 1) * gw + x0 + 1]!;
        out[y * w + x] = out[y * w + x]! + amp * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
      }
    }
    total += amp;
    amp *= 0.5;
    cell = Math.max(1, cell / 2);
    cellX = Math.max(1, cellX / 2);
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / total;
  return out;
}

/** draw.fill's keyword arguments. */
export interface FillSpec {
  top: Col;
  bottom?: Col | null;
  noise?: number;
  cell?: number;
  seed?: number;
  tint?: Col | null;
  octaves?: number;
  /** Stretches the noise's cells this many times wider than tall: streaks, as brushed metal (1 = round clouds). */
  streak?: number;
  /** Per-pixel grain on top, lighter or darker by up to this much (paper, leather); its own seeded stream. */
  grain?: number;
}

function setPx(im: RGBAImage, x: number, y: number, c: Ink): void {
  const i = (y * im.width + x) * 4;
  im.data[i] = c[0];
  im.data[i + 1] = c[1];
  im.data[i + 2] = c[2];
  im.data[i + 3] = c[3];
}

/** A vertical gradient from top to bottom (or flat), optionally mottled with value noise. */
export function fill(w: number, h: number, spec: FillSpec): RGBAImage {
  const { top, noise = 0, cell = 12, seed = 1, tint = null, octaves = 3, streak = 1, grain = 0 } = spec;
  const bottom = spec.bottom ?? top;
  const im = newImage(w, h);
  const nz = noise ? valueNoise(w, h, seed, cell, octaves, streak) : null;
  const gr = grain ? new PyRandom(seed + 7919) : null;
  for (let y = 0; y < h; y++) {
    const base = mix(top, bottom, y / Math.max(1, h - 1));
    for (let x = 0; x < w; x++) {
      let c = base;
      if (nz) {
        const n = (nz[y * w + x]! - 0.5) * 2 * noise;
        c = tint == null ? shade(c, n) : n > 0 ? mix(c, tint, n) : shade(c, n);
      }
      if (gr) c = shade(c, (gr.random() - 0.5) * 2 * grain);
      setPx(im, x, y, c);
    }
  }
  return im;
}

/** A 1 px rectangle inset px inside the image's edge (only the given sides: t, l, b, r). */
export function rect(im: RGBAImage, inset: number, color: Col, sides = "tlbr"): void {
  const d = new Draw(im);
  const x0 = inset;
  const y0 = inset;
  const x1 = im.width - 1 - inset;
  const y1 = im.height - 1 - inset;
  const c = rgba(color);
  if (sides.includes("t")) d.line([[x0, y0], [x1, y0]], c);
  if (sides.includes("b")) d.line([[x0, y1], [x1, y1]], c);
  if (sides.includes("l")) d.line([[x0, y0], [x0, y1]], c);
  if (sides.includes("r")) d.line([[x1, y0], [x1, y1]], c);
}

/** 1 px rings from the edge inwards; bevel > 0 lightens top and left, darkens bottom and right (raised). */
export function rim(im: RGBAImage, rings: readonly (Col | null)[], bevel = 0): void {
  rings.forEach((c, i) => {
    if (c == null) return;
    if (bevel) {
      rect(im, i, shade(c, -bevel), "br");
      rect(im, i, shade(c, bevel), "tl");
    } else rect(im, i, c);
  });
}

/** An inner glow: rings from start inwards, fading out over width px, blended over what is there. */
export function glow(im: RGBAImage, color: Col, start: number, width: number, strength = 1): void {
  for (let i = 0; i < width; i++) {
    const a = strength * (1 - i / width) ** 1.6;
    const layer = newImage(im.width, im.height);
    const c = rgba(color);
    rect(layer, start + i, [c[0], c[1], c[2], Math.trunc(255 * a)]);
    alphaCompositeInPlace(im, layer);
  }
}

/** The client's fixed 9-slice margin for frames: rim detail must stay inside it or it stretches with the widget. */
export const RIM_MARGIN = 3;

/** A rim drawn as a lit tube (a thin pipe) instead of flat rings. */
export interface PipeSpec {
  color: Col;
  /** Across the tube, 1 to 3 px; with inset it must stay within RIM_MARGIN. */
  width: number;
  /** Pixels from the edge to the tube (e.g. 1 to leave a dark outline ring outside it). */
  inset?: number;
  /** How much lighter the highlight is (0..1). */
  light?: number;
  /** How much darker the shadow side is (0..1). */
  shadow?: number;
}

/**
 * The shades across a tube of n px, from its lit side to its shadow side: a highlight just off the lit edge, falling to
 * the shadow. Light comes from the top left, so a pipe along the top or the left edge has its lit side outside and one
 * along the bottom or the right its lit side inside, as one round pipe lit from above.
 */
export function pipeProfile(n: number, light: number, shadow: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    return light * Math.max(0, 1 - ((t - 0.25) / 0.55) ** 2) - shadow * Math.max(0, (t - 0.3) / 0.7) ** 1.3;
  });
}

/** A pipe around the image's edge (pipeProfile). Throws if it would reach past RIM_MARGIN. */
export function pipe(im: RGBAImage, p: PipeSpec): void {
  const inset = p.inset ?? 0;
  if (p.width < 1 || inset < 0 || inset + p.width > RIM_MARGIN) throw new Error(`a pipe of ${p.width} px at ${inset} px from the edge reaches past the ${RIM_MARGIN} px margin`);
  const prof = pipeProfile(p.width, p.light ?? 0.45, p.shadow ?? 0.55);
  // Bottom and right first, so the top and left sides win where they meet (as rim's bevel).
  for (let i = 0; i < p.width; i++) rect(im, inset + i, shade(p.color, prof[p.width - 1 - i]!), "br");
  for (let i = 0; i < p.width; i++) rect(im, inset + i, shade(p.color, prof[i]!), "tl");
}

/** A round stud in each corner, size px across from inset px in, lit from the top left (rivets, pipe fittings). */
export function rivets(im: RGBAImage, color: Col, size = RIM_MARGIN, inset = 0): void {
  if (size < 1 || inset < 0 || inset + size > RIM_MARGIN) throw new Error(`a rivet of ${size} px at ${inset} px from the edge reaches past the ${RIM_MARGIN} px margin`);
  const head = radialFill(size, shade(color, 0.55), shade(color, -0.5), size * 0.3 - 0.5, size * 0.3 - 0.5, size * 0.95);
  const mask = discMask(size, size / 2);
  const stud = newImage(size, size);
  pasteMask(stud, head, mask);
  const w = im.width;
  const h = im.height;
  for (const [ox, oy] of [
    [inset, inset],
    [w - inset - size, inset],
    [inset, h - inset - size],
    [w - inset - size, h - inset - size],
  ] as const) {
    const layer = newImage(w, h);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) layer.data.set(stud.data.subarray((y * size + x) * 4, (y * size + x) * 4 + 4), ((oy + y) * w + ox + x) * 4);
    alphaCompositeInPlace(im, layer);
  }
}

export interface FrameOpts {
  bevel?: number;
  /** A pipe over the rings. */
  pipe?: PipeSpec | null;
  /** Corner studs over the rim (rivets, or fittings where pipes meet): their colour. */
  rivet?: Col | null;
  rivetSize?: number;
  glowColor?: Col | null;
  glowStart?: number;
  glowWidth?: number;
  glowStrength?: number;
}

export function frame(w: number, h: number, body: RGBAImage | Col, rings: readonly (Col | null)[], o: FrameOpts = {}): RGBAImage {
  let im = isImage(body) ? copyImage(body) : newImage(w, h, rgba(body));
  if (im.width !== w || im.height !== h) im = resize(im, w, h, "bilinear");
  if (o.glowColor != null) glow(im, o.glowColor, o.glowStart ?? 3, o.glowWidth ?? 4, o.glowStrength ?? 0.9);
  rim(im, rings, o.bevel ?? 0);
  if (o.pipe) pipe(im, o.pipe);
  if (o.rivet != null) rivets(im, o.rivet, o.rivetSize ?? RIM_MARGIN);
  return im;
}

const isImage = (v: unknown): v is RGBAImage => typeof v === "object" && v !== null && "data" in v;

/** paint(draw, k, image) on a transparent canvas SS times larger, averaged down (antialiased icons). */
export function supersample(w: number, h: number, paint: (d: Draw, k: number, im: RGBAImage) => void): RGBAImage {
  const big = newImage(w * SS, h * SS);
  paint(new Draw(big), SS, big);
  return resize(big, w, h, "box");
}

export type Dir = "up" | "down" | "left" | "right";

/** A triangle pointing dir, centred on (cx, cy), r = half its base. */
export function triangle(dir: Dir, cx: number, cy: number, r: number): Pt[] {
  const h = r * 0.9;
  if (dir === "up") return [[cx - r, cy + h / 2], [cx + r, cy + h / 2], [cx, cy - h / 2 - r * 0.15]];
  if (dir === "down") return [[cx - r, cy - h / 2], [cx + r, cy - h / 2], [cx, cy + h / 2 + r * 0.15]];
  if (dir === "left") return [[cx + h / 2, cy - r], [cx + h / 2, cy + r], [cx - h / 2 - r * 0.15, cy]];
  return [[cx - h / 2, cy - r], [cx - h / 2, cy + r], [cx + h / 2 + r * 0.15, cy]];
}

/** A chevron (an arrow head of two strokes of thickness t) as one polygon. */
export function chevron(dir: Dir, cx: number, cy: number, r: number, t: number): Pt[] {
  const pts: Pt[] = {
    down: [[-r, -r / 2], [0, r / 2], [r, -r / 2]] as Pt[],
    up: [[-r, r / 2], [0, -r / 2], [r, r / 2]] as Pt[],
    left: [[r / 2, -r], [-r / 2, 0], [r / 2, r]] as Pt[],
    right: [[-r / 2, -r], [r / 2, 0], [-r / 2, r]] as Pt[],
  }[dir];
  const [[ax, ay], [bx, by], [qx, qy]] = pts as [Pt, Pt, Pt];
  let inner: Pt[];
  if (dir === "down" || dir === "up") {
    const s = dir === "down" ? -1 : 1;
    inner = [[qx, qy + s * t], [bx, by + s * t], [ax, ay + s * t]];
  } else {
    const s = dir === "right" ? -1 : 1;
    inner = [[qx + s * t, qy], [bx + s * t, by], [ax + s * t, ay]];
  }
  return [...pts, ...inner].map(([x, y]) => [cx + x, cy + y] as Pt);
}

/** An antialiased disc of radius r in an n x n mask. */
export function discMask(n: number, r: number, cx = n / 2, cy = n / 2): Uint8ClampedArray {
  const im = supersample(n, n, (d, k) => d.ellipse([(cx - r) * k, (cy - r) * k, (cx + r) * k, (cy + r) * k], [255, 255, 255, 255]));
  return alphaOf(im);
}

/** A disc-shaped radial gradient (inner at the centre, outer at radius r), as a square image. */
export function radialFill(n: number, inner: Col, outer: Col, cx = n / 2 - 0.5, cy = n / 2 - 0.5, r = n / 2): RGBAImage {
  const im = newImage(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) setPx(im, x, y, mix(inner, outer, Math.min(1, Math.hypot(x - cx, y - cy) / r)));
  }
  return im;
}
