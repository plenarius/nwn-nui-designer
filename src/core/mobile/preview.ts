/**
 * The mobile preview's side of the renderer: what a point-based client changes in the drawing besides the JSON
 * (transform.ts), and the renderer's results mapped back to the window the editor holds.
 */
import { windowPosition } from "../model/window.js";
import type { RenderClient, Renderer } from "../render/render.js";
import type { ClientProfile } from "./client.js";
import type { PointWindow } from "./transform.js";

/** The client's refusal, as the device shows it (NUI-MOBILE-021, NUI-LAYOUT-001). */
export const REFUSAL = "Error constructing window from json: The constraint can not be satisfied";

/**
 * The renderer's client for a point-based profile:
 *
 * - the window position is in points, multiplied by the position factor fp = d / s (NUI-MOBILE-026); -1, -2 and -3
 *   are worked out as on the desktop and then multiplied too, which puts the window past the screen's edge, where the client clamps it into
 *   the bottom-right corner (NUI-MOBILE-027, T64). Every position is clamped into the screen;
 * - a list's inset, fixed in screen pixels (NUI-MOBILE-033), and its row spacing, multiplied by d (NUI-MOBILE-022);
 * - the frame's extra width and height (NUI-MOBILE-030, the K / s^2 fit; the 6 units of slack are the author's, not
 *   the client's, so they are not taken here).
 */
export function clientRender(p: ClientProfile): RenderClient {
  return {
    position: (v, size, screen) => Math.min(Math.max(0, screen - size), Math.max(0, windowPosition(v, size, screen) * p.fp)),
    listInset: p.listInset,
    rowSpacing: p.rowSpacing,
    frameExtra: p.frameExtra,
  };
}

/**
 * The renderer's outlines and problems after a point-based draw, made to name the editor's elements (the window it
 * holds, not the copy that was drawn), and the client's refusal said as the device says it.
 */
export function pointProblems(rend: Renderer, pw: PointWindow, p: ClientProfile): void {
  for (const o of rend.outlines) o.elem = pw.original.get(o.elem) ?? o.elem;
  const where = `${p.title} at UI scale ${p.s}`;
  rend.problems = rend.problems.map((x) => {
    const elem = x.elem ? (pw.original.get(x.elem) ?? x.elem) : undefined;
    const text = /unsolvable/.test(x.kind) ? `${where} refuses the window ("${REFUSAL}", NUI-MOBILE-021): ${x.text}` : x.text;
    return { ...x, text, ...(elem ? { elem } : {}) };
  });
}
