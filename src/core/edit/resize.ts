/**
 * Sizes set on the canvas: the size math behind the resize handles and Alt+Arrow keys, and the edits they make. A
 * dragged or stepped size writes the same `width` / `height` the properties panel writes (an element), or the
 * window's `geometry` w / h (its sample, when geometry is bound). Sizes snap to a grid step; impossible sizes are not
 * prevented here (the problems list reports them, as for typed sizes).
 */
import { type JsonObject, type JsonValue, isObject } from "../model/types.js";
import { NuiRect } from "../model/nui.js";
import { getValue, setSample, setValue } from "./ops.js";
import type { EditorDoc } from "./project.js";
import type { ElemPath } from "./tree.js";

/** The grid steps the toolbar offers, in layout units (px at UI scale 1). */
export const GRID_STEPS = [2, 4, 8] as const;
export const DEFAULT_GRID = 4;

/** A size change: either axis may be left out (unchanged). null clears the size (the element's "auto"). */
export interface SizeChange {
  w?: number | null;
  h?: number | null;
}

/**
 * Snaps a size: to the nearest multiple of step, or to whole pixels when free (Shift held). Never below one step (one
 * pixel when free): a size of 0 or less is no size NUI can draw.
 */
export function snapSize(v: number, step: number, free = false): number {
  const s = free || !(step > 0) ? 1 : step;
  return Math.max(s, Math.round(v / s) * s);
}

/**
 * The size after dragging an edge: start plus the pointer's travel in screen pixels, turned into layout units
 * (pxPerUnit is the canvas's UI scale times its zoom), then snapped. factor 2 for a window whose drawing is centred on
 * the screen: its edge moves half as far as its size changes, so the edge stays under the pointer.
 */
export function dragSize(start: number, travel: number, pxPerUnit: number, step: number, free = false, factor = 1): number {
  const k = pxPerUnit > 0 ? pxPerUnit : 1;
  return snapSize(start + (travel / k) * factor, step, free);
}

/**
 * One key press: to the next grid line up (dir 1) or down (dir -1), so an off-grid size lands on the grid first; one
 * pixel when free. Never below one step (one pixel when free).
 */
export function stepSize(cur: number, dir: 1 | -1, step: number, free = false): number {
  const s = free || !(step > 0) ? 1 : step;
  const eps = 1e-9;
  const next = dir > 0 ? Math.floor(cur / s + eps) * s + s : Math.ceil(cur / s - eps) * s - s;
  return Math.max(s, next);
}

/** A size property's number, or null (not set, bound, or not a number). */
function num(v: JsonValue | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Where a drag or key starts: the element's own width / height when set, else what was drawn. */
export function elementSize(elem: JsonObject, drawn: [number, number]): [number, number] {
  return [num(elem.width) ?? drawn[0], num(elem.height) ?? drawn[1]];
}

/** Sets (null: clears) an element's width and height, as the properties panel does. */
export function resizeElement(doc: EditorDoc, path: ElemPath, c: SizeChange): EditorDoc {
  let d = doc;
  if (c.w !== undefined) d = setValue(d, { path }, "width", c.w === null ? undefined : c.w);
  if (c.h !== undefined) d = setValue(d, { path }, "height", c.h === null ? undefined : c.h);
  return d;
}

/** The window's geometry as drawn: its static value, or its bind's sample; null when there is none to resize. */
function geometry(doc: EditorDoc): { rect: JsonObject | null; bind: string | null } {
  const g = getValue(doc, { path: null }, "geometry");
  if (isObject(g) && typeof g.bind === "string") {
    const s = doc.binds[g.bind];
    return { rect: isObject(s) ? s : null, bind: g.bind };
  }
  return { rect: isObject(g) ? g : null, bind: null };
}

/** The window's size, as the renderer reads it (400 x 300 without geometry). */
export function windowSize(doc: EditorDoc): [number, number] {
  const { rect } = geometry(doc);
  return [num(rect?.w) ?? 400, num(rect?.h) ?? 300];
}

/** Sets the window's geometry w / h (the bind's sample when geometry is bound); null means no change. */
export function resizeWindow(doc: EditorDoc, c: SizeChange): EditorDoc {
  const { rect, bind } = geometry(doc);
  const base = rect ?? NuiRect(-1, -1, 400, 300);
  const next: JsonObject = { ...base };
  if (typeof c.w === "number") next.w = c.w;
  if (typeof c.h === "number") next.h = c.h;
  if (next.w === base.w && next.h === base.h && rect) return doc;
  return bind ? setSample(doc, bind, next) : setValue(doc, { path: null }, "geometry", next);
}
