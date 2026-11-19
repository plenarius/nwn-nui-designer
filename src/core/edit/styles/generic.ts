/**
 * Generic, parameterised style rules and the style file that configures them (styles/style.schema.json). A house
 * style is mostly numbers and lists (a spacing grid, a row height, a palette, a tooltip length); a style file picks the
 * rules it wants and gives their numbers, and the rules below do the checking. Rules that cannot be put as numbers go
 * in an optional JavaScript module the file names (`plugin`), loaded by the Node side (src/node/styles.ts) or by the
 * editor through the local API; it gets the helpers below as its argument, so it needs no imports.
 *
 * This file is pure (no Node, no DOM): the editor and `pnpm check` build a style from the same parsed JSON.
 */
import { type JsonObject, type JsonValue, isObject } from "../../model/types.js";
import { defaultMargin, marginOf } from "../../layout/layout.js";
import { windowChrome } from "../../model/window.js";
import { type StyleContext, type StyleRule, type StyleRuleSet, eachElem, isBound, runStyle, staticText, typeOf, valueOf, walkElems } from "../style.js";
import { getElem, kidsOf } from "../tree.js";
import type { Severity } from "../validate.js";

/** A style file that cannot be used: the file and the key, and what is wrong. */
export class StyleFileError extends Error {
  constructor(
    readonly file: string,
    readonly key: string,
    readonly reason: string,
  ) {
    super(`${file}: ${key ? `${key}: ` : ""}${reason}`);
    this.name = "StyleFileError";
  }
}

// --- shared helpers (also given to plugins) --------------------------------------------------------------------

/** The footprint: a size plus the element's real margin on each side (0 for a spacer, tabbar or options; layout.ts). */
export const fp = (size: number, e: JsonObject) => size + 2 * marginOf(e);

/**
 * How a size and its margin make the footprint, and what to set for the wanted footprint: the property panel shows
 * the size alone, so "a gap of 20" next to a width of 16 needs the margin spelled out.
 */
export function footprintFix(what: string, size: number, e: JsonObject, want: number): string {
  const m = marginOf(e);
  if (m === 0) return `${what} ${size}: make it ${want}`;
  const set = want - 2 * m;
  const how = set > 0 ? `set its margin to 0 and keep ${want}, or make it ${set} with the ${m} px margin` : `set its margin to 0`;
  return `${what} ${size} plus a ${m} px margin on each side${m === defaultMargin(e.type) ? " (the default)" : ""} takes ${size + 2 * m}: ${how}`;
}

/**
 * What the window's frame adds to its content: 8 on each side, and a title bar 33 high when there is one
 * (docs/CLIENT-BEHAVIOUR.md#window-frame): the client hides it only when the title is empty and the close and collapse
 * buttons are both off (windowChrome; bound values by their sample).
 */
export function frameOf(win: JsonObject, binds: Record<string, JsonValue> = {}): { w: number; h: number } {
  return { w: 16, h: windowChrome(win, binds).header ? 49 : 16 };
}

/**
 * A Close button: a button whose label is "Close", static or as its bind's sample value; or, with no sample value, a
 * bind named for it (close, close_label, btn_close, close_lbl, ...). Conservative on purpose: an id alone (close_btn
 * may be labelled "Done") or a label that merely contains "close" ("Close shop") is not taken for one.
 */
export function isCloseButton(ctx: StyleContext, e: JsonObject): boolean {
  if (typeOf(e) !== "button") return false;
  const v = valueOf(ctx, e.label);
  if (typeof v === "string") return /^\s*close\s*$/i.test(v);
  return v === undefined && isBound(e.label) && /^(btn_?|button_?)?close(_?(label|lbl|text|txt))?$/i.test(String((e.label as JsonObject).bind));
}

/** The geometry the window opens with (a bound one read from the binds and the profile). */
export function geometryOf(ctx: StyleContext): { w: number; h: number } | null {
  const g = valueOf(ctx, ctx.win.geometry);
  return isObject(g) && typeof g.w === "number" && typeof g.h === "number" ? { w: g.w, h: g.h } : null;
}

/** The longest string a (possibly per-row) sample value holds, or null if it holds none. */
export function longest(v: JsonValue | undefined): string | null {
  if (typeof v === "string") return v;
  if (!Array.isArray(v)) return null;
  const s = v.filter((x): x is string => typeof x === "string");
  return s.length ? s.reduce((a, b) => (b.length > a.length ? b : a)) : null;
}

/** "8", "8 or 16", "8, 16 or 24". */
export const orList = (xs: readonly (string | number)[]) => (xs.length < 2 ? String(xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** The allowed value nearest to v (a tie goes to the larger). */
const nearest = (v: number, allowed: readonly number[]) => allowed.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) || (Math.abs(b - v) === Math.abs(a - v) && b > a) ? b : a));

const CONTROLS = new Set(["button", "button_select", "check", "combo", "textedit", "options", "tabbar", "toggles"]);
/** What a row of controls may also hold: labels beside the controls, and plain spacers. */
const IN_CONTROL_ROW = new Set([...CONTROLS, "label", "spacer"]);
const TEXTY = new Set(["label", "button", "button_select", "check", "text", "textedit"]);

/** What a plugin's default export gets: the helpers rule writers use. */
export const PLUGIN_API = { eachElem, walkElems, typeOf, kidsOf, getElem, isBound, valueOf, staticText, isObject, fp, footprintFix, frameOf, isCloseButton, geometryOf, longest, marginOf, defaultMargin, orList };
export type PluginApi = typeof PLUGIN_API;

// --- the generic rules ----------------------------------------------------------------------------------------

type Rgb = [number, number, number];
type Params = Record<string, unknown>;

interface ParamSpec {
  kind: "number" | "numbers" | "strings" | "colours" | "string";
  default: unknown;
  description: string;
}

/** A generic rule: its parameters, and the rule it makes from them. */
export interface GenericRule {
  id: string;
  /** What it checks, for the schema and the docs. */
  description: string;
  severity: Severity;
  params: Record<string, ParamSpec>;
  title(p: Params): string;
  summary(p: Params): string;
  check(p: Params): StyleRule["check"];
}

const num = (p: Params, k: string) => p[k] as number;
const nums = (p: Params, k: string) => p[k] as number[];

export const GENERIC_RULES: GenericRule[] = [
  {
    id: "fixed-size",
    description: "Windows are not resizable.",
    severity: "warning",
    params: {},
    title: () => "Fixed size",
    summary: () => "Windows are not resizable (sizes are static, nothing reflows).",
    check: () => (ctx, report) => {
      // A bound resizable is read from its sample value (the dump's binds, the framework profile); with none, the
      // game decides and the rule cannot tell.
      const r = valueOf(ctx, ctx.win.resizable);
      if (r === undefined && isBound(ctx.win.resizable)) return;
      if (r !== false) report(null, "make the window not resizable (resizable: false): NUI sizes cannot be bound, so nothing reflows when it grows", "warning", "resizable");
    },
  },
  {
    id: "max-content",
    description: "The window's content (its geometry less the frame) is at most width x height.",
    severity: "warning",
    params: { width: { kind: "number", default: 1000, description: "Largest content width." }, height: { kind: "number", default: 720, description: "Largest content height." } },
    title: (p) => `At most ${num(p, "width")} x ${num(p, "height")}`,
    summary: (p) => `Content of at most ${num(p, "width")} x ${num(p, "height")}.`,
    check: (p) => (ctx, report) => {
      const g = geometryOf(ctx);
      if (!g) return;
      const fr = frameOf(ctx.win, ctx.binds);
      const cw = g.w - fr.w;
      const ch = g.h - fr.h;
      if (cw > num(p, "width") || ch > num(p, "height")) report(null, `the content is ${cw} x ${ch}: keep it to ${num(p, "width")} x ${num(p, "height")}, or split the window into steps`, "warning", "geometry");
    },
  },
  {
    id: "frame",
    description: "The geometry is the root's footprint plus the client's frame (16 wide, 49 tall or 16 with no title bar): no empty band.",
    severity: "warning",
    params: {},
    title: () => "Sized to its content",
    summary: () => "Geometry is the content's footprint plus the frame: 16 wide and 49 tall (16 with no title bar), so no empty band.",
    check: () => (ctx, report) => {
      const { win } = ctx;
      const g = geometryOf(ctx);
      const r = win.root;
      if (!g || !isObject(r)) return;
      const fr = frameOf(win, ctx.binds);
      const parts: string[] = [];
      if (typeof r.width === "number") {
        const want = fp(r.width, r) + fr.w;
        if (Math.abs(want - g.w) > 0.5) parts.push(`${g.w} wide where the root's footprint (${fp(r.width, r)}) + ${fr.w} is ${want}`);
      }
      if (typeof r.height === "number") {
        const want = fp(r.height, r) + fr.h;
        const bar = fr.h === 16 ? " (no title bar)" : "";
        if (Math.abs(want - g.h) > 0.5) parts.push(`${g.h} tall where the root's footprint (${fp(r.height, r)}) + ${fr.h}${bar} is ${want}`);
      }
      if (parts.length) report(null, `the window is ${parts.join(", and ")}`, "warning", "geometry");
    },
  },
  {
    id: "gaps",
    description: "A plain spacer in a row or column (a gap) has one of the allowed footprints; wider spacers are fillers, not gaps.",
    severity: "info",
    params: {
      allowed: { kind: "numbers", default: [8, 16], description: "The allowed gaps (footprints: size plus margins)." },
      fillerOver: { kind: "number", default: 32, description: "A spacer wider than this is a filler (it pushes what follows), not a gap." },
    },
    title: (p) => `Gaps of ${orList(nums(p, "allowed"))}`,
    summary: (p) => `Empty room between things is ${orList(nums(p, "allowed"))} (as a footprint). Fillers (over ${num(p, "fillerOver")}) are not gaps.`,
    check: (p) => ({ win }, report) => {
      const allowed = nums(p, "allowed");
      eachElem(win, (e, path, parent) => {
        if (typeOf(e) !== "spacer" || e.draw_list || e.id) return;
        const along = typeOf(parent) === "row" ? "width" : typeOf(parent) === "col" ? "height" : null;
        const v = along ? e[along] : undefined;
        if (typeof v !== "number") return;
        const f = fp(v, e);
        // A wide spacer is a filler (a footer's, pushing Close to the right), not a gap between things.
        if (f > num(p, "fillerOver")) return;
        if (!allowed.includes(f)) report(path, `a gap of ${f} where the grid's gaps are ${orList(allowed)}: ${footprintFix(along!, v, e, nearest(f, allowed))}`, "info", along!);
      });
    },
  },
  {
    id: "row-grid",
    description: "A row of controls (buttons, fields, combos, checks, with their labels and plain spacers) has this height (a footprint).",
    severity: "info",
    params: { height: { kind: "number", default: 36, description: "The control row's height (footprint)." } },
    title: (p) => `${num(p, "height")} px control rows`,
    summary: (p) => `A row of controls (buttons, fields, combos, checks, with their labels) is ${num(p, "height")} tall. Rows of other things (image tiles, a board, nested layouts) are not control rows.`,
    check: (p) => ({ win }, report) => {
      const h = num(p, "height");
      eachElem(win, (e, path) => {
        if (typeOf(e) !== "row" || typeof e.height !== "number") return;
        const kids = kidsOf(e);
        // A control row holds controls and nothing but controls, labels and plain spacers: a row with image
        // buttons (a tile row), images, drawn art, a list or a nested layout is something else and has its own height.
        if (!kids.some((k) => CONTROLS.has(typeOf(k)))) return;
        if (kids.some((k) => !IN_CONTROL_ROW.has(typeOf(k)) || (typeOf(k) === "spacer" && k.draw_list !== undefined))) return;
        const f = fp(e.height, e);
        if (f !== h) report(path, `a row of controls ${f} tall where the grid's control row is ${h}: ${footprintFix("height", e.height, e, h)}`, "info", "height");
      });
    },
  },
  {
    id: "control-height",
    description: "A control (button, field, combo, check, ...) with a set height has one of the standard heights (footprints).",
    severity: "info",
    params: { allowed: { kind: "numbers", default: [36], description: "The standard control heights (footprints: size plus margins)." } },
    title: (p) => `Controls ${orList(nums(p, "allowed"))} tall`,
    summary: (p) => `A control with a set height is ${orList(nums(p, "allowed"))} tall (as a footprint).`,
    check: (p) => ({ win }, report) => {
      const allowed = nums(p, "allowed");
      eachElem(win, (e, path) => {
        if (!CONTROLS.has(typeOf(e)) || typeof e.height !== "number") return;
        const f = fp(e.height, e);
        if (!allowed.includes(f)) report(path, `a control ${f} tall where the standard heights are ${orList(allowed)}: ${footprintFix("height", e.height, e, nearest(f, allowed))}`, "info", "height");
      });
    },
  },
  {
    id: "margins",
    description: "An element's explicit margin is one of the allowed values (an element without one keeps the client's default).",
    severity: "info",
    params: { allowed: { kind: "numbers", default: [0, 2, 4], description: "The allowed explicit margins." } },
    title: (p) => `Margins of ${orList(nums(p, "allowed"))}`,
    summary: (p) => `A margin set on an element is ${orList(nums(p, "allowed"))}; elements without one keep the default.`,
    check: (p) => ({ win }, report) => {
      const allowed = nums(p, "allowed");
      eachElem(win, (e, path) => {
        if (typeof e.margin === "number" && !allowed.includes(e.margin)) report(path, `a margin of ${e.margin} where the house margins are ${orList(allowed)}`, "info", "margin");
      });
    },
  },
  {
    id: "disabled-tip",
    description: "Every control that can be disabled has a disabled tooltip.",
    severity: "warning",
    params: {},
    title: () => "Disabled controls say why",
    summary: () => "Every control that can be disabled has a disabled tooltip saying what to do.",
    check: () => ({ win }, report) => {
      eachElem(win, (e, path) => {
        const en = e.enabled;
        if (en === undefined || en === true) return;
        if (e.disabled_tooltip === undefined) report(path, "this control can be disabled but has no disabled tooltip: say why, and what to do (\"Choose your domains first.\")", "warning", "disabled_tooltip");
      });
    },
  },
  {
    id: "tooltip-length",
    description: "A tooltip or disabled tooltip is one line of at most max characters (bound ones by their sample values).",
    severity: "warning",
    params: { max: { kind: "number", default: 60, description: "The longest tooltip, in characters." } },
    title: () => "Short tooltips",
    summary: (p) => `A tooltip or disabled tooltip is one short line, at most ${num(p, "max")} characters (the client never wraps it and draws "\\n" as "?"); longer help goes in the window as wrapped text. Bound ones are checked by their sample values.`,
    check: (p) => (ctx, report) => {
      const max = num(p, "max");
      eachElem(ctx.win, (e, path) => {
        for (const key of ["tooltip", "disabled_tooltip"]) {
          const s = longest(valueOf(ctx, e[key]));
          if (!s) continue;
          const what = key === "tooltip" ? "tooltip" : "disabled tooltip";
          const from = isBound(e[key]) ? ` (sample value of bind ${(e[key] as JsonObject).bind})` : "";
          const quoted = `"${s.length > 40 ? s.slice(0, 39) + "..." : s}"`;
          if (/[\r\n]/.test(s)) report(path, `the ${what} ${quoted}${from} has a line break: the client draws a tooltip on one line and shows "\\n" as "?"; make it one short line`, "warning", key);
          else if (s.length > max) report(path, `the ${what} ${quoted}${from} is ${s.length} characters: keep it to ${max} (one short line; the client never wraps it), and put longer help in the window`, "warning", key);
        }
      });
    },
  },
  {
    id: "no-help-text",
    description: "No static text element longer than maxChars (help paragraphs belong in tooltips or a help page).",
    severity: "warning",
    params: { maxChars: { kind: "number", default: 200, description: "The longest static text element, in characters." } },
    title: () => "No help paragraphs",
    summary: () => "Explanations go in tooltips or behind a \"?\" button to the Help page, not in the window.",
    check: (p) => ({ win }, report) => {
      eachElem(win, (e, path) => {
        if (typeOf(e) !== "text") return;
        const s = staticText(e.value);
        if (s && s.length > num(p, "maxChars")) report(path, `a ${s.length}-character paragraph in the window: put help in tooltips or on the system's Help page`, "warning", "value");
      });
    },
  },
  {
    id: "list-rows",
    description: "List rows that hold text are at least minHeight tall.",
    severity: "warning",
    params: { minHeight: { kind: "number", default: 32, description: "The smallest row_height for rows with text." } },
    title: (p) => `List rows of ${num(p, "minHeight")} or more`,
    summary: (p) => `List rows that hold text are at least ${num(p, "minHeight")} tall.`,
    check: (p) => ({ win }, report) => {
      const min = num(p, "minHeight");
      eachElem(win, (e, path) => {
        if (typeOf(e) !== "list") return;
        const rh = typeof e.row_height === "number" ? e.row_height : 25;
        const texty = kidsOf(e).some((k) => TEXTY.has(typeOf(k)) || (Array.isArray(k.draw_list) && k.draw_list.some((it) => isObject(it) && it.type === 4)));
        if (texty && rh < min) report(path, `rows ${rh} tall hold text: make them at least ${min}`, "warning", "row_height");
      });
    },
  },
  {
    id: "close-last",
    description: "The Close button is the window's last control (bottom right).",
    severity: "warning",
    params: {},
    title: () => "Close at the bottom right",
    summary: () => "The Close button is the window's last control, bottom right.",
    check: () => (ctx, report) => {
      const { win } = ctx;
      const leaves: number[][] = [];
      eachElem(win, (e, path) => {
        if (!kidsOf(e).length && typeOf(e) !== "spacer") leaves.push([...path]);
      });
      leaves.forEach((p, i) => {
        const e = getElem(win, p)!;
        if (isCloseButton(ctx, e) && i !== leaves.length - 1) report(p, "Close is not the last control: put it at the bottom right of the footer row", "warning");
      });
    },
  },
  {
    id: "close-width",
    description: "The Close button has this width (a footprint).",
    severity: "info",
    params: { width: { kind: "number", default: 120, description: "The Close button's width (footprint: size plus margins)." } },
    title: (p) => `Close is ${num(p, "width")} wide`,
    summary: (p) => `The Close button is ${num(p, "width")} wide (as a footprint), in every window.`,
    check: (p) => (ctx, report) => {
      const w = num(p, "width");
      eachElem(ctx.win, (e, path) => {
        if (isCloseButton(ctx, e) && typeof e.width === "number" && fp(e.width, e) !== w) {
          report(path, `Close is width ${e.width}, ${fp(e.width, e)} with its margins: make it ${w - (fp(e.width, e) - e.width)} (${w} with its margins), as in every window`, "info", "width");
        }
      });
    },
  },
  {
    id: "drawn-progress",
    description: "No NuiProgress: progress bars are drawn (a track rect and a bound fill rect).",
    severity: "info",
    params: { hint: { kind: "string", default: "draw the bar instead: a track rect and a fill rect whose rect is bound", description: "The note shown on each NuiProgress." } },
    title: () => "Drawn progress bars",
    summary: () => "Progress bars are drawn (a track rect and a bound fill rect), so their height and colour are chosen.",
    check: (p) => ({ win }, report) => {
      eachElem(win, (e, path) => {
        if (typeOf(e) === "progress") report(path, p.hint as string, "info");
      });
    },
  },
  {
    id: "palette",
    description: "Foreground and drawn colours come from the palette (rgb; alpha is free). Image items and drawn art (artItems or more shapes and no text) are not checked.",
    severity: "info",
    params: {
      colours: { kind: "colours", default: [[0, 0, 0], [255, 255, 255]], description: "The allowed colours, as [r, g, b]." },
      artItems: { kind: "number", default: 16, description: "A draw list of at least this many shapes and no text is drawn art, not checked." },
    },
    title: () => "The house colours",
    summary: () => "Colours come from the house palette. Drawn game art (image items, a board) is not checked.",
    check: (p) => ({ win }, report) => {
      const allowed = p.colours as Rgb[];
      const off = (c: unknown): c is Record<string, number> => isObject(c) && typeof c.r === "number" && !allowed.some(([r, g, b]) => r === c.r && g === c.g && b === c.b);
      const rgb = (c: Record<string, number>) => `${c.r}, ${c.g}, ${c.b}`;
      eachElem(win, (e, path) => {
        // One report per colour per element: the colour, and where it is used (the first key, and how many more).
        const seen = new Map<string, string[]>();
        const note = (c: Record<string, number>, key: string) => seen.set(rgb(c), [...(seen.get(rgb(c)) ?? []), key]);
        if (off(e.foreground_color)) note(e.foreground_color, "foreground_color");
        const items = Array.isArray(e.draw_list) ? e.draw_list.filter(isObject) : [];
        // Drawn art keeps the colours of the game's art: a board or tile grid (many shapes, no text) entirely, and
        // image items (type 5) always (their colour is not a text or line colour).
        const art = items.length >= num(p, "artItems") && !items.some((it) => it.type === 4);
        if (!art && Array.isArray(e.draw_list)) {
          e.draw_list.forEach((it, i) => {
            if (isObject(it) && it.type !== 5 && off(it.color)) note(it.color, `draw_list[${i}].color`);
          });
        }
        for (const [c, keys] of seen) {
          const where = keys.length === 1 ? (keys[0] === "foreground_color" ? "" : ` (${keys[0]!.replace(".color", "")})`) : ` (${keys.length} uses)`;
          report(path, `colour (${c}) is not one of the house colours${where}`, "info", keys[0]);
        }
      });
    },
  },
  {
    id: "fonts",
    description: "An element's static font is one of the allowed fonts.",
    severity: "info",
    params: { allowed: { kind: "strings", default: [], description: "The allowed font names (the skin's [[fonts]] names)." } },
    title: () => "House fonts",
    summary: (p) => `Elements use the house fonts (${orList(p.allowed as string[]) || "none listed"}).`,
    check: (p) => ({ win }, report) => {
      const allowed = (p.allowed as string[]).map((f) => f.toLowerCase());
      eachElem(win, (e, path) => {
        const f = staticText(e.font);
        if (f && !allowed.includes(f.toLowerCase())) report(path, `font "${f}" is not one of the house fonts (${orList(p.allowed as string[])})`, "info", "font");
      });
    },
  },
  {
    id: "label-budget",
    description: "A bound label or button is wide enough for its longest sample value at pxPerChar a character plus padding.",
    severity: "info",
    params: {
      pxPerChar: { kind: "number", default: 8, description: "Width budget per character." },
      labelPad: { kind: "number", default: 8, description: "Extra width for a label." },
      buttonPad: { kind: "number", default: 24, description: "Extra width for a button." },
    },
    title: (p) => `${num(p, "pxPerChar")} px a character`,
    summary: (p) => `A bound label is at least ${num(p, "pxPerChar")} px a character + ${num(p, "labelPad")} wide (a button + ${num(p, "buttonPad")}), for its longest sample value. Static text is measured by the layout check instead (clipped text).`,
    check: (p) => (ctx, report) => {
      // Only bound text: its real values are not known, so the budget leaves room for them. A static text either
      // fits or the layout reports it clipped; budgeting it too would report text that fits.
      eachElem(ctx.win, (e, path) => {
        const t = typeOf(e);
        const key = t === "label" ? "value" : t === "button" || t === "button_select" ? "label" : null;
        if (!key || !isBound(e[key]) || typeof e.width !== "number") return;
        const s = longest(valueOf(ctx, e[key]));
        if (!s) return;
        const need = num(p, "pxPerChar") * s.length + (t === "label" ? num(p, "labelPad") : num(p, "buttonPad"));
        if (e.width < need) report(path, `"${s.length > 30 ? s.slice(0, 29) + "..." : s}" (${s.length} characters, bind ${(e[key] as JsonObject).bind}) budgets ${need} px; it has ${e.width}`, "info", "width");
      });
    },
  },
  {
    id: "no-refresh",
    description: "No Refresh button: windows refresh themselves.",
    severity: "info",
    params: {},
    title: () => "No Refresh button",
    summary: () => "Windows refresh themselves on the events that change their data.",
    check: () => ({ win }, report) => {
      eachElem(win, (e, path) => {
        if (typeOf(e) === "button" && /^refresh$/i.test(staticText(e.label) ?? "")) report(path, "a Refresh button says the window is out of date: refresh it on the events that change its data", "info");
      });
    },
  },
];

const GENERIC = new Map(GENERIC_RULES.map((r) => [r.id, r]));
/** The keys every rule entry takes, besides its parameters. */
const COMMON = new Set(["enabled", "severity", "exempt", "title", "summary"]);
const SEVERITIES = new Set(["error", "warning", "info"]);
const TOP = new Set(["$schema", "$comment", "id", "title", "description", "source", "knownWindowKeys", "plugin", "rules"]);

/** A style file, parsed and checked: the set (generic rules), and the plugin to add, if any. */
export interface StyleDef {
  file: string;
  set: StyleRuleSet;
  /** The plugin's path as written (relative to the style file). */
  plugin: string | null;
  /** The rule entries the generic rules do not know: the plugin's rules (their enabled, severity, exempt...). */
  pluginEntries: Record<string, JsonObject>;
}

const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function checkParam(file: string, key: string, spec: ParamSpec, v: unknown): void {
  const bad = (what: string) => {
    throw new StyleFileError(file, key, `expected ${what}`);
  };
  const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  switch (spec.kind) {
    case "number":
      if (!isNum(v)) bad("a number");
      break;
    case "numbers":
      if (!Array.isArray(v) || !v.length || !v.every(isNum)) bad("a non-empty list of numbers");
      break;
    case "strings":
      if (!isStrList(v)) bad("a list of strings");
      break;
    case "string":
      if (typeof v !== "string" || !v) bad("a non-empty string");
      break;
    case "colours":
      if (!Array.isArray(v) || !v.every((c) => Array.isArray(c) && c.length === 3 && c.every((x) => Number.isInteger(x) && x >= 0 && x <= 255))) bad("a list of [r, g, b] colours (integers 0-255)");
      break;
  }
}

/** Wraps a rule with an entry's severity override (every report it makes takes that severity). */
function withSeverity(rule: StyleRule, severity: Severity | undefined): StyleRule {
  if (!severity) return rule;
  return { ...rule, check: (ctx, report) => rule.check(ctx, (path, text, _s, key) => report(path, text, severity, key)) };
}

function commonOf(file: string, key: string, entry: JsonObject): { enabled: boolean; severity?: Severity; exempt?: string[]; title?: string; summary?: string } {
  if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") throw new StyleFileError(file, `${key}.enabled`, "expected true or false");
  if (entry.severity !== undefined && !SEVERITIES.has(entry.severity as string)) throw new StyleFileError(file, `${key}.severity`, "expected error, warning or info");
  if (entry.exempt !== undefined && !isStrList(entry.exempt)) throw new StyleFileError(file, `${key}.exempt`, "expected a list of window names");
  for (const k of ["title", "summary"] as const) if (entry[k] !== undefined && (typeof entry[k] !== "string" || !entry[k])) throw new StyleFileError(file, `${key}.${k}`, "expected a non-empty string");
  return { enabled: entry.enabled !== false, severity: entry.severity as Severity | undefined, exempt: entry.exempt as string[] | undefined, title: entry.title as string | undefined, summary: entry.summary as string | undefined };
}

/**
 * A style file's parsed JSON as a rule set of generic rules; throws a StyleFileError naming the file and the key.
 * Rules run in the generic rules' order (then the plugin's, in its order); a rule not listed under `rules`, or listed
 * with `"enabled": false`, is off.
 */
export function parseStyleDef(json: unknown, file: string): StyleDef {
  if (!isObject(json)) throw new StyleFileError(file, "", "expected a JSON object");
  for (const k of Object.keys(json)) if (!TOP.has(k)) throw new StyleFileError(file, k, `unknown key (expected ${[...TOP].filter((t) => !t.startsWith("$")).join(", ")})`);
  if (typeof json.id !== "string" || !/^[a-z0-9][a-z0-9_.-]*$/i.test(json.id)) throw new StyleFileError(file, "id", "expected a name of letters, digits, '-', '_' or '.'");
  if (typeof json.title !== "string" || !json.title) throw new StyleFileError(file, "title", "expected a non-empty string");
  if (json.description !== undefined && typeof json.description !== "string") throw new StyleFileError(file, "description", "expected a string");
  if (json.source !== undefined && typeof json.source !== "string") throw new StyleFileError(file, "source", "expected a string");
  if (json.knownWindowKeys !== undefined && !isStrList(json.knownWindowKeys)) throw new StyleFileError(file, "knownWindowKeys", "expected a list of strings");
  if (json.plugin !== undefined && (typeof json.plugin !== "string" || !/\.m?js$/i.test(json.plugin))) throw new StyleFileError(file, "plugin", "expected the path of a .js or .mjs file");
  const rulesIn = json.rules ?? {};
  if (!isObject(rulesIn)) throw new StyleFileError(file, "rules", "expected an object of rule id: settings");

  const entries = new Map<string, JsonObject>();
  const pluginEntries: Record<string, JsonObject> = {};
  for (const [id, raw] of Object.entries(rulesIn)) {
    const entry = raw === true ? {} : raw === false ? { enabled: false } : raw;
    if (!isObject(entry)) throw new StyleFileError(file, `rules.${id}`, "expected an object (or true / false)");
    if (GENERIC.has(id)) entries.set(id, entry);
    else if (json.plugin !== undefined) {
      commonOf(file, `rules.${id}`, entry);
      pluginEntries[id] = entry;
    } else throw new StyleFileError(file, `rules.${id}`, `no such rule (expected ${GENERIC_RULES.map((r) => r.id).join(", ")}; a rule of your own needs a plugin)`);
  }

  const rules: StyleRule[] = [];
  for (const g of GENERIC_RULES) {
    const entry = entries.get(g.id);
    if (!entry) continue;
    const key = `rules.${g.id}`;
    const c = commonOf(file, key, entry);
    const params: Params = {};
    for (const [k, v] of Object.entries(entry)) {
      if (COMMON.has(k) || k === "$comment") continue;
      const spec = g.params[k];
      if (!spec) throw new StyleFileError(file, `${key}.${k}`, `unknown parameter (${Object.keys(g.params).length ? `expected ${Object.keys(g.params).join(", ")}` : "the rule takes none"})`);
      checkParam(file, `${key}.${k}`, spec, v);
      params[k] = v;
    }
    for (const [k, spec] of Object.entries(g.params)) if (!(k in params)) params[k] = spec.default;
    if (!c.enabled) continue;
    rules.push(withSeverity({ id: g.id, title: c.title ?? g.title(params), summary: c.summary ?? g.summary(params), exempt: c.exempt, check: g.check(params) }, c.severity));
  }
  return {
    file,
    plugin: (json.plugin as string | undefined) ?? null,
    pluginEntries,
    set: { id: json.id, name: json.title, description: (json.description as string | undefined) ?? "", source: json.source as string | undefined, knownWindowKeys: json.knownWindowKeys as string[] | undefined, rules },
  };
}

/**
 * Adds a plugin's rules to a parsed style. exported is the module's default export: a list of rules, or a function
 * given (api, style JSON's plugin entries) that returns one. Each rule has id, title, summary and check, as StyleRule;
 * an entry under `rules` with the rule's id turns it off or sets its severity, exemptions, title or summary.
 */
export function addPluginRules(def: StyleDef, exported: unknown): StyleRuleSet {
  const where = def.plugin ?? "plugin";
  const list = typeof exported === "function" ? (exported as (api: PluginApi, entries: Record<string, JsonObject>) => unknown)(PLUGIN_API, def.pluginEntries) : exported;
  if (!Array.isArray(list)) throw new StyleFileError(def.file, "plugin", `${where}: the default export must be a list of rules or a function that returns one`);
  const rules = [...def.set.rules];
  const seen = new Set(rules.map((r) => r.id));
  list.forEach((r: unknown, i) => {
    const rr = r as StyleRule;
    if (typeof r !== "object" || r === null || typeof rr.id !== "string" || !rr.id || typeof rr.title !== "string" || typeof rr.check !== "function") throw new StyleFileError(def.file, "plugin", `${where}: rule ${i} needs an id, a title and a check function`);
    if (seen.has(rr.id)) throw new StyleFileError(def.file, "plugin", `${where}: rule id ${rr.id} is used twice`);
    seen.add(rr.id);
    const entry = def.pluginEntries[rr.id];
    const c = entry ? commonOf(def.file, `rules.${rr.id}`, entry) : { enabled: true as const };
    if (!c.enabled) return;
    rules.push(withSeverity({ id: rr.id, title: c.title ?? rr.title, summary: c.summary ?? rr.summary ?? "", exempt: c.exempt ?? rr.exempt, check: (ctx, report) => {
          // A plugin's mistake is its rule's finding, not the editor's crash.
          try {
            rr.check(ctx, report);
          } catch (e) {
            report(null, `the rule failed (${where}): ${e instanceof Error ? e.message : String(e)}`, "error");
          }
        } }, c.severity));
  });
  const unknown = Object.keys(def.pluginEntries).filter((id) => !seen.has(id));
  if (unknown.length) throw new StyleFileError(def.file, `rules.${unknown[0]}`, `no such rule in the generic rules or ${where}`);
  return { ...def.set, rules };
}

export { runStyle };
