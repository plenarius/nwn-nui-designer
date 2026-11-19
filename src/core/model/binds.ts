/** The binds a window uses: where each is used, and whether a list row reads it as an array. */
import { type JsonObject, type JsonValue, type NuiDocument, isObject } from "./types.js";

export interface BindUse {
  /** Where: the element's type and the key ("label.value", "draw_list[2].rect", "window.title"). */
  where: string;
  /** Inside a list's row template (one value a row: the bind is an array), or an array-bound draw-list item. */
  perRow: boolean;
}

export interface BindInfo {
  name: string;
  uses: BindUse[];
  /** Whether any use expects an array. */
  perRow: boolean;
}

function walk(v: JsonValue, where: string, perRow: boolean, out: Map<string, BindInfo>): void {
  if (Array.isArray(v)) {
    v.forEach((x, i) => walk(x, `${where}[${i}]`, perRow, out));
    return;
  }
  if (!isObject(v)) return;
  if (typeof v.bind === "string") {
    let info = out.get(v.bind);
    if (!info) out.set(v.bind, (info = { name: v.bind, uses: [], perRow: false }));
    info.uses.push({ where, perRow });
    info.perRow ||= perRow;
    return;
  }
  const type = typeof v.type === "string" ? v.type : null;
  for (const [k, x] of Object.entries(v)) {
    if (k === "row_template" && type === "list") {
      walk(x, `list.row_template`, true, out);
    } else if (k === "draw_list" && Array.isArray(x)) {
      x.forEach((item, i) => {
        const arr = isObject(item) && item.arrayBinds === true;
        walk(item, `${type ?? "?"}.draw_list[${i}]`, perRow || arr, out);
      });
    } else if (k === "children") {
      walk(x, type ?? where, perRow, out);
    } else {
      walk(x, `${type ?? where}.${k}`, perRow, out);
    }
  }
}

/** Every bind the window (and its panes) names, sorted by name. */
export function collectBinds(doc: NuiDocument): BindInfo[] {
  const out = new Map<string, BindInfo>();
  walk(doc.window as JsonObject, "window", false, out);
  for (const [id, p] of Object.entries(doc.panes)) walk(p, `pane '${id}'`, false, out);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The bind values a window's framework profile sets when it opens: Layonara's NUI framework (nui_i_main.nss) keeps
 * them in the window's `profiles` key, `{"default": {bind: value, ...}, "<profile>": {...}}`, and sets the default
 * profile's (overlaid by the chosen one's) on every open. Empty for a window with no profiles.
 */
export function profileBinds(win: JsonObject, profile = "default"): Record<string, JsonValue> {
  const p = win.profiles;
  if (!isObject(p)) return {};
  const base = isObject(p.default) ? p.default : {};
  const chosen = profile !== "default" && isObject(p[profile]) ? p[profile] : {};
  return { ...base, ...chosen };
}

/**
 * A value as the window shows it: a static value as it is; a bind's sample value (the dump's binds first, then the
 * framework profile's default), or undefined when the bind has none (or is null).
 */
export function boundValue(v: JsonValue | undefined, binds: Record<string, JsonValue>, win?: JsonObject): JsonValue | undefined {
  if (!isObject(v) || typeof v.bind !== "string") return v;
  const name = v.bind;
  const b = binds[name];
  if (b !== undefined && b !== null) return b;
  const p = win ? profileBinds(win)[name] : undefined;
  return p === null ? undefined : p;
}

/** The window's geometry as it opens (static, or its bind's sample value), or null when only the game will set it. */
export function windowGeometry(win: JsonObject, binds: Record<string, JsonValue>): { x: number; y: number; w: number; h: number } | null {
  const g = boundValue(win.geometry, binds, win);
  if (!isObject(g) || typeof g.w !== "number" || typeof g.h !== "number") return null;
  return { x: typeof g.x === "number" ? g.x : -1, y: typeof g.y === "number" ? g.y : -1, w: g.w, h: g.h };
}
