/**
 * The old GUI's redraw colours, from the skin's palette (src/core/reskin/palette.ts): flat faces, one rule, the hover
 * glow, the pressed fill. Every colour a face is filled with is one DXT1 stores exactly (5:6:5), with its hue kept, so
 * no 4 x 4 block decodes with a green or olive cast.
 */
import { unpack565 } from "../../reskin/bc.js";
import type { ReskinPalette } from "../../reskin/palette.js";
import type { RGBAImage } from "../../res/image.js";
import { type Pic, type RGB, fromImage, lum, toImage } from "./raster.js";

export type Rgb = [number, number, number];

const mix = (a: RGB, b: RGB, t: number): Rgb => [0, 1, 2].map((k) => a[k]! + (b[k]! - a[k]!) * t) as Rgb;

/** The nearest colour DXT1 stores exactly, its hue kept: the cost counts how far the channels' differences move, so a
 * warm grey stays warm and a neutral one neutral (never the green or purple cast a plain nearest colour can have). */
export function snap565(c: RGB): Rgb {
  const r5 = Math.round((c[0]! * 31) / 255);
  const g6 = Math.round((c[1]! * 63) / 255);
  const b5 = Math.round((c[2]! * 31) / 255);
  let best: Rgb = [c[0]!, c[1]!, c[2]!];
  let bestCost = Infinity;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dg = -2; dg <= 2; dg++) {
      for (let db = -1; db <= 1; db++) {
        const R = Math.min(31, Math.max(0, r5 + dr));
        const G = Math.min(63, Math.max(0, g6 + dg));
        const B = Math.min(31, Math.max(0, b5 + db));
        const col = unpack565((R << 11) | (G << 5) | B) as Rgb;
        const dist = (col[0] - c[0]!) ** 2 + (col[1] - c[1]!) ** 2 + (col[2] - c[2]!) ** 2;
        const hue = (col[0] - col[1] - (c[0]! - c[1]!)) ** 2 + (col[1] - col[2] - (c[1]! - c[2]!)) ** 2;
        const cost = dist + 2 * hue;
        if (cost < bestCost) {
          bestCost = cost;
          best = col;
        }
      }
    }
  }
  return best;
}

/** True when DXT1 stores the colour exactly. */
export function exact565(c: RGB): boolean {
  const r = c[0]! >> 3;
  const g = c[1]! >> 2;
  const b = c[2]! >> 3;
  const d = unpack565((r << 11) | (g << 5) | b);
  return d[0] === c[0] && d[1] === c[1] && d[2] === c[2];
}

export type State = "normal" | "pressed" | "hilite" | "disabled" | "panel" | "field";

export interface OldGuiStyle {
  /** The 1 px outer edge of every frame. */
  out: Rgb;
  /** The rule (the skin's accent). */
  line: Rgb;
  /** The hover rule, inside the rule. */
  glow: Rgb;
  /** Button face, window fill, pressed / selected face. */
  btn: Rgb;
  panel: Rgb;
  press: Rgb;
  /** Disabled rule and face. */
  dline: Rgb;
  dbtn: Rgb;
  /** Tracks, edit fields and item cells, and their rule. */
  track: Rgb;
  tline: Rgb;
  /** Ticks and marks. */
  mark: Rgb;
  /** The darker brass of a thumb or knob (a brown or gold cell of a colour strip). */
  brass: Rgb;
  /** Each state's face, rule and (hover) glow. */
  states: Record<State, { face: Rgb; line: Rgb; glow: Rgb | null }>;
}

const grey = (c: RGB): Rgb => {
  const l = Math.round(lum(c));
  return [l, l, l];
};

export function oldGuiStyle(p: ReskinPalette): OldGuiStyle {
  const s = (c: RGB) => snap565(c.map((v) => Math.round(v)));
  const panel = s(p.ink);
  const btn = s(p.button);
  const press = s(mix(p.activeLo, p.active, 0.5));
  const line = s(p.accent);
  const glow = s(p.glow);
  const out = s(mix(p.ink, [0, 0, 0], 0.7));
  const dline = s(grey(mix(p.mark, p.ink, 0.5)));
  const dbtn = s(grey(p.button));
  const track = s(mix(p.ink, [0, 0, 0], 0.4));
  const tline = s(mix(p.accent, p.ink, 0.45));
  const mark = s(p.mark);
  const brass = s(mix(p.accent, p.ink, 0.15));
  return {
    out,
    line,
    glow,
    btn,
    panel,
    press,
    dline,
    dbtn,
    track,
    tline,
    mark,
    brass,
    states: {
      normal: { face: btn, line, glow: null },
      pressed: { face: press, line, glow: null },
      hilite: { face: btn, line, glow },
      disabled: { face: dbtn, line: dline, glow: null },
      panel: { face: panel, line, glow: null },
      field: { face: track, line: tline, glow: null },
    },
  };
}

/** Dark texels (under 72 on every channel) snapped to the nearest exact 5:6:5 colour of their hue: DXT stores colours
 * as 5:6:5, and a dark warm grey's nearest stored colour is often green. Exact colours stay. */
export function warm565(p: Pic): void {
  const cache = new Map<number, Rgb>();
  for (let i = 0; i < p.w * p.h; i++) {
    const r = Math.round(p.d[i * 4]!);
    const g = Math.round(p.d[i * 4 + 1]!);
    const b = Math.round(p.d[i * 4 + 2]!);
    if (Math.max(r, g, b) >= 72 || exact565([r, g, b])) continue;
    const k = (r << 16) | (g << 8) | b;
    let c = cache.get(k);
    if (!c) cache.set(k, (c = snap565([r, g, b])));
    p.d[i * 4] = c[0];
    p.d[i * 4 + 1] = c[1];
    p.d[i * 4 + 2] = c[2];
  }
}

/** warm565 on a copy of an image. */
export function warm565Image(im: RGBAImage): RGBAImage {
  const p = fromImage(im);
  warm565(p);
  return toImage(p);
}

/** Encoder weights for a flat redraw: a texel whose 3 x 3 neighbourhood is one colour (a face) counts FACE_WEIGHT
 * times, so DXT keeps faces exact and puts its error on the 1 px edges and rules beside them. */
export const FACE_WEIGHT = 12;

export function faceWeights(im: RGBAImage): Float64Array {
  const { width: w, height: h, data } = im;
  const out = new Float64Array(w * h).fill(1);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const o = (y * w + x) * 4;
      let same = true;
      for (let dy = -1; dy <= 1 && same; dy++) {
        for (let dx = -1; dx <= 1 && same; dx++) {
          const q = ((y + dy) * w + x + dx) * 4;
          for (let k = 0; k < 4; k++) if (data[q + k] !== data[o + k]) same = false;
        }
      }
      if (same) out[y * w + x] = FACE_WEIGHT;
    }
  }
  return out;
}
