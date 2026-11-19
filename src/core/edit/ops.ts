/**
 * The editor's operations on a whole document (window, sample binds, panes): what the UI calls, each returning a new
 * document (and the selection that follows), so every one of them is one undo step and unit-testable.
 */
import { type JsonObject, type JsonValue, isObject } from "../model/types.js";
import { bindValue, freshBindName, renameBind } from "./binds.js";
import { newDrawItem } from "./catalog.js";
import type { EditorDoc } from "./project.js";
import { type ElemPath, type DropTarget, type WrapKind, duplicateElem, getElem, insertElem, kidsOf, moveElem, pasteable, removeElem, setProp, setWindowProp, unwrapElem, updateElem, wrapElem } from "./tree.js";

/** A property's owner: the window (path null), an element, one of its draw-list items, or a chart's slot. */
export interface Target {
  path: ElemPath | null;
  /** A draw-list item's index. */
  item?: number;
  /** A chart slot's index (in the chart's value). */
  slot?: number;
}

export interface Result {
  doc: EditorDoc;
  /** The element to select afterwards (null: the window; undefined: keep the selection). */
  select?: ElemPath | null;
}

function owner(doc: EditorDoc, t: Target): JsonObject | null {
  if (t.path === null) return doc.window;
  const e = getElem(doc.window, t.path);
  if (!e) return null;
  if (t.item !== undefined) {
    const it = Array.isArray(e.draw_list) ? e.draw_list[t.item] : undefined;
    return isObject(it) ? it : null;
  }
  if (t.slot !== undefined) {
    const s = Array.isArray(e.value) ? e.value[t.slot] : undefined;
    return isObject(s) ? s : null;
  }
  return e;
}

export function getValue(doc: EditorDoc, t: Target, key: string): JsonValue | undefined {
  return owner(doc, t)?.[key];
}

/** Sets (undefined: removes) a property. */
export function setValue(doc: EditorDoc, t: Target, key: string, value: JsonValue | undefined): EditorDoc {
  if (t.path === null) return { ...doc, window: setWindowProp(doc.window, key, value) };
  if (t.item === undefined && t.slot === undefined) return { ...doc, window: setProp(doc.window, t.path, key, value) };
  const listKey = t.item !== undefined ? "draw_list" : "value";
  const idx = (t.item ?? t.slot)!;
  return {
    ...doc,
    window: updateElem(doc.window, t.path, (e) => {
      const arr = Array.isArray(e[listKey]) ? (e[listKey] as JsonValue[]).slice() : [];
      const it = isObject(arr[idx]) ? { ...(arr[idx] as JsonObject) } : {};
      if (value === undefined) delete it[key];
      else it[key] = value;
      arr[idx] = it;
      return { ...e, [listKey]: arr };
    }),
  };
}

/**
 * Binds a property: its value becomes {"bind": name}, and the bind's sample value is the static value it had (unless
 * the bind has a sample already), so the canvas does not change.
 */
export function bindProp(doc: EditorDoc, t: Target, key: string, name?: string): EditorDoc {
  const cur = getValue(doc, t, key);
  const n = name ?? freshBindName(doc.window, doc.binds, key);
  const out = setValue(doc, t, key, bindValue(n));
  const binds = { ...doc.binds };
  if (!(n in binds) && cur !== undefined && !(isObject(cur) && "bind" in cur)) binds[n] = cur;
  return { ...out, binds };
}

/** Makes a bound property static again: its value is the bind's sample (if it has one), else fallback. */
export function unbindProp(doc: EditorDoc, t: Target, key: string, fallback: JsonValue): EditorDoc {
  const cur = getValue(doc, t, key);
  const name = isObject(cur) && typeof cur.bind === "string" ? cur.bind : null;
  const sample = name !== null ? doc.binds[name] : undefined;
  const v = sample !== undefined && !Array.isArray(sample) ? sample : fallback;
  return setValue(doc, t, key, v);
}

/** Points a bound property at another bind (keeping its flags). */
export function rebindProp(doc: EditorDoc, t: Target, key: string, name: string): EditorDoc {
  const cur = getValue(doc, t, key);
  const v = isObject(cur) && typeof cur.bind === "string" ? { ...cur, bind: name } : bindValue(name);
  return setValue(doc, t, key, v);
}

export function renameBindDoc(doc: EditorDoc, from: string, to: string): EditorDoc {
  const r = renameBind(doc.window, doc.binds, doc.panes, from, to);
  return { ...doc, window: r.win, binds: r.binds, panes: r.panes };
}

export function setSample(doc: EditorDoc, name: string, value: JsonValue | undefined): EditorDoc {
  const binds = { ...doc.binds };
  if (value === undefined) delete binds[name];
  else binds[name] = value;
  return { ...doc, binds };
}

// --- the tree --------------------------------------------------------------------------------------------------

export function addElement(doc: EditorDoc, target: DropTarget, elem: JsonObject): Result {
  const r = insertElem(doc.window, target.parent, target.index, pasteable(doc.window, elem));
  return { doc: { ...doc, window: r.win }, select: r.path };
}

export function deleteElement(doc: EditorDoc, path: ElemPath): Result {
  const r = removeElem(doc.window, path);
  const parent = path.slice(0, -1);
  const i = path[path.length - 1]!;
  const p = getElem(r.win, parent);
  const n = p ? kidsOf(p).length : 0;
  return { doc: { ...doc, window: r.win }, select: n ? [...parent, Math.min(i, n - 1)] : parent };
}

export function moveElement(doc: EditorDoc, from: ElemPath, target: DropTarget): Result {
  const r = moveElem(doc.window, from, target);
  return { doc: { ...doc, window: r.win }, select: r.path };
}

/** Moves an element one place up or down among its siblings. */
export function nudge(doc: EditorDoc, path: ElemPath, d: -1 | 1): Result | null {
  if (!path.length) return null;
  const parent = path.slice(0, -1);
  const i = path[path.length - 1]!;
  const p = getElem(doc.window, parent);
  if (!p) return null;
  const n = kidsOf(p).length;
  const j = i + d;
  if (j < 0 || j >= n) return null;
  return moveElement(doc, path, { parent, index: d > 0 ? j + 1 : j });
}

export function duplicateElement(doc: EditorDoc, path: ElemPath): Result {
  const r = duplicateElem(doc.window, path);
  return { doc: { ...doc, window: r.win }, select: r.path };
}

export function wrapElement(doc: EditorDoc, path: ElemPath, kind: WrapKind): Result {
  const r = wrapElem(doc.window, path, kind);
  return { doc: { ...doc, window: r.win }, select: r.path };
}

export function unwrapElement(doc: EditorDoc, path: ElemPath): Result {
  const r = unwrapElem(doc.window, path);
  return { doc: { ...doc, window: r.win }, select: r.path };
}

// --- draw lists --------------------------------------------------------------------------------------------------

export function addDrawItem(doc: EditorDoc, path: ElemPath, type: number): EditorDoc {
  return {
    ...doc,
    window: updateElem(doc.window, path, (e) => {
      const list = Array.isArray(e.draw_list) ? e.draw_list.slice() : [];
      list.push(newDrawItem(type));
      return { ...e, draw_list: list, draw_list_scissor: e.draw_list_scissor ?? true };
    }),
  };
}

export function removeDrawItem(doc: EditorDoc, path: ElemPath, i: number): EditorDoc {
  return {
    ...doc,
    window: updateElem(doc.window, path, (e) => {
      const list = Array.isArray(e.draw_list) ? e.draw_list.slice() : [];
      list.splice(i, 1);
      const out: JsonObject = { ...e, draw_list: list };
      if (!list.length) {
        delete out.draw_list;
        delete out.draw_list_scissor;
      }
      return out;
    }),
  };
}

export function moveDrawItem(doc: EditorDoc, path: ElemPath, i: number, d: -1 | 1): EditorDoc {
  return {
    ...doc,
    window: updateElem(doc.window, path, (e) => {
      const list = Array.isArray(e.draw_list) ? e.draw_list.slice() : [];
      const j = i + d;
      if (j < 0 || j >= list.length) return e;
      [list[i], list[j]] = [list[j]!, list[i]!];
      return { ...e, draw_list: list };
    }),
  };
}

/** Changes a draw-list item's type: a new item of that type, keeping what the two share (colour, rect, order...). */
export function retypeDrawItem(doc: EditorDoc, path: ElemPath, i: number, type: number): EditorDoc {
  return {
    ...doc,
    window: updateElem(doc.window, path, (e) => {
      const list = Array.isArray(e.draw_list) ? e.draw_list.slice() : [];
      const old = isObject(list[i]) ? (list[i] as JsonObject) : {};
      const fresh = newDrawItem(type);
      for (const k of Object.keys(fresh)) if (k !== "type" && k in old && old[k] !== null && fresh[k] !== null) fresh[k] = old[k]!;
      list[i] = fresh;
      return { ...e, draw_list: list };
    }),
  };
}
