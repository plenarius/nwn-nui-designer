/**
 * Where a drop on the canvas lands: the innermost row, column, group or list under the pointer, and the place among
 * its children nearest the pointer (along a row, a list's template, or down a column). Pure geometry over the
 * renderer's outlines, so the canvas, the tests and anything else agree.
 */
import type { Rect } from "../layout/layout.js";
import type { JsonObject } from "../model/types.js";
import { type DropTarget, type ElemPath, containerKind, getElem, isPrefix, kidsOf, moveRefusal, refusal, typeOf } from "./tree.js";

export interface Placed {
  path: ElemPath;
  rect: Rect;
}

export interface DropHit {
  target: DropTarget;
  /** Where to draw the insertion mark: a line (w or h of 0... 2 px) or the container's inside when it is empty. */
  mark: Rect;
  /** The container's rect. */
  box: Rect;
  /** Why it cannot go there, if it cannot. */
  refused: string | null;
}

/**
 * Each element's first drawn rect by path (list rows draw their template many times; the first row stands for them).
 * visible: only elements the client draws.
 */
export function placements(outlines: { rect: Rect; elem: JsonObject; visible: boolean }[], pathOf: Map<JsonObject, ElemPath>): Map<string, Placed> {
  const out = new Map<string, Placed>();
  for (const o of outlines) {
    const p = pathOf.get(o.elem);
    if (!p) continue;
    const k = p.join("/");
    if (!out.has(k)) out.set(k, { path: p, rect: o.rect });
  }
  return out;
}

const inside = (r: Rect, x: number, y: number) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];

/**
 * The drop at (x, y). moving: the element being dragged (it and its children are not targets; refusals are a move's),
 * or null for a new element (refusals for adding `adding`).
 */
export function dropAt(win: JsonObject, placed: Map<string, Placed>, x: number, y: number, moving: ElemPath | null, adding: JsonObject | null): DropHit | null {
  let best: Placed | null = null;
  for (const p of placed.values()) {
    const e = getElem(win, p.path);
    if (!e || !containerKind(e)) continue;
    if (moving && isPrefix(moving, p.path)) continue;
    if (!inside(p.rect, x, y)) continue;
    if (!best || p.path.length > best.path.length || (p.path.length === best.path.length && p.rect[2] * p.rect[3] < best.rect[2] * best.rect[3])) best = p;
  }
  if (!best) {
    const root = placed.get("");
    if (!root || !containerKind(win.root as JsonObject)) return null;
    best = root;
  }
  const hit = (c: Placed): DropHit => {
    const e = getElem(win, c.path)!;
    const kids = kidsOf(e);
    const vertical = typeOf(e) === "col" || typeOf(e) === "group";
    const rects = kids.map((_, i) => placed.get([...c.path, i].join("/"))?.rect ?? null);
    let index = 0;
    for (let i = 0; i < kids.length; i++) {
      const r = rects[i];
      if (!r) continue;
      const mid = vertical ? r[1] + r[3] / 2 : r[0] + r[2] / 2;
      if ((vertical ? y : x) > mid) index = i + 1;
    }
    let mark: Rect;
    const [bx, by, bw, bh] = c.rect;
    if (!kids.length || rects.every((r) => !r)) mark = [bx + 2, by + 2, Math.max(0, bw - 4), Math.max(0, bh - 4)];
    else {
      const before = index > 0 ? rects[index - 1] : null;
      const after = index < kids.length ? rects[index] : null;
      if (vertical) {
        const yy = before && after ? (before[1] + before[3] + after[1]) / 2 : after ? after[1] - 2 : before![1] + before![3] + 2;
        const ref = (after ?? before)!;
        mark = [ref[0], yy - 1, ref[2], 2];
      } else {
        const xx = before && after ? (before[0] + before[2] + after[0]) / 2 : after ? after[0] - 2 : before![0] + before![2] + 2;
        const ref = (after ?? before)!;
        mark = [xx - 1, ref[1], 2, ref[3]];
      }
    }
    const target: DropTarget = { parent: c.path, index };
    const refused = moving ? moveRefusal(win, moving, target) : adding ? refusal(e, adding) : null;
    return { target, mark, box: c.rect, refused };
  };
  let h = hit(best);
  // A full group (or a refused container): try beside it, in its parent.
  if (h.refused && best.path.length) {
    const parentPath = best.path.slice(0, -1);
    const parent = placed.get(parentPath.join("/"));
    if (parent) {
      const alt = hit(parent);
      if (!alt.refused) h = alt;
    }
  }
  return h;
}

/** The element under (x, y): the smallest drawn rect that holds the point. */
export function elementAt(outlines: { rect: Rect; elem: JsonObject; visible: boolean }[], pathOf: Map<JsonObject, ElemPath>, x: number, y: number): ElemPath | null {
  let best: { path: ElemPath; area: number } | null = null;
  for (const o of outlines) {
    if (!o.visible || !inside(o.rect, x, y)) continue;
    const p = pathOf.get(o.elem);
    if (!p) continue;
    const area = o.rect[2] * o.rect[3];
    if (!best || area < best.area || (area === best.area && p.length > best.path.length)) best = { path: p, area };
  }
  return best?.path ?? null;
}
