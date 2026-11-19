/**
 * Binds from the editor's side: what kind of value each bind holds (from the property it is bound to), which list it
 * feeds (one value a row) or counts, switching a property between a static value and a bind, and sample presets to
 * stress a layout (long text, empty, a full list).
 */
import { type Binds, type JsonObject, type JsonValue, isObject } from "../model/types.js";
import { DRAW_ITEM_PROPS, DRAW_LIST_SCISSOR, type PropKind, WINDOW_PROPS, specOf } from "./catalog.js";
import { type ElemPath, kidsOf, renameBindIn, typeOf, walkElems } from "./tree.js";

export interface BindUse {
  /** The element's path, or null for the window. */
  path: ElemPath | null;
  /** The key, with a draw-list item's index: "label", "draw_list[2].rect", "value[0].data". */
  key: string;
  kind: PropKind | "json";
  /** One value a row (in a list's row template, or an array-bound draw-list item). */
  perRow: boolean;
  /** The list it is a row value of. */
  list: ElemPath | null;
}

export interface BindDetails {
  name: string;
  kind: PropKind | "json";
  perRow: boolean;
  uses: BindUse[];
  /** The lists whose row_count this bind is. */
  countsRowsOf: ElemPath[];
}

const isBind = (v: JsonValue | undefined): v is JsonObject => isObject(v) && typeof v.bind === "string";

/** Every bind in the window, with where it is used and its kind. */
export function bindDetails(win: JsonObject, panes: Record<string, JsonObject> = {}): Map<string, BindDetails> {
  const out = new Map<string, BindDetails>();
  const add = (v: JsonValue | undefined, use: BindUse) => {
    if (!isBind(v)) return;
    const name = v.bind as string;
    let d = out.get(name);
    if (!d) out.set(name, (d = { name, kind: use.kind, perRow: false, uses: [], countsRowsOf: [] }));
    d.uses.push(use);
    d.perRow ||= use.perRow;
    if (d.kind === "json") d.kind = use.kind;
  };
  for (const p of WINDOW_PROPS) add(win[p.key], { path: null, key: p.key, kind: p.kind, perRow: false, list: null });

  const visit = (e: JsonObject, path: ElemPath | null, list: ElemPath | null) => {
    const perRow = list !== null;
    const spec = specOf(typeOf(e));
    for (const p of spec?.props ?? []) add(e[p.key], { path, key: p.key, kind: p.kind, perRow, list });
    if (typeOf(e) === "list" && isBind(e.row_count) && path) {
      const name = e.row_count.bind as string;
      out.get(name)?.countsRowsOf.push(path);
    }
    add(e.draw_list_scissor, { path, key: DRAW_LIST_SCISSOR.key, kind: "bool", perRow, list });
    if (Array.isArray(e.draw_list)) {
      e.draw_list.forEach((it, i) => {
        if (!isObject(it)) return;
        const arr = it.arrayBinds === true;
        const props = DRAW_ITEM_PROPS[typeof it.type === "number" ? it.type : -1] ?? [];
        for (const p of props) add(it[p.key], { path, key: `draw_list[${i}].${p.key}`, kind: arr ? "json" : p.kind, perRow: perRow || arr, list: arr ? null : list });
      });
    }
    if (typeOf(e) === "chart" && Array.isArray(e.value)) {
      e.value.forEach((s, i) => {
        if (!isObject(s)) return;
        add(s.legend, { path, key: `value[${i}].legend`, kind: "string", perRow, list });
        add(s.color, { path, key: `value[${i}].color`, kind: "color", perRow, list });
        add(s.data, { path, key: `value[${i}].data`, kind: "floats", perRow, list });
      });
    }
  };
  // An element in a list's row template is a row value of the nearest list above it.
  const rec = (e: JsonObject, path: ElemPath, list: ElemPath | null) => {
    visit(e, path, list);
    const isList = typeOf(e) === "list";
    kidsOf(e).forEach((c, i) => rec(c, [...path, i], isList ? path : list));
  };
  if (isObject(win.root)) rec(win.root, [], null);
  for (const p of Object.values(panes)) {
    const sub = { root: p };
    walkElems(sub, (e) => visit(e, null, null));
  }
  // row_count binds found before their list's own walk.
  walkElems(win, (e, path) => {
    if (typeOf(e) === "list" && isBind(e.row_count)) {
      const d = out.get(e.row_count.bind as string);
      if (d && !d.countsRowsOf.some((p) => p.join() === path.join())) d.countsRowsOf.push(path);
    }
  });
  return out;
}

const LONG =
  "A much longer value than the designer planned for, to see where it wraps, scrolls or is cut off: " +
  "names players choose, descriptions written by builders, and text from a database all grow.";

/** A sample value of a kind: "short" (the default a new bind gets), "long" or "empty". */
export function sampleValue(kind: PropKind | "json", preset: "short" | "long" | "empty" = "short", i = 0): JsonValue {
  switch (kind) {
    case "string":
    case "text":
    case "title":
      return preset === "empty" ? "" : preset === "long" ? LONG : i ? `Sample ${i + 1}` : "Sample";
    case "resref":
      return preset === "empty" ? "" : "is_fireball";
    case "font":
      return "";
    case "id":
      return "";
    case "bool":
      return preset !== "empty";
    case "int":
    case "enum":
      return preset === "empty" ? 0 : preset === "long" ? 9999 : i;
    case "float":
      return preset === "empty" ? 0 : preset === "long" ? 1 : 0.5;
    case "color":
      return { r: 222, g: 184, b: 80, a: 255 };
    case "rect":
      return { x: 0, y: 0, w: 100, h: 30 };
    case "vec":
      return { x: 0, y: 0 };
    case "strings":
      return preset === "empty" ? [] : ["One", "Two", "Three"];
    case "combo":
      return preset === "empty" ? [] : preset === "long" ? Array.from({ length: 20 }, (_, k) => [`Entry ${k + 1} with a long name`, k]) : [["First", 0], ["Second", 1]];
    case "floats":
      return preset === "empty" ? [] : [1, 3, 2, 4];
    case "chart":
      return [];
    default:
      return null;
  }
}

/** A value for a bind of d (an array of rows values for a row bind). */
export function sampleFor(d: BindDetails, preset: "short" | "long" | "empty" = "short", rows = 5): JsonValue {
  if (d.countsRowsOf.length) return preset === "empty" ? 0 : rows;
  if (d.perRow) return Array.from({ length: preset === "empty" ? 0 : rows }, (_, i) => sampleValue(d.kind, preset, i));
  return sampleValue(d.kind, preset);
}

/** Every bind given a value of the preset (long text everywhere, everything empty). */
export function applyPreset(win: JsonObject, binds: Binds, preset: "short" | "long" | "empty", panes: Record<string, JsonObject> = {}, rows = 5): Binds {
  const out: Binds = { ...binds };
  for (const d of bindDetails(win, panes).values()) out[d.name] = sampleFor(d, preset, rows);
  return out;
}

/** A list full of rows: its row_count bind set to rows, every row bind of its template given rows values. */
export function fillList(win: JsonObject, binds: Binds, list: ElemPath, rows: number, preset: "short" | "long" = "short", panes: Record<string, JsonObject> = {}): Binds {
  const out: Binds = { ...binds };
  const key = list.join();
  for (const d of bindDetails(win, panes).values()) {
    if (d.countsRowsOf.some((p) => p.join() === key)) out[d.name] = rows;
    else if (d.uses.some((u) => u.list && u.list.join() === key)) {
      out[d.name] = Array.from({ length: rows }, (_, i) => sampleValue(d.kind, preset, i));
    }
  }
  return out;
}

/** Bind names: letters, digits and _ are safe everywhere (NWScript constants are made from them). */
export function bindNameProblem(name: string): string | null {
  if (!name) return "a bind needs a name";
  if (!/^[A-Za-z0-9_]+$/.test(name)) return "use letters, digits and _ only";
  return null;
}

/** A new bind name for key on element type t, unused in binds. */
export function freshBindName(win: JsonObject, binds: Binds, base: string): string {
  const used = new Set([...bindDetails(win).keys(), ...Object.keys(binds)]);
  const b = base.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "bind";
  if (!used.has(b)) return b;
  let n = 2;
  while (used.has(`${b}_${n}`)) n++;
  return `${b}_${n}`;
}

/** NuiBind(name): the JSON nw_inc_nui makes. */
export function bindValue(name: string): JsonObject {
  return { bind: name, number_flags: 0, number_precision: 0, text_flags: 0 };
}

/** Renames a bind everywhere in the window and the panes, and its sample value. */
export function renameBind(win: JsonObject, binds: Binds, panes: Record<string, JsonObject>, from: string, to: string): { win: JsonObject; binds: Binds; panes: Record<string, JsonObject> } {
  const b: Binds = {};
  for (const [k, v] of Object.entries(binds)) b[k === from ? to : k] = v;
  const p: Record<string, JsonObject> = {};
  for (const [k, v] of Object.entries(panes)) p[k] = renameBindIn(v, from, to) as JsonObject;
  return { win: renameBindIn(win, from, to) as JsonObject, binds: b, panes: p };
}

/** The sample values of binds no longer used by the window (to tidy them). */
export function unusedBinds(win: JsonObject, binds: Binds, panes: Record<string, JsonObject> = {}): string[] {
  const used = bindDetails(win, panes);
  return Object.keys(binds).filter((k) => !used.has(k));
}
