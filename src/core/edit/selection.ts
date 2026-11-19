/**
 * The editor's selection: one element, several, or none (the window). It is a list of paths in the order they were
 * picked; the first is the key element, the one Match size and Align measure against (as in design tools). Pure
 * functions, so the tree, the canvas and the tests pick the same way. The selection is not part of the undo history.
 */
import type { Rect } from "../layout/layout.js";
import type { JsonObject } from "../model/types.js";
import { specOf } from "./catalog.js";
import { type ElemPath, elemLabel, getElem, isPrefix, kidsOf, parentPath, samePath, typeOf, walkElems } from "./tree.js";

/** The selected elements, the key first. [] is the window. */
export type Selection = readonly ElemPath[];

export const keyOf = (s: Selection): ElemPath | null => s[0] ?? null;

export function has(s: Selection, p: ElemPath): boolean {
  return s.some((x) => samePath(x, p));
}

/** Ctrl/Cmd-click: p joins the selection, or leaves it (a key that leaves hands the key to the next one). */
export function toggle(s: Selection, p: ElemPath): Selection {
  return has(s, p) ? s.filter((x) => !samePath(x, p)) : [...s, p];
}

/** Every element of the window in tree order (depth first, the root first). */
export function treeOrder(win: JsonObject): ElemPath[] {
  const out: ElemPath[] = [];
  walkElems(win, (_, p) => out.push(p));
  return out;
}

/** Compares two paths in tree order. */
export function compareTree(a: ElemPath, b: ElemPath): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

/**
 * Shift-click in the tree: the rows from the key to p in the order the tree shows them (rows is that order: collapsed
 * containers' children are not in it). The key stays first.
 */
export function treeRange(s: Selection, p: ElemPath, rows: readonly ElemPath[]): Selection {
  const key = keyOf(s);
  if (!key) return [p];
  const a = rows.findIndex((r) => samePath(r, key));
  const b = rows.findIndex((r) => samePath(r, p));
  if (a < 0 || b < 0) return [key, ...(samePath(key, p) ? [] : [p])];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const range = rows.slice(lo, hi + 1).filter((r) => !samePath(r, key));
  return [key, ...range];
}

/**
 * Shift-click on the canvas: the siblings from the key to p (the key stays first). When the two are not siblings, p
 * is added (there is no range between elements of different rows).
 */
export function siblingRange(s: Selection, p: ElemPath): Selection {
  const key = keyOf(s);
  if (!key) return [p];
  if (samePath(key, p)) return s;
  if (!key.length || !p.length || !samePath(parentPath(key), parentPath(p))) return has(s, p) ? s : [...s, p];
  const parent = parentPath(key);
  const a = key[key.length - 1]!;
  const b = p[p.length - 1]!;
  const out: ElemPath[] = [key];
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i !== a) out.push([...parent, i]);
  return out;
}

const inside = (r: Rect, box: Rect) => r[0] >= box[0] && r[1] >= box[1] && r[0] + r[2] <= box[0] + box[2] && r[1] + r[3] <= box[1] + box[3];

/**
 * A box dragged on the canvas: the elements drawn fully inside it. Rows and columns draw nothing and spacers are
 * empty room, so the widgets, groups and lists inside are what is picked, outermost first (a group inside takes its
 * content with it); only when there are none are rows and columns picked. The root is never picked. In tree order.
 */
export function boxSelect(win: JsonObject, placed: ReadonlyMap<string, { path: ElemPath; rect: Rect }>, box: Rect): ElemPath[] {
  const within = [...placed.values()].filter((p) => p.path.length > 0 && p.rect[2] > 0 && p.rect[3] > 0 && inside(p.rect, box));
  const kind = (p: ElemPath) => typeOf(getElem(win, p));
  const outermost = (list: typeof within) => list.filter((p) => !list.some((q) => q !== p && isPrefix(q.path, p.path)));
  const widgets = outermost(within.filter((p) => !["row", "col", "spacer"].includes(kind(p.path))));
  const picked = widgets.length ? widgets : outermost(within.filter((p) => kind(p.path) !== "spacer"));
  return picked.map((p) => p.path).sort(compareTree);
}

/**
 * The selection after the document changed (an undo, a delete): the paths that still name an element. When none do,
 * the key's nearest ancestor that still exists (as the single selection did), or the window.
 */
export function stillThere(s: Selection, win: JsonObject): Selection {
  const kept = s.filter((p) => getElem(win, p) !== null);
  if (kept.length === s.length) return s;
  if (kept.length) return kept;
  let p = keyOf(s);
  if (!p) return [];
  while (p.length && !getElem(win, p)) p = p.slice(0, -1);
  return getElem(win, p) ? [p] : [];
}

/** The selected paths that are not inside another selected element (a container takes its content along). */
export function outermostOf(s: Selection): ElemPath[] {
  return s.filter((p) => !s.some((q) => !samePath(q, p) && isPrefix(q, p)));
}

/** Whether every path in s is a child of one parent; that parent's path, or null. */
export function commonParent(s: Selection): ElemPath | null {
  if (!s.length || s.some((p) => !p.length)) return null;
  const parent = parentPath(s[0]!);
  return s.every((p) => samePath(parentPath(p), parent)) ? parent : null;
}

/** An element named in a message: its type and id (button #ok), else its text (button “OK”), else where it sits. */
export function nameOf(win: JsonObject, p: ElemPath): string {
  const e = getElem(win, p);
  if (!e) return "an element";
  if (!p.length) return `the root ${typeOf(e)}`;
  const t = typeOf(e) || "element";
  if (typeof e.id === "string" && e.id) return `${t} #${e.id}`;
  const text = elemLabel(e);
  return text ? `${t} “${text}”` : `${t} ${kidsIndexLabel(win, p)}`;
}

/** "#2 in its row": where an element without an id sits. */
function kidsIndexLabel(win: JsonObject, p: ElemPath): string {
  const parent = getElem(win, parentPath(p));
  const kind = typeOf(parent) === "col" ? "column" : typeOf(parent) || "parent";
  return `#${p[p.length - 1]! + 1} of ${kidsOf(parent).length} in its ${kind}`;
}

/** An element type as a builder calls it: "text field", "column", "slider" (lower case, from the palette's titles). */
export function typeWord(type: string): string {
  if (type === "col") return "column";
  const title = specOf(type)?.title;
  return title ? title.replace(/ \(.*\)$/, "").toLowerCase() : type || "element";
}

const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

/**
 * An element named for a builder, in a sentence (lower case where it is not a label): a button by its text, quoted (“Sell”),
 * another element with text by its type and text ("the label “Gold”"), else by type and id ("button se_sell"), else by
 * type alone when it is the only one of its kind where it sits ("the text field"), else by its place ("the second
 * button in its row"). Never the editor's internal type names or paths.
 */
export function plainName(win: JsonObject, p: ElemPath): string {
  const e = getElem(win, p);
  if (!e) return "an element";
  const t = typeOf(e);
  const word = typeWord(t);
  if (!p.length) return `the window's main ${word}`;
  const raw = elemLabel(e);
  // A bound or strref text is not what the builder sees on the canvas: name it some other way.
  const text = raw && !raw.startsWith("{") && !raw.startsWith("strref ") ? (raw.length > 24 ? raw.slice(0, 23) + "…" : raw) : "";
  if (text && (t === "button" || t === "button_select")) return `“${text}”`;
  if (text) return `the ${word} “${text}”`;
  if (typeof e.id === "string" && e.id) return `${word} ${e.id}`;
  const parent = getElem(win, parentPath(p));
  const same = kidsOf(parent).filter((c) => typeOf(c) === t);
  if (same.length <= 1) return `the ${word}`;
  const nth = same.indexOf(e);
  const place = typeOf(parent) === "list" ? "list" : typeWord(typeOf(parent));
  return `the ${ORDINAL[nth] ?? `number ${nth + 1}`} ${word} in its ${place}`;
}

/** A sentence's first letter in upper case. */
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

