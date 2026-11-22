/**
 * The export option "portable margins" (NUI-MOBILE-060, item 1): the window written with margin 0 on every element
 * and the gaps its margins made rebuilt from spacers, so iOS, which multiplies every margin by its density
 * (NUI-MOBILE-021), lays it out as the desktop does.
 *
 * In a row or a column (NUI-LAYOUT-040), each child's margin m set to 0, and
 *
 * - along the span: a fixed spacer for each gap the margins made (m before the first child, the two margins between
 *   two children, m after the last). A span that has spacers of its own gets fixed empty spans instead, as a fixed
 *   spacer would join its spacers' equal-size rule (NUI-LAYOUT-044) and pull them off centre;
 * - across it: the span is put between two spacers of its children's smallest margin, across (a size it sets across
 *   loses them), and a child with a bigger margin between two spacers of the difference.
 *
 * The top element of a solver (the window's root, a group's child) is not placed by its margin: it only gets margin
 * 0. List template cells get margin 0 and no spacer cells, as NUI-MOBILE-060 (item 2) asks: a cell narrower than
 * about 11 px draws wider on iOS (NUI-MOBILE-024). So a cell's content fills its cell; give it a width of its own to
 * keep a gap.
 *
 * NUI's spans fit their children at medium strength (NUI-LAYOUT-041), so the result is the same layout where the
 * sizes settle it, and can differ where the solver has a choice (flexible elements sharing room, a window that does
 * not fit). Open the exported window in the designer to see it (tests/mobile.test.ts measures the fixtures).
 */
import { marginOf } from "../layout/layout.js";
import { NuiCol, NuiHeight, NuiMargin, NuiRow, NuiSpacer, NuiWidth } from "../model/nui.js";
import { type JsonObject, type JsonValue, isObject } from "../model/types.js";
import type { EditorDoc } from "../edit/project.js";

/** A gap of size g along a span (horizontal: a row's): a fixed spacer, or a fixed empty span where spacers must not go. */
function gap(g: number, horizontal: boolean, spacer: boolean): JsonObject {
  const e = spacer ? NuiSpacer() : NuiMargin(horizontal ? NuiCol([]) : NuiRow([]), 0);
  return horizontal ? NuiWidth(e, g) : NuiHeight(e, g);
}

interface Converted {
  elem: JsonObject;
  /** The margin it had (now 0): the gaps its parent must make. */
  m: number;
}

function convert(e: JsonObject): Converted {
  const o: JsonObject = { ...e };
  const t = e.type;
  const m = marginOf(e);
  if (m > 0) o.margin = 0;
  let out: JsonObject = o;
  if ((t === "row" || t === "col") && Array.isArray(e.children)) {
    const horizontal = t === "row";
    const kids = e.children.filter(isObject).map(convert);
    const hasSpacers = kids.some((k) => k.elem.type === "spacer");
    const isSpacer = (i: number) => kids[i]?.elem.type === "spacer";
    const children: JsonValue[] = [];
    // Across the span: the smallest of the children's margins goes around the span, the rest around each child.
    const cross = kids.filter((k) => k.elem.type !== "spacer").map((k) => k.m);
    const mc = cross.length ? Math.min(...cross) : 0;
    const across = (inner: JsonObject, by: number) => {
      const w = NuiMargin((horizontal ? NuiCol : NuiRow)([gap(by, !horizontal, true), inner, gap(by, !horizontal, true)]), 0);
      // The wrapper takes the element's fixed sizes (and its spacers), so it is as rigid as the element was.
      const [along, acrossKey] = horizontal ? (["width", "height"] as const) : (["height", "width"] as const);
      if (typeof inner[along] === "number") w[along] = inner[along];
      if (typeof inner[acrossKey] === "number") w[acrossKey] = (inner[acrossKey] as number) + 2 * by;
      return w;
    };
    kids.forEach((k, i) => {
      const before = i === 0 ? k.m : kids[i - 1]!.m + k.m;
      if (before > 0) children.push(gap(before, horizontal, !hasSpacers));
      children.push(k.m > mc && !isSpacer(i) ? across(k.elem, k.m - mc) : k.elem);
    });
    const last = kids[kids.length - 1];
    if (last && last.m > 0) children.push(gap(last.m, horizontal, !hasSpacers));
    o.children = children;
    if (mc > 0) {
      // A span's own size across holds its children's margins: the spacers take them out of it.
      const key = horizontal ? "height" : "width";
      if (typeof o[key] === "number") o[key] = Math.max(0, (o[key] as number) - 2 * mc);
      // A spacer has no margin, so it may fill the span across: capped at the span's new size, or it no longer fits.
      const room = o[key];
      if (typeof room === "number")
        o.children = children.map((c) => (isObject(c) && c.type === "spacer" && typeof c[key] === "number" && c[key] > room ? { ...c, [key]: room } : c));
      out = across(o, mc);
    }
  } else if (Array.isArray(e.children)) {
    // A group: its child is the top of a solver of its own.
    o.children = e.children.map((c) => (isObject(c) ? convert(c).elem : c));
  }
  if (t === "list" && Array.isArray(e.row_template)) {
    o.row_template = e.row_template.map((c) => {
      if (!Array.isArray(c) || !isObject(c[0])) return c;
      const cell: JsonValue[] = [...c];
      cell[0] = convert(c[0]).elem;
      return cell;
    });
  }
  return { elem: out, m };
}

/** The window with margin 0 everywhere and its margins rebuilt from spacers (a copy; the window is not changed). */
export function portableMargins(win: JsonObject): JsonObject {
  return isObject(win.root) ? { ...win, root: convert(win.root).elem } : { ...win };
}

/** The window the exports write: with portable margins when the document's export settings ask for them. */
export function exportWindow(d: EditorDoc): JsonObject {
  return d.export.portableMargins ? portableMargins(d.window) : d.window;
}
