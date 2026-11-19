/**
 * The element tree of a window, and every edit the editor makes to it, as pure functions over the window's JSON.
 *
 * An element is addressed by its path: the indices of its ancestors' child slots from the window's root, [] being
 * the root itself. A row's or column's children are its "children" array; a group's is the same (NuiGroup makes an
 * array of one); a list's are the elements of its row template cells (row_template[i][0]). Edits return a new window
 * (immutable updates: the history keeps the old ones) and never touch keys they do not know, so anything the editor
 * does not understand survives.
 */
import { type JsonObject, type JsonValue, isObject } from "../model/types.js";

export type ElemPath = readonly number[];

export type ContainerKind = "span" | "group" | "list";

/** The most cells a list's row template may have (nw_inc_nui.nss: "max: 16"). */
export const MAX_TEMPLATE_CELLS = 16;

export class EditError extends Error {}

export function typeOf(e: JsonValue | undefined): string {
  return isObject(e) && typeof e.type === "string" ? e.type : "";
}

export function containerKind(e: JsonValue | undefined): ContainerKind | null {
  const t = typeOf(e);
  if (t === "row" || t === "col") return "span";
  if (t === "group") return "group";
  if (t === "list") return "list";
  return null;
}

/** The element's children (the elements of a list's template cells), or [] for a widget. */
export function kidsOf(e: JsonValue | undefined): JsonObject[] {
  if (!isObject(e)) return [];
  const k = containerKind(e);
  if (k === "span" || k === "group") return Array.isArray(e.children) ? e.children.filter(isObject) : [];
  if (k === "list") {
    const tpl = e.row_template;
    if (!Array.isArray(tpl)) return [];
    return tpl.map((c) => (Array.isArray(c) && isObject(c[0]) ? c[0] : null)).filter((x): x is JsonObject => x !== null);
  }
  return [];
}

/** A list cell's width and whether it grows: [elem, width, variable]. */
export interface CellInfo {
  width: number;
  variable: boolean;
}

export function cellOf(list: JsonObject, i: number): CellInfo | null {
  const tpl = list.row_template;
  if (!Array.isArray(tpl)) return null;
  const c = tpl[i];
  if (!Array.isArray(c)) return null;
  return { width: typeof c[1] === "number" ? c[1] : 0, variable: c[2] === true };
}

/** A new template cell for elem: auto width (0), variable, as nw_inc_nui's NuiListTemplateCell(e, 0.0, TRUE). */
export const DEFAULT_CELL: CellInfo = { width: 0, variable: true };

function withKids(e: JsonObject, kids: JsonObject[], cells?: (CellInfo | null)[]): JsonObject {
  const k = containerKind(e);
  if (k === "list") {
    const old = Array.isArray(e.row_template) ? e.row_template : [];
    const tpl: JsonValue[] = kids.map((c, i) => {
      const info = cells?.[i] ?? null;
      if (info) return [c, info.width, info.variable];
      const prev = old.find((x) => Array.isArray(x) && x[0] === c);
      if (Array.isArray(prev)) return [c, prev[1] ?? 0, prev[2] ?? true];
      return [c, DEFAULT_CELL.width, DEFAULT_CELL.variable];
    });
    return { ...e, row_template: tpl };
  }
  return { ...e, children: kids };
}

export function getElem(win: JsonObject, path: ElemPath): JsonObject | null {
  let e: JsonValue | undefined = win.root;
  for (const i of path) {
    if (!isObject(e)) return null;
    e = kidsOf(e)[i];
  }
  return isObject(e) ? e : null;
}

/** Replaces the element at path with fn(element). */
export function updateElem(win: JsonObject, path: ElemPath, fn: (e: JsonObject) => JsonObject): JsonObject {
  const rec = (e: JsonObject, rest: ElemPath): JsonObject => {
    if (!rest.length) return fn(e);
    const kids = kidsOf(e);
    const i = rest[0]!;
    const c = kids[i];
    if (!c) throw new EditError(`no element at index ${i}`);
    const cells = containerKind(e) === "list" ? kids.map((_, j) => cellOf(e, j)) : undefined;
    const next = kids.slice();
    next[i] = rec(c, rest.slice(1));
    return withKids(e, next, cells);
  };
  if (!isObject(win.root)) throw new EditError("the window has no root");
  return { ...win, root: rec(win.root, path) };
}

export function parentPath(path: ElemPath): ElemPath {
  return path.slice(0, -1);
}

export function samePath(a: ElemPath | null | undefined, b: ElemPath | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** a is b or an ancestor of b. */
export function isPrefix(a: ElemPath, b: ElemPath): boolean {
  return a.length <= b.length && a.every((x, i) => x === b[i]);
}

/** Why parent cannot take child as one more child, or null if it can. */
export function refusal(parent: JsonObject, child: JsonObject, existing = kidsOf(parent).length): string | null {
  const k = containerKind(parent);
  const ct = typeOf(child);
  if (!k) return `a ${typeOf(parent) || "widget"} has no children: only rows, columns and groups do, and lists take a row template`;
  if (k === "group" && existing >= 1) return "a group holds one child (NuiGroup): wrap its child in a row or column first";
  if (k === "list") {
    if (existing >= MAX_TEMPLATE_CELLS) return `a list's row template has at most ${MAX_TEMPLATE_CELLS} cells`;
    if (ct === "list") return "a list cannot hold a list";
  }
  return null;
}

/** Inserts elem as child index of the element at parent; returns the new window and the element's path. */
export function insertElem(win: JsonObject, parent: ElemPath, index: number, elem: JsonObject, cell?: CellInfo): { win: JsonObject; path: ElemPath } {
  const p = getElem(win, parent);
  if (!p) throw new EditError("no such parent");
  const why = refusal(p, elem);
  if (why) throw new EditError(why);
  const kids = kidsOf(p);
  const at = Math.max(0, Math.min(index, kids.length));
  const out = updateElem(win, parent, (e) => {
    const cells = containerKind(e) === "list" ? kids.map((_, j) => cellOf(e, j)) : undefined;
    const next = kids.slice();
    next.splice(at, 0, elem);
    cells?.splice(at, 0, cell ?? DEFAULT_CELL);
    return withKids(e, next, cells);
  });
  return { win: out, path: [...parent, at] };
}

/** Removes the element at path (not the root). */
export function removeElem(win: JsonObject, path: ElemPath): { win: JsonObject; removed: JsonObject; cell: CellInfo | null } {
  if (!path.length) throw new EditError("the root cannot be deleted: a window needs a row, column or group");
  const parent = parentPath(path);
  const i = path[path.length - 1]!;
  const p = getElem(win, parent);
  const removed = getElem(win, path);
  if (!p || !removed) throw new EditError("no such element");
  const cell = containerKind(p) === "list" ? cellOf(p, i) : null;
  const out = updateElem(win, parent, (e) => {
    const kids = kidsOf(e);
    const cells = containerKind(e) === "list" ? kids.map((_, j) => cellOf(e, j)) : undefined;
    const next = kids.slice();
    next.splice(i, 1);
    cells?.splice(i, 1);
    return withKids(e, next, cells);
  });
  return { win: out, removed, cell };
}

/** Where a move lands: the parent's path and the index in it, as they are before the move. */
export interface DropTarget {
  parent: ElemPath;
  index: number;
}

/** Moves the element at from to target (indices as before the move). Returns the element's new path. */
export function moveElem(win: JsonObject, from: ElemPath, target: DropTarget): { win: JsonObject; path: ElemPath } {
  if (!from.length) throw new EditError("the root cannot be moved");
  if (isPrefix(from, target.parent)) throw new EditError("an element cannot be moved into itself");
  const elem = getElem(win, from);
  const dest = getElem(win, target.parent);
  if (!elem || !dest) throw new EditError("no such element");
  const sameParent = samePath(parentPath(from), target.parent);
  const fromIndex = from[from.length - 1]!;
  if (!sameParent) {
    const why = refusal(dest, elem);
    if (why) throw new EditError(why);
  }
  const { win: w1, cell } = removeElem(win, from);
  // The target's path, and its index, as they are once the element is gone.
  const parent = target.parent.slice();
  const depth = from.length - 1;
  if (parent.length > depth && isPrefix(parentPath(from), parent.slice(0, depth)) && parent[depth]! > fromIndex) parent[depth]!--;
  let index = target.index;
  if (sameParent && fromIndex < index) index--;
  return insertElem(w1, parent, index, elem, sameParent || containerKind(dest) === "list" ? (cell ?? undefined) : undefined);
}

/** Can elem at from be dropped at target? null if so, else why not. */
export function moveRefusal(win: JsonObject, from: ElemPath, target: DropTarget): string | null {
  if (!from.length) return "the root cannot be moved";
  if (isPrefix(from, target.parent)) return "an element cannot be moved into itself";
  const elem = getElem(win, from);
  const dest = getElem(win, target.parent);
  if (!elem || !dest) return "no such element";
  if (samePath(parentPath(from), target.parent)) return null;
  return refusal(dest, elem);
}

function usedIds(win: JsonObject): Set<string> {
  const used = new Set<string>();
  walkElems(win, (e) => {
    if (typeof e.id === "string") used.add(e.id);
  });
  return used;
}

/** "name" -> "name_2", "name_2" -> "name_3", the first not in used. */
function nextId(used: ReadonlySet<string>, id: string): string {
  const m = /^(.*?)(?:_(\d+))?$/.exec(id)!;
  const base = m[1] || id;
  let n = m[2] ? Number(m[2]) + 1 : 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** A new id for a copy: "name" becomes "name_2", "name_2" becomes "name_3", unused in the window. */
export function freshId(win: JsonObject, id: string): string {
  return nextId(usedIds(win), id);
}

function renameIds(win: JsonObject, e: JsonObject): JsonObject {
  const copy = structuredClone(e);
  // The window's ids and those given to the copy so far: two ids in one copy never get the same new name.
  const used = usedIds(win);
  const rec = (x: JsonObject): JsonObject => {
    let out = x;
    if (typeof x.id === "string" && x.id) {
      const id = nextId(used, x.id);
      used.add(id);
      out = { ...x, id };
    }
    const kids = kidsOf(out);
    if (!kids.length) return out;
    const cells = containerKind(out) === "list" ? kids.map((_, j) => cellOf(out, j)) : undefined;
    return withKids(out, kids.map(rec), cells);
  };
  return rec(copy);
}

/** Duplicates the element at path right after itself (ids get a fresh suffix, binds stay shared). */
export function duplicateElem(win: JsonObject, path: ElemPath): { win: JsonObject; path: ElemPath } {
  if (!path.length) throw new EditError("the root cannot be duplicated");
  const e = getElem(win, path);
  const p = getElem(win, parentPath(path));
  if (!e || !p) throw new EditError("no such element");
  const cell = containerKind(p) === "list" ? cellOf(p, path[path.length - 1]!) : null;
  return insertElem(win, parentPath(path), path[path.length - 1]! + 1, renameIds(win, e), cell ?? undefined);
}

/** A copy of e fit to paste into win (fresh ids). */
export function pasteable(win: JsonObject, e: JsonObject): JsonObject {
  return renameIds(win, e);
}

export type WrapKind = "row" | "col" | "group";

/** Wraps the element at path in a new row, column or group (the root too: a window's root can be any of them). */
export function wrapElem(win: JsonObject, path: ElemPath, kind: WrapKind): { win: JsonObject; path: ElemPath } {
  const e = getElem(win, path);
  if (!e) throw new EditError("no such element");
  const wrapper: JsonObject =
    kind === "group"
      ? { type: "group", label: null, value: null, children: [e], border: true, scrollbars: 4 }
      : { type: kind, label: null, value: null, children: [e] };
  return { win: updateElem(win, path, () => wrapper), path };
}

/** Replaces the container at path with its children. */
export function unwrapElem(win: JsonObject, path: ElemPath): { win: JsonObject; path: ElemPath } {
  const e = getElem(win, path);
  if (!e) throw new EditError("no such element");
  const kids = kidsOf(e);
  if (!containerKind(e)) throw new EditError("only a row, column, group or list can be unwrapped");
  if (!path.length) {
    if (kids.length !== 1 || containerKind(kids[0]) === null || containerKind(kids[0]) === "list") {
      throw new EditError("the root can only be unwrapped when its one child is a row, column or group");
    }
    return { win: { ...win, root: kids[0]! }, path: [] };
  }
  const parent = parentPath(path);
  const i = path[path.length - 1]!;
  const p = getElem(win, parent)!;
  const siblings = kidsOf(p);
  const pk = containerKind(p);
  if (pk === "group" && siblings.length - 1 + kids.length > 1) throw new EditError("a group holds one child: its parent cannot take them all");
  if (pk === "list") {
    if (siblings.length - 1 + kids.length > MAX_TEMPLATE_CELLS) throw new EditError(`a list's row template has at most ${MAX_TEMPLATE_CELLS} cells`);
    if (kids.some((k) => typeOf(k) === "list")) throw new EditError("a list cannot hold a list");
  }
  const out = updateElem(win, parent, (x) => {
    const cells = pk === "list" ? siblings.map((_, j) => cellOf(x, j)) : undefined;
    const next = siblings.slice();
    next.splice(i, 1, ...kids);
    cells?.splice(i, 1, ...kids.map(() => DEFAULT_CELL));
    return withKids(x, next, cells);
  });
  return { win: out, path: kids.length ? [...parent, i] : parent };
}

/** Sets (or, with undefined, removes) key on the element at path. */
export function setProp(win: JsonObject, path: ElemPath, key: string, value: JsonValue | undefined): JsonObject {
  return updateElem(win, path, (e) => {
    const out = { ...e };
    if (value === undefined) delete out[key];
    else out[key] = value;
    return out;
  });
}

/** Sets a window key (undefined removes it). */
export function setWindowProp(win: JsonObject, key: string, value: JsonValue | undefined): JsonObject {
  const out = { ...win };
  if (value === undefined) delete out[key];
  else out[key] = value;
  return out;
}

/** Sets a list cell's width or variable flag; path is the cell element's path. */
export function setCell(win: JsonObject, path: ElemPath, info: Partial<CellInfo>): JsonObject {
  const parent = parentPath(path);
  const i = path[path.length - 1]!;
  return updateElem(win, parent, (l) => {
    if (containerKind(l) !== "list") throw new EditError("not a list cell");
    const tpl = Array.isArray(l.row_template) ? l.row_template.slice() : [];
    const c = tpl[i];
    if (!Array.isArray(c)) throw new EditError("no such cell");
    const next = c.slice();
    if (info.width !== undefined) next[1] = info.width;
    if (info.variable !== undefined) next[2] = info.variable;
    tpl[i] = next;
    return { ...l, row_template: tpl };
  });
}

/** Calls fn on every element of the window (root first, depth first) with its path. */
export function walkElems(win: JsonObject, fn: (e: JsonObject, path: ElemPath) => void): void {
  const rec = (e: JsonObject, path: number[]) => {
    fn(e, path);
    kidsOf(e).forEach((c, i) => rec(c, [...path, i]));
  };
  if (isObject(win.root)) rec(win.root, []);
}

/** Every element object of the window to its path (the renderer's outlines carry the same objects). */
export function pathIndex(win: JsonObject): Map<JsonObject, ElemPath> {
  const m = new Map<JsonObject, ElemPath>();
  walkElems(win, (e, p) => m.set(e, p));
  return m;
}

/** Replaces every {"bind": from} in v with to (keeping its flags). */
export function renameBindIn(v: JsonValue, from: string, to: string): JsonValue {
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => {
      const y = renameBindIn(x, from, to);
      if (y !== x) changed = true;
      return y;
    });
    return changed ? out : v;
  }
  if (!isObject(v)) return v;
  if (typeof v.bind === "string") return v.bind === from ? { ...v, bind: to } : v;
  let changed = false;
  const out: JsonObject = {};
  for (const [k, x] of Object.entries(v)) {
    const y = renameBindIn(x, from, to);
    if (y !== x) changed = true;
    out[k] = y;
  }
  return changed ? out : v;
}

/** The element's label for the tree: its type, id and a short text. */
export function elemLabel(e: JsonObject): string {
  const t = typeOf(e);
  const text = (v: JsonValue | undefined): string | null => {
    if (typeof v === "string") return v;
    if (isObject(v) && typeof v.bind === "string") return `{${v.bind}}`;
    if (isObject(v) && "strref" in v) return `strref ${String(v.strref)}`;
    return null;
  };
  let s: string | null = null;
  if (t === "label" || t === "text") s = text(e.value);
  else if (t === "button" || t === "button_select" || t === "check" || t === "button_image") s = text(e.label);
  else if (t === "image") s = text(e.value);
  else if (t === "textedit") s = text(e.label) ?? text(e.value);
  if (s !== null && s.length > 32) s = s.slice(0, 31) + "…";
  return s ?? "";
}
