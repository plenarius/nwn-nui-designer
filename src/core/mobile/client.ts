/**
 * The clients a window can be previewed and checked for: the desktop, iOS (a point-based client) and Android, with
 * the numbers the nwn-nui-spec measured on them (https://github.com/plenarius/nwn-nui-spec, spec/mobile.md and
 * tables/mobile.yaml, build 89.8193.37-17). Rule ids (NUI-MOBILE-0xx) are cited where each number is used.
 *
 * iOS applies two factors, in GUI units: the window's position is in points, multiplied by fp = d / s
 * (NUI-MOBILE-026); margins, list row heights and row spacing, template cell widths and draw-list coordinates are
 * multiplied by fd = d alone, whatever the GUI scale (NUI-MOBILE-020 to -025; measured on an iPhone at s = 1.0 and
 * 1.6: a draw rect sent 32 / 1.875 high drew 17.07 x 3 units, and nui_touch.nss's division by d gives the desktop
 * size back at both scales). At s = 1.0 the two factors are equal.
 *
 * The numbers come from one iPhone (density 3, GUI scales 1.0 and 1.6) and one Android tablet. Density 2 (older or
 * smaller iPhones and iPads) was not measured: its multipliers follow the same rule, and its pixel-fixed extras (the
 * frame, the list inset) and the narrowest cell are scaled from the density-3 numbers, an assumption marked as such
 * in docs/MOBILE.md.
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
  /** A list cell is never drawn narrower than about this many screen pixels on iOS at s = 1.0 (NUI-MOBILE-024, T61):
   * 11 GUI units, taken to be in the cells' own space (multiplied by d, like the widths), so at any GUI scale. */
  minCellPx: 11,
  /** Fixed template cells narrower than this (GUI units) are thin: multiplied by d = 3 they reach the 11 minimum. */
  thinCell: 4,
  /** The desktop list row spacing (NUI-LIST-003); iOS multiplies it by d (NUI-MOBILE-022). */
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
  /** The position factor fp = d / s: what the window's position is multiplied by (NUI-MOBILE-026). 1 on desktop-like
   * clients. */
  fp: number;
  /** The size factor fd = d: what margins, row heights, row spacing, cell widths and draw-list coordinates are
   * multiplied by, whatever the GUI scale (NUI-MOBILE-020 to -025). 1 on desktop-like clients. */
  fd: number;
  /** iOS: the window is built with fp and fd. Desktop and Android are not (desktop-like). */
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
  if (entry.d === null) {
    return { kind: entry.kind, title: entry.title, s, d, fp: 1, fd: 1, pointBased: false, minCell: 0, listInset: MOBILE.listInset, rowSpacing: MOBILE.rowSpacing, frameExtra: [0, 0] };
  }
  // The pixel-fixed extras were measured at d = 3; at another density they are scaled by (d - 1) / 2 (assumed).
  const k = (d - 1) / (MOBILE.measuredDensity - 1);
  const insetPx = MOBILE.listInset + (MOBILE.listInsetPxIos - MOBILE.listInset) * k;
  return {
    kind: entry.kind,
    title: entry.title,
    s,
    d,
    fp: d / s,
    fd: d,
    pointBased: true,
    // In the cells' space (multiplied by d like their widths): 11 at density 3 whatever the scale (assumed, T61).
    minCell: (MOBILE.minCellPx * d) / MOBILE.measuredDensity,
    // Fixed in screen pixels: 14 / s (NUI-MOBILE-033, measured at both scales).
    listInset: insetPx / s,
    rowSpacing: MOBILE.rowSpacing * d,
    frameExtra: [(MOBILE.frameK.w * k) / (s * s), (MOBILE.frameK.h * k) / (s * s)],
  };
}

/** Whether a client changes nothing in the layout or the drawing (the desktop path is taken unchanged). */
export function drawsAsDesktop(p: ClientProfile | null | undefined): boolean {
  return !p || !p.pointBased;
}
