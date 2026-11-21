/**
 * The NUI layout solver, as the client builds it. A port of nwn-module tools/nui-preview/layout.py.
 *
 * The client turns a window's JSON into Kiwi (Cassowary) constraints and solves them. Its code for rows and columns
 * (Span) and for groups (LayoutGroup) is niv's gist "nuilayout.cpp" (linked from the nwn.wiki NUI page). This builds
 * the same constraints, in the same order and at the same strengths as layout.py, and solves them with @lume/kiwi, a
 * TypeScript port of the same Kiwi. What the gist leaves out comes from nwn-module core/nss/nui/nui_i_check.nss, read
 * from the client (nwmain-linux 8193.37-17; docs/CLIENT-BEHAVIOUR.md#layout):
 *
 * - every element has a margin of 2 on each side, except a spacer, a tabbar (NuiToggles) and options, whose
 *   margin is 0; "margin" or "padding" set to 0 or more replaces it (required); padding is 0 unless set;
 * - "width" and "height" are required;
 * - a group or a list lays its content out in a solver of its own, whose size is only a medium suggestion; a list row
 *   is row_height high;
 *
 * and, from the client's code (docs/CLIENT-BEHAVIOUR.md#default-sizes):
 *
 * - a widget whose JSON sets no width or height gets its type's default size (DEFAULT_SIZE: a button 150 x 50, a check
 *   150 (weak) x 35, a slider, progress bar or combo 150 x 35, a text edit 35 high), at strong strength, which beats a row's
 *   or column's own fit (medium) but not a required size;
 * - options (NuiOptions) and a tabbar (NuiToggles) are a SelectList: a row (direction 0) or a column (1) of one entry
 *   per label, each with margin 2 and a strong 35 high, and 150 wide in a row.
 */

import * as kiwi from "./kiwi/kiwi.js";
import { type JsonObject, type JsonValue, type NuiElement, elemName, isObject, num } from "../model/types.js";

const { Strength, Operator } = kiwi;
export const STRONG = Strength.strong;
export const MEDIUM = Strength.medium;
export const WEAK = Strength.weak;
export const REQUIRED = Strength.required;

export const DEFAULT_MARGIN = 2.0;
export const DEFAULT_PADDING = 0.0;
/** The widgets whose constructor sets their margin to 0 (Widgets::spacer, Widgets::tabbar, Widgets::options). */
export const ZERO_MARGIN = new Set(["spacer", "tabbar", "options"]);

/** An element's margin when its JSON sets none: 0 for a spacer, a tabbar or options, else 2. */
export function defaultMargin(type: unknown): number {
  return typeof type === "string" && ZERO_MARGIN.has(type) ? 0 : DEFAULT_MARGIN;
}

/** A JSON margin or padding counts when it is a number of 0 or more (the client's default, -1, means not set). */
function setValue(elem: JsonObject, key: string): number | null {
  const v = num(elem, key, null);
  return v !== null && v >= 0 ? v : null;
}

/** The margin the client gives an element: its JSON "margin" if 0 or more, else its type's default. */
export function marginOf(elem: JsonObject): number {
  return setValue(elem, "margin") ?? defaultMargin(elem.type);
}

/** The padding the client gives an element: its JSON "padding" if 0 or more, else 0. */
export function paddingOf(elem: JsonObject): number {
  return setValue(elem, "padding") ?? DEFAULT_PADDING;
}
/** A default size: its value and the strength it is asked for at. */
export type DefaultLength = [value: number, strength: number];

/**
 * The size a widget asks for when its JSON sets no width or height (docs/CLIENT-BEHAVIOUR.md#default-sizes): strong,
 * except a check's width (weak). A button select's 150 was measured in the client (its height was not); "progress" is
 * NuiProgress, the float bar (an int bar, which nw_inc_nui cannot make, is 35 high only).
 */
export const DEFAULT_SIZE: Record<string, { w?: DefaultLength; h?: DefaultLength }> = {
  button: { w: [150, STRONG], h: [50, STRONG] },
  button_image: { w: [150, STRONG], h: [50, STRONG] },
  button_select: { w: [150, STRONG] },
  check: { w: [150, WEAK], h: [35, STRONG] },
  slider: { w: [150, STRONG], h: [35, STRONG] },
  sliderf: { w: [150, STRONG], h: [35, STRONG] },
  progress: { w: [150, STRONG], h: [35, STRONG] },
  textedit: { h: [35, STRONG] },
  combo: { w: [150, STRONG], h: [35, STRONG] },
};

/** The widgets built as a SelectList (Widgets::options, Widgets::tabbar): a row or a column of entries. */
export const SELECT_LISTS = new Set(["options", "tabbar"]);
/** The type of a SelectList's entries (SelectList::MakeButtons; not a JSON type). */
export const SELECT_ENTRY = "select_entry";
/** A SelectList entry's size (strong): 35 high, and 150 wide in a horizontal list. */
export const SELECT_ENTRY_W = 150;
export const SELECT_ENTRY_H = 35;

/** Whether a SelectList runs horizontally: its JSON "direction" is 0 (NUI_DIRECTION_HORIZONTAL, the default). */
export function selectHorizontal(elem: JsonObject): boolean {
  return (elem.direction ?? 0) === 0;
}

/** A SelectList's labels as the solver sees them: its JSON "elements" when an array (a bind has no labels yet). */
export function selectLabels(elem: JsonObject): JsonValue[] {
  return Array.isArray(elem.elements) ? elem.elements : [];
}

export const SPANS = new Set(["row", "col"]);
export const CONTAINERS = new Set(["group", "list"]);

export type Rect = [x: number, y: number, w: number, h: number];

type Term = number | kiwi.Variable | kiwi.Expression;

/** One element in a solver. rect is in the coordinates of the group (or window) the node is laid out in. */
export class LayoutNode {
  readonly x = new kiwi.Variable("x");
  readonly y = new kiwi.Variable("y");
  readonly w = new kiwi.Variable("w");
  readonly h = new kiwi.Variable("h");
  children: LayoutNode[] = [];
  rect: Rect = [0, 0, 0, 0];

  constructor(
    readonly elem: NuiElement,
    readonly path: string,
  ) {}

  get type(): string {
    return typeof this.elem.type === "string" ? this.elem.type : "";
  }

  get margin(): number {
    return marginOf(this.elem);
  }

  get padding(): number {
    return paddingOf(this.elem);
  }
}

/** The top nodes of one solver (a window's or a group's content) and the size it was given. */
export class Solved {
  constructor(
    readonly nodes: LayoutNode[],
    readonly width: number,
    readonly height: number,
  ) {}

  /** How far the content reaches (its right and bottom edges, margins included). */
  extent(): [number, number] {
    let r = 0;
    let b = 0;
    for (const top of this.nodes) {
      // A top-level span's rect is the room it was given: what reaches out is its children.
      for (const n of SPANS.has(top.type) || SELECT_LISTS.has(top.type) ? top.children : [top]) {
        const [x, y, w, h] = n.rect;
        r = Math.max(r, x + w + n.margin);
        b = Math.max(b, y + h + n.margin);
        // A SelectList's entries are widgets of their own: entries cut off by a fixed-size list still reach out (the
        // in-game options window scrolled for them; docs/CLIENT-BEHAVIOUR.md#default-sizes).
        for (const e of selectEntries(n)) {
          const [ex, ey, ew, eh] = e.rect;
          r = Math.max(r, ex + ew + e.margin);
          b = Math.max(b, ey + eh + e.margin);
        }
      }
    }
    return [r, b];
  }
}

/** Whether n is laid out as a span: a row, a column, or a SelectList (options, tabbar) with its entries. */
export function spanLike(n: LayoutNode): boolean {
  return SPANS.has(n.type) || SELECT_LISTS.has(n.type);
}

/** The SelectList entries under n (n's own when it is one), through rows and columns. */
function* selectEntries(n: LayoutNode): Generator<LayoutNode> {
  if (SELECT_LISTS.has(n.type)) yield* n.children;
  else if (SPANS.has(n.type)) for (const c of n.children) yield* selectEntries(c);
}

export function build(elem: NuiElement, path: string): LayoutNode {
  const node = new LayoutNode(elem, path);
  if (SPANS.has(node.type)) {
    const kids = Array.isArray(elem.children) ? elem.children : [];
    kids.forEach((c, i) => {
      if (isObject(c)) node.children.push(build(c, `${path}[${i}]/${elemName(c)}`));
    });
  } else if (SELECT_LISTS.has(node.type)) {
    // SelectList::MakeButtons: one entry per label, an ordinary widget (margin 2).
    const horizontal = selectHorizontal(elem);
    selectLabels(elem).forEach((label, i) => {
      node.children.push(new LayoutNode({ type: SELECT_ENTRY, label, horizontal }, `${path}/entry ${i}`));
    });
  }
  return node;
}

function expr(a: Term): kiwi.Expression {
  return a instanceof kiwi.Expression ? a : new kiwi.Expression(a);
}
function add(a: Term, b: Term): kiwi.Expression {
  return expr(a).plus(b);
}

type LayoutBox = [Term, Term, Term, Term];

/** A SelectList entry's size: 35 high, and 150 wide when the list is a row (SelectList::MakeButtons, strong). */
function entrySize(entry: JsonObject): { w?: DefaultLength; h?: DefaultLength } {
  return entry.horizontal ? { w: [SELECT_ENTRY_W, STRONG], h: [SELECT_ENTRY_H, STRONG] } : { h: [SELECT_ENTRY_H, STRONG] };
}

/** One solver: the content of a window or of a group, laid out in (0, 0, gw, gh). */
class Layout {
  readonly solver = new kiwi.Solver();
  /** The element whose constraints are being added: the one named when a required constraint is refused (as
   * nui-preview's Layout.at). A span adds its children's constraints before its own cross-axis ones, so a child too
   * big for its row is named, not the row. */
  at = "";

  add(lhs: Term, op: kiwi.Operator, rhs: Term, strength = REQUIRED): void {
    this.solver.addConstraint(new kiwi.Constraint(expr(lhs), op, rhs, strength));
  }

  /**
   * Layoutable::BuildConstraints: the applicators (width, height, aspect, defaults), padding and margin, then the
   * dependants (a span's children).
   */
  nodeConstraints(n: LayoutNode, layout: LayoutBox): void {
    this.at = n.path;
    const width = num(n.elem, "width", null);
    const height = num(n.elem, "height", null);
    const def = n.type === SELECT_ENTRY ? entrySize(n.elem) : DEFAULT_SIZE[n.type];
    if (width !== null) this.add(n.w, Operator.Eq, width);
    else if (def?.w) this.add(n.w, Operator.Eq, def.w[0], def.w[1]);
    if (height !== null) this.add(n.h, Operator.Eq, height);
    else if (def?.h) this.add(n.h, Operator.Eq, def.h[0], def.h[1]);
    const aspect = num(n.elem, "aspect", null);
    if (aspect) this.add(n.w, Operator.Eq, expr(n.h).multiply(aspect), STRONG);
    this.add(n.w, Operator.Ge, 0);
    this.add(n.h, Operator.Ge, 0);
    if (spanLike(n)) this.span(n, layout);
  }

  /** Span::BuildConstraintDependants, line for line. layout is (x, y, w, h) the children are placed in. */
  span(n: LayoutNode, layout: LayoutBox): void {
    const [lx, ly, lw, lh] = layout;
    const horizontal = n.type === "row" || (SELECT_LISTS.has(n.type) && selectHorizontal(n.elem));
    const pad = n.padding;
    const pos = (axisH: boolean, q: LayoutNode) => (axisH ? q.x : q.y);
    const size = (axisH: boolean, q: LayoutNode) => (axisH ? q.w : q.h);
    const lpos = (axisH: boolean) => add(axisH ? lx : ly, pad);
    const lsize = (axisH: boolean) => add(axisH ? lw : lh, -2 * pad);
    const prim = horizontal;
    const sec = !horizontal;
    const kids = n.children;
    for (const q of kids) this.nodeConstraints(q, [q.x, q.y, q.w, q.h]);
    kids.forEach((q, i) => {
      if (i === 0) {
        this.add(pos(prim, q), Operator.Eq, add(lpos(prim), q.margin));
      } else {
        const p = kids[i - 1]!;
        this.add(pos(prim, q), Operator.Eq, add(add(add(pos(prim, p), q.margin), size(prim, p)), p.margin));
      }
    });
    for (const q of kids) this.add(pos(sec, q), Operator.Eq, add(lpos(sec), q.margin));
    let total: kiwi.Expression = new kiwi.Expression(0);
    for (const q of kids) {
      total = add(add(total, size(prim, q)), 2 * q.margin);
      this.add(lsize(prim), Operator.Ge, add(size(prim, q), 2 * q.margin), MEDIUM);
    }
    if (kids.length) {
      this.add(total, Operator.Eq, lsize(prim), MEDIUM);
      this.add(total, Operator.Le, lsize(prim), MEDIUM);
    }
    const spacers = kids.filter((q) => q.type === "spacer");
    for (let i = 0; i + 1 < spacers.length; i++) {
      this.add(size(prim, spacers[i + 1]!), Operator.Eq, size(prim, spacers[i]!), WEAK);
    }
    for (const q of kids) {
      this.add(pos(sec, q), Operator.Eq, add(lpos(sec), q.margin));
      this.add(lsize(sec), Operator.Ge, add(size(sec, q), 2 * q.margin));
      this.add(lsize(sec), Operator.Eq, add(size(sec, q), 2 * q.margin), MEDIUM);
    }
  }
}

export function* walk(n: LayoutNode): Generator<LayoutNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}

/** The error kiwi throws for a required constraint that contradicts the others: the client's "constraint can not be
 * satisfied". path is the element whose constraint was refused (nui-preview's Unsolvable.path), or the solver's own
 * path when no element's constraints were being added. */
export class UnsatisfiableLayout extends Error {
  readonly path: string;
  constructor(path: string, cause: unknown) {
    const p = path || "/";
    super(`the layout at ${p} cannot be solved: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.path = p;
  }
}

/**
 * A solver built for one element at one path, never given a size: its constraints added and gw, gh made edit
 * variables, as solveContent builds it. A clone of it, given a size, does exactly what a solver built for that size
 * does (Solver.clone), so building it once per element and path is enough.
 */
interface Built {
  solver: kiwi.Solver;
  gw: kiwi.Variable;
  gh: kiwi.Variable;
  /** The nodes the constraints were built on; each solve copies them with their rects (snapshot). */
  nodes: LayoutNode[];
}

interface CacheEntry {
  built: Built | UnsatisfiableLayout;
  /** The solved content per size ("w h"), least recently used first. */
  sizes: Map<string, Solved>;
}

/** Sizes kept per element and path: a window resize drag passes through many, an edit usually comes back to one. */
export const LAYOUT_CACHE_SIZES = 8;

/**
 * Solved content kept across redraws, per element object, then per path, then per size. An element's layout depends
 * only on its JSON (the subtree under it: sizes, margins, padding, aspect, children), its path (which names the nodes
 * and the problems) and the size it is given, never on binds, the skin or fonts. The editor never changes a JSON
 * object in place (every edit copies the objects on the path to the change, edit/tree.ts), so a changed element is a
 * new object and finds nothing here, and an unchanged subtree is solved once. A WeakMap: the entries go with the
 * documents (undo history included) that hold the objects.
 */
let layoutCache = new WeakMap<NuiElement, Map<string, CacheEntry>>();

/** Empties the layout cache (tests). */
export function clearLayoutCache(): void {
  layoutCache = new WeakMap();
}

/** Builds a solver for roots: their constraints, gw and gh made medium edit variables, no size given yet. */
function buildSolver(roots: NuiElement[], path: string): Built {
  const lay = new Layout();
  const gw = new kiwi.Variable("gw");
  const gh = new kiwi.Variable("gh");
  lay.solver.addEditVariable(gw, MEDIUM);
  lay.solver.addEditVariable(gh, MEDIUM);
  const nodes = roots.map((r) => build(r, `${path}/${elemName(r)}`));
  try {
    for (const n of nodes) lay.nodeConstraints(n, [0, 0, gw, gh]);
  } catch (e) {
    throw new UnsatisfiableLayout(lay.at || path, e);
  }
  return { solver: lay.solver, gw, gh, nodes };
}

/**
 * The client places a span's children one after another at whole-pixel sizes: each size is cut to a whole pixel and
 * the next child starts where the last one ended (docs/CLIENT-BEHAVIOUR.md#layout: a row of widths 302.6, 176.9 and 64.5 puts its
 * third child at 478).
 */
function wholePixels(n: LayoutNode): void {
  if (!SPANS.has(n.type)) return;
  const horizontal = n.type === "row";
  const [nx, ny] = n.rect;
  let cursor = (horizontal ? nx : ny) + n.padding;
  for (const q of n.children) {
    const [, , qw, qh] = q.rect;
    const w = Math.trunc(qw);
    const h = Math.trunc(qh);
    cursor += q.margin;
    q.rect = horizontal ? [cursor, ny + n.padding + q.margin, w, h] : [nx + n.padding + q.margin, cursor, w, h];
    cursor += (horizontal ? w : h) + q.margin;
    wholePixels(q);
  }
}

/** A copy of n and its children with their rects as the solver's variables hold them now. */
function snapshot(n: LayoutNode): LayoutNode {
  const c = Object.create(LayoutNode.prototype) as LayoutNode;
  Object.assign(c, n);
  c.rect = [n.x.value(), n.y.value(), n.w.value(), n.h.value()];
  c.children = n.children.map(snapshot);
  return c;
}

/** Gives built (a clone of it when it is kept for later sizes) the size width x height and reads the rects out. */
function solveBuilt(built: Built, width: number, height: number, keep: boolean): Solved {
  const solver = keep ? built.solver.clone() : built.solver;
  solver.suggestValue(built.gw, width);
  solver.suggestValue(built.gh, height);
  solver.updateVariables();
  const nodes = built.nodes.map((top) => {
    const c = snapshot(top);
    // A top-level span places its children in the group's room, not in a rect of its own: that is its rect.
    if (SPANS.has(top.type) || SELECT_LISTS.has(top.type)) c.rect = [0, 0, built.gw.value(), built.gh.value()];
    wholePixels(c);
    return c;
  });
  return new Solved(nodes, width, height);
}

/** solveContent without the layout cache: a solver built for this call only (tests compare the two). */
export function solveFresh(roots: NuiElement[], width: number, height: number, path: string): Solved {
  return solveBuilt(buildSolver(roots, path), width, height, false);
}

/**
 * LayoutGroup::SetChildren: lays roots out in (0, 0, gw, gh), gw and gh suggested (medium) as width and height.
 *
 * One root (every caller's case) is solved through the layout cache: the result is shared with later calls, so it
 * must not be changed (solveRowTemplate moves copies).
 */
export function solveContent(roots: NuiElement[], width: number, height: number, path: string): Solved {
  if (roots.length !== 1 || Object.is(width, -0) || Object.is(height, -0)) return solveFresh(roots, width, height, path);
  const root = roots[0]!;
  let byPath = layoutCache.get(root);
  if (!byPath) layoutCache.set(root, (byPath = new Map()));
  let entry = byPath.get(path);
  if (!entry) {
    let built: Built | UnsatisfiableLayout;
    try {
      built = buildSolver(roots, path);
    } catch (e) {
      if (!(e instanceof UnsatisfiableLayout)) throw e;
      built = e;
    }
    byPath.set(path, (entry = { built, sizes: new Map() }));
  }
  if (entry.built instanceof UnsatisfiableLayout) throw entry.built;
  const key = `${width} ${height}`;
  let solved = entry.sizes.get(key);
  if (solved) {
    entry.sizes.delete(key);
  } else {
    solved = solveBuilt(entry.built, width, height, true);
    if (entry.sizes.size >= LAYOUT_CACHE_SIZES) entry.sizes.delete(entry.sizes.keys().next().value!);
  }
  entry.sizes.set(key, solved);
  return solved;
}

/** A list row template cell: [element, width, variable]. */
export type TemplateCell = [elem: NuiElement, width: number, variable: boolean];

/**
 * A list row: its cells side by side in width x height. A fixed cell takes its width; the variable ones share what
 * is left (at least their width). Each cell's element is laid out in its cell as in a solver of its own: its width
 * and height if it has them, else the cell less its margins.
 */
export function solveRowTemplate(cells: TemplateCell[], width: number, height: number, path: string): LayoutNode[] {
  let fixed = 0;
  let nvar = 0;
  for (const [, w, v] of cells) {
    if (!v) fixed += w;
    else nvar++;
  }
  const share = nvar ? (width - fixed) / nvar : 0;
  const nodes: LayoutNode[] = [];
  let x = 0;
  cells.forEach(([elem, w, v], i) => {
    const room = v ? Math.max(w, share) : w;
    // The cached solve is shared: its nodes are copied, moved to the cell.
    const sub = solveContent([elem], room, height, `${path}/cell ${i}`);
    // The element fills its cell unless it has a size of its own: its width less its margins, and the whole row
    // height (in the client a list row's button is row_height high, its margins only to the sides).
    const top = shifted(sub.nodes[0]!, x);
    const mx = top.margin;
    let [, ey, ew, eh] = top.rect;
    if (num(elem, "width", null) === null) ew = room - 2 * mx;
    if (num(elem, "height", null) === null) {
      eh = height;
      ey = 0;
    }
    top.rect = [x + mx, ey, ew, eh];
    nodes.push(top);
    x += room;
  });
  return nodes;
}

/** A copy of n and its children moved dx to the right. */
function shifted(n: LayoutNode, dx: number): LayoutNode {
  const c = Object.create(LayoutNode.prototype) as LayoutNode;
  Object.assign(c, n);
  const [x, y, w, h] = n.rect;
  c.rect = [x + dx, y, w, h];
  c.children = n.children.map((k) => shifted(k, dx));
  return c;
}

/** The template cells of a list element, as nui-preview reads them. */
export function templateCells(list: JsonObject): TemplateCell[] {
  const cells: TemplateCell[] = [];
  const tpl = list.row_template;
  if (!Array.isArray(tpl)) return cells;
  for (const c of tpl) {
    if (Array.isArray(c) && c.length && isObject(c[0])) {
      const w = c.length > 1 && typeof c[1] === "number" ? c[1] : 0;
      const v = c.length > 2 ? Boolean(c[2]) : true;
      cells.push([c[0], w, v]);
    }
  }
  return cells;
}
