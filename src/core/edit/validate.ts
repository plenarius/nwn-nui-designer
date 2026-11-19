/**
 * Checks a window's values the way the client reads them: types and ranges per property, binds where nw_inc_nui
 * takes none, keys the client ignores (and, for the ones people expect to work, what NUI cannot style at all:
 * docs/CLIENT-BEHAVIOUR.md#what-nui-cannot-style), ids, fonts the skin does not have, list and group rules.
 *
 * These are findings about the JSON; the renderer's problems (clipped text, overflow, unsolvable sizes) are about
 * the layout. The editor lists both, and the optional style rules (style.ts).
 */
import { boundValue } from "../model/binds.js";
import { type Binds, type JsonObject, type JsonValue, isObject } from "../model/types.js";
import { RUNTIME_GEOMETRY_TEXT, runtimeGeometry } from "./issues.js";
import { windowChrome } from "../model/window.js";
import { DRAW_ITEM_COMMON, DRAW_ITEM_PROPS, DRAW_LIST_SCISSOR, type PropDef, WINDOW_PROPS, knownKeys, specOf } from "./catalog.js";
import { type ElemPath, MAX_TEMPLATE_CELLS, typeOf, walkElems } from "./tree.js";

export type Severity = "error" | "warning" | "info";

export interface Finding {
  severity: Severity;
  /** "client" for these checks, "style:<id>" for a style rule set. */
  source: string;
  kind: string;
  text: string;
  /** The element, or null for the window. */
  path: ElemPath | null;
  /** The property it is about, if one. */
  key?: string;
}

export interface ValidateOptions {
  /** The loaded skin's font names ([[fonts]] name). Without them, fonts are not checked. */
  fonts?: string[];
  /** The sample bind values (the dump's binds): a geometry bind with none is set at runtime. */
  binds?: Binds;
  /**
   * Window keys a framework adds that the client ignores, declared by the active style rule set
   * (StyleRuleSet.knownWindowKeys): not reported. Without them, the client's unknown keys on the window are reported.
   */
  extraWindowKeys?: readonly string[];
}

/** Keys people reach for that NUI has no way to apply (docs/CLIENT-BEHAVIOUR.md#what-nui-cannot-style). */
const CANNOT: [RegExp, string][] = [
  [/^(background|bg|background_color|background_image|fill_color)$/i, "per-element backgrounds cannot be styled: paint one with a draw list (ORDER_BEFORE) behind the element"],
  [/^(tint|image_color|image_tint|alpha|opacity|image_alpha)$/i, "images take no tint or alpha: make separate art, or lay a translucent draw-list rect over the image"],
  [/^(rotation|rotate|angle)$/i, "elements and images cannot be rotated"],
  [/^(rounding|corner_radius|border_radius|radius)$/i, "corner rounding cannot be styled (the skin's 9-slice textures decide the corners)"],
  [/^(border_color|border_width|border_thickness)$/i, "border colour and thickness come from the skin, for every window"],
  [/^(shadow|outline|glow|text_shadow)$/i, "text effects cannot be styled (a shadow can be faked: draw-list text twice, offset)"],
  [/^(bold|italic|font_size|font_weight)$/i, "one font per element, a [[fonts]] entry of the skin (NuiStyleFont): sizes and weights are skin fonts of their own"],
  [/^(hover|on_hover|hover_color|hover_image)$/i, "no hover styling per element: use draw-list items rendered on hover (NUI_DRAW_LIST_ITEM_RENDER_MOUSE_HOVER)"],
];

const isBind = (v: JsonValue | undefined): boolean => isObject(v) && typeof v.bind === "string";
const isNum = (v: JsonValue | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: JsonValue | undefined): v is number => isNum(v) && Number.isInteger(v);

/** What is wrong with a static value of a property (null if nothing). */
export function valueProblem(p: PropDef, v: JsonValue | undefined): string | null {
  if (v === undefined) return null;
  if (v === null) return p.nullable || p.optional || p.kind === "title" ? null : p.kind === "font" ? null : "null: the client reads nothing here";
  switch (p.kind) {
    case "float":
      if (!isNum(v)) return `a number is expected, not ${JSON.stringify(v)}`;
      if (p.min !== undefined && v < p.min) return `at least ${p.min}`;
      if (p.max !== undefined && v > p.max) return `at most ${p.max}`;
      return null;
    case "int":
      if (!isInt(v)) return `a whole number is expected, not ${JSON.stringify(v)}`;
      if (p.min !== undefined && v < p.min) return `at least ${p.min}`;
      if (p.max !== undefined && v > p.max) return `at most ${p.max}`;
      return null;
    case "enum":
      if (!isInt(v)) return `one of ${p.options!.map((o) => `${o.value} (${o.constant})`).join(", ")} is expected`;
      if (!p.options!.some((o) => o.value === v)) return `${v} is none of ${p.options!.map((o) => o.constant).join(", ")}`;
      return null;
    case "bool":
      return typeof v === "boolean" ? null : `true or false is expected, not ${JSON.stringify(v)}`;
    case "title":
      if (v === false || typeof v === "string" || (isObject(v) && "strref" in v)) return null;
      return "a string, a StrRef, or false (no title bar) is expected";
    case "string":
    case "text":
      if (typeof v === "string" || (isObject(v) && isInt(v.strref))) return null;
      return `a string (or NuiStrRef) is expected, not ${JSON.stringify(v)}`;
    case "resref":
      if (typeof v !== "string") return "an image resref (a string) is expected";
      if (v.length > 16) return `"${v}" has ${v.length} characters: a resref has at most 16`;
      return null;
    case "font":
    case "id":
      return typeof v === "string" ? null : "a string is expected";
    case "color": {
      if (!isObject(v)) return "a colour (NuiColor: r, g, b, a) is expected";
      for (const k of ["r", "g", "b"]) if (!isInt(v[k]) || (v[k] as number) < 0 || (v[k] as number) > 255) return `${k} must be a whole number from 0 to 255`;
      if (v.a !== undefined && (!isInt(v.a) || v.a < 0 || v.a > 255)) return "a must be a whole number from 0 to 255";
      return null;
    }
    case "rect":
      if (!isObject(v) || !["x", "y", "w", "h"].every((k) => isNum(v[k]))) return "a rect (NuiRect: x, y, w, h) is expected";
      return null;
    case "vec":
      if (!isObject(v) || !["x", "y"].every((k) => isNum(v[k]))) return "a vector (NuiVec: x, y) is expected";
      return null;
    case "strings":
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return "an array of strings is expected";
      return null;
    case "combo":
      if (!Array.isArray(v) || !v.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === "string" && isInt(x[1]))) return "an array of NuiComboEntry (label, value) is expected";
      return null;
    case "floats":
      if (!Array.isArray(v) || !v.every((x) => isNum(x) || isBind(x))) return "an array of numbers is expected";
      if (p.key === "points" && v.length % 2) return "points come in x, y pairs: the last one has no y";
      return null;
    case "chart":
      if (!Array.isArray(v)) return "an array of NuiChartSlot is expected";
      return null;
  }
  return null;
}

function checkProps(props: PropDef[], obj: JsonObject, path: ElemPath | null, out: Finding[], where: string, o: ValidateOptions): void {
  for (const p of props) {
    const v = obj[p.key];
    if (v === undefined) continue;
    const key = where ? `${where}.${p.key}` : p.key;
    if (isBind(v)) {
      if (!p.bindable) out.push({ severity: "error", source: "client", kind: "cannot be bound", text: `${p.label}: nw_inc_nui takes a plain ${p.kind === "float" ? "float" : p.kind === "bool" ? "int (TRUE or FALSE)" : p.kind} here; the client never reads a bind`, path, key });
      const name = (v as JsonObject).bind as string;
      if (!name) out.push({ severity: "error", source: "client", kind: "empty bind", text: `${p.label} is bound to a bind with no name`, path, key });
      continue;
    }
    const why = valueProblem(p, v);
    if (why) out.push({ severity: "error", source: "client", kind: "bad value", text: `${p.label}: ${why}`, path, key });
    if (p.kind === "font" && typeof v === "string" && v && o.fonts && !o.fonts.includes(v)) {
      out.push({ severity: "warning", source: "client", kind: "unknown font", text: `font "${v}" is not in the skin's [[fonts]] (${o.fonts.join(", ")}): the client logs "Requested font was not found" and keeps the current font`, path, key });
    }
  }
}

function unknownKeys(obj: JsonObject, known: Set<string>, path: ElemPath | null, out: Finding[], what: string): void {
  for (const k of Object.keys(obj)) {
    if (known.has(k)) continue;
    const cannot = CANNOT.find(([re]) => re.test(k));
    out.push(
      cannot
        ? { severity: "warning", source: "client", kind: "cannot be styled", text: `"${k}" does nothing: ${cannot[1]}`, path, key: k }
        : { severity: "info", source: "client", kind: "unknown key", text: `the client does not read "${k}" on ${what}`, path, key: k },
    );
  }
}

const WINDOW_KEYS = new Set(["version", "root", ...WINDOW_PROPS.map((p) => p.key)]);

export function validateWindow(win: JsonObject, o: ValidateOptions = {}): Finding[] {
  const out: Finding[] = [];
  if (win.version !== 1) out.push({ severity: "warning", source: "client", kind: "version", text: `the window's version is ${JSON.stringify(win.version ?? null)}: NuiWindow writes 1 ("to catch backwards-incompatible data")`, path: null, key: "version" });
  const rt = typeOf(win.root);
  if (!isObject(win.root)) out.push({ severity: "error", source: "client", kind: "no root", text: "the window has no root element", path: null, key: "root" });
  else if (!["row", "col", "group"].includes(rt)) out.push({ severity: "error", source: "client", kind: "bad root", text: `the root is a ${rt || "?"}: NuiWindow's root is a row, column or group`, path: [], key: "root" });
  // A window a framework opens (it has keys the client does not read, or a bound geometry) gets its geometry at
  // runtime: one note, and the editor leaves out the layout's problems at the default size (issues.ts).
  const framework = isBind(win.geometry) || Object.keys(win).some((k) => !WINDOW_KEYS.has(k) && !CANNOT.some(([re]) => re.test(k)));
  if (win.geometry === undefined && !framework) out.push({ severity: "error", source: "client", kind: "no geometry", text: "the window has no geometry", path: null, key: "geometry" });
  else if (runtimeGeometry(win, o.binds ?? {})) {
    out.push({ severity: "info", source: "client", kind: "runtime geometry", text: RUNTIME_GEOMETRY_TEXT, path: null, key: "geometry" });
  }
  checkProps(WINDOW_PROPS, win, null, out, "", o);
  unknownKeys(win, o.extraWindowKeys?.length ? new Set([...WINDOW_KEYS, ...o.extraWindowKeys]) : WINDOW_KEYS, null, out, "a window");
  // The client hides the title bar only with no title and both buttons off (windowChrome).
  const chrome = windowChrome(win, o.binds ?? {});
  if (win.title === false && chrome.header) {
    const on = [chrome.close ? "closable" : "", chrome.collapse ? "collapsible (collapsed is not false)" : ""].filter(Boolean).join(" and ");
    out.push({ severity: "info", source: "client", kind: "title bar", text: `the title is false but the window is ${on}: the title bar (with its buttons) still shows; the client hides it only with closing and collapsing off too`, path: null, key: "title" });
  }

  // Elements inside list rows: their ids repeat by design, and their binds hold a value per row.
  const inList = new Set<string>();
  walkElems(win, (e, path) => {
    if (typeOf(e) === "list") walkElems({ root: e }, (x, p) => p.length && inList.add([...path, ...p].join()));
  });
  // Ids: an event names its element by id, so two elements with one id (outside list rows) cannot be told apart.
  const ids = new Map<string, ElemPath[]>();
  walkElems(win, (e, path) => {
    const t = typeOf(e);
    const spec = specOf(t);
    if (!spec) {
      out.push({ severity: "error", source: "client", kind: "unknown type", text: `"${t || "(no type)"}" is not an element type the client knows`, path });
      return;
    }
    checkProps(spec.props, e, path, out, "", o);
    unknownKeys(e, knownKeys(t), path, out, `a ${spec.title.toLowerCase()}`);
    if (typeof e.id === "string") {
      if (e.id && !/^[A-Za-z0-9_]+$/.test(e.id)) out.push({ severity: "warning", source: "client", kind: "id", text: `id "${e.id}": keep ids to letters, digits and _ (scripts compare them as strings, and the window id must be alphanumeric)`, path, key: "id" });
      if (e.id) ids.set(e.id, [...(ids.get(e.id) ?? []), path]);
    }
    if (t === "group") {
      const n = Array.isArray(e.children) ? e.children.length : 0;
      if (n !== 1) out.push({ severity: n ? "error" : "warning", source: "client", kind: "group", text: n ? `a group holds one child (NuiGroup); this one has ${n}` : "the group is empty", path });
    }
    if (t === "list") {
      const tpl = Array.isArray(e.row_template) ? e.row_template : [];
      if (!tpl.length) out.push({ severity: "warning", source: "client", kind: "list", text: "the list's row template has no cells: its rows are empty", path, key: "row_template" });
      if (tpl.length > MAX_TEMPLATE_CELLS) out.push({ severity: "error", source: "client", kind: "list", text: `${tpl.length} template cells: at most ${MAX_TEMPLATE_CELLS}`, path, key: "row_template" });
      tpl.forEach((c, i) => {
        if (!Array.isArray(c) || c.length !== 3 || !isObject(c[0]) || !isNum(c[1]) || typeof c[2] !== "boolean") {
          out.push({ severity: "error", source: "client", kind: "list", text: `template cell ${i} is not [element, width, variable] (NuiListTemplateCell)`, path, key: "row_template" });
        } else if (c[1] < 0) out.push({ severity: "error", source: "client", kind: "list", text: `template cell ${i}'s width is negative`, path, key: "row_template" });
      });
      if (e.scrollbars === 4) out.push({ severity: "warning", source: "client", kind: "list", text: "a list's scrollbars cannot be AUTO (nw_inc_nui.nss): use NONE, X, Y or BOTH", path, key: "scrollbars" });
    }
    if (t === "combo") {
      comboEntries(e, path, win, o.binds ?? {}, inList.has(path.join()), out);
      comboTooltip(e, path, win, o.binds ?? {}, out);
    }
    if ((t === "image" || t === "button_image") && e.foreground_color !== undefined) {
      out.push({ severity: "warning", source: "client", kind: "cannot be styled", text: "images take no tint: a foreground colour does nothing to an image", path, key: "foreground_color" });
    }
    if (e.draw_list !== undefined) {
      if (!Array.isArray(e.draw_list)) out.push({ severity: "error", source: "client", kind: "draw list", text: "draw_list is not an array (it cannot be bound: bind its items' values)", path, key: "draw_list" });
      else {
        checkProps([DRAW_LIST_SCISSOR], e, path, out, "", o);
        e.draw_list.forEach((it, i) => {
          const where = `draw_list[${i}]`;
          if (!isObject(it)) {
            out.push({ severity: "error", source: "client", kind: "draw list", text: `${where} is not an object`, path, key: where });
            return;
          }
          const props = DRAW_ITEM_PROPS[typeof it.type === "number" ? it.type : -1];
          if (!props) {
            out.push({ severity: "error", source: "client", kind: "draw list", text: `${where}: type ${JSON.stringify(it.type)} is none of the NUI_DRAW_LIST_ITEM_TYPE_* (0 to 7)`, path, key: where });
            return;
          }
          checkProps([...props, ...DRAW_ITEM_COMMON], it, path, out, where, o);
          const known = new Set(["type", "fill", "line_thickness", "color", "enabled", ...props.map((p) => p.key), ...DRAW_ITEM_COMMON.map((p) => p.key)]);
          unknownKeys(it, known, path, out, `a draw-list item (${where})`);
        });
      }
    }
  });
  // Ids inside list rows repeat by design (ed.nIndex tells the rows apart): only compare ids outside lists.
  for (const [id, paths] of ids) {
    const outside = paths.filter((p) => !inList.has(p.join()));
    if (outside.length > 1) {
      for (const p of outside) out.push({ severity: "warning", source: "client", kind: "duplicate id", text: `${outside.length} elements have the id "${id}": their events cannot be told apart`, path: p, key: "id" });
    }
  }
  return out;
}

export const EMPTY_COMBO_TEXT = "the list opens empty in game (looks like nothing happens)";

/**
 * A combo with no entries still opens, as a popup with no rows a few pixels high (docs/CLIENT-BEHAVIOUR.md#combo-boxes):
 * in game, clicking it seems to do nothing. Static entries are checked as they are; bound ones by the bind's sample
 * value (one per row in a list), and a bind with none gets a note asking for one.
 */
function comboEntries(e: JsonObject, path: ElemPath, win: JsonObject, binds: Binds, inList: boolean, out: Finding[]): void {
  const v = e.elements;
  const key = "elements";
  if (v === undefined || (Array.isArray(v) && !v.length)) {
    out.push({ severity: "warning", source: "client", kind: "empty combo", text: `no entries: ${EMPTY_COMBO_TEXT}`, path, key });
    return;
  }
  if (!isBind(v)) return;
  const name = (v as JsonObject).bind as string;
  const sample = boundValue(v, binds, win);
  if (sample === undefined || sample === null) {
    out.push({ severity: "info", source: "client", kind: "no sample value", text: `no sample value for bind "${name}": give it the entries the game sets, to check the combo and its open list (an empty list opens empty in game, which looks like nothing happens)`, path, key });
    return;
  }
  if (!Array.isArray(sample)) return; // a bad value, told by the bind-values panel
  if (!inList) {
    if (!sample.length) out.push({ severity: "warning", source: "client", kind: "empty combo", text: `bind "${name}"'s sample value has no entries: ${EMPTY_COMBO_TEXT}`, path, key });
    return;
  }
  // In a list, the bind holds one set of entries per row.
  const empty = sample.map((row, i) => (Array.isArray(row) && !row.length ? i : -1)).filter((i) => i >= 0);
  if (empty.length) {
    const rows = empty.length > 5 ? `${empty.slice(0, 5).join(", ")}, ...` : empty.join(", ");
    out.push({ severity: "warning", source: "client", kind: "empty combo", text: `bind "${name}"'s sample value has no entries in row${empty.length > 1 ? "s" : ""} ${rows}: ${EMPTY_COMBO_TEXT}`, path, key });
  }
}

export const COMBO_TOOLTIP_TEXT =
  "a combo cannot have a tooltip: the tooltip and the open list share the window's one popup, so hovering the combo shows the tooltip and closes the list every frame (clicking the combo only flashes it). Put the tooltip on the combo's label instead";

/**
 * A combo with a tooltip cannot be opened in game (docs/CLIENT-BEHAVIOUR.md#combo-boxes): Nuklear keeps one popup per
 * window, the tooltip takes it while the mouse is over the combo, and the open list closes. Only `tooltip`: a disabled
 * combo cannot open, so its `disabled_tooltip` is harmless. An empty tooltip shows nothing, and a bound one whose
 * sample value is empty is taken at its word.
 */
function comboTooltip(e: JsonObject, path: ElemPath, win: JsonObject, binds: Binds, out: Finding[]): void {
  const v = e.tooltip;
  if (v === undefined || v === null) return;
  const shown = isBind(v) ? boundValue(v, binds, win) : v;
  if (shown === "" || (isBind(v) && Array.isArray(shown) && shown.every((x) => x === ""))) return;
  out.push({ severity: "error", source: "client", kind: "combo tooltip", text: COMBO_TOOLTIP_TEXT, path, key: "tooltip" });
}

/** Problems with a bind name (the bind-values panel and the properties panel use it). */
export function bindNameFinding(name: string): string | null {
  if (!name) return "a bind needs a name";
  if (!/^[A-Za-z0-9_]+$/.test(name)) return "keep bind names to letters, digits and _";
  return null;
}
