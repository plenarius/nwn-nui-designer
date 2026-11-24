/**
 * How each stock pixel of the original GUI is recoloured: by luminance along ramps of the skin's palette, so
 * gradients stay gradients and a frame's layout and states stay where they are. A port of the mappings Layonara's
 * Ink and brass set was made with (theme-gui ib_retone.py ib_colour, ibo_retone.py, ibo2_retone.py s2_colour):
 *
 * - swatch strips (swatchColour): black and greys up the neutral ramp (ink, raised, button body, pressed, accent);
 *   gold up the gold ramp (pressed, accent, glow); saturated other colours (health bars, hostility marks) kept.
 *   With an opaque skin, the thin light rules at low alpha become glow, so they stay visible on the denser fill.
 * - frames and buttons (frameColour): black field to ink, gold rules up a brass ramp to glow (the bright hover frame
 *   lands on glow), the blue-cloud "down" frames along the pressed ramp (the cloud stays a cloud), bright reds and
 *   greens kept as signals. Dark texels have noisy hue: how far the hue is trusted grows with saturation.
 * - alpha (alphaCurve): an opaque skin raises the stock translucent fills to the NUI body's density (0 stays 0).
 *
 * Contrast. The original GUI draws its rules, dividers and bevels with greys that differ from the fill by alpha as
 * much as by colour: the same #636563 is the fill at alpha 64 and 102 and a rule at 255; black at 128 darkens the
 * world, white at 102-166 lightens it. Two things can erase that structure, and did (Bronze, 2026-11-18: the
 * character record's row rules and the inventory's bevels vanished in game):
 * - the opaque curve raises 64 and 102 to 228 and 235, next to 255, so the alpha no longer separates rule and fill;
 * - a skin whose ink, title and button bodies are all near black (Bronze: #040302, #070604, #0A0806) maps the whole
 *   stock grey range onto 6 levels.
 * So the neutral steps get a floor of luminance above ink (ladder: lifted towards the accent where the skin's own
 * colour is darker), and with an opaque skin a swatch texel's place on the neutral ramp is its luminance as the stock
 * texel shows over a mid-dark world (WORLD_L), not its raw colour: rule, fill, darkening and highlight cells stay
 * apart once the alpha no longer separates them.
 */
import { type RGB, type ReskinPalette, mixRgb } from "./palette.js";

type Stop = [number, RGB];

function ramp(stops: Stop[], L: number): RGB {
  if (L <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i]!;
    if (L <= x1) {
      const [x0, c0] = stops[i - 1]!;
      const t = x1 === x0 ? 1 : (L - x0) / (x1 - x0);
      return [0, 1, 2].map((k) => c0[k]! + (c1[k]! - c0[k]!) * t) as RGB;
    }
  }
  return stops.at(-1)![1];
}

const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Luminance, saturation (0-1) and hue (degrees) of an sRGB colour, as the Python scripts computed them. */
export function lsh(r: number, g: number, b: number): [number, number, number] {
  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = (mx - mn) / Math.max(mx, 1);
  const d = Math.max(mx - mn, 1e-6);
  let h: number;
  if (mx === r) h = (((g - b) / d) % 6 + 6) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [L, sat, h * 60];
}

/** Relative luminance (as lsh) of a colour. */
export const lum = (c: readonly number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;

/** c, or c mixed towards `to` just far enough to differ from `from` by `min` in luminance (as far as `to` allows). */
export function lift(c: RGB, from: RGB, min: number, to: RGB): RGB {
  const L0 = lum(from);
  const far = (x: RGB) => Math.abs(lum(x) - L0) >= min;
  if (far(c) || !far(to)) return far(c) ? c : to;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    if (far(mixRgb(c, to, t))) hi = t;
    else lo = t;
  }
  return mixRgb(c, to, hi);
}

/** The world's luminance the stock translucent cells are judged over (the stock windows over a mid-dark scene). */
export const WORLD_L = 80;

/** The least luminance difference from ink of each neutral step (stock: the fill and rule greys are 85-100 over WORLD_L, ink 0). */
export const LADDER_MIN = { raised: 14, button: 21, rule: 64, light: 96 } as const;

export interface Ladder {
  raised: RGB;
  button: RGB;
  /** The stock opaque mid-grey rules and dividers. */
  rule: RGB;
  /** The stock light highlights (white at alpha 100-170). */
  light: RGB;
}

/** The neutral steps with their contrast floor against ink (either way: a light skin's steps go darker). Ink and
 * brass's own colours already clear it (unchanged). */
export function ladder(p: ReskinPalette): Ladder {
  const raised = lift(p.raised, p.ink, LADDER_MIN.raised, p.accent);
  const button = lift(p.button, p.ink, LADDER_MIN.button, p.accent);
  const rule = lift(mixRgb(button, p.accent, 0.25), p.ink, LADDER_MIN.rule, p.accent);
  const light = lift(mixRgb(rule, p.accent, 0.5), p.ink, LADDER_MIN.light, p.accent);
  return { raised, button, rule, light };
}

export interface Ramps {
  neutral: Stop[];
  /** Swatch neutrals with an opaque skin, and translucent frame texels, by luminance over WORLD_L (see the top of
   * this file). */
  swatchOpaque: Stop[];
  gold: Stop[];
  brass: Stop[];
  pressed: Stop[];
}

/** The dark brass step of the gold ramps: the pressed colour when it is of the accent's hue (Ink and brass's amber),
 * else the accent darkened to the pressed colour's luminance (Bronze's pressed is steel blue: gold rules must not
 * pass through blue). */
export function darkBrass(p: ReskinPalette): RGB {
  const [La, sa, ha] = lsh(...p.active);
  const [Lc, , hc] = lsh(...p.accent);
  const dh = Math.min(Math.abs(ha - hc), 360 - Math.abs(ha - hc));
  if (sa < 0.15 || dh <= 30) return p.active;
  const k = Math.min(1, La / Math.max(1, Lc));
  return p.accent.map((v) => Math.round(v * k)) as RGB;
}

export function ramps(p: ReskinPalette): Ramps {
  const brass = darkBrass(p);
  const l = ladder(p);
  return {
    neutral: [
      [0, p.ink],
      [99, l.raised],
      [106, l.button],
      [150, p.activeLo],
      [190, p.active],
      [255, p.accent],
    ],
    // stock cells over WORLD_L: black 255 -> 0, black 191 -> 20, black 128 -> 40, #636563 at 64 / 102 / 255 -> 85 /
    // 88 / 100, white 102 -> 150, white 153 -> 185, white 255 -> 255
    swatchOpaque: [
      [0, p.ink],
      [40, p.ink],
      [86, l.raised],
      [92, l.button],
      [100, l.rule],
      [150, l.light],
      [255, p.accent],
    ],
    gold: [
      [0, p.ink],
      [108, brass],
      [150, p.accent],
      [209, p.glow],
      [255, p.glowHi],
    ],
    brass: [
      [0, p.ink],
      [40, mixRgb(p.ink, brass, 0.42)],
      [90, brass],
      [150, p.accent],
      [205, p.glow],
      [255, p.glowHi],
    ],
    pressed: [
      [0, p.ink],
      [14, mixRgb(p.ink, p.activeLo, 0.26)],
      [45, p.activeLo],
      [90, p.active],
      [140, mixRgb(p.active, p.accent, 0.5)],
      [255, p.accent],
    ],
  };
}

/** A pixel mapper: stock colour and alpha (0-255) to the new colour. */
export type ColourMap = (r: number, g: number, b: number, a: number) => RGB;

/** The opaque alpha curve's stops: stock alpha to new (Layonara's ibo curve: 64 and 102 are the stock fills, 36-48
 * the thin rules). */
export const OPAQUE_ALPHA: [number, number][] = [
  [0, 0],
  [36, 150],
  [48, 160],
  [64, 228],
  [102, 235],
  [255, 255],
];

export type AlphaMode = "keep" | "opaque";

/** The alpha mapping: "keep" leaves alpha as it is; "opaque" raises it along OPAQUE_ALPHA (0 stays 0). */
export function alphaCurve(mode: AlphaMode): (a: number) => number {
  if (mode === "keep") return (a) => a;
  return (a) => {
    if (a <= 0) return 0;
    for (let i = 1; i < OPAQUE_ALPHA.length; i++) {
      const [x1, y1] = OPAQUE_ALPHA[i]!;
      if (a <= x1) {
        const [x0, y0] = OPAQUE_ALPHA[i - 1]!;
        return Math.round(y0 + ((y1 - y0) * (a - x0)) / (x1 - x0));
      }
    }
    return 255;
  };
}

/** The alpha mode a palette asks for: opaque when the NUI window body is (nearly) opaque. */
export const alphaModeOf = (p: ReskinPalette): AlphaMode => (p.bodyAlpha >= 240 ? "opaque" : "keep");

/** The 14 colour-swatch strips. name: the texture (gui_rgbc has its own rule). */
export function swatchColour(p: ReskinPalette, name: string, mode: AlphaMode): ColourMap {
  const R = ramps(p);
  return (r, g, b, a) => {
    const [L, sat, h] = lsh(r, g, b);
    if (name === "gui_rgbc") {
      // hostility markers: red, green, blue stay as signals; the pale yellow cell becomes the mark colour
      return sat > 0.2 && h > 50 && h < 70 ? p.mark : [r, g, b];
    }
    if (mode === "opaque" && a > 0 && a <= 60 && L > 180) return p.glow; // thin light rules on a denser fill
    const coloured = sat > 0.35;
    const gold = coloured && h >= 25 && h <= 50;
    if (coloured && !gold) return [r, g, b]; // health-bar red, poison green, blue, olive: signals
    if (gold) return ramp(R.gold, L);
    if (mode === "opaque") return ramp(R.swatchOpaque, (L * a + WORLD_L * (255 - a)) / 255);
    return ramp(R.neutral, L);
  };
}

/** The tab strips: their tab outlines are the stock mid grey (#636563, opaque or at alpha 100-109) on a black field.
 * The grey is a fill's grey elsewhere, so it lands on the raised step, which some skins draw darker than ink
 * (Oxblood: #341012 on #581A1C, the outline vanished) or barely above it (Bronze). Here it is a rule: an outline
 * texel that would sit within LADDER_MIN.rule of ink takes the ladder's rule step instead. */
export const TAB_STRIPS: ReadonlySet<string> = new Set(["gui_ig_chartabs", "gui_ig_chartabs2", "gui_ig_jourtabs", "gui_pre_playtabs"]);

/** The frames, buttons and controls (whole-panel art). name: gui_pre_chkbox and gui_gring01 have their own rule;
 * the TAB_STRIPS keep their outline clear of ink. */
export function frameColour(p: ReskinPalette, name: string): ColourMap {
  const R = ramps(p);
  const base = frameBase(p, name, R);
  if (!TAB_STRIPS.has(name)) return base;
  const rule = ladder(p).rule;
  const inkL = lum(p.ink);
  return (r, g, b, a) => {
    const c = base(r, g, b, a);
    const [L, sat] = lsh(r, g, b);
    return sat < 0.15 && L >= 60 && Math.abs(lum(c) - inkL) < LADDER_MIN.rule ? rule : c;
  };
}

/** Translucent window fills: one flat panel colour each, black to ink and the stock grey to the button face. */
export const FILLS: ReadonlySet<string> = new Set(["gui_transprnt", "gui_transprnt2", "gui_pregame_bkg"]);

function frameBase(p: ReskinPalette, name: string, R: Ramps): ColourMap {
  const l = ladder(p);
  const fill: Stop[] = [
    [0, p.ink],
    [99, l.button],
  ];
  // the close X: white X to the accent, its grey (other state) X to the rule, so it stays clear of ink
  const mark: Stop[] = [
    [0, p.ink],
    [99, l.rule],
    [255, p.accent],
  ];
  return (r, g, b, a) => {
    const [L, sat, h] = lsh(r, g, b);
    if (FILLS.has(name)) return ramp(fill, L);
    if (name === "gui_ig_xbutton") return ramp(mark, L);
    if (name === "gui_pre_chkbox" || name === "gui_gring01") {
      // a white tick or cell on alpha: ink to mark (or glow)
      const hi = name === "gui_pre_chkbox" ? p.mark : p.glow;
      const t = smooth(L, 60, 240);
      return [0, 1, 2].map((k) => p.ink[k]! * (1 - t) + hi[k]! * t) as RGB;
    }
    const mx = Math.max(r, g, b);
    // a translucent dark or grey texel (inventory cells) shows over the world: place it by how it shows there, so a
    // grey border at 192 stays apart from a black field at 161 (see the top of this file). Light texels (the thin
    // white rules at alpha 36-51) keep their place near the accent, or they would sink into the world.
    const neutral = a > 0 && a < 255 && L <= 180 ? ramp(R.swatchOpaque, (L * a + WORLD_L * (255 - a)) / 255) : ramp(R.neutral, L);
    const w = smooth(sat, 0.08, 0.25);
    const gold = (h >= 10 && h <= 60) || (mx < 90 && !(h > 160 && h < 280)); // dark warm or odd-hue noise rides gold
    const blue = h >= 180 && h <= 260;
    if (sat > 0.35 && mx > 90 && !gold && !blue) return [r, g, b]; // bright reds, greens: signals
    const toward = blue ? R.pressed : gold ? R.brass : null;
    if (!toward) return neutral;
    const c = ramp(toward, L);
    return [0, 1, 2].map((k) => neutral[k]! * (1 - w) + c[k]! * w) as RGB;
  };
}
