/**
 * The original GUI's palette, derived from a designer skin's generator style (src/core/skin/gen/style.ts), so the
 * old windows take the same colours as the NUI ones: the window body becomes the panel fill, the title and button
 * bodies the raised greys, the pressed/selected body the stock blue "down" frames, the accent the gold rules and the
 * hover glow the bright gold frames.
 *
 * For Ink and brass these come out as the colours Layonara's hand-made set used (theme-gui ib_retone.py: INK
 * #141312, RAISED #24211D, BUTTON #2C2823, ACTIVE_LO #4A371B, ACTIVE #604824, ACCENT #A88A58, GLOW #F0CC82,
 * MARK #EACE96); tests/reskin.test.ts holds them to it.
 */
import type { Col, FillSpec } from "../skin/gen/draw.js";
import type { Style } from "../skin/gen/style.js";

export type RGB = [number, number, number];

export interface ReskinPalette {
  /** Panel fill: the NUI window body. */
  ink: RGB;
  /** Raised fill (title bars): the NUI title body, or between window and button body. */
  raised: RGB;
  /** Button body. */
  button: RGB;
  /** Pressed / selected, dark and light end (the NUI active body's bottom and top). */
  activeLo: RGB;
  active: RGB;
  /** Rules, borders, frames: the skin's accent. */
  accent: RGB;
  /** Hover: the NUI glow, and a lighter step above it. */
  glow: RGB;
  glowHi: RGB;
  /** Ticks and marks. */
  mark: RGB;
  /** Text (the old GUI's text colour is not in a texture: for the record and the contact sheet only). */
  text: RGB;
  /** The NUI window body's opacity (0-255): 255 makes the old translucent panels opaque too. */
  bodyAlpha: number;
}

/** "#RRGGBB" or "#RRGGBBAA" to [r, g, b, a]. */
export function parseHex(s: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s.trim());
  if (!m) throw new Error(`not a colour: ${s}`);
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? Number.parseInt(m[2], 16) : 255];
}

export const mixRgb = (a: readonly number[], b: readonly number[], t: number): RGB => [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t)) as RGB;

const col = (c: Col): RGB => (typeof c === "string" ? (parseHex(c).slice(0, 3) as RGB) : ([c[0]!, c[1]!, c[2]!] as RGB));
const top = (f: FillSpec): RGB => col(f.top);
const bottom = (f: FillSpec): RGB => (f.bottom ? col(f.bottom) : mixRgb(col(f.top), [0, 0, 0], 0.23));

export function paletteFromStyle(s: Style): ReskinPalette {
  const ink = top(s.window_body);
  const button = top(s.button_body);
  const glow = col(s.glow);
  const [ar, ag, ab] = parseHex(s.accent);
  return {
    ink,
    raised: s.title_body ? top(s.title_body) : mixRgb(ink, button, 0.5),
    button,
    activeLo: bottom(s.active_body),
    active: top(s.active_body),
    accent: [ar, ag, ab],
    glow,
    glowHi: mixRgb(glow, [255, 255, 255], 0.55),
    mark: col(s.mark),
    text: parseHex(s.text).slice(0, 3) as RGB,
    bodyAlpha: parseHex(s.fixed_background)[3],
  };
}

export const hex = (c: readonly number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
