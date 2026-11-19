/**
 * The tree edits on several selected elements at once, each one undo step: delete, duplicate, move up / down, and a
 * property set on all of them. What works on one element works here on each of the selection's outermost elements (a
 * selected container takes its selected content along); what cannot (the root, siblings of different parents moved
 * as a block) is refused with the reason.
 */
import type { JsonValue } from "../model/types.js";
import type { ArrangeResult } from "./arrange.js";
import type { EditorDoc } from "./project.js";
import { type ElemPath, EditError, duplicateElem, getElem, isPrefix, kidsOf, moveElem, parentPath, pathIndex, removeElem, samePath, setProp } from "./tree.js";
import { type Selection, commonParent, compareTree, outermostOf } from "./selection.js";

/** Why the selection cannot be deleted (or duplicated), or null. */
export function removeRefusal(s: Selection): string | null {
  if (!s.length) return "Nothing is selected.";
  if (s.some((p) => !p.length)) return "The window's main row or column can't be deleted or duplicated: a window needs one. Take it out of the selection.";
  return null;
}

/** p after the elements at removed (paths as before) are gone; null when p was one of them or inside one. */
function afterRemoval(p: ElemPath, removed: ElemPath[]): ElemPath | null {
  const out = p.slice();
  for (const r of removed) {
    if (isPrefix(r, p)) return null;
    const d = r.length - 1;
    if (d < p.length && isPrefix(parentPath(r), p) && r[d]! < p[d]!) out[d]!--;
  }
  return out;
}

/** Deletes every selected element; the selection becomes the key's parent (or what follows it). */
export function deleteMany(doc: EditorDoc, s: Selection): ArrangeResult {
  const why = removeRefusal(s);
  if (why) throw new EditError(why);
  const gone = outermostOf(s).sort(compareTree);
  let win = doc.window;
  // Last first: removing it does not move the ones before it.
  for (const p of [...gone].reverse()) win = removeElem(win, p).win;
  // What takes the key's place: the next sibling of the removed element the key was (or was in), else its parent.
  const g0 = gone.find((g) => isPrefix(g, s[0]!))!;
  const parent = afterRemoval(parentPath(g0), gone) ?? [];
  const n = kidsOf(getElem(win, parent)).length;
  const i = g0[g0.length - 1]!;
  const before = gone.filter((g) => samePath(parentPath(g), parentPath(g0)) && g[g.length - 1]! < i).length;
  const at = Math.min(i - before, n - 1);
  return { doc: { ...doc, window: win }, selectMany: n ? [[...parent, at]] : [parent] };
}

/** Duplicates every selected element right after itself; the copies become the selection (in the same order). */
export function duplicateMany(doc: EditorDoc, s: Selection): ArrangeResult {
  const why = removeRefusal(s);
  if (why) throw new EditError(why);
  const outer = outermostOf(s);
  let win = doc.window;
  const copies = new Map<string, unknown>();
  // Last first, so the paths of the ones still to copy do not move.
  for (const p of [...outer].sort(compareTree).reverse()) {
    const r = duplicateElem(win, p);
    win = r.win;
    copies.set(p.join("/"), getElem(win, r.path));
  }
  const index = pathIndex(win);
  const selectMany = outer.map((p) => index.get(copies.get(p.join("/")) as never)).filter((p): p is ElemPath => !!p);
  return { doc: { ...doc, window: win }, selectMany };
}

/** Why the selection cannot move one place up (d -1) or down (1) among its siblings, or null. */
export function nudgeRefusal(doc: EditorDoc, s: Selection, d: -1 | 1): string | null {
  if (!s.length) return "Nothing is selected.";
  if (s.some((p) => !p.length)) return "The window's main row or column can't be moved.";
  const parent = commonParent(s);
  if (!parent) return "Only elements in the same row or column can move up or down together. Select them from one row or column.";
  const idx = s.map((p) => p[p.length - 1]!);
  const n = kidsOf(getElem(doc.window, parent)).length;
  if (d < 0 ? Math.min(...idx) === 0 : Math.max(...idx) === n - 1) return d < 0 ? "One of them is already at the top." : "One of them is already at the bottom.";
  return null;
}

/** Moves every selected element (siblings) one place up or down, keeping their order; one step. */
export function nudgeMany(doc: EditorDoc, s: Selection, d: -1 | 1): ArrangeResult | null {
  const why = nudgeRefusal(doc, s, d);
  if (why) {
    if (s.length === 1) return null;
    throw new EditError(why);
  }
  const parent = commonParent(s)!;
  const idx = s.map((p) => p[p.length - 1]!);
  let win = doc.window;
  // Up: from the first; down: from the last, so each moves past a sibling that is not selected (or already moved).
  const order = [...idx].sort((x, y) => (d < 0 ? x - y : y - x));
  for (const i of order) win = moveElem(win, [...parent, i], { parent, index: d < 0 ? i - 1 : i + 2 }).win;
  return { doc: { ...doc, window: win }, selectMany: idx.map((i) => [...parent, i + d]) };
}

/** Sets (undefined: removes) key on every selected element, as one step. */
export function setValueMany(doc: EditorDoc, s: Selection, key: string, value: JsonValue | undefined): EditorDoc {
  let win = doc.window;
  for (const p of s) win = setProp(win, p, key, value);
  return { ...doc, window: win };
}
