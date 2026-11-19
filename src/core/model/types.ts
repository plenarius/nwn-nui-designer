/**
 * The NUI JSON model. NUI windows are plain JSON (what NuiWindow and the Nui* builders of nw_inc_nui.nss make, what a
 * .jui file holds), so the model is that JSON itself: the viewer, and later the editor, read and write it as it is, and
 * anything this code does not know about survives a round trip untouched.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

/** An element: {"type": "row" | "col" | "label" | ..., ...}. */
export type NuiElement = JsonObject;

/** A window: {"version": 1, "title", "root", "geometry", ...}. */
export type NuiWindow = JsonObject;

/** Bind name -> value, as NuiSetBind sets them (arrays for list rows and draw-list array binds). */
export type Binds = Record<string, JsonValue>;

/**
 * What the viewer opens: a window, the bind values to show it with, and the group layouts swapped in by id
 * (nui-preview's dump format: {name, form, window, binds, panes}).
 */
export interface NuiDocument {
  name: string;
  form: string;
  window: NuiWindow;
  binds: Binds;
  panes: Record<string, NuiElement>;
}

export function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The number at key, or def if it has none (absent, a bind, a boolean: as nui-preview's number()). */
export function num(elem: JsonObject | null | undefined, key: string, def: number): number;
export function num(elem: JsonObject | null | undefined, key: string, def: number | null): number | null;
export function num(elem: JsonObject | null | undefined, key: string, def: number | null): number | null {
  const v = elem ? elem[key] : undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return def;
}

/** A value as a number if it is one (not a boolean). */
export function asNumber(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}

/** The element's display name in a path: its type and its id, if it has one ("button 'cn_help'"). */
export function elemName(elem: JsonObject): string {
  const t = typeof elem.type === "string" ? elem.type : "?";
  const id = elem.id;
  return typeof id === "string" && id ? `${t} '${id}'` : t;
}
