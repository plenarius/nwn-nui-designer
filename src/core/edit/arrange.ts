/**
 * Match size, align and distribute for several selected elements.
 *
 * NUI has no free x / y: rows and columns place their children one after another and the client's layout solver
 * decides every position (docs/CLIENT-BEHAVIOUR.md#layout). So these tools only ever change sizes: an element's
 * `width` / `height` (required), or a spacer's (margin 0) before an element, inserted when there is none. Each
 * change is measured by laying the window out again exactly as the canvas does (Measure: the renderer's dry pass,
 * view.ts layoutView), repeated until the edges land where they should, and checked against the client's own
 * refusals ("constraint can not be satisfied"). A request that cannot be met is refused whole with the reason: no
 * half-applied edit, and never a layout the client would refuse.
 *
 * Exact means within EPS (0.001 px) in layout units, which are pixels at UI scale 1. At another UI scale the client
 * multiplies every size by the scale, so edges that line up at 1 line up in theory at any scale, but each rect is then
 * rounded to whole pixels on its own and may land up to 1 px apart.
 */
import { DEFAULT_SIZE, type Rect, STRONG } from "../layout/layout.js";
import type { JsonObject } from "../model/types.js";
import { placements } from "./drop.js";
import type { Result } from "./ops.js";
import type { EditorDoc } from "./project.js";
import { type ElemPath, EditError, getElem, insertElem, isPrefix, parentPath, pathIndex, samePath, setProp, typeOf } from "./tree.js";
import { type Selection, cap, commonParent, compareTree, keyOf, plainName as nameOf } from "./selection.js";

/** How close counts as the same edge, in layout units (px at UI scale 1). */
export const EPS = 0.001;
/** How many lay-out-and-adjust rounds a tool tries before it says the layout does not settle. */
export const MAX_ROUNDS = 12;

/** A window laid out: each element's first drawn rect by path ("1/0"), and the client's refusals of the layout. */
export interface Measured {
  rects: ReadonlyMap<string, Rect>;
  /** Problems for which the client refuses the whole window (unsolvable layouts and sizes), as texts. */
  refused: string[];
  /** The element each refusal is about, by its text, when the layout names one. */
  refusedAt?: ReadonlyMap<string, ElemPath>;
  /** Content reaching past its room (the client clips or scrolls it; not refused). */
  overflow: string[];
  /** The element each overflow is about, by its text, when the layout names one. */
  overflowAt?: ReadonlyMap<string, ElemPath>;
}

/** Lays a document out as the canvas does (the app and the tests build it on layoutView). */
export type Measure = (doc: EditorDoc) => Measured;

/** The problem kinds for which the client refuses the window ("The constraint can not be satisfied"). */
export const REFUSED_KINDS = new Set(["unsolvable layout", "unsolvable size"]);

/** A Measured from a laid-out window (layoutView or renderView's outlines and problems). */
export function measured(win: JsonObject, outlines: { rect: Rect; elem: JsonObject; visible: boolean }[], problems: { kind: string; text: string; elem?: JsonObject }[]): Measured {
  const rects = new Map<string, Rect>();
  const index = pathIndex(win);
  for (const [k, p] of placements(outlines, index)) rects.set(k, p.rect);
  const refusedAt = new Map<string, ElemPath>();
  const overflowAt = new Map<string, ElemPath>();
  for (const p of problems) {
    const at = p.elem && index.get(p.elem);
    const into = REFUSED_KINDS.has(p.kind) ? refusedAt : p.kind === "overflow" ? overflowAt : null;
    if (into && at && !into.has(p.text)) into.set(p.text, at);
  }
  return {
    rects,
    refusedAt,
    overflowAt,
    refused: problems.filter((p) => REFUSED_KINDS.has(p.kind)).map((p) => p.text),
    overflow: problems.filter((p) => p.kind === "overflow").map((p) => p.text),
  };
}

export type SizeAxis = "w" | "h";
export type MatchTo = "largest" | "key";
export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeMode = "sizes" | "gaps";

/** The result of an arrange tool: the document, the selection after it, and a note for the user (a toast). */
export interface ArrangeResult extends Result {
  selectMany?: ElemPath[];
  note?: string;
}

type Axis = "x" | "y";
const pos = (r: Rect, a: Axis) => (a === "x" ? r[0] : r[1]);
const len = (r: Rect, a: Axis) => (a === "x" ? r[2] : r[3]);
const sizeKey = (a: Axis) => (a === "x" ? "width" : "height");
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const px = (v: number) => `${round3(Math.abs(v))} px`;
const k = (p: ElemPath) => p.join("/");

function edgeOf(r: Rect, e: AlignEdge): number {
  const a: Axis = e === "left" || e === "hcenter" || e === "right" ? "x" : "y";
  if (e === "left" || e === "top") return pos(r, a);
  if (e === "right" || e === "bottom") return pos(r, a) + len(r, a);
  return pos(r, a) + len(r, a) / 2;
}

const EDGE_TEXT: Record<AlignEdge, string> = { left: "left edges", hcenter: "centres", right: "right edges", top: "top edges", vcenter: "middles", bottom: "bottom edges" };
const sizeWord = (a: Axis) => (a === "x" ? "wide" : "high");

/** The span that places children along an axis: a row places them left to right, a column top to bottom. */
const stackOf = (a: Axis) => (a === "x" ? "row" : "col");
const stackName = (a: Axis) => (a === "x" ? "row" : "column");

// --- checks that need no layout (the toolbar's disabled reasons) --------------------------------------------------

/** Why the selection cannot be arranged at all, or null. */
function baseRefusal(win: JsonObject, s: Selection, least = 2): string | null {
  if (s.length < least) return `Select ${least === 2 ? "two" : "three"} or more elements first (Ctrl+click or Shift+click).`;
  if (s.some((p) => !p.length)) return "The window's main row or column fills the whole window, so it can't be arranged. Take it out of the selection.";
  for (const p of s) {
    const inner = s.find((q) => !samePath(q, p) && isPrefix(p, q));
    if (inner) return `${cap(nameOf(win, inner))} is inside ${nameOf(win, p)}. Select one or the other, not both.`;
  }
  return null;
}

/** Why Match size cannot run on the selection, or null. */
export function matchRefusal(win: JsonObject, s: Selection): string | null {
  return baseRefusal(win, s);
}

/** How two children of one row (column) sit. */
const together = (a: Axis) => (a === "x" ? "side by side" : "one above the other");

/** Why Align (along the edge's axis) cannot run on the selection, or null. */
export function alignRefusal(win: JsonObject, s: Selection, edge: AlignEdge): string | null {
  const why = baseRefusal(win, s);
  if (why) return why;
  const a: Axis = edge === "left" || edge === "hcenter" || edge === "right" ? "x" : "y";
  const key = keyOf(s)!;
  const rows = new Map<string, ElemPath>();
  const movers = new Map<string, ElemPath>();
  for (const p of s.slice(1)) {
    const m = mover(win, p, a);
    if (typeof m === "string") return m;
    // Two that move with one row, column or group: fine when they need the same move (checked when measured).
    if (movers.has(k(m))) continue;
    movers.set(k(m), p);
    if (isPrefix(parentPath(m), key)) return `${cap(nameOf(win, p))} and ${nameOf(win, key)} are ${together(a)} in one ${stackName(a)}, so their ${EDGE_TEXT[edge]} can't line up. Align works across ${stackName(a)}s; to make them the same size, use Match size.`;
    const row = k(parentPath(m));
    const other = rows.get(row);
    if (other) return `${cap(nameOf(win, other))} and ${nameOf(win, p)} are ${together(a)} in one ${stackName(a)}, so only one of them can line up with ${nameOf(win, key)}. Leave one of them out.`;
    rows.set(row, p);
  }
  return null;
}

/** Why Distribute cannot run on the selection, or null. */
export function distributeRefusal(win: JsonObject, s: Selection, mode: DistributeMode): string | null {
  const why = baseRefusal(win, s, mode === "gaps" ? 3 : 2);
  if (why) return why;
  const parent = commonParent(s);
  const pt = parent ? typeOf(getElem(win, parent)) : "";
  if (!parent || (pt !== "row" && pt !== "col")) return "Distribute works inside one row or column. Select elements that sit in the same row or column.";
  return null;
}

/**
 * What moves e along axis a: the nearest element (e itself, or the row, column, group or list it is in) that is a
 * child of a row (a column for a), where a spacer before it moves it. A message when there is none.
 */
function mover(win: JsonObject, e: ElemPath, a: Axis): ElemPath | string {
  let cur = e;
  while (cur.length) {
    const parent = getElem(win, parentPath(cur));
    if (typeOf(parent) === stackOf(a)) return cur;
    cur = parentPath(cur);
  }
  return `${cap(nameOf(win, e))} isn't in a ${stackName(a)}, so nothing can move it ${a === "x" ? "sideways" : "up or down"}. Wrap it in a ${stackName(a)} first (${a === "x" ? "Alt+R" : "Alt+C"}).`;
}

// --- editing helpers ---------------------------------------------------------------------------------------------

/** A spacer of the given size along a (margin 0: it moves what follows by exactly its size). */
function spacer(a: Axis, size: number): JsonObject {
  return { type: "spacer", label: null, value: null, [sizeKey(a)]: size };
}

/** The paths in ps after an element is inserted at index i of parent. */
function shiftAll(ps: ElemPath[], parent: ElemPath, i: number): ElemPath[] {
  const d = parent.length;
  return ps.map((q) => (q.length > d && isPrefix(parent, q) && q[d]! >= i ? [...q.slice(0, d), q[d]! + 1, ...q.slice(d + 1)] : q));
}

function rectOf(m: Measured, win: JsonObject, p: ElemPath): Rect {
  const r = m.rects.get(k(p));
  if (!r) throw new EditError(`${cap(nameOf(win, p))} isn't drawn right now (it's in an empty list, a collapsed window or a group showing another pane), so it can't be measured.`);
  return r;
}

/**
 * Throws when the client would refuse doc's layout and did not refuse before's: what the edit is ("That size"), what
 * does not fit, and what to do instead.
 */
function checkAccepted(before: Measured, after: Measured, win: JsonObject, what: string, instead: string): void {
  const fresh = after.refused.filter((t) => !before.refused.includes(t));
  if (!fresh.length) return;
  const text = fresh[0]!;
  const at = after.refusedAt?.get(text);
  const m = /^(width|height) ([\d.]+), but its children need ([\d.]+)/.exec(text);
  const why = m
    ? `${at ? nameOf(win, at) : "a row or column"} would be ${round3(Number(m[2]))} px ${m[1] === "width" ? "wide" : "high"}, but what's inside it needs ${round3(Number(m[3]))} px`
    : "the sizes would no longer fit together";
  throw new EditError(`${what} would make the game refuse to open the window: ${why}. ${instead}`);
}

/** A note when an edit made content reach past its room (the client clips or scrolls it). */
function overflowNote(before: Measured, after: Measured, win: JsonObject): string | undefined {
  const text = after.overflow.find((t) => !before.overflow.includes(t));
  if (!text) return undefined;
  const at = after.overflowAt?.get(text);
  return at && text.startsWith("reaches") ? `Done, but ${nameOf(win, at)} now ${text}, so the game cuts it off.` : `Done, but now ${text}.`;
}

/**
 * Moves the element at at (a child of a row, a column for y) by d along a, through the spacer just before it: that
 * spacer's size changes (drawn is its size now), or, when there is none and d is positive, a spacer of d is inserted.
 * Returns the document and the paths (ps) as they are after any insertion. Throws when it cannot move that way.
 */
function shove(doc: EditorDoc, m: Measured, at: ElemPath, d: number, a: Axis, ps: ElemPath[], who: ElemPath): { doc: EditorDoc; ps: ElemPath[] } {
  const win = doc.window;
  const parent = parentPath(at);
  const i = at[at.length - 1]!;
  const prevPath = i > 0 ? [...parent, i - 1] : null;
  const prev = prevPath ? getElem(win, prevPath) : null;
  const dir = a === "x" ? (d < 0 ? "left" : "right") : d < 0 ? "up" : "down";
  const via = samePath(at, who) ? "" : ` (it moves with ${nameOf(win, at)})`;
  if (prev && typeOf(prev) === "spacer" && !ps.some((p) => samePath(p, prevPath))) {
    const now = len(rectOf(m, win, prevPath!), a);
    const next = round3(now + d);
    if (next < -EPS) {
      throw new EditError(`${cap(nameOf(win, who))} would have to move ${px(d)} ${dir}${via}, but the spacer before it is only ${px(now)}. Make it the key instead (select it first), or narrow what comes before it.`);
    }
    return { doc: { ...doc, window: setProp(win, prevPath!, sizeKey(a), Math.max(0, next)) }, ps };
  }
  if (d < 0) {
    throw new EditError(`${cap(nameOf(win, who))} would have to move ${px(d)} ${dir}${via}, but there's no spacer before it to shrink. Make it the key instead (select it first), or put a spacer before it.`);
  }
  const r = insertElem(win, parent, i, spacer(a, round3(d)));
  return { doc: { ...doc, window: r.win }, ps: shiftAll(ps, parent, i) };
}

/**
 * Why moving the element at at does not move it: the elements before it in its row (column) with no size of their
 * own along a (and none the client gives them by default) take the change instead.
 */
function unsettled(win: JsonObject, at: ElemPath, a: Axis, what: string): string {
  const parent = parentPath(at);
  const i = at[at.length - 1]!;
  const loose: string[] = [];
  for (let j = 0; j < i; j++) {
    const e = getElem(win, [...parent, j]);
    if (!e || typeof e[sizeKey(a)] === "number") continue;
    const def = DEFAULT_SIZE[typeOf(e)];
    if ((a === "x" ? def?.w : def?.h)?.[1] === STRONG) continue;
    loose.push(nameOf(win, [...parent, j]));
  }
  const one = loose.length <= 1;
  const who = loose.length ? `${loose.slice(0, 2).join(" and ")}${loose.length > 2 ? ` and ${loose.length - 2} more` : ""}` : `something before it in its ${stackName(a)}`;
  return `${what}: ${who} ${one ? "has" : "have"} no ${sizeKey(a)} of ${one ? "its" : "their"} own, so ${one ? "it soaks" : "they soak"} up the change and ${nameOf(win, at)} doesn't move. Give ${one ? "it" : "them"} a ${sizeKey(a)} first (Match size can help).`;
}

// --- the tools ---------------------------------------------------------------------------------------------------

/**
 * Match size: every selected element's width, height or both set to the largest drawn one's, or the key element's
 * (sets the required `width` / `height`).
 */
export function matchSize(doc: EditorDoc, s: Selection, measure: Measure, axes: SizeAxis[], to: MatchTo): ArrangeResult {
  const why = matchRefusal(doc.window, s);
  if (why) throw new EditError(why);
  const m0 = measure(doc);
  const rects = s.map((p) => rectOf(m0, doc.window, p));
  let win = doc.window;
  for (const ax of axes) {
    const a: Axis = ax === "w" ? "x" : "y";
    const target = round3(to === "key" ? len(rects[0]!, a) : Math.max(...rects.map((r) => len(r, a))));
    for (const p of s) if (getElem(win, p)![sizeKey(a)] !== target) win = setProp(win, p, sizeKey(a), target);
  }
  if (win === doc.window) return { doc, note: "They're already the same size." };
  const next = { ...doc, window: win };
  const m1 = measure(next);
  checkAccepted(m0, m1, win, "That size", to === "largest" ? "Match to the key instead, or make room first." : "Pick a smaller key, or make room first.");
  for (const ax of axes) {
    const a: Axis = ax === "w" ? "x" : "y";
    const target = round3(to === "key" ? len(rects[0]!, a) : Math.max(...rects.map((r) => len(r, a))));
    for (const p of s) {
      const got = len(rectOf(m1, win, p), a);
      if (Math.abs(got - target) > EPS) throw new EditError(`${cap(nameOf(win, p))} can't be ${px(target)} ${sizeWord(a)}: the ${stackName(a === "x" ? "y" : "x")} it's in keeps it at ${px(got)}. Leave it out, or change the ${stackName(a === "x" ? "y" : "x")}'s ${sizeKey(a)} first.`);
    }
  }
  return { doc: next, selectMany: [...s], note: overflowNote(m0, m1, win) };
}

/**
 * Align: moves every selected element so its edge (or centre) lands on the key element's. Each one moves through the
 * spacer before it (or before the row, column or group it moves with), inserted when there is none. Across rows for
 * left / centre / right, across columns for top / middle / bottom.
 */
export function align(doc: EditorDoc, s: Selection, measure: Measure, edge: AlignEdge): ArrangeResult {
  const why = alignRefusal(doc.window, s, edge);
  if (why) throw new EditError(why);
  const a: Axis = edge === "left" || edge === "hcenter" || edge === "right" ? "x" : "y";
  const m0 = measure(doc);
  // The selected paths, key first, kept up to date as spacers go in.
  let ps = [...s];
  let cur = doc;
  // Each element's distance still to go after the last round: one that did not move at all will not.
  let last = new Map<number, number>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const m = round === 0 ? m0 : measure(cur);
    if (round) checkAccepted(m0, m, cur.window, `Lining up the ${EDGE_TEXT[edge]}`, `Make room in that ${stackName(a)} first.`);
    const target = edgeOf(rectOf(m, cur.window, ps[0]!), edge);
    const moves: { at: ElemPath; d: number; who: ElemPath }[] = [];
    const now = new Map<number, number>();
    for (const [j, p] of ps.entries()) {
      if (!j) continue;
      const d = target - edgeOf(rectOf(m, cur.window, p), edge);
      if (Math.abs(d) <= EPS) continue;
      const at = mover(cur.window, p, a) as ElemPath;
      const before = last.get(j);
      if (before !== undefined && Math.abs(before - d) <= EPS) throw new EditError(unsettled(cur.window, at, a, `The ${EDGE_TEXT[edge]} can't line up`));
      now.set(j, d);
      const same = moves.find((x) => samePath(x.at, at));
      if (same) {
        if (Math.abs(same.d - d) > EPS) throw new EditError(`${cap(nameOf(cur.window, same.who))} and ${nameOf(cur.window, p)} can only move together (both are in ${nameOf(cur.window, at)}), but they'd need different moves. Leave one of them out.`);
        continue;
      }
      moves.push({ at, d, who: p });
    }
    last = now;
    if (!moves.length) {
      if (cur === doc) return { doc, note: `The ${EDGE_TEXT[edge]} already line up.` };
      return { doc: cur, selectMany: ps, note: overflowNote(m0, m, cur.window) };
    }
    // Later moves first, so an inserted spacer does not shift a path still to be used.
    moves.sort((x, y) => compareTree(y.at, x.at));
    const tracked = ps.length;
    for (const mv of moves) {
      const r = shove(cur, m, mv.at, mv.d, a, [...ps, ...moves.map((x) => x.at)], mv.who);
      cur = r.doc;
      ps = r.ps.slice(0, tracked);
      // The other moves' paths after this insertion.
      moves.forEach((x, i) => (x.at = r.ps[tracked + i]!));
    }
  }
  throw new EditError(`The ${EDGE_TEXT[edge]} can't line up: the ${stackName(a)}s keep sharing out their room differently after each change. Give the elements around them a ${sizeKey(a)} first.`);
}

/**
 * Distribute within one row or column: equal sizes (each selected element's width in a row, height in a column, set
 * to their average, so together they take the room they took), or equal gaps (the spacers between consecutive
 * selected elements sized so every gap is the average gap; spacers inserted where there are none).
 */
export function distribute(doc: EditorDoc, s: Selection, measure: Measure, mode: DistributeMode): ArrangeResult {
  const why = distributeRefusal(doc.window, s, mode);
  if (why) throw new EditError(why);
  const parent = commonParent(s)!;
  const a: Axis = typeOf(getElem(doc.window, parent)) === "row" ? "x" : "y";
  const m0 = measure(doc);
  // In the order they sit in the row or column.
  let ps = [...s].sort((p, q) => p[p.length - 1]! - q[q.length - 1]!);
  if (mode === "sizes") {
    const sizes = ps.map((p) => len(rectOf(m0, doc.window, p), a));
    const avg = round3(sizes.reduce((x, y) => x + y, 0) / sizes.length);
    let win = doc.window;
    for (const p of ps) if (getElem(win, p)![sizeKey(a)] !== avg) win = setProp(win, p, sizeKey(a), avg);
    if (win === doc.window) return { doc, note: `They're already the same ${sizeKey(a)}.` };
    const next = { ...doc, window: win };
    const m1 = measure(next);
    checkAccepted(m0, m1, win, `Making them ${px(avg)} ${sizeWord(a)} each`, `Make room in the ${stackName(a)} first.`);
    for (const p of ps) {
      const got = len(rectOf(m1, win, p), a);
      if (Math.abs(got - avg) > EPS) throw new EditError(`${cap(nameOf(win, p))} can't be ${px(avg)} ${sizeWord(a)}: the ${stackName(a)} keeps it at ${px(got)}. Leave it out, or give the ${stackName(a)} more room first.`);
    }
    return { doc: next, selectMany: [...s], note: overflowNote(m0, m1, win) };
  }
  let cur = doc;
  const order = s.map((p) => ps.findIndex((q) => samePath(p, q)));
  let last: number[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const m = round === 0 ? m0 : measure(cur);
    if (round) checkAccepted(m0, m, cur.window, "Evening out the gaps", `Make room in the ${stackName(a)} first.`);
    const rs = ps.map((p) => rectOf(m, cur.window, p));
    const gaps = rs.slice(1).map((r, i) => pos(r, a) - (pos(rs[i]!, a) + len(rs[i]!, a)));
    // Nothing moved since the last round: the spacers' changes went to elements with no size of their own.
    const stuck = gaps.findIndex((g, i) => last.length && Math.abs(g - last[i]!) <= EPS && Math.abs(g - gaps.reduce((x, y) => x + y, 0) / gaps.length) > EPS);
    if (last.length && gaps.every((g, i) => Math.abs(g - last[i]!) <= EPS) && stuck >= 0) {
      throw new EditError(unsettled(cur.window, ps[stuck + 1]!, a, "The gaps can't be evened out"));
    }
    last = gaps;
    const target = gaps.reduce((x, y) => x + y, 0) / gaps.length;
    if (gaps.every((g) => Math.abs(g - target) <= EPS)) {
      if (cur === doc) return { doc, note: "The gaps are already even." };
      return { doc: cur, selectMany: order.map((i) => ps[i]!), note: overflowNote(m0, m, cur.window) };
    }
    if (round === 0) {
      // The least each gap can be: what is between the two (margins, elements) without the spacer before the second.
      gaps.forEach((g, i) => {
        const before = [...parentPath(ps[i + 1]!), ps[i + 1]![ps[i + 1]!.length - 1]! - 1];
        const sp = getElem(cur.window, before);
        const give = sp && typeOf(sp) === "spacer" && !samePath(before, ps[i]) ? len(rectOf(m, cur.window, before), a) : 0;
        const least = g - give;
        if (least > target + EPS) {
          const x = nameOf(cur.window, ps[i]!);
          const y = nameOf(cur.window, ps[i + 1]!);
          const between = ps[i + 1]![ps[i + 1]!.length - 1]! - ps[i]![ps[i]!.length - 1]! > (give ? 2 : 1);
          throw new EditError(
            between
              ? `The gaps can't be evened out: something sits between ${x} and ${y}, so that gap can't be less than ${px(least)}, wider than the even gap of ${px(target)}. Move it out, or select it too.`
              : `The gaps can't be evened out: the margins of ${x} and ${y} keep that gap at ${px(least)} or more, wider than the even gap of ${px(target)}. Give them smaller margins first.`,
          );
        }
      });
    }
    // Last gap first, so an inserted spacer does not shift a path still to be used.
    for (let i = gaps.length - 1; i >= 0; i--) {
      const d = target - gaps[i]!;
      if (Math.abs(d) <= EPS) continue;
      const r = shove(cur, m, ps[i + 1]!, d, a, ps, ps[i + 1]!);
      cur = r.doc;
      ps = r.ps;
    }
  }
  throw new EditError(`The gaps can't be evened out: the ${stackName(a)} keeps sharing out its room differently after each change. Give the elements around them a ${sizeKey(a)} first.`);
}
