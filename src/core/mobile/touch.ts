/**
 * What nss/nui_touch.nss does to a window for a touch client, in TypeScript: NuiTouch_Window and NuiTouch_Rect for
 * a client profile, step for step (controls with a set height grown, lists' cells narrowed to the wider inset, then
 * row heights, cell widths and draw-list coordinates divided by the density d, the position by d / s). The tests
 * check that its constants are the script's, and that the preview (transform.ts, preview.ts) of a window it made
 * lays out as the desktop window, at GUI scales 1.0 and 1.6. Desktop-like clients get the window unchanged.
 */
import { type JsonObject, type JsonValue, isObject } from "../model/types.js";
import type { ClientProfile } from "./client.js";
import { DEFAULT_ROW_HEIGHT, DRAW_COORD_KEYS } from "./transform.js";

/** nui_touch.nss's numbers (NUI_TOUCH_*), by their names there without the prefix. */
export const NUI_TOUCH = {
  THIN_CELL: 4,
  FRAME_KW: 32,
  FRAME_KH: 66,
  FRAME_SLACK: 6,
  CORNER: 20,
  EXTRA_CTRL: 2,
  BTN_IN: 2.5,
  LIST_IN: 4,
  LIST_IN_IOS: 4.64,
  LIST_SLACK: 3,
  SCROLLBAR_W: 18,
  ROW_SPACING: 4,
  ROW_HEIGHT: DEFAULT_ROW_HEIGHT,
} as const;

/** NUI_SCROLLBARS_* (nw_inc_nui). */
const SB = { NONE: 0, X: 1, Y: 2, BOTH: 3, AUTO: 4 } as const;

const num = (v: JsonValue | undefined): v is number => typeof v === "number";
const numOr = (e: JsonObject, k: string, d: number) => (num(e[k]) ? (e[k] as number) : d);
const fixed = (e: JsonObject, width: boolean) => numOr(e, width ? "width" : "height", -1);
const margins = (e: JsonObject) => {
  let m = numOr(e, "margin", -1);
  if (m < 0) m = ["spacer", "tabbar", "options"].includes(String(e.type)) ? 0 : 2;
  return 2 * m;
};
const border = (e: JsonObject) => typeof e.border !== "boolean" || e.border;
const scrollbars = (e: JsonObject, d: number) => (Number.isInteger(e.scrollbars) ? (e.scrollbars as number) : d);
const kids = (e: JsonObject): JsonValue[] | null => (Array.isArray(e.children) ? e.children : null);
const cells = (e: JsonObject): JsonValue[][] | null => (Array.isArray(e.row_template) ? (e.row_template as JsonValue[][]) : null);

/** The client's size factor as nui_touch.nss sees it: d on a touch client, 1 on desktop-like ones. */
export const touchDensity = (p: ClientProfile) => (p.pointBased ? p.d : 1);
export const controlGrowth = (p: ClientProfile) => (NUI_TOUCH.EXTRA_CTRL * (touchDensity(p) - 1)) / p.s;
export const buttonTextIn = (p: ClientProfile) => (NUI_TOUCH.BTN_IN * (touchDensity(p) - 1)) / p.s;
export function listInsetExtra(p: ClientProfile): number {
  const d = touchDensity(p);
  if (d === 1) return 0;
  return Math.max(0, (NUI_TOUCH.LIST_IN_IOS * d) / p.s - NUI_TOUCH.LIST_IN + NUI_TOUCH.LIST_SLACK);
}
export function frameExtra(p: ClientProfile, height: boolean): number {
  if (!p.pointBased) return 0;
  const k = Math.max(0, ((height ? NUI_TOUCH.FRAME_KH : NUI_TOUCH.FRAME_KW) * (p.d - 1)) / 2);
  return k / (p.s * p.s) + NUI_TOUCH.FRAME_SLACK;
}

/** NuiTouch_DivGeom. */
export function divGeom(v: JsonValue, f: number): JsonValue {
  if (num(v)) return v / f;
  if (Array.isArray(v)) return v.map((x) => divGeom(x, f));
  if (isObject(v) && typeof v.bind !== "string") {
    const o: JsonObject = { ...v };
    for (const k of ["x", "y", "w", "h"]) if (num(o[k])) o[k] = (o[k] as number) / f;
    return o;
  }
  return v;
}

function drawItem(it: JsonValue, f: number): JsonValue {
  if (!isObject(it)) return it;
  const o: JsonObject = { ...it };
  for (const k of DRAW_COORD_KEYS) if (o[k] !== undefined) o[k] = divGeom(o[k]!, f);
  if (num(o.line_thickness)) {
    const t = o.line_thickness;
    o.line_thickness = Math.max(t / f, Math.min(t, 1));
  }
  return o;
}

/** _NuiTouch_Divide. */
function divide(e: JsonValue, f: number): JsonValue {
  if (!isObject(e)) return e;
  const o: JsonObject = { ...e };
  const ks = kids(o);
  if (ks) o.children = ks.map((c) => divide(c, f));
  if (o.type === "list") {
    o.row_height = numOr(o, "row_height", NUI_TOUCH.ROW_HEIGHT) / f;
    const t = cells(o);
    if (t) {
      o.row_template = t
        .filter((c) => !(t.length > 1 && isObject(c[0]) && c[0].type === "spacer" && num(c[1]) && c[1] <= NUI_TOUCH.THIN_CELL))
        .map((c) => {
          const n = [...c];
          n[0] = divide(c[0]!, f);
          if (num(c[1])) n[1] = c[1] / f;
          return n;
        });
    }
  }
  if (Array.isArray(o.draw_list)) o.draw_list = o.draw_list.map((it) => drawItem(it, f));
  return o;
}

const CONTROLS = new Set(["button", "button_select", "combo", "check", "textedit", "slider", "sliderf", "tabbar"]);

/** NuiTouch_GrowControls: the element and how much taller it became. */
export function growControls(e: JsonValue, grow: number): [JsonValue, number] {
  if (!isObject(e) || grow <= 0) return [e, 0];
  if (isObject(e.root)) {
    const [r, g] = growControls(e.root, grow);
    return [{ ...e, root: r }, g];
  }
  const o: JsonObject = { ...e };
  const h = fixed(o, false);
  let grown = CONTROLS.has(String(o.type)) && h >= 0 ? grow : 0;
  const ks = kids(o);
  if (ks) {
    const col = o.type === "col";
    o.children = ks.map((c) => {
      const [n, g] = growControls(c, grow);
      grown = col ? grown + g : Math.max(grown, g);
      return n;
    });
  }
  const t = cells(o);
  if (t) {
    let row = 0;
    o.row_template = t.map((c) => {
      const [n, g] = growControls(c[0]!, grow);
      row = Math.max(row, g);
      const out = [...c];
      out[0] = n;
      return out;
    });
    if (row > 0) o.row_height = numOr(o, "row_height", NUI_TOUCH.ROW_HEIGHT) + row;
    grown = 0;
  }
  if (h >= 0 && grown > 0) o.height = h + grown;
  return [o, grown];
}

const sumWidths = (t: JsonValue[][] | null) => (t ?? []).reduce((a, c) => a + (num(c[1]) ? c[1] : 0), 0);
function listRoom(w: number, scroll: number, inset: number): number {
  const bar = scroll === SB.Y || scroll === SB.BOTH || scroll === SB.AUTO;
  return w - 2 * inset - (bar ? NUI_TOUCH.SCROLLBAR_W : 0);
}

/** NuiTouch_ListCut. */
export function listCut(p: ClientProfile, listW: number, width: number, scroll: number = SB.Y): number {
  if (touchDensity(p) === 1) return 0;
  return Math.max(0, width - listRoom(listW, scroll, NUI_TOUCH.LIST_IN + listInsetExtra(p)));
}

function narrowPos(v: JsonValue, w: number, cut: number): JsonValue {
  if (!isObject(v) || !num(v.x)) return v;
  if (v.x >= w / 2) return { ...v, x: v.x - cut };
  if (num(v.w) && v.x + v.w > w - 8) return { ...v, w: Math.max(0, v.w - cut) };
  return v;
}

function narrowDraw(e: JsonObject, w: number, cut: number): JsonObject {
  if (!Array.isArray(e.draw_list) || w <= 0) return e;
  const draw = e.draw_list.map((it) => {
    if (!isObject(it)) return it;
    if (it.type === 6) {
      // NUI_DRAW_LIST_ITEM_TYPE_LINE: each end on its own.
      const a = isObject(it.a) ? it.a : {};
      const b = isObject(it.b) ? it.b : {};
      const ax = num(a.x) ? a.x : 0;
      const bx = num(b.x) ? b.x : 0;
      const right = ax >= w / 2 && bx >= w / 2;
      const o: JsonObject = { ...it };
      if (num(a.x) && (right || ax > w - 8)) o.a = { ...a, x: ax - cut };
      if (num(b.x) && (right || bx > w - 8)) o.b = { ...b, x: bx - cut };
      return o;
    }
    return it.rect !== undefined ? { ...it, rect: narrowPos(it.rect, w, cut) } : it;
  });
  return { ...e, draw_list: draw };
}

function narrowCell(t: JsonValue[][], i: number, cut: number): JsonValue[][] {
  const c = t[i]!;
  const w = num(c[1]) ? c[1] : 0;
  let inner = c[0] as JsonObject;
  const own = isObject(inner) && fixed(inner, true) >= 0;
  if (isObject(inner)) {
    if (!own) inner = { ...inner, width: w };
    inner = narrow(inner, cut) as JsonObject;
    if (!own) {
      const { width: _w, ...rest } = inner;
      inner = rest;
    }
  }
  const out = t.slice();
  const n = [...c];
  n[0] = inner;
  n[1] = Math.max(0, w - cut);
  out[i] = n;
  return out;
}

function narrowCells(list: JsonObject, cut: number): JsonObject {
  let t = cells(list);
  if (cut <= 0 || !t || !t.length) return list;
  let widest = -1;
  let variable = -1;
  let wMax = -1;
  t.forEach((c, i) => {
    const w = num(c[1]) ? c[1] : 0;
    if (variable < 0 && c[2] === true) variable = i;
    else if (w > wMax) {
      wMax = w;
      widest = i;
    }
  });
  if (variable >= 0) {
    const v = t[variable]![1];
    const take = Math.min(cut, num(v) ? v : 0);
    t = narrowCell(t, variable, take);
    cut -= take;
  }
  if (cut > 0 && widest >= 0) t = narrowCell(t, widest, cut);
  return { ...list, row_template: t };
}

/** NuiTouch_Narrow. */
export function narrow(e: JsonValue, cut: number): JsonValue {
  if (cut <= 0 || !isObject(e)) return e;
  let o: JsonObject = e;
  const w = fixed(o, true);
  if (w >= 0) o = narrowDraw({ ...o, width: w > cut ? w - cut : 0 }, w, cut);
  if (o.type === "list") return narrowCells(o, cut);
  const ks = kids(o);
  if (!ks || !ks.length) return o;
  if (o.type === "row") {
    let widest = -1;
    let wMax = -1;
    for (let i = 0; i < ks.length; i++) {
      const k = isObject(ks[i]) ? fixed(ks[i] as JsonObject, true) : -1;
      if (k < 0) return o;
      if (k > wMax) {
        wMax = k;
        widest = i;
      }
    }
    return { ...o, children: ks.map((c, i) => (i === widest ? narrow(c, cut) : c)) };
  }
  const newW = w - cut;
  return {
    ...o,
    children: ks.map((c) => {
      if (!isObject(c)) return c;
      const k = fixed(c, true);
      let kc = cut;
      if (w >= 0 && k >= 0) kc = k + margins(c) - newW;
      return narrow(c, Math.min(kc, cut));
    }),
  };
}

/** NuiTouch_FitRows. */
export function fitRows(list: JsonObject, side: number): JsonObject {
  if (side <= 0 || list.type !== "list") return list;
  const scroll = scrollbars(list, SB.Y);
  const h = fixed(list, false);
  const row = numOr(list, "row_height", NUI_TOUCH.ROW_HEIGHT);
  if ((scroll !== SB.NONE && scroll !== SB.X) || h < 0 || row <= 0) return list;
  const inset = border(list) ? NUI_TOUCH.LIST_IN : 0;
  const sp = NUI_TOUCH.ROW_SPACING;
  const rows = Math.trunc((h - 2 * inset + sp) / (row + sp));
  if (rows < 1) return list;
  const fit = (h - 2 * (inset + side) + sp) / rows - sp;
  return fit >= row ? list : { ...list, row_height: Math.max(1, fit) };
}

/** NuiTouch_NarrowLists. */
export function narrowLists(e: JsonValue, side: number): JsonValue {
  if (side <= 0 || !isObject(e)) return e;
  if (isObject(e.root)) return { ...e, root: narrowLists(e.root, side) };
  const w = fixed(e, true);
  if (e.type === "list") {
    let cut = 2 * side;
    if (w >= 0) cut = Math.max(0, sumWidths(cells(e)) - listRoom(w, scrollbars(e, SB.Y), (border(e) ? NUI_TOUCH.LIST_IN : 0) + side));
    return fitRows(narrowCells(e, cut), side);
  }
  let ks = kids(e);
  if (!ks) return e;
  if (e.type === "group" && border(e) && ks.length && isObject(ks[0])) {
    const k0 = ks[0];
    const kw = fixed(k0, true);
    const scroll = scrollbars(e, SB.AUTO);
    let cut = 2 * side;
    if (w >= 0 && kw >= 0) {
      const bar = scroll === SB.Y || scroll === SB.BOTH;
      cut = Math.max(0, kw + margins(k0) - (w - 2 * (NUI_TOUCH.LIST_IN + side) - (bar ? NUI_TOUCH.SCROLLBAR_W : 0)));
    }
    ks = [narrow(k0, cut), ...ks.slice(1)];
  }
  return { ...e, children: ks.map((c) => narrowLists(c, side)) };
}

/** NuiTouch_Layout: the element for the client, and how much taller its controls made it. */
export function touchLayout(e: JsonValue, p: ClientProfile): [JsonValue, number] {
  const d = touchDensity(p);
  if (d === 1) return [e, 0];
  const [grown, g] = growControls(e, controlGrowth(p));
  return [divide(narrowLists(grown, listInsetExtra(p)), d), g];
}

/** NuiTouch_Rect. */
export function touchRect(p: ClientProfile, x: number, y: number, w: number, h: number, grown = 0): JsonObject {
  if (!p.pointBased) return { x, y, w, h };
  const corner = x < 0 || y < 0;
  return {
    x: corner ? NUI_TOUCH.CORNER : x / p.fp,
    y: corner ? NUI_TOUCH.CORNER : y / p.fp,
    w: w + frameExtra(p, false),
    h: h + frameExtra(p, true) + grown,
  };
}

/** NuiTouch_Window: the window, and the growth to pass to touchRect for a bound geometry. */
export function touchWindow(win: JsonObject, p: ClientProfile): { window: JsonObject; grown: number } {
  if (!p.pointBased) return { window: win, grown: 0 };
  const [root, grown] = touchLayout(win.root!, p);
  const out: JsonObject = { ...win, root };
  const g = win.geometry;
  if (isObject(g) && typeof g.bind !== "string") {
    const n = (v: JsonValue | undefined) => (num(v) ? v : 0);
    out.geometry = touchRect(p, n(g.x), n(g.y), n(g.w), n(g.h), grown);
  }
  const l = win.size_constraint;
  if (isObject(l) && typeof l.bind !== "string") {
    const o: JsonObject = { ...l };
    (["x", "y", "w", "h"] as const).forEach((k, i) => {
      if (num(o[k]) && o[k] > 0) o[k] = (o[k] as number) + (i % 2 === 0 ? frameExtra(p, false) : frameExtra(p, true) + grown);
    });
    out.size_constraint = o;
  }
  return { window: out, grown };
}
