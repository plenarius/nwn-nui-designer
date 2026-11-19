/**
 * House style rules: optional, off by default, pluggable. A rule set is a list of checks over the window's JSON (and,
 * when the editor has drawn it, the elements' rectangles); its findings join the problems list as "style:<id>".
 * A server adds its own by writing a StyleRuleSet and listing it in STYLE_RULE_SETS.
 */
import type { Rect } from "../layout/layout.js";
import { boundValue } from "../model/binds.js";
import { type Binds, type JsonObject, type JsonValue, isObject } from "../model/types.js";
import { type ElemPath, kidsOf, typeOf, walkElems } from "./tree.js";
import type { Finding, Severity } from "./validate.js";

export interface StyleContext {
  win: JsonObject;
  binds: Binds;
  /** Each element's drawn rect (its first, for list rows), if the window has been drawn. */
  rects?: Map<JsonObject, Rect>;
  /** The window's names, for a rule's exemptions: the document's form and name (a framework window's `id` is added). */
  names?: string[];
}

export interface StyleRule {
  id: string;
  title: string;
  /** One line saying what the rule wants, shown in the rule list. */
  summary: string;
  /** Windows the rule skips, by name (the form or document name, or a framework window's `id`): a house exception. */
  exempt?: string[];
  check(ctx: StyleContext, report: (path: ElemPath | null, text: string, severity?: Severity, key?: string) => void): void;
}

export interface StyleRuleSet {
  id: string;
  name: string;
  description: string;
  /** Where the house style is written down. */
  source?: string;
  /**
   * Window keys a framework adds that the client does not read: with this set on, the client check does not report
   * them as unknown (validate.ts, ValidateOptions.extraWindowKeys).
   */
  knownWindowKeys?: string[];
  rules: StyleRule[];
}

export function runStyle(set: StyleRuleSet, ctx: StyleContext, disabled: ReadonlySet<string> = new Set()): Finding[] {
  const out: Finding[] = [];
  const names = new Set([...(ctx.names ?? []), ...(typeof ctx.win.id === "string" ? [ctx.win.id] : [])].map((n) => n.toLowerCase()));
  for (const r of set.rules) {
    if (disabled.has(r.id)) continue;
    if (r.exempt?.some((n) => names.has(n.toLowerCase()))) continue;
    r.check(ctx, (path, text, severity = "warning", key) => out.push({ severity, source: `style:${set.id}`, kind: r.title, text, path, key }));
  }
  return out;
}

// --- helpers for rule writers ----------------------------------------------------------------------------------

export const isBound = (v: JsonValue | undefined): boolean => isObject(v) && typeof v.bind === "string";

/** A value as the window opens with it: static, or its bind's sample value (the dump's, then the framework profile's). */
export function valueOf(ctx: StyleContext, v: JsonValue | undefined): JsonValue | undefined {
  return boundValue(v, ctx.binds, ctx.win);
}

/** The static string of a value (null for binds and non-strings). */
export function staticText(v: JsonValue | undefined): string | null {
  return typeof v === "string" ? v : null;
}

/** Calls fn for every element with its path and its parent. */
export function eachElem(win: JsonObject, fn: (e: JsonObject, path: ElemPath, parent: JsonObject | null) => void): void {
  const rec = (e: JsonObject, path: ElemPath, parent: JsonObject | null) => {
    fn(e, path, parent);
    kidsOf(e).forEach((c, i) => rec(c, [...path, i], e));
  };
  if (isObject(win.root)) rec(win.root, [], null);
}

export { typeOf, walkElems };
