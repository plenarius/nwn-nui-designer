/**
 * A screen of the original GUI as a list of pieces: models at their places and states, textures drawn whole (an icon
 * on a hook), and text labels. draw() renders the models and textures; the text is returned placed in pixels, for
 * the caller to draw in the game's font.
 */
import type { Vec3 } from "../mdl.js";
import { type Canvas, type ModelSource, PPU, type TexSource, type Xform, canvas, drawTri, modelBounds, renderModel } from "./render.js";

export interface ModelItem {
  kind: "model";
  name: string;
  x: number;
  y: number;
  anim: string | null;
  z: number;
  xform?: Record<string, Xform>;
  swap?: Record<string, string>;
}

export interface ImageItem {
  kind: "image";
  tex: string;
  /** Top left (y up) and size, model units. */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface TextItem {
  kind: "text";
  s: string;
  /** Bottom left (y up) and size, model units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Alignment in the box: 0 left / top, 1 right / bottom. */
  ah: number;
  av: number;
  col: [number, number, number];
  size: number;
  z: number;
}

export type Item = ModelItem | ImageItem | TextItem;

/** A text label placed in pixels on the drawn canvas. */
export interface PlacedText {
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ah: number;
  av: number;
  col: [number, number, number];
  size: number;
}

export const BG = [40, 44, 48] as const;
const MARGIN = 20;

export class Scene {
  items: Item[] = [];
  /** The screen's own extent (model units), where a page model reaches far past the window. */
  fixed: [number, number, number, number] | null = null;
  /** (x, y, width) of each list's header band (its text0 hook above the first row). */
  listHeads: [number, number, number][] = [];

  constructor(readonly models: ModelSource) {}

  model(name: string, x: number, y: number, anim: string | null = null, z = 0, extra: { xform?: Record<string, Xform>; swap?: Record<string, string> } = {}): void {
    this.items.push({ kind: "model", name, x, y, anim, z, ...extra });
  }

  image(tex: string, x: number, y: number, w: number, h: number, z = 1): void {
    this.items.push({ kind: "image", tex, x, y, w, h, z });
  }

  text(s: string, x: number, y: number, w: number, h: number, ah = 0, av = 0.5, col: [number, number, number] = [255, 255, 255], size = 14, z = 1): void {
    this.items.push({ kind: "text", s, x, y, w, h, ah, av, col, size, z });
  }

  bounds(): [number, number, number, number] {
    if (this.fixed) return this.fixed;
    let b: [number, number, number, number] | null = null;
    for (const it of this.items) {
      if (it.kind !== "model" || it.xform) continue;
      const m = this.models(it.name);
      const mb = m ? modelBounds(m, it.anim) : null;
      if (!mb) continue;
      const r: [number, number, number, number] = [it.x + mb[0], it.y + mb[1], it.x + mb[2], it.y + mb[3]];
      b = b ? [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])] : r;
    }
    return b ?? [0, 0, 1, 1];
  }

  /** The models and textures drawn (at most maxW px wide), and the text placed in pixels. */
  draw(texsrc: TexSource, bounds = this.bounds(), scale = 1, maxW = 1400, texts = true): { cv: Canvas; texts: PlacedText[]; scale: number } {
    const [x0, y0, x1, y1] = bounds;
    const ppu = PPU * scale;
    const W = Math.floor((x1 - x0) * ppu) + 2 * MARGIN;
    const H = Math.floor((y1 - y0) * ppu) + 2 * MARGIN;
    if (W > maxW) return this.draw(texsrc, bounds, (scale * maxW) / W, maxW, texts);
    const cv = canvas(W, H, BG);
    const ox = MARGIN - x0 * ppu;
    const oy = MARGIN + y1 * ppu;
    const out: PlacedText[] = [];
    const sorted = this.items.map((it, i) => [it, i] as const).sort((a, b) => a[0].z - b[0].z || a[1] - b[1]);
    for (const [it] of sorted) {
      if (it.kind === "model") {
        const m = this.models(it.name);
        if (m) renderModel(cv, m, ox + it.x * ppu, oy - it.y * ppu, texsrc, { anim: it.anim, scale, xform: it.xform, swap: it.swap });
      } else if (it.kind === "image") {
        const t = texsrc(it.tex);
        if (!t) continue;
        const P = [
          [ox + it.x * ppu, oy - it.y * ppu],
          [ox + (it.x + it.w) * ppu, oy - it.y * ppu],
          [ox + (it.x + it.w) * ppu, oy - (it.y - it.h) * ppu],
          [ox + it.x * ppu, oy - (it.y - it.h) * ppu],
        ];
        const UV = [
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ];
        const tex = { ...t, clamp: 3 };
        drawTri(cv, [P[0]!, P[1]!, P[2]!], [UV[0]!, UV[1]!, UV[2]!], tex, 1);
        drawTri(cv, [P[0]!, P[2]!, P[3]!], [UV[0]!, UV[2]!, UV[3]!], tex, 1);
      } else if (texts && it.s) {
        out.push({ s: it.s, x: ox + it.x * ppu, y: oy - (it.y + it.h) * ppu, w: it.w * ppu, h: it.h * ppu, ah: it.ah, av: it.av, col: it.col, size: Math.max(8, Math.floor(it.size * scale)) });
      }
    }
    return { cv, texts: out, scale };
  }
}

/** Moves a node's vertices so they span y0 (top) to y1 (bottom) in world units, shifted dx across (a piece the client
 * stretches in code: the scrollbar's track and thumb). */
export function fitY(y0: number, y1: number, dx: number, dz = 0): Xform {
  return (W: Vec3[]) => {
    const ys = W.map((p) => p[1]);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    return W.map((p, i) => {
      const k = hi - lo > 1e-6 ? (p[1] - lo) / (hi - lo) : i % 2 === 0 ? 1 : 0;
      return [p[0] + dx, y1 + k * (y0 - y1), p[2] + dz] as Vec3;
    });
  };
}

/** Turns a node's world vertices about the origin by `deg` degrees (a control on a turned hook). */
export function rotZ(deg: number): Xform {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return (W: Vec3[]) => W.map((p) => [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]] as Vec3);
}

