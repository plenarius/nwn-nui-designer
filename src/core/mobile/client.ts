/**
 * The clients a window can be previewed and checked for: the desktop, iOS (a point-based client) and Android, with
 * the numbers the nwn-nui-spec measured on them (https://github.com/plenarius/nwn-nui-spec, spec/mobile.md and
 * tables/mobile.yaml, build 89.8193.37-17). Rule ids (NUI-MOBILE-0xx) are cited where each number is used.
 *
 * The numbers come from one iPhone (density 3, GUI scales 1.0 and 1.6) and one Android tablet. Density 2 (older or
 * smaller iPhones and iPads) was not measured: its multipliers follow the rule f = d / s (NUI-MOBILE-020), and its
 * pixel-fixed extras (the frame and the list inset) are scaled by (d - 1) / 2 from the density-3 numbers, an
 * assumption marked as such in docs/MOBILE.md.
 */

/** A client the toolbar offers. */
export type ClientKind = "desktop" | "ios2" | "ios3" | "android";

export const CLIENT_KINDS: readonly { kind: ClientKind; title: string; short: string; d: number | null }[] = [
  { kind: "desktop", title: "Desktop", short: "Desktop", d: null },
  { kind: "ios2", title: "iOS (density 2)", short: "iOS \u00d72", d: 2 },
  { kind: "ios3", title: "iOS (density 3)", short: "iOS \u00d73", d: 3 },
  { kind: "android", title: "Android", short: "Android", d: null },
];

/** The spec's measured numbers (tables/mobile.yaml), in one place. */
export const MOBILE = {
  /** The density the iOS numbers were measured at (an iPhone). */
  measuredDensity: 3,
  /** A client whose f is within this of 1 is desktop-like (NUI-MOBILE-012: allow for rounding). */
  fTolerance: 0.03,
  /** A list cell is never drawn narrower than about this many screen pixels on iOS (NUI-MOBILE-024, T61). */
  minCellPx: 11,
  /** Fixed template cells narrower than this (GUI units) are thin: at f = 3 they reach the 11 px minimum. */
  thinCell: 4,
  /** The desktop list row spacing (NUI-LIST-003); iOS multiplies it by f (NUI-MOBILE-022). */
  rowSpacing: 4,
  /** The desktop list inset (NUI-LIST-002), and iOS's in screen pixels at density 3 (NUI-MOBILE-033, T68). */
  listInset: 4,
  listInsetPxIos: 14,
  /** The iOS frame's extra over the desktop's, K / s^2 GUI units at density 3 (NUI-MOBILE-030, a fit), plus slack. */
  frameK: { w: 32, h: 66 },
  frameSlack: 6,
  /** The density probe's window: x = y = 20000, 300 x 150 (NUI-MOBILE-010). */
  probe: { x: 20000, y: 20000, w: 300, h: 150 },
} as const;

/** What a client does to a window, at one GUI scale. */
export interface ClientProfile {
  kind: ClientKind;
  title: string;
  /** The GUI scale s (gui_scale / 100; 0 or missing counts as 1, NUI-MOBILE-040). */
  s: number;
  /** The density d (NUI-MOBILE-011): s on desktop-like clients, the screen's pixels per point on iOS. */
  d: number;
  /** f = d / s (NUI-MOBILE-020): 1 on desktop-like clients. */
  f: number;
  /** f > 1: margins, row heights, cell widths, draw coordinates and the window position are multiplied by f. */
  pointBased: boolean;
  /** The narrowest a list cell is drawn, in GUI units (NUI-MOBILE-024). */
  minCell: number;
  /** A bordered list's inset on each side, in GUI units (NUI-LIST-002, NUI-MOBILE-033). */
  listInset: number;
  /** The space between list rows, in GUI units (NUI-LIST-003, NUI-MOBILE-022). */
  rowSpacing: number;
  /** How much more the frame takes than the desktop's 16 x 49, in GUI units (NUI-MOBILE-030), slack not included. */
  frameExtra: [w: number, h: number];
}

/** The scale the client works with: 0, a missing or a nonsense scale count as 1 (NUI-MOBILE-040). */
export function guiScale(s: number | null | undefined): number {
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 1;
}

/** A client at a GUI scale. */
export function clientProfile(kind: ClientKind, scale = 1): ClientProfile {
  const entry = CLIENT_KINDS.find((c) => c.kind === kind) ?? CLIENT_KINDS[0]!;
  const s = guiScale(scale);
  const d = entry.d ?? s;
  const f = d / s;
  const pointBased = f > 1 + MOBILE.fTolerance;
  if (!pointBased) {
    return { kind: entry.kind, title: entry.title, s, d, f: 1, pointBased: false, minCell: 0, listInset: MOBILE.listInset, rowSpacing: MOBILE.rowSpacing, frameExtra: [0, 0] };
  }
  // The pixel-fixed extras were measured at d = 3; at another density they are scaled by (d - 1) / 2 (assumed).
  const k = (d - 1) / (MOBILE.measuredDensity - 1);
  const insetPx = MOBILE.listInset + (MOBILE.listInsetPxIos - MOBILE.listInset) * k;
  return {
    kind: entry.kind,
    title: entry.title,
    s,
    d,
    f,
    pointBased: true,
    minCell: MOBILE.minCellPx / s,
    listInset: insetPx / s,
    rowSpacing: MOBILE.rowSpacing * f,
    frameExtra: [(MOBILE.frameK.w * k) / (s * s), (MOBILE.frameK.h * k) / (s * s)],
  };
}

/** Whether a client changes nothing in the layout or the drawing (the desktop path is taken unchanged). */
export function drawsAsDesktop(p: ClientProfile | null | undefined): boolean {
  return !p || !p.pointBased;
}
