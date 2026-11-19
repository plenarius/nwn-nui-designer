/**
 * Writes a window as a .jui: the resource NuiCreateFromResRef loads (resource type 2083, RESTYPE_JUI).
 *
 * What the client does with it (nwmain-linux 8193.37-17, CNWCMessage::HandleServerToPlayerNuiEvent; DESIGN.md,
 * "What NuiCreateFromResRef loads"): the server sends only the resref; the client gets the resource from its own resman (haks, NWSync,
 * override), copies it into a string, measures it with strlen, and parses it with nlohmann::json in strict mode,
 * without comments. The result goes down the same path as NuiCreate's JSON. So a .jui is exactly the JSON NuiWindow
 * makes, as UTF-8 text: binds stay binds ({"bind": ...}), ids stay ids, and the bind values are set by the script
 * after it opens the window.
 *
 * JSON numbers have no int/float type in JavaScript, but nlohmann keeps the difference and JsonDump shows it (150.0).
 * This writer writes a number as a float where the nw_inc_nui builder makes one (sizes, rects, vectors, row height,
 * float sliders, progress, chart data, line thickness, ...), so a .jui reads like the JSON the script would build.
 * The client reads either the same way.
 */
import { type JsonObject, type JsonValue, isObject } from "../model/types.js";

type Hint = "float" | "floats" | "xy" | "elem" | "window" | "item" | "items" | "cells" | "slots" | "slot" | "elems" | "cell" | null;

const ELEM_FLOAT = new Set(["width", "height", "aspect", "margin", "padding", "row_height"]);
const XY_KEYS = new Set(["geometry", "size_constraint", "edge_constraint", "image_region", "rect", "a", "b", "ctrl0", "ctrl1", "c"]);
const ITEM_FLOAT = new Set(["line_thickness", "radius", "amin", "amax"]);

function num(v: number, float: boolean): string {
  if (!Number.isFinite(v)) return "null";
  if (float && Number.isInteger(v) && Math.abs(v) < 1e15) return `${v}.0`;
  return JSON.stringify(v);
}

function childHint(parent: Hint, obj: JsonObject, key: string): Hint {
  if (parent === "window") {
    if (key === "root") return "elem";
    if (XY_KEYS.has(key)) return "xy";
    return null;
  }
  if (parent === "elem") {
    const t = obj.type;
    if (ELEM_FLOAT.has(key)) return "float";
    if (key === "children") return "elems";
    if (key === "row_template") return "cells";
    if (key === "draw_list") return "items";
    if (key === "image_region") return "xy";
    if (t === "sliderf" && (key === "value" || key === "min" || key === "max" || key === "step")) return "float";
    if (t === "progress" && key === "value") return "float";
    if (t === "chart" && key === "value") return "slots";
    return null;
  }
  if (parent === "item") {
    if (ITEM_FLOAT.has(key)) return "float";
    if (XY_KEYS.has(key)) return "xy";
    if (key === "points") return "floats";
    return null;
  }
  if (parent === "slot") return key === "data" ? "floats" : null;
  if (parent === "xy") return "float";
  return null;
}

function write(v: JsonValue, hint: Hint, indent: string, step: string): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return num(v, hint === "float" || hint === "floats");
  const nl = step ? "\n" : "";
  const inner = indent + step;
  const sep = step ? ": " : ":";
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    const parts = v.map((x, i) => {
      let h: Hint = null;
      if (hint === "floats") h = "float";
      else if (hint === "elems") h = "elem";
      else if (hint === "items") h = "item";
      else if (hint === "slots") h = "slot";
      else if (hint === "cells") h = "cell";
      else if (hint === "cell") h = i === 0 ? "elem" : i === 1 ? "float" : null;
      return write(x, h, inner, step);
    });
    // Short arrays of scalars on one line.
    if (step && v.every((x) => !isObject(x) && !Array.isArray(x)) && parts.join(", ").length < 80) return `[${parts.join(", ")}]`;
    return `[${nl}${parts.map((p) => inner + p).join("," + nl)}${nl}${indent}]`;
  }
  // A bind: its flags are ints, whatever the key.
  const own: Hint = typeof v.bind === "string" ? null : hint;
  const keys = Object.keys(v);
  if (!keys.length) return "{}";
  const parts = keys.map((k) => `${JSON.stringify(k)}${sep}${write(v[k]!, own === null ? null : childHint(own, v, k), inner, step)}`);
  if (step && own === "xy" && parts.join(", ").length < 80) return `{${parts.join(", ")}}`;
  return `{${nl}${parts.map((p) => inner + p).join("," + nl)}${nl}${indent}}`;
}

/** The window as .jui text (UTF-8, no comments, one JSON value), floats written as floats. indent "" is compact. */
export function writeJui(win: JsonObject, indent = "  "): string {
  return write(win, "window", "", indent) + (indent ? "\n" : "");
}

/** Any element as JSON text with the same float rules (the clipboard, the NWScript export's JsonParse fallback). */
export function writeElement(e: JsonObject, indent = ""): string {
  return write(e, "elem", "", indent);
}

/** A resref the client can load: at most 16 characters, lower case letters, digits and _. */
export function resrefProblem(r: string): string | null {
  if (!r) return "empty";
  if (r.length > 16) return `${r.length} characters: a resref has at most 16`;
  if (!/^[a-z0-9_]+$/.test(r)) return "use lower case letters, digits and _ only";
  return null;
}
