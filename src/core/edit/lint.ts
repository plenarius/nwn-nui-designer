/**
 * A window's problem list, as the editor's Problems panel shows it and `pnpm check` prints it: one place for both, so
 * the command line runs exactly the editor's checks (DESIGN.md, "The check command").
 *
 * - the client checks (validate.ts: types, ranges, binds, unknown keys, fonts the skin lacks), with the window keys
 *   the chosen style rule set declares;
 * - the chosen style rule set (style.ts), given the drawn rectangles when there are some;
 * - the renderer's layout problems told as the editor tells them (issues.ts, editorProblems): clipped text, overflow,
 *   unsolvable sizes, missing images;
 *
 * sorted worst first (a stable sort: each source keeps its order). Grouping identical notes is issues.ts' groupIssues.
 */
import type { Rect } from "../layout/layout.js";
import type { Binds, JsonObject } from "../model/types.js";
import type { Problem } from "../render/render.js";
import { specOf } from "./catalog.js";
import { editorProblems, layoutSeverity } from "./issues.js";
import { type StyleRuleSet, runStyle } from "./style.js";
import { type ElemPath, elemLabel, getElem, typeOf } from "./tree.js";
import { type Finding, type Severity, validateWindow } from "./validate.js";

/** One row of the problem list. */
export interface WindowIssue {
  severity: Severity;
  /** "layout" (the renderer), "client" (validate.ts) or "style:<id>". */
  source: string;
  kind: string;
  text: string;
  /** The element, or null for the window (or a layout problem the renderer could not tie to an element). */
  path: ElemPath | null;
  /** The element as the panel names it ("Button #ok", "Label “Gold”"), or "window". */
  where: string;
}

export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export interface FindingsInput {
  win: JsonObject;
  binds: Binds;
  /** The document's name (a rule's exemptions match it, and the framework window's `id`). */
  name: string;
  /** The skin's font names; without them fonts are not checked. */
  fonts?: string[];
  /** The house style rule set, or none. */
  style?: StyleRuleSet | null;
  /** Rule ids turned off. */
  disabledRules?: ReadonlySet<string>;
  /** The drawn elements of this window (the renderer's outlines), for the rules that look at sizes. */
  outlines?: readonly { elem: JsonObject; rect: Rect }[];
}

/** The client checks and, when a style is chosen, its rules. */
export function windowFindings(i: FindingsInput): Finding[] {
  const out = validateWindow(i.win, { fonts: i.fonts?.length ? i.fonts : undefined, binds: i.binds, extraWindowKeys: i.style?.knownWindowKeys });
  if (i.style) {
    const rects = new Map<JsonObject, Rect>();
    for (const o of i.outlines ?? []) if (!rects.has(o.elem)) rects.set(o.elem, o.rect);
    out.push(...runStyle(i.style, { win: i.win, binds: i.binds, rects, names: [i.name] }, i.disabledRules ?? new Set()));
  }
  return out;
}

/** How the panel names an element: its type's title, then its id or the start of its text. */
export function describeElem(win: JsonObject, p: ElemPath | null): string {
  if (!p) return "window";
  const e = getElem(win, p);
  if (!e) return "?";
  const t = specOf(typeOf(e))?.title ?? typeOf(e);
  const id = typeof e.id === "string" && e.id ? ` #${e.id}` : "";
  const text = elemLabel(e);
  return `${t}${id}${!id && text ? ` “${text.length > 20 ? text.slice(0, 19) + "…" : text}”` : ""}`;
}

/**
 * The problem list: the layout's problems (null: not drawn yet) and the findings, worst first.
 * pathOf maps the window's element objects to their paths (tree.ts, pathIndex).
 */
export function windowIssues(win: JsonObject, binds: Binds, problems: readonly Problem[] | null, pathOf: ReadonlyMap<JsonObject, ElemPath>, findings: readonly Finding[]): WindowIssue[] {
  const out: WindowIssue[] = [];
  for (const p of problems ? editorProblems(problems, win, binds) : []) {
    const path = p.elem ? (pathOf.get(p.elem) ?? null) : null;
    out.push({ severity: layoutSeverity(p.kind), source: "layout", kind: p.kind, text: p.text, path, where: path ? describeElem(win, path) : p.path || "window" });
  }
  for (const f of findings) {
    out.push({ severity: f.severity, source: f.source.startsWith("style:") ? f.source : "client", kind: f.kind, text: f.text, path: f.path, where: describeElem(win, f.path) });
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
