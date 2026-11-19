/**
 * The Layonara rule set as TypeScript, as it was before it became styles/layonara.json: kept only for the
 * equivalence test (tests/styles.test.ts), which checks the style file finds exactly what this did.
 *
 * Layonara's house style for NUI windows, as checks. It ships as an example of a style rule set: a real server's rules,
 * to copy and adapt for your own (write a StyleRuleSet like this one and list it in styles/index.ts).
 *
 * The guide itself is nwn-module's docs/NUI-STYLE.md (checked against origin/ee on 2026-11-17); these rules are
 * written here in our own words and keep only what can be checked from a window's JSON: the numbers (the 36 px row,
 * the 8 and 16 px gaps, the frame of + 16 wide and + 49 tall, the 1000 x 720 limit, the colour palette) are the
 * guide's. The frame numbers are the client's own (docs/CLIENT-BEHAVIOUR.md#window-frame).
 *
 * Each rule was decided from an audit of Layonara's windows against this set (DESIGN.md, "Problems and house style"):
 * what a rule skips (tile rows, footer fillers, static text the layout already measures, game art) is deliberate.
 *
 * Guide-only (not checked, because a check could not tell them apart precisely from the JSON): a heading is 28 tall,
 * a drawn text line 18-20 for a name line and 16 for a secondary line. A heading is only a gold label to the JSON (and
 * a gold label is also a title line, 40, or a badge), and a drawn line's role (name or secondary) is not in the JSON.
 */
import { type JsonObject, type JsonValue, isObject } from "../src/core/model/types.js";
import { type StyleContext, type StyleRuleSet, eachElem, isBound, staticText, typeOf, valueOf } from "../src/core/edit/style.js";
import { getElem, kidsOf } from "../src/core/edit/tree.js";
import { defaultMargin, marginOf } from "../src/core/layout/layout.js";
import { windowChrome } from "../src/core/model/window.js";

/** The footprint: a size plus the element's real margin on each side (0 for a spacer, tabbar or options; layout.ts). */
const fp = (size: number, e: JsonObject) => size + 2 * marginOf(e);
/**
 * How a size and its margin make the footprint, and what to set for the wanted footprint: the property panel shows
 * the size alone, so "a gap of 20" next to a width of 16 needs the margin spelled out.
 */
function footprintFix(what: string, size: number, e: JsonObject, want: number): string {
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

/** The palette of the guide's named colours (rgb; alpha is free). */
const PALETTE: [number, number, number][] = [
  [222, 184, 80],
  [235, 225, 200],
  [200, 192, 176],
  [165, 160, 150],
  [140, 135, 128],
  [150, 210, 150],
  [240, 160, 120],
  [235, 100, 90],
  [70, 64, 56],
  [110, 100, 86],
  [55, 50, 44],
  [214, 198, 160],
  [128, 120, 106],
  [0, 0, 0],
  [255, 255, 255],
];

/**
 * The achievements' level colours (Achv_LevelColor, nwn-module achv_i_show.nss: notable is the gold above): a level's
 * own colour, allowed besides the palette.
 */
const LEVEL_COLOURS: [number, number, number][] = [
  [255, 150, 60],
  [190, 120, 240],
  [225, 225, 225],
];

const CONTROLS = new Set(["button", "button_select", "check", "combo", "textedit", "options", "tabbar", "toggles"]);
/** What a row of controls may also hold: labels beside the controls, and plain spacers. */
const IN_CONTROL_ROW = new Set([...CONTROLS, "label", "spacer"]);
/** A spacer wider than this (a footprint) is a filler that pushes what follows to the right, not a gap. */
const FILLER = 32;
/** A draw list of at least this many shapes and no text is drawn art (a board, a grid of tiles), not styled text. */
const ART_ITEMS = 16;

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

/** The geometry and resizable flag the window opens with (bound ones read from the binds and the profile). */
function geometryOf(ctx: StyleContext): { w: number; h: number } | null {
  const g = valueOf(ctx, ctx.win.geometry);
  return isObject(g) && typeof g.w === "number" && typeof g.h === "number" ? { w: g.w, h: g.h } : null;
}

/** The longest string a (possibly per-row) sample value holds, or null if it holds none. */
function longest(v: JsonValue | undefined): string | null {
  if (typeof v === "string") return v;
  if (!Array.isArray(v)) return null;
  const s = v.filter((x): x is string => typeof x === "string");
  return s.length ? s.reduce((a, b) => (b.length > a.length ? b : a)) : null;
}
/** The longest tooltip: one short line (docs/CLIENT-BEHAVIOUR.md#tooltips: the client never wraps one). */
export const TOOLTIP_MAX = 60;
const TEXTY = new Set(["label", "button", "button_select", "check", "text", "textedit"]);

export const LAYONARA: StyleRuleSet = {
  id: "layonara",
  name: "Layonara (example)",
  description: "Layonara's NUI house style, included as an example of a style rule set to copy and adapt: fixed-size windows sized to their content, one spacing grid, no help paragraphs, short one-line tooltips, every disabled control explains itself.",
  source: "nwn-module docs/NUI-STYLE.md",
  // Layonara's NUI framework (nui_i_main.nss) keeps its own data in these window keys; the client ignores them.
  knownWindowKeys: ["event_data", "formfile", "id", "local_version", "profiles", "subforms", "user_data"],
  rules: [
    {
      id: "fixed-size",
      title: "Fixed size",
      summary: "Windows are not resizable (sizes are static, nothing reflows). Layonara exempts the customisation window.",
      exempt: ["cust"],
      check(ctx, report) {
        // A bound resizable is read from its sample value (the dump's binds, the framework profile); with none, the
        // game decides and the rule cannot tell.
        const r = valueOf(ctx, ctx.win.resizable);
        if (r === undefined && isBound(ctx.win.resizable)) return;
        if (r !== false) report(null, "make the window not resizable (resizable: false): NUI sizes cannot be bound, so nothing reflows when it grows", "warning", "resizable");
      },
    },
    {
      id: "max-content",
      title: "At most 1000 x 720",
      summary: "Content of at most 1000 x 720, so the window fits 1920 x 1080 at UI scale 1.0 with the quickbar and chat.",
      check(ctx, report) {
        const { win } = ctx;
        const g = geometryOf(ctx);
        if (!g) return;
        const fr = frameOf(win, ctx.binds);
        const cw = g.w - fr.w;
        const ch = g.h - fr.h;
        if (cw > 1000 || ch > 720) report(null, `the content is ${cw} x ${ch}: keep it to 1000 x 720, or split the window into steps`, "warning", "geometry");
      },
    },
    {
      id: "frame",
      title: "Sized to its content",
      summary: "Geometry is the content's footprint plus the frame: 16 wide and 49 tall (16 with no title bar), so no empty band.",
      check(ctx, report) {
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
      title: "Gaps of 8 or 16",
      summary: "Empty room between things is 8 or 16 (as a footprint); the 4 between controls comes from their margins. Fillers (over 32) are not gaps.",
      check({ win }, report) {
        eachElem(win, (e, path, parent) => {
          if (typeOf(e) !== "spacer" || e.draw_list || e.id) return;
          const along = typeOf(parent) === "row" ? "width" : typeOf(parent) === "col" ? "height" : null;
          const v = along ? e[along] : undefined;
          if (typeof v !== "number") return;
          const f = fp(v, e);
          // A wide spacer is a filler (the footer's, pushing Close to the right), not a gap between things.
          if (f > FILLER) return;
          if (f !== 8 && f !== 16) {
            const want = f < 12 ? 8 : 16;
            report(path, `a gap of ${f} where the grid's gaps are 8 or 16: ${footprintFix(along!, v, e, want)}`, "info", along!);
          }
        });
      },
    },
    {
      id: "row-grid",
      title: "36 px control rows",
      summary: "A row of controls (buttons, fields, combos, checks, with their labels) is 36 tall. Rows of other things (image tiles, a board, nested layouts) are not control rows.",
      check({ win }, report) {
        eachElem(win, (e, path) => {
          if (typeOf(e) !== "row" || typeof e.height !== "number") return;
          const kids = kidsOf(e);
          // A control row holds controls and nothing but controls, labels and plain spacers: a row with image
          // buttons (a tile row), images, drawn art, a list or a nested layout is something else and has its own height.
          if (!kids.some((k) => CONTROLS.has(typeOf(k)))) return;
          if (kids.some((k) => !IN_CONTROL_ROW.has(typeOf(k)) || (typeOf(k) === "spacer" && k.draw_list !== undefined))) return;
          const f = fp(e.height, e);
          if (f !== 36) report(path, `a row of controls ${f} tall where the grid's control row is 36: ${footprintFix("height", e.height, e, 36)}`, "info", "height");
        });
      },
    },
    {
      id: "disabled-tip",
      title: "Disabled controls say why",
      summary: "Every control that can be disabled has a disabled tooltip saying what to do.",
      check({ win }, report) {
        eachElem(win, (e, path) => {
          const en = e.enabled;
          if (en === undefined || en === true) return;
          if (e.disabled_tooltip === undefined) report(path, "this control can be disabled but has no disabled tooltip: say why, and what to do (\"Choose your domains first.\")", "warning", "disabled_tooltip");
        });
      },
    },
    {
      id: "tooltip-length",
      title: "Short tooltips",
      summary: `A tooltip or disabled tooltip is one short line, at most ${TOOLTIP_MAX} characters (the client never wraps it and draws "\\n" as "?"); longer help goes in the window as wrapped text. Bound ones are checked by their sample values. Layonara exempts the gods window (its deity titles are game data).`,
      exempt: ["gods"],
      check(ctx, report) {
        eachElem(ctx.win, (e, path) => {
          for (const key of ["tooltip", "disabled_tooltip"]) {
            const s = longest(valueOf(ctx, e[key]));
            if (!s) continue;
            const what = key === "tooltip" ? "tooltip" : "disabled tooltip";
            const from = isBound(e[key]) ? ` (sample value of bind ${(e[key] as JsonObject).bind})` : "";
            const quoted = `"${s.length > 40 ? s.slice(0, 39) + "..." : s}"`;
            if (/[\r\n]/.test(s)) report(path, `the ${what} ${quoted}${from} has a line break: the client draws a tooltip on one line and shows "\\n" as "?"; make it one short line`, "warning", key);
            else if (s.length > TOOLTIP_MAX) report(path, `the ${what} ${quoted}${from} is ${s.length} characters: keep it to ${TOOLTIP_MAX} (one short line; the client never wraps it), and put longer help in the window`, "warning", key);
          }
        });
      },
    },
    {
      id: "no-help-text",
      title: "No help paragraphs",
      summary: "Explanations go in tooltips or behind a \"?\" button to the Help page, not in the window.",
      check({ win }, report) {
        eachElem(win, (e, path) => {
          if (typeOf(e) !== "text") return;
          const s = staticText(e.value);
          if (s && s.length > 200) report(path, `a ${s.length}-character paragraph in the window: put help in tooltips or on the system's Help page`, "warning", "value");
        });
      },
    },
    {
      id: "list-rows",
      title: "List rows of 32 or more",
      summary: "List rows that hold text are at least 32 tall (a 24 row cuts the 17 px font).",
      check({ win }, report) {
        eachElem(win, (e, path) => {
          if (typeOf(e) !== "list") return;
          const rh = typeof e.row_height === "number" ? e.row_height : 25;
          const texty = kidsOf(e).some((k) => TEXTY.has(typeOf(k)) || (Array.isArray(k.draw_list) && k.draw_list.some((it) => isObject(it) && it.type === 4)));
          if (texty && rh < 32) report(path, `rows ${rh} tall hold text: make them at least 32`, "warning", "row_height");
        });
      },
    },
    {
      id: "close-last",
      title: "Close at the bottom right",
      summary: "The Close button is the window's last control, bottom right.",
      check(ctx, report) {
        const { win } = ctx;
        const leaves: number[][] = [];
        eachElem(win, (e, path) => {
          if (!kidsOf(e).length && typeOf(e) !== "spacer") leaves.push([...path]);
        });
        leaves.forEach((p, i) => {
          const e = getElem(win, p)!;
          if (isCloseButton(ctx, e) && i !== leaves.length - 1) {
            report(p, "Close is not the last control: put it at the bottom right of the footer row", "warning");
          }
        });
      },
    },
    {
      id: "close-width",
      title: "Close is 120 wide",
      summary: "The Close button is 120 wide (footprint: width 116 with the default margin), in every window.",
      check(ctx, report) {
        eachElem(ctx.win, (e, path) => {
          // A footprint, as the grid's other sizes: width 116 with the default 2 px margin, as achv's Close.
          if (isCloseButton(ctx, e) && typeof e.width === "number" && fp(e.width, e) !== 120) {
            report(path, `Close is width ${e.width}, ${fp(e.width, e)} with its margins: make it ${120 - (fp(e.width, e) - e.width)} (120 with its margins), as in every window`, "info", "width");
          }
        });
      },
    },
    {
      id: "drawn-progress",
      title: "Drawn progress bars",
      summary: "Progress bars are drawn (a track rect and a bound fill rect), so their height and colour are chosen.",
      check({ win }, report) {
        eachElem(win, (e, path) => {
          if (typeOf(e) === "progress") report(path, "draw the bar instead: a track rect (55, 50, 44) and a gold fill whose rect is bound, with the figures above it", "info");
        });
      },
    },
    {
      id: "palette",
      title: "The house colours",
      summary: "Colours come from the named palette (gold headings, name, body, muted, good, short, blocked, separator, frame, track) or the achievement levels'. Drawn game art (image items, a board) is not checked.",
      check({ win }, report) {
        const allowed = [...PALETTE, ...LEVEL_COLOURS];
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
          const art = items.length >= ART_ITEMS && !items.some((it) => it.type === 4);
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
      id: "label-budget",
      title: "8 px a character",
      summary: "A bound label is at least 8 px a character + 8 wide (a button + 24), for its longest sample value. Static text is measured by the layout check instead (clipped text).",
      check(ctx, report) {
        // Only bound text: its real values are not known, so the budget leaves room for them. A static text either
        // fits or the layout reports it clipped; budgeting it too would report text that fits.
        eachElem(ctx.win, (e, path) => {
          const t = typeOf(e);
          const key = t === "label" ? "value" : t === "button" || t === "button_select" ? "label" : null;
          if (!key || !isBound(e[key]) || typeof e.width !== "number") return;
          const s = longest(valueOf(ctx, e[key]));
          if (!s) return;
          const need = 8 * s.length + (t === "label" ? 8 : 24);
          if (e.width < need) report(path, `"${s.length > 30 ? s.slice(0, 29) + "..." : s}" (${s.length} characters, bind ${(e[key] as JsonObject).bind}) budgets ${need} px; it has ${e.width}`, "info", "width");
        });
      },
    },
    {
      id: "no-refresh",
      title: "No Refresh button",
      summary: "Windows refresh themselves on the events that change their data.",
      check({ win }, report) {
        eachElem(win, (e, path) => {
          if (typeOf(e) === "button" && /^refresh$/i.test(staticText(e.label) ?? "")) report(path, "a Refresh button says the window is out of date: refresh it on the events that change its data", "info");
        });
      },
    },
  ],
};
