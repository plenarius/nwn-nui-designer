/**
 * The procedural skins: a Style of about 30 numbers, the textures drawn from it and every nui_skin.tml key set from
 * it. A port of tools/open-skin/candidates.py (removed in phase 3; in git at e38d1ca). "b-clean" (Ink and brass,
 * Brawler) is the default built-in skin and "a-bronze" (Bronze, Philosopher Bold) the second one (themes.ts,
 * assets/skin/ink and assets/skin/bronze, CC0); "d-iron" is a preset only. The textures come out byte for byte as the
 * Python generator drew them (tests/skin.test.ts).
 *
 * Every pixel comes from the numbers here: no input image. The palettes were picked by hand for each look.
 */
import { type RGBAImage, newImage } from "../../res/image.js";
import { alphaCompositeInPlace } from "../../render/text.js";
import {
  type Col,
  type Dir,
  type FillSpec,
  type PipeSpec,
  SS,
  chevron,
  discMask,
  fill,
  frame,
  mix,
  radialFill,
  rgba,
  shade,
  supersample,
  triangle,
} from "./draw.js";
import { Draw, greyLA, pasteMask, rotate90 } from "./pil.js";

export type RGB = [number, number, number];

export interface Style {
  key: string;
  title: string;
  summary: string;
  /** The (default) font's key in tools/open-skin/sources.toml (for provenance only). */
  font: string;
  /** The (default) font's font_size (17 is the client's; a face with tall ascenders needs more for the same width). */
  font_size: number;
  /** A second face for headings, as a [[fonts]] entry named "display" that windows pick with NuiStyleFont. */
  display_font: { font: string; size: number } | null;
  spacing_h: number;
  // colours of nui_skin.tml
  text: string;
  title_label: string;
  title_label_active: string;
  /** Button text on hover and pressed (white on the dark presets; dark ink on a light one). */
  text_hover: string;
  text_active: string;
  accent: string;
  fixed_background: string;
  /** Context menu entries: normal, hover, active. */
  contextual: [string, string, string];
  // textures
  window_body: FillSpec;
  /** A title bar texture of its own (nuio_title) when set. */
  title_body: FillSpec | null;
  button_body: FillSpec;
  active_body: FillSpec;
  /** Inside of checkboxes, radio buttons and scroll tracks. */
  well: RGB;
  /** 1 px rings from the edge in, at most 3 (the slice margin); null leaves a ring out. */
  rings: (RGB | null)[];
  bevel: number;
  /** A thin lit pipe drawn over the rings of every frame (windows, buttons, checkboxes). */
  pipe: PipeSpec | null;
  /** Corner studs on windows, title bars and buttons (rivets, pipe fittings): their colour, and size in px (at most 3). */
  rivet: RGB | null;
  rivet_size: number;
  glow: RGB;
  glow_start: number;
  glow_width: number;
  glow_strength: number;
  /** Ticks, dots, arrows. */
  mark: RGB;
  mark_dark: RGB;
  /** Small square buttons (close, scroll arrows); null = transparent. */
  tile: FillSpec | null;
  tile_icon_dark: boolean;
  tick: "cross" | "check";
  /** Progress fill: light centre, dark edge. */
  progress: [RGB, RGB];
  disabled_grey: boolean;
}

const DEFAULTS: Omit<Style, "key" | "title" | "summary" | "font"> = {
  font_size: 17,
  display_font: null,
  spacing_h: 0.5,
  text: "#FFFFFFFF",
  title_label: "#C8C8C8FF",
  title_label_active: "#FFFFFFFF",
  text_hover: "#FFFFFFFF",
  text_active: "#FFFFFFFF",
  accent: "#B08E5AFF",
  fixed_background: "#000000FF",
  contextual: ["#000000FF", "#000000FF", "#B08E5AFF"],
  window_body: { top: [0, 0, 0] },
  title_body: null,
  button_body: { top: [0, 0, 0] },
  active_body: { top: [0, 0, 0] },
  well: [0, 0, 0],
  rings: [],
  bevel: 0,
  pipe: null,
  rivet: null,
  rivet_size: 3,
  glow: [255, 200, 100],
  glow_start: 3,
  glow_width: 4,
  glow_strength: 0.9,
  mark: [230, 210, 170],
  mark_dark: [20, 14, 8],
  tile: null,
  tile_icon_dark: true,
  tick: "cross",
  progress: [
    [150, 170, 230],
    [40, 50, 120],
  ],
  disabled_grey: true,
};

const style = (s: Partial<Style> & Pick<Style, "key" | "title" | "summary" | "font">): Style => ({ ...DEFAULTS, ...s });

export const BRONZE: Style = style({
  key: "a-bronze",
  title: "A: Bronze",
  summary:
    "Close to the stock look: black panels, a three-line bronze rim, warm glow on hover, mottled steel blue for pressed and selected. Procedural.",
  font: "philosopher-bold",
  text: "#FFFFFFFF",
  title_label: "#CFC6B6FF",
  title_label_active: "#FFFFFFFF",
  accent: "#B08E5AFF",
  fixed_background: "#000000FF",
  contextual: ["#000000FF", "#1E2A3AFF", "#B08E5AFF"],
  window_body: { top: [4, 3, 2] },
  button_body: { top: [10, 8, 6], bottom: [2, 2, 1], noise: 0.04, cell: 6 },
  active_body: { top: [46, 64, 88], bottom: [24, 36, 54], noise: 0.3, cell: 18, octaves: 2 },
  well: [3, 2, 1],
  rings: [
    [38, 22, 10],
    [124, 86, 46],
    [214, 172, 106],
  ],
  bevel: 0.12,
  glow: [255, 196, 92],
  glow_start: 3,
  glow_width: 4,
  mark: [236, 214, 168],
  mark_dark: [26, 16, 6],
  tile: { top: [214, 190, 146], bottom: [150, 118, 76], noise: 0.1, cell: 4 },
  tick: "cross",
  progress: [
    [190, 200, 255],
    [52, 46, 140],
  ],
});

export const CLEAN: Style = style({
  key: "b-clean",
  title: "B: Ink and brass",
  summary:
    "The stock layout and palette made flat and quiet: dark grey panels, one thin brass line, a single bright line on hover, amber for pressed and selected. No noise. Procedural.",
  font: "brawler",
  text: "#EDE6DAFF",
  title_label: "#D6CAB4FF",
  title_label_active: "#FFFFFFFF",
  accent: "#A88A58FF",
  fixed_background: "#141312FF",
  contextual: ["#141312FF", "#2A2622FF", "#A88A58FF"],
  window_body: { top: [20, 19, 18] },
  title_body: { top: [36, 33, 29], bottom: [27, 25, 22] },
  button_body: { top: [44, 40, 35], bottom: [32, 29, 26] },
  active_body: { top: [96, 72, 36], bottom: [74, 55, 27] },
  well: [12, 11, 10],
  rings: [[6, 6, 6], [146, 118, 74], null],
  bevel: 0,
  glow: [240, 204, 130],
  glow_start: 2,
  glow_width: 1,
  glow_strength: 1,
  mark: [234, 206, 150],
  mark_dark: [10, 9, 8],
  tile: null,
  tick: "check",
  progress: [
    [226, 190, 120],
    [120, 86, 40],
  ],
});

export const IRON: Style = style({
  key: "d-iron",
  title: "D: Iron",
  summary:
    "A different take: cold iron rims with a raised bevel on blue-black panels, crimson for pressed and selected, a pale blue hover glow. Procedural.",
  font: "philosopher-bold",
  text: "#E6E8ECFF",
  title_label: "#BCC4D0FF",
  title_label_active: "#FFFFFFFF",
  accent: "#8C96A6FF",
  fixed_background: "#080A0EFF",
  contextual: ["#080A0EFF", "#1C2230FF", "#8C96A6FF"],
  window_body: { top: [12, 14, 19], bottom: [6, 7, 10], noise: 0.12, cell: 28 },
  title_body: { top: [40, 44, 52], bottom: [22, 24, 30], noise: 0.08, cell: 10 },
  button_body: { top: [34, 37, 45], bottom: [18, 20, 25], noise: 0.06, cell: 6 },
  active_body: { top: [104, 32, 34], bottom: [62, 16, 18], noise: 0.2, cell: 18, octaves: 2 },
  well: [5, 6, 8],
  rings: [
    [12, 13, 16],
    [98, 104, 116],
    [178, 186, 198],
  ],
  bevel: 0.25,
  glow: [170, 205, 255],
  glow_start: 3,
  glow_width: 4,
  mark: [214, 222, 234],
  mark_dark: [10, 12, 16],
  tile: { top: [150, 158, 170], bottom: [88, 94, 106], noise: 0.08, cell: 4 },
  tick: "cross",
  progress: [
    [240, 120, 110],
    [110, 20, 24],
  ],
});

// --- the steampunk skins (2026-11-18): shortlisted as candidates, all three shipped as built-in skins ----------------

export const BRASS: Style = style({
  key: "s-brass",
  title: "S1: Brass and soot",
  summary:
    "Steampunk: soot-black brushed panels in a thin lit brass pipe with fittings at the corners, an engraved brass nameplate for the title, ember copper for pressed and selected, a furnace glow on hover. Old Standard TT Bold, Rye for headings. Procedural.",
  font: "oldstandard-bold",
  font_size: 16,
  display_font: { font: "rye", size: 24 },
  text: "#E9DDC2FF",
  title_label: "#1A1006FF",
  title_label_active: "#0E0802FF",
  accent: "#B88A44FF",
  fixed_background: "#100E0CFF",
  contextual: ["#100E0CFF", "#3A2A18FF", "#B88A44FF"],
  window_body: { top: [26, 24, 21], bottom: [14, 13, 11], noise: 0.07, cell: 8, streak: 8, grain: 0.03 },
  title_body: { top: [178, 140, 70], bottom: [122, 90, 40], noise: 0.14, cell: 4, streak: 10, octaves: 2 },
  button_body: { top: [54, 50, 44], bottom: [30, 28, 25], noise: 0.08, cell: 4, streak: 8 },
  active_body: { top: [150, 70, 30], bottom: [96, 40, 16], noise: 0.16, cell: 10, octaves: 2 },
  well: [10, 9, 8],
  rings: [
    [12, 9, 6],
    [150, 112, 52],
    [214, 176, 104],
  ],
  pipe: { color: [182, 140, 66], width: 2, inset: 1, light: 0.5, shadow: 0.6 },
  rivet: [196, 156, 82],
  glow: [255, 160, 70],
  glow_start: 3,
  glow_width: 3,
  glow_strength: 0.9,
  mark: [236, 200, 130],
  mark_dark: [20, 14, 8],
  tile: { top: [212, 174, 100], bottom: [142, 104, 48], noise: 0.08, cell: 4 },
  tick: "check",
  progress: [
    [255, 186, 104],
    [140, 56, 18],
  ],
});

export const VERDIGRIS: Style = style({
  key: "s-verdigris",
  title: "S2: Verdigris and paper",
  summary:
    "Steampunk in daylight: aged paper panels and sepia ink in a thin verdigris copper pipe with copper fittings, a patinated title plate, pale verdigris for pressed and selected, a copper glow on hover. Spectral SemiBold, Federant for headings. Procedural.",
  font: "spectral-semibold",
  font_size: 19,
  display_font: { font: "federant", size: 22 },
  text: "#2B1D12FF",
  title_label: "#EFE6D0FF",
  title_label_active: "#FFFBF0FF",
  text_hover: "#120A04FF",
  text_active: "#120A04FF",
  accent: "#9A5A32FF",
  fixed_background: "#DDCDA8FF",
  contextual: ["#E2D4B2FF", "#C6DACBFF", "#86B8A4FF"],
  window_body: { top: [228, 214, 180], bottom: [210, 192, 152], noise: 0.07, cell: 24, grain: 0.035 },
  title_body: { top: [72, 124, 106], bottom: [44, 84, 72], noise: 0.22, cell: 8, tint: [150, 96, 58], octaves: 3 },
  button_body: { top: [238, 228, 202], bottom: [214, 200, 166], noise: 0.04, cell: 10, grain: 0.03 },
  active_body: { top: [160, 204, 184], bottom: [124, 176, 156], noise: 0.12, cell: 10, octaves: 2, grain: 0.02 },
  well: [238, 230, 208],
  rings: [
    [44, 58, 50],
    [86, 140, 120],
    [150, 196, 176],
  ],
  pipe: { color: [84, 146, 124], width: 2, inset: 1, light: 0.4, shadow: 0.55 },
  rivet: [184, 104, 60],
  glow: [196, 104, 44],
  glow_start: 3,
  glow_width: 3,
  glow_strength: 0.8,
  mark: [184, 104, 60],
  mark_dark: [40, 26, 16],
  tile: { top: [206, 132, 86], bottom: [150, 84, 48], noise: 0.08, cell: 4 },
  tick: "check",
  progress: [
    [170, 220, 200],
    [44, 110, 92],
  ],
});

export const OXBLOOD: Style = style({
  key: "s-oxblood",
  title: "S3: Oxblood and rivets",
  summary:
    "Steampunk upholstery: oxblood leather panels in a bevelled brass band riveted at the corners, dark verdigris for pressed and selected, a brass glow on hover. Zilla Slab SemiBold, Cinzel Decorative for headings. Procedural.",
  font: "zillaslab-semibold",
  font_size: 18,
  display_font: { font: "cinzeldecorative-bold", size: 22 },
  text: "#F0E2C4FF",
  title_label: "#E2C384FF",
  title_label_active: "#FFE6A8FF",
  accent: "#C49A52FF",
  fixed_background: "#2A0C0EFF",
  contextual: ["#2A0C0EFF", "#4A1A1CFF", "#C49A52FF"],
  window_body: { top: [88, 26, 28], bottom: [56, 14, 16], noise: 0.12, cell: 14, grain: 0.05 },
  title_body: { top: [52, 16, 18], bottom: [34, 9, 11], noise: 0.12, cell: 6, grain: 0.05 },
  button_body: { top: [70, 32, 28], bottom: [44, 18, 16], noise: 0.08, cell: 6, grain: 0.05 },
  active_body: { top: [44, 98, 86], bottom: [24, 64, 56], noise: 0.18, cell: 10, octaves: 2 },
  well: [30, 10, 10],
  rings: [
    [26, 14, 8],
    [176, 134, 66],
    [118, 86, 38],
  ],
  bevel: 0.28,
  rivet: [214, 178, 104],
  glow: [255, 210, 120],
  glow_start: 3,
  glow_width: 3,
  glow_strength: 0.85,
  mark: [232, 200, 130],
  mark_dark: [26, 8, 8],
  tile: { top: [206, 166, 92], bottom: [140, 102, 46], noise: 0.08, cell: 4 },
  tick: "cross",
  progress: [
    [150, 220, 196],
    [24, 80, 68],
  ],
});

export const PRESETS: Style[] = [BRONZE, CLEAN, IRON, BRASS, VERDIGRIS, OXBLOOD];

/** A deep copy (for editing). */
export const cloneStyle = (s: Style): Style => JSON.parse(JSON.stringify(s)) as Style;

function body(spec: FillSpec, w: number, h: number, seed = 1): RGBAImage {
  return fill(w, h, { seed, ...spec });
}

/** Every texture of a style, in candidates.py's order. */
export function styleTextures(s: Style): Map<string, RGBAImage> {
  const t = new Map<string, RGBAImage>();
  const rings = s.rings;
  const fr = (w: number, h: number, b: RGBAImage | Col, glow = false, gs: number | null = null, studs = true) =>
    frame(w, h, b, rings, {
      bevel: s.bevel,
      pipe: s.pipe,
      rivet: studs ? s.rivet : null,
      rivetSize: s.rivet_size,
      glowColor: glow ? s.glow : null,
      glowStart: s.glow_start,
      glowWidth: s.glow_width,
      glowStrength: gs ?? s.glow_strength,
    });

  t.set("nui_windowh", fr(128, 128, body(s.window_body, 128, 128, 11)));
  if (s.title_body) t.set("nuio_title", fr(128, 32, body(s.title_body, 128, 32, 12)));
  const trackRings = rings.length > 1 ? [rings[0]!, shade(rings[1]!, -0.35)] : rings;
  const track = frame(18, 64, s.well, trackRings, { bevel: -Math.abs(s.bevel) });
  t.set("nui_windowv", track);
  t.set("nuio_trackh", rotate90(track));
  t.set("nui_button_n", fr(128, 32, body(s.button_body, 128, 32, 21)));
  t.set("nui_button_h", fr(128, 32, body(s.button_body, 128, 32, 21), true));
  t.set("nui_button_a", fr(128, 32, body(s.active_body, 128, 32, 22)));
  t.set("nui_button_ah", fr(128, 32, body(s.active_body, 128, 32, 22), true));
  t.set("nui_header", fr(128, 32, body(s.active_body, 128, 32, 23)));
  t.set("nui_button_d", s.disabled_grey ? greyLA(t.get("nui_button_n")!) : t.get("nui_button_n")!);
  t.set("nui_checkbox_n", fr(22, 22, s.well, false, null, false));
  t.set("nui_checkbox_h", fr(22, 22, s.well, true, s.glow_strength, false));
  t.set("nui_checkbox_d", greyLA(t.get("nui_checkbox_n")!));
  t.set("nui_checkbox_x", tick(s, 14));
  t.set("nui_radial_n", ring(s, 24, false));
  t.set("nui_radial_h", ring(s, 24, true));
  t.set("nui_radial_d", greyLA(t.get("nui_radial_n")!));
  t.set("nui_radial_x", dot(s, 14));
  t.set("nui_close", tile(s, 16, "close"));
  for (const d of ["up", "down", "left", "right"] as const) t.set(`nui_cnt_${d}`, tile(s, 16, d));
  t.set("nui_minimize", smallArrow(s, 16, "down"));
  t.set("nui_maximize", smallArrow(s, 16, "right"));
  t.set("nui_scrollv", thumb(s, 14, 32, true));
  t.set("nui_scrollh", thumb(s, 32, 14, false));
  t.set("nui_slider", knob(s, 12, 18));
  t.set("nui_progress", progress(s, 8, 16));
  for (const d of ["down", "left", "right", "up"] as const) t.set(`nui_shld_${d}`, boss(s, 24, d));
  return t;
}

function tick(s: Style, n: number): RGBAImage {
  return supersample(n, n, (d, k) => {
    if (s.tick === "check") {
      const pts: [number, number][] = [
        [2.5 * k, 7.5 * k],
        [5.5 * k, 10.5 * k],
        [11.5 * k, 3 * k],
      ];
      d.line(pts, rgba(s.mark_dark), Math.trunc(4.2 * k), "curve");
      d.line(pts, rgba(s.mark), Math.trunc(2.2 * k), "curve");
    } else {
      const strokes: [[number, number], [number, number]][] = [
        [
          [3, 3],
          [n - 3, n - 3],
        ],
        [
          [n - 3, 3],
          [3, n - 3],
        ],
      ];
      for (const [a, b] of strokes) d.line([[a[0] * k, a[1] * k], [b[0] * k, b[1] * k]], rgba(s.mark_dark), Math.trunc(4 * k));
      for (const [a, b] of strokes) d.line([[a[0] * k, a[1] * k], [b[0] * k, b[1] * k]], rgba(s.mark), Math.trunc(2 * k));
    }
  });
}

function ring(s: Style, n: number, hover: boolean): RGBAImage {
  const rings: (Col | null)[] = s.rings.length ? s.rings : [[0, 0, 0]];
  return supersample(n, n, (d, k) => {
    const r = n / 2 - 0.5;
    const c = n / 2;
    const box = (rr: number) => [(c - rr) * k, (c - rr) * k, (c + rr) * k, (c + rr) * k] as const;
    rings.forEach((col, i) => {
      if (col == null) return;
      const rr = r - i;
      if (s.bevel) {
        d.ellipse(box(rr), shade(col, -s.bevel));
        d.chord(box(rr), 135, 315, shade(col, s.bevel));
      } else d.ellipse(box(rr), rgba(col));
    });
    const rr = r - rings.length;
    d.ellipse(box(rr), rgba(s.well));
    if (hover) {
      for (let i = 0; i < 3; i++) d.ellipse(box(rr - i), null, rgba(s.glow, Math.trunc(230 * (1 - i / 3))), k);
    }
  });
}

function dot(s: Style, n: number): RGBAImage {
  const fillim = radialFill(n, shade(s.mark, 0.5), shade(s.mark, -0.45), n * 0.4, n * 0.38, n * 0.55);
  const mask = discMask(n, n / 2 - 2);
  const out = newImage(n, n);
  pasteMask(out, newImage(n, n, rgba(s.mark_dark)), discMask(n, n / 2 - 1));
  pasteMask(out, fillim, mask);
  return out;
}

function tile(s: Style, n: number, what: "close" | Dir): RGBAImage {
  const im = s.tile !== null ? frame(n, n, body(s.tile, n, n, 31), s.rings.slice(0, 2), { bevel: s.bevel }) : newImage(n, n);
  const ink = rgba(s.tile !== null && s.tile_icon_dark ? s.mark_dark : s.mark);
  const icon = supersample(n, n, (d, k) => {
    const c = n / 2;
    if (what === "close") {
      for (const [a, b] of [
        [
          [4.5, 4.5],
          [n - 4.5, n - 4.5],
        ],
        [
          [n - 4.5, 4.5],
          [4.5, n - 4.5],
        ],
      ] as const) {
        d.line([[a[0] * k, a[1] * k], [b[0] * k, b[1] * k]], ink, Math.trunc(1.8 * k));
      }
    } else {
      d.polygon(triangle(what, c, c, 3.6).map(([x, y]) => [x * k, y * k]), ink);
    }
  });
  alphaCompositeInPlace(im, icon);
  return im;
}

function smallArrow(s: Style, n: number, dir: Dir): RGBAImage {
  return supersample(n, n, (d, k) =>
    d.polygon(triangle(dir, n / 2, n / 2, 4.5).map(([x, y]) => [x * k, y * k]), rgba(s.mark), rgba(s.mark_dark)),
  );
}

function thumb(s: Style, w: number, h: number, vertical: boolean): RGBAImage {
  const rings: (Col | null)[] = s.rings.length ? s.rings : [[60, 60, 60]];
  const mid = (rings.length > 1 ? rings[1] : rings[0])!;
  const hi = rings.length > 2 && rings[2] != null ? rings[2] : shade(mid, 0.4);
  const across = vertical ? w : h;
  const prof = Array.from({ length: across }, (_, i) => mix(hi, shade(mid, -0.5), Math.min(1, Math.abs((i + 0.5) / across - 0.4) / 0.6)));
  const im = newImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = prof[vertical ? x : y]!;
      im.data.set(c, (y * w + x) * 4);
    }
  }
  const d = new Draw(im);
  const o = rgba(rings[0]!);
  if (vertical) {
    d.line([[0, 0], [0, h - 1]], o);
    d.line([[w - 1, 0], [w - 1, h - 1]], o);
  } else {
    d.line([[0, 0], [w - 1, 0]], o);
    d.line([[0, h - 1], [w - 1, h - 1]], o);
  }
  return im;
}

function knob(s: Style, w: number, h: number): RGBAImage {
  const rings: (Col | null)[] = s.rings.length ? s.rings : [[60, 60, 60]];
  const mid = (rings.length > 1 ? rings[1] : rings[0])!;
  return supersample(w, h, (d, k) => {
    d.roundedRectangle([0, 0, w * k - 1, h * k - 1], 3 * k, rgba(rings[0]!));
    d.roundedRectangle([k, k, (w - 1) * k - 1, (h - 1) * k - 1], 2 * k, rgba(mid));
    d.roundedRectangle([2 * k, 2 * k, (w - 2) * k - 1, (h / 2) * k], 2 * k, shade(mid, 0.35));
    d.line([[(w / 2) * k, 4 * k], [(w / 2) * k, (h - 4) * k]], rgba(s.mark_dark), k);
  });
}

function progress(s: Style, w: number, h: number): RGBAImage {
  const [light, dark] = s.progress;
  const im = newImage(w, h);
  for (let y = 0; y < h; y++) {
    const t = Math.abs((y + 0.5) / h - 0.45) / 0.55;
    const c = mix(light, dark, Math.min(1, t) ** 0.8);
    for (let x = 0; x < w; x++) im.data.set(c, (y * w + x) * 4);
  }
  return im;
}

/** A round stud with a chevron: the combo box and property arrows. */
function boss(s: Style, n: number, dir: Dir): RGBAImage {
  const rings: (Col | null)[] = s.rings.length ? s.rings : [[0, 0, 0]];
  const face: FillSpec = s.tile ?? { top: (rings.length > 1 ? rings[1] : rings[0])! };
  const faceIm = body(face, n, n, 41);
  const ink = rgba(s.tile !== null && s.tile_icon_dark ? s.mark_dark : s.mark);
  const out = newImage(n, n);
  pasteMask(out, newImage(n, n, rgba(rings[0]!)), discMask(n, n / 2 - 1));
  pasteMask(out, faceIm, discMask(n, n / 2 - 2));
  const shine = radialFill(n, [255, 255, 255, 70], [255, 255, 255, 0], n * 0.38, n * 0.32, n * 0.5);
  const shineM = newImage(n, n);
  pasteMask(shineM, shine, discMask(n, n / 2 - 2));
  alphaCompositeInPlace(out, shineM);
  const icon = supersample(n, n, (d, k) => {
    const pts = chevron(dir, n / 2, n / 2 + (dir === "down" ? 1 : dir === "up" ? -1 : 0), 5.0, 2.4);
    d.polygon(pts.map(([x, y]) => [x * k, y * k]), ink);
  });
  alphaCompositeInPlace(out, icon);
  return out;
}

/** Every key the client reads, for a procedural skin (candidates.py skin_values). */
export function styleValues(s: Style, titleTex = "nui_windowh", trackH = "nuio_trackh"): Record<string, string | number> {
  const v: Record<string, string | number> = { "text.color": s.text };
  const win = "nui_windowh";
  v["border.border_image"] = win;
  v["window.fixed_background"] = s.fixed_background;
  v["window.background"] = s.fixed_background;
  v["window.border_image"] = win;
  for (const c of ["border_color", "popup_border_color", "combo_border_color", "contextual_border_color", "menu_border_color", "group_border_color", "tooltip_border_color"]) {
    v[`window.${c}`] = "#00000000";
  }
  v["window.scaler"] = s.accent;
  v["window.padding_x"] = 0;
  v["window.padding_y"] = 0;
  v["window.scrollbar_size_x"] = 18;
  v["window.scrollbar_size_y"] = 18;
  for (const st of ["normal", "hover", "active"]) v[`window.header.${st}`] = titleTex;
  v["window.header.label_normal"] = s.title_label;
  v["window.header.label_hover"] = s.title_label;
  v["window.header.label_active"] = s.title_label_active;
  for (const [b, tex] of [
    ["close_button", "nui_close"],
    ["minimize_button", "nui_cnt_down"],
  ]) {
    for (const st of ["normal", "hover", "active"]) v[`window.header.${b}.${st}`] = tex!;
    v[`window.header.${b}.padding_x`] = 5;
    v[`window.header.${b}.padding_y`] = 5;
  }
  v.background_color = "#000000FF";
  v.color = "#F0F0F0FF";
  v.border_color = s.accent;
  v.selected_color = s.accent;
  v["chart.border"] = 1;
  for (const [sb, track, cur, dec, inc] of [
    ["scrollv", "nui_windowv", "nui_scrollv", "nui_cnt_up", "nui_cnt_down"],
    ["scrollh", trackH, "nui_scrollh", "nui_cnt_left", "nui_cnt_right"],
  ] as const) {
    for (const st of ["normal", "hover", "active"]) {
      v[`${sb}.${st}`] = track;
      v[`${sb}.cursor_${st}`] = cur;
      v[`${sb}.dec_button.${st}`] = dec;
      v[`${sb}.inc_button.${st}`] = inc;
    }
    if (sb === "scrollv") v["scrollv.border_color"] = s.accent;
    v[`${sb}.padding_x`] = 4;
    v[`${sb}.padding_y`] = 2;
  }
  for (const [sec, n, h, x] of [
    ["checkbox", "nui_checkbox_n", "nui_checkbox_h", "nui_checkbox_x"],
    ["option", "nui_radial_n", "nui_radial_h", "nui_radial_x"],
  ]) {
    v[`${sec}.normal`] = n!;
    v[`${sec}.hover`] = h!;
    v[`${sec}.active`] = h!;
    v[`${sec}.cursor_normal`] = x!;
    v[`${sec}.cursor_hover`] = x!;
  }
  v["button.normal"] = "nui_button_n";
  v["button.hover"] = "nui_button_h";
  v["button.active"] = "nui_button_a";
  v["button.text_background"] = "#F8F8F8FF";
  v["button.text_normal"] = s.text;
  // ?? for a style saved in a skin project before these keys existed.
  v["button.text_hover"] = s.text_hover ?? "#FFFFFFFF";
  v["button.text_active"] = s.text_active ?? "#FFFFFFFF";
  v["button.border"] = 0;
  [v["contextual_button.normal"], v["contextual_button.hover"], v["contextual_button.active"]] = s.contextual;
  v["contextual_button.padding_x"] = 4;
  v["contextual_button.padding_y"] = 2;
  v["tab.background"] = "nui_header";
  for (const [b, tex] of [
    ["tab_minimize_button", "nui_minimize"],
    ["tab_maximize_button", "nui_maximize"],
    ["node_minimize_button", "nui_minimize"],
    ["node_maximize_button", "nui_maximize"],
  ]) {
    for (const st of ["normal", "active", "hover"]) v[`tab.${b}.${st}`] = tex!;
  }
  for (const st of ["cursor_normal", "cursor_hover", "cursor_active"]) {
    v[`slider.${st}`] = "nui_slider";
    v[`progress.${st}`] = "nui_progress";
  }
  v["slider.bar_filled"] = s.accent;
  v["selectable.normal"] = "nui_button_n";
  v["selectable.hover"] = "nui_button_h";
  v["selectable.pressed"] = "nui_button_a";
  v["selectable.normal_active"] = "nui_button_a";
  v["selectable.hover_active"] = "nui_button_ah";
  v["selectable.pressed_active"] = "nui_button_ah";
  v["selectable.padding_x"] = 10;
  v["selectable.padding_y"] = 0;
  v["progress.normal"] = "nui_button_n";
  v["progress.hover"] = "nui_button_h";
  v["progress.active"] = "nui_button_h";
  for (const st of ["normal", "active", "hover"]) {
    v[`property.${st}`] = s.fixed_background;
    v[`property.edit.${st}`] = s.fixed_background;
    v[`property.dec_button.${st}`] = "nui_shld_left";
    v[`property.inc_button.${st}`] = "nui_shld_right";
  }
  v["combo.normal"] = "nui_button_n";
  v["combo.hover"] = "nui_button_h";
  v["combo.active"] = "nui_button_a";
  v["combo.content_padding_x"] = 10;
  v["combo.content_padding_y"] = 0;
  for (const st of ["normal", "active", "hover"]) v[`combo.button.${st}`] = "nui_shld_down";
  for (const st of ["normal", "hover", "active"]) v[`edit.${st}`] = win;
  v["edit.border_color"] = s.accent;
  v["edit.text_normal"] = s.text;
  v["edit.padding_x"] = 10;
  v["edit.padding_y"] = 0;
  return v;
}

export { SS };
