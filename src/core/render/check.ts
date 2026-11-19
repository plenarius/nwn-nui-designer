/**
 * A port of nwn-module core/nss/nui/nui_i_check.nss: finds the fixed sizes the client's required constraints make
 * impossible ("Error constructing window from json: The constraint can not be satisfied"). Every element has a
 * margin of 2 (0 for a spacer, tabbar or options) unless it sets one (layout.ts marginOf); in a row each child's height plus its margins must fit the row's height, in a
 * column each child's width plus its margins must fit the column's width; groups and lists keep their content to
 * themselves; a list row is row_height high and its cells must fit it.
 */
import { DEFAULT_MARGIN, SELECT_LISTS, marginOf, paddingOf, selectHorizontal, selectLabels } from "../layout/layout.js";
import { type JsonObject, elemName, isObject, num } from "../model/types.js";

export interface CheckProblem {
  path: string;
  kind: string;
  text: string;
  /** The element (the same object as in the window). */
  elem?: JsonObject;
}

function fixed(e: JsonObject, width: boolean): number {
  return num(e, width ? "width" : "height", -1);
}

function margins(e: JsonObject): number {
  return 2 * marginOf(e);
}

function least(e: JsonObject, width: boolean, ignoreOwn = false): number {
  const f = ignoreOwn ? -1 : fixed(e, width);
  if (f >= 0) return f;
  const t = e.type;
  if ((t === "row" && !width) || (t === "col" && width)) {
    let l = 0;
    for (const c of Array.isArray(e.children) ? e.children : []) {
      if (!isObject(c)) continue;
      l = Math.max(l, least(c, width) + margins(c));
    }
    return l + 2 * paddingOf(e);
  }
  if (SELECT_LISTS.has(t as string)) {
    // A SelectList's entries (margin 2) have no required size: their margins alone must fit, across the list and,
    // summed, along it.
    const n = selectLabels(e).length;
    if (!n) return 0;
    return width === selectHorizontal(e) ? n * 2 * DEFAULT_MARGIN : 2 * DEFAULT_MARGIN;
  }
  return 0;
}

function fmt(v: number): string {
  return v.toFixed(1);
}

function checkElement(e: JsonObject, path: string, out: CheckProblem[]): void {
  path += "/" + elemName(e);
  for (const width of [false, true]) {
    const f = fixed(e, width);
    if (f < 0) continue;
    const l = least(e, width, true);
    if (l > f + 0.01) {
      out.push({
        path,
        elem: e,
        kind: "unsolvable size",
        text: `${width ? "width" : "height"} ${fmt(f)}, but its children need ${fmt(l)} (sizes plus 2 x margin, ${DEFAULT_MARGIN} by default, 0 for spacers): the client refuses the window`,
      });
    }
  }
  if (e.type === "list") {
    const row = num(e, "row_height", 25);
    const tpl = Array.isArray(e.row_template) ? e.row_template : [];
    tpl.forEach((cell, i) => {
      const c = Array.isArray(cell) ? cell[0] : undefined;
      if (!isObject(c)) return;
      const need = least(c, false) + margins(c);
      if (need > row + 0.01) {
        out.push({ path: `${path}/cell ${i} ${elemName(c)}`, elem: c, kind: "unsolvable size", text: `needs height ${fmt(need)} but the list's rows are ${fmt(row)}` });
      }
      checkElement(c, `${path}/cell ${i}`, out);
    });
    return;
  }
  const kids = Array.isArray(e.children) ? e.children : [];
  kids.forEach((c, i) => {
    if (isObject(c)) checkElement(c, `${path}[${i}]`, out);
  });
}

/** The problems of a layout (or a whole window, checked from its root). */
export function checkRequiredSizes(layout: JsonObject): CheckProblem[] {
  const root = isObject(layout.root) ? layout.root : layout;
  const out: CheckProblem[] = [];
  checkElement(root, "", out);
  return out;
}
