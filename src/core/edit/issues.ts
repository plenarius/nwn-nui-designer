/**
 * The editor's problem list, from the renderer's problems and the checks' findings: what the renderer reports as
 * nui-preview does (the golden compares that list) is told the way a window author can act on (DESIGN.md, "Problems and house style"),
 * and identical notes are grouped.
 */
import { boundValue, windowGeometry } from "../model/binds.js";
import { type Binds, type JsonObject, type JsonValue, isObject } from "../model/types.js";
import { type Problem, foldUnsolvable } from "../render/render.js";
import type { Severity } from "./validate.js";

/** Whether the game sets the window's geometry: none in the window, or a geometry bind with no sample value. */
export function runtimeGeometry(win: JsonObject, binds: Binds): boolean {
  const g = win.geometry;
  return (g === undefined || (isObject(g) && typeof g.bind === "string")) && windowGeometry(win, binds) === null;
}

/**
 * How serious a layout problem is: the client refuses an unsolvable window, and a tooltip off the screen cannot be
 * read at all; the rest show wrong.
 */
export function layoutSeverity(kind: string): Severity {
  if (/unsolvable|tooltip off screen/.test(kind)) return "error";
  if (/not drawn|no sample value/.test(kind)) return "info";
  return "warning";
}

/** The one note a runtime-geometry window gets in place of its layout problems. */
export const RUNTIME_GEOMETRY_TEXT = "geometry is set at runtime; give it a sample value (geometry in the window, or a value for its bind) to check the layout at its real size";

const blank = (v: JsonValue | undefined): boolean =>
  v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.every((x) => x === null || (typeof x === "string" && !x.trim())));

/**
 * The renderer's problems as the editor lists them (and marks them on the canvas):
 * - the solver's "unsolvable layout" folded into its "unsolvable size" (foldUnsolvable, DESIGN.md, "Problems and house style");
 * - an empty text box whose value is a bind with no sample value is "no sample value for bind X", not "wasted room":
 *   the box is filled at runtime, it is the sample that is missing;
 * - none at all when the game sets the window's geometry: they would be about the default 400 x 300, not the real size
 *   (the checks say so once instead, validate.ts).
 */
export function editorProblems(problems: readonly Problem[], win: JsonObject, binds: Binds): Problem[] {
  if (runtimeGeometry(win, binds)) return [];
  return foldUnsolvable(problems).map((p) => {
    if (p.kind !== "empty" || !p.elem) return p;
    const v = p.elem.value;
    if (!isObject(v) || typeof v.bind !== "string" || !blank(boundValue(v, binds, win))) return p;
    return { ...p, kind: "no sample value", text: `no sample value for bind "${v.bind}": give it one to see the text box as it shows in game` };
  });
}

// --- grouping ----------------------------------------------------------------------------------------------------

/** What a note's text says with its particulars (quoted text, numbers) taken out: identical notes share it. */
export function textPattern(text: string): string {
  return text
    .replace(/"[^"]*"|“[^”]*”/g, "\"…\"")
    .replace(/-?\d+(\.\d+)?/g, "#");
}

export interface Groupable {
  severity: string;
  source: string;
  kind: string;
  text: string;
}

/** A row of the problems panel: one issue, or several of one rule saying the same thing (in the order first seen). */
export interface IssueGroup<T extends Groupable> {
  key: string;
  items: T[];
}

/** Groups issues with the same severity, source, kind and text pattern; a group of one is a plain row. */
export function groupIssues<T extends Groupable>(issues: readonly T[]): IssueGroup<T>[] {
  const out: IssueGroup<T>[] = [];
  const by = new Map<string, IssueGroup<T>>();
  for (const i of issues) {
    const key = `${i.severity}\u0000${i.source}\u0000${i.kind}\u0000${textPattern(i.text)}`;
    let g = by.get(key);
    if (!g) {
      g = { key, items: [] };
      by.set(key, g);
      out.push(g);
    }
    g.items.push(i);
  }
  return out;
}
