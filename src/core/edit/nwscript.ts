/**
 * The NWScript export: readable code that builds the same window with nw_inc_nui.nss's builders, its binds and ids
 * as named constants, and a small skeleton that opens the window, sets the sample bind values and handles its
 * events.
 *
 * The code is generated as a small program (statements of builder calls) that this module can also run: evalProgram
 * runs it with the builders' semantics as nw_inc_nui.nss 8193.37-17 implements them (an int TRUE becomes JsonBool,
 * a float parameter JsonFloat, ...). Every element is first written as its builder and modifiers (NuiLabel, NuiWidth,
 * NuiId, ...); whatever that does not reproduce exactly (a key the builder does not make, one it adds that the JSON
 * lacks, a value of another shape) is fixed with JsonObjectSet or JsonObjectDel, so the program's result is the
 * window's JSON exactly, whatever produced it. The tests run it over every fixture and every local dump.
 */
import * as N from "../model/nui.js";
import { type JsonObject, type JsonValue, isObject } from "../model/types.js";
import { ASPECT, CHART_TYPE, DIRECTION, DRAW_ORDER, DRAW_RENDER, type EnumOption, HALIGN, SCROLLBARS, VALIGN } from "./catalog.js";
import { bindDetails } from "./binds.js";
import { type EditorDoc } from "./project.js";
import { typeOf } from "./tree.js";

// --- the program ----------------------------------------------------------------------------------------------

export type Expr =
  | { k: "call"; fn: string; args: Expr[] }
  | { k: "str"; v: string }
  | { k: "int"; v: number; c?: string }
  | { k: "float"; v: number }
  | { k: "const"; name: string }
  | { k: "var"; name: string };

export type Stmt = { k: "decl"; name: string; e: Expr } | { k: "set"; name: string; e: Expr } | { k: "comment"; text: string } | { k: "blank" } | { k: "return"; e: Expr };

export interface Func {
  name: string;
  doc: string;
  body: Stmt[];
}

export interface Program {
  /** String constants: name -> value (binds, ids, the window id). */
  consts: [name: string, value: string, comment?: string][];
  funcs: Func[];
  /** The function that returns the window. */
  entry: string;
}

const call = (fn: string, ...args: Expr[]): Expr => ({ k: "call", fn, args });
const str = (v: string): Expr => ({ k: "str", v });
const int = (v: number, c?: string): Expr => ({ k: "int", v, c });
const flt = (v: number): Expr => ({ k: "float", v });
const TRUE = int(1, "TRUE");
const FALSE = int(0, "FALSE");
const nbool = (b: boolean): Expr => (b ? TRUE : FALSE);

// --- running it -----------------------------------------------------------------------------------------------

type V = JsonValue;
const b = (x: V): boolean => x !== 0 && x !== false && x !== null;
const f = (x: V): number => (typeof x === "number" ? Math.fround(x) : 0);

/** The nw_inc_nui.nss builders and the Json* functions, as NWScript runs them. */
const BUILTINS: Record<string, (...a: V[]) => V> = {
  JsonString: (s) => s,
  JsonInt: (n) => Math.trunc(n as number),
  JsonFloat: (x) => f(x),
  JsonBool: (x) => b(x),
  JsonNull: () => null,
  JsonArray: () => [],
  JsonObject: () => ({}),
  JsonArrayInsert: (a, v) => [...(a as V[]), v],
  JsonObjectSet: (o, k, v) => ({ ...(o as JsonObject), [k as string]: v }),
  JsonObjectDel: (o, k) => {
    const out = { ...(o as JsonObject) };
    delete out[k as string];
    return out;
  },
  JsonParse: (s) => JSON.parse(s as string) as V,
  NuiWindow: (root, title, geo, res, col, clo, tra, bor, acc = true, sc = null, ec = null, font = "") => N.NuiWindow(root, title, geo, res, col, clo, tra, bor, acc, sc, ec, font),
  NuiElement: (t, l, v) => N.NuiElement(t as string, l, v),
  NuiBind: (id, nf = 0, np = 0, tf = 0) => N.NuiBind(id as string, nf as number, np as number, tf as number),
  NuiId: (e, id) => N.NuiId(e as JsonObject, id as string),
  NuiStrRef: (n) => N.NuiStrRef(n as number),
  NuiCol: (l) => N.NuiCol(l as V[]),
  NuiRow: (l) => N.NuiRow(l as V[]),
  NuiGroup: (c, bb = 1, s = 4) => N.NuiGroup(c, b(bb), s as number),
  NuiWidth: (e, x) => N.NuiWidth(e as JsonObject, f(x)),
  NuiHeight: (e, x) => N.NuiHeight(e as JsonObject, f(x)),
  NuiAspect: (e, x) => N.NuiAspect(e as JsonObject, f(x)),
  NuiMargin: (e, x) => N.NuiMargin(e as JsonObject, f(x)),
  NuiPadding: (e, x) => N.NuiPadding(e as JsonObject, f(x)),
  NuiEnabled: (e, v) => N.NuiEnabled(e as JsonObject, v),
  NuiVisible: (e, v) => N.NuiVisible(e as JsonObject, v),
  NuiTooltip: (e, v) => N.NuiTooltip(e as JsonObject, v),
  NuiDisabledTooltip: (e, v) => N.NuiDisabledTooltip(e as JsonObject, v),
  NuiEncouraged: (e, v) => N.NuiEncouraged(e as JsonObject, v),
  NuiVec: (x, y) => N.NuiVec(f(x), f(y)),
  NuiRect: (x, y, w, h) => N.NuiRect(f(x), f(y), f(w), f(h)),
  NuiColor: (r, g, bb, a = 255) => N.NuiColor(r as number, g as number, bb as number, a as number),
  NuiStyleForegroundColor: (e, c) => N.NuiStyleForegroundColor(e as JsonObject, c),
  NuiStyleFont: (e, v) => N.NuiStyleFont(e as JsonObject, v),
  NuiSpacer: () => N.NuiSpacer(),
  NuiLabel: (v, h, va) => N.NuiLabel(v, h, va),
  NuiText: (v, bb = 1, s = 4) => N.NuiText(v, b(bb), s as number),
  NuiButton: (l) => N.NuiButton(l),
  NuiButtonImage: (r) => N.NuiButtonImage(r),
  NuiButtonSelect: (l, v) => N.NuiButtonSelect(l, v),
  NuiCheck: (l, v) => N.NuiCheck(l, v),
  NuiImage: (r, a, h, v) => N.NuiImage(r, a, h, v),
  NuiImageRegion: (e, r) => N.NuiImageRegion(e as JsonObject, r),
  NuiCombo: (e, s) => N.NuiCombo(e, s),
  NuiComboEntry: (l, v) => N.NuiComboEntry(l as string, v as number),
  NuiSliderFloat: (v, mn, mx, s) => N.NuiSliderFloat(v, mn, mx, s),
  NuiSlider: (v, mn, mx, s) => N.NuiSlider(v, mn, mx, s),
  NuiProgress: (v) => N.NuiProgress(v),
  NuiTextEdit: (p, v, mx, ml, ww = 1) => N.NuiTextEdit(p, v, mx as number, b(ml), b(ww)),
  NuiList: (t, rc, rh = 25, bb = 1, s = 2) => N.NuiList(t, rc, f(rh), b(bb), s as number),
  NuiListTemplateCell: (e, w, v) => N.NuiListTemplateCell(e as JsonObject, f(w), b(v)),
  NuiColorPicker: (c) => N.NuiColorPicker(c),
  NuiOptions: (d, e, v) => N.NuiOptions(d as number, e, v),
  NuiToggles: (d, e, v) => N.NuiToggles(d as number, e, v),
  NuiChartSlot: (t, l, c, d) => N.NuiChartSlot(t as number, l, c, d),
  NuiChart: (s) => N.NuiChart(s),
  NuiDrawListPolyLine: (en, c, fi, t, p, o = 1, r = 0, a = 0) => N.NuiDrawListPolyLine(en, c, fi, t, p, o as number, r as number, b(a)),
  NuiDrawListCurve: (en, c, t, a0, b0, c0, c1, o = 1, r = 0, a = 0) => N.NuiDrawListCurve(en, c, t, a0, b0, c0, c1, o as number, r as number, b(a)),
  NuiDrawListCircle: (en, c, fi, t, rc, o = 1, r = 0, a = 0) => N.NuiDrawListCircle(en, c, fi, t, rc, o as number, r as number, b(a)),
  NuiDrawListArc: (en, c, fi, t, ce, ra, mn, mx, o = 1, r = 0, a = 0) => N.NuiDrawListArc(en, c, fi, t, ce, ra, mn, mx, o as number, r as number, b(a)),
  NuiDrawListText: (en, c, rc, tx, o = 1, r = 0, a = 0, font = "") => N.NuiDrawListText(en, c, rc, tx, o as number, r as number, b(a), font),
  NuiDrawListImage: (en, im, rc, as, h, v, o = 1, r = 0, a = 0) => N.NuiDrawListImage(en, im, rc, as, h, v, o as number, r as number, b(a)),
  NuiDrawListImageRegion: (e, r) => N.NuiDrawListImageRegion(e as JsonObject, r),
  NuiDrawListLine: (en, c, t, a0, b0, o = 1, r = 0, a = 0) => N.NuiDrawListLine(en, c, t, a0, b0, o as number, r as number, b(a)),
  NuiDrawListRect: (en, c, fi, t, rc, o = 1, r = 0, a = 0) => N.NuiDrawListRect(en, c, fi, t, rc, o as number, r as number, b(a)),
  NuiDrawList: (e, s, l) => N.NuiDrawList(e as JsonObject, s, l),
};

/** Runs the program: the window it builds. */
export function evalProgram(p: Program): JsonObject {
  const consts = new Map(p.consts.map(([n, v]) => [n, v]));
  const funcs = new Map(p.funcs.map((fn) => [fn.name, fn]));
  const runFunc = (name: string): V => {
    const fn = funcs.get(name);
    if (!fn) throw new Error(`no function ${name}`);
    const vars = new Map<string, V>();
    const ev = (e: Expr): V => {
      switch (e.k) {
        case "str":
          return e.v;
        case "int":
        case "float":
          return e.v;
        case "const":
          if (!consts.has(e.name)) throw new Error(`no constant ${e.name}`);
          return consts.get(e.name)!;
        case "var":
          if (!vars.has(e.name)) throw new Error(`no variable ${e.name}`);
          return vars.get(e.name)!;
        case "call": {
          if (funcs.has(e.fn) && !e.args.length) return runFunc(e.fn);
          const impl = BUILTINS[e.fn];
          if (!impl) throw new Error(`no builtin ${e.fn}`);
          return impl(...e.args.map(ev));
        }
      }
    };
    for (const s of fn.body) {
      if (s.k === "decl") {
        if (vars.has(s.name)) throw new Error(`${s.name} declared twice in ${name}`);
        vars.set(s.name, ev(s.e));
      } else if (s.k === "set") {
        if (!vars.has(s.name)) throw new Error(`${s.name} not declared in ${name}`);
        vars.set(s.name, ev(s.e));
      } else if (s.k === "return") return ev(s.e);
    }
    throw new Error(`${name} returns nothing`);
  };
  return runFunc(p.entry) as JsonObject;
}

// --- equality, as the client compares numbers --------------------------------------------------------------------

/**
 * Whether two numbers are the same NWScript float: equal as 32-bit floats, or one float32 step apart. The NWScript
 * compiler (nwn_script_comp 2.3.2, and the game's, which it wraps) parses a float literal truncated, not rounded:
 * 0.05 becomes 0.049999997 (0x3D4CCCCC) where a correctly rounded parse gives 0.050000001 (0x3D4CCCCD). So the
 * game's JSON can be one step below the .jui's number (found by tests/server/nwscript_on_server.ts; DESIGN.md).
 */
export function sameFloat32(x: number, y: number): boolean {
  const fa = Math.fround(x);
  const fb = Math.fround(y);
  if (fa === fb) return true;
  const m = Math.max(Math.abs(fa), Math.abs(fb));
  if (m === 0 || !Number.isFinite(m)) return false;
  const ulp = 2 ** (Math.floor(Math.log2(m)) - 23);
  return Math.abs(fa - fb) <= ulp;
}

/** Deep equality of JSON values; with floatTolerance, numbers compare as NWScript floats (sameFloat32). */
export function jsonEqual(a: V | undefined, c: V | undefined, floatTolerance = false): boolean {
  if (typeof a === "number" && typeof c === "number") return a === c || (floatTolerance && sameFloat32(a, c));
  if (a === c) return true;
  if (Array.isArray(a) || Array.isArray(c)) {
    if (!Array.isArray(a) || !Array.isArray(c) || a.length !== c.length) return false;
    return a.every((x, i) => jsonEqual(x, c[i], floatTolerance));
  }
  if (isObject(a) && isObject(c)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(c).length) return false;
    return ka.every((k) => k in c && jsonEqual(a[k], c[k], floatTolerance));
  }
  return false;
}

// --- generating it ---------------------------------------------------------------------------------------------

export interface NwscriptOptions {
  /** Prefix of the functions and constants ("Gods" gives Gods_Window, GODS_BIND_...). */
  prefix: string;
  /** The window id (NuiCreate's sWindowId). */
  windowId: string;
  /** The script's own resref: the skeleton opens the window with it as the event script. */
  script: string;
  /** Write the skeleton (open, bind, events, main). Without it the file is an include of the builder only. */
  skeleton: boolean;
  /** Sample bind values the skeleton sets after opening. */
  binds?: Record<string, JsonValue>;
  /** Put each container of more than this many elements in a function of its own (long windows stay readable, and
   * the compiler's limits are far away). */
  splitOver?: number;
  /** Where it came from, for the header. */
  source?: string;
}

const KEYWORDS = new Set(["int", "float", "string", "object", "json", "void", "vector", "location", "effect", "if", "else", "for", "while", "do", "return", "switch", "case", "break", "continue", "default", "const", "struct", "action", "event", "itemproperty", "talent", "sqlquery", "cassowary"]);

function ident(s: string): string {
  const out = s.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return out && /^[A-Za-z_]/.test(out) ? out : `_${out}`;
}

class Gen {
  readonly consts: Program["consts"] = [];
  private readonly constByValue = new Map<string, string>();
  readonly funcs: Func[] = [];
  private readonly names = new Set<string>();
  private body: Stmt[] = [];
  private evalCache = new WeakMap<Expr, V>();
  readonly P: string;

  constructor(readonly o: NwscriptOptions) {
    this.P = ident(o.prefix).toUpperCase();
  }

  constant(kind: "BIND" | "ID", value: string): Expr {
    const key = `${kind}\u0000${value}`;
    let name = this.constByValue.get(key);
    if (!name) {
      const base = `${this.P}_${kind}_${ident(value).toUpperCase()}`;
      name = base;
      let n = 2;
      while (this.consts.some(([c]) => c === name)) name = `${base}_${n++}`;
      this.constByValue.set(key, name);
      this.consts.push([name, value]);
    }
    return { k: "const", name };
  }

  /** A fresh local variable name in the function being written. */
  local(base: string): string {
    let b0 = ident(base);
    if (KEYWORDS.has(b0.toLowerCase())) b0 = `j${b0}`;
    if (!/^j[A-Z]/.test(b0)) b0 = `j${b0.charAt(0).toUpperCase()}${b0.slice(1)}`;
    let name = b0;
    let n = 2;
    while (this.names.has(name)) name = `${b0}${n++}`;
    this.names.add(name);
    return name;
  }

  emit(s: Stmt): void {
    this.body.push(s);
  }

  /** Writes a function; fill is called with the body's statements going into it. */
  func(name: string, doc: string, fill: () => Expr): Expr {
    const saved = this.body;
    this.body = [];
    const ret = fill();
    this.body.push({ k: "return", e: ret });
    this.funcs.push({ name, doc, body: this.body });
    this.funcValues.set(name, this.value(ret));
    this.body = saved;
    return call(name);
  }

  /** Every local's value (locals are unique across the program), for the fixups' comparisons. */
  private readonly vars = new Map<string, V>();
  private readonly funcValues = new Map<string, V>();

  setVar(name: string, v: V): void {
    this.vars.set(name, v);
  }

  /** The expression's value (cached: fixups compare what the builders made with the JSON). */
  value(e: Expr): V {
    if (e.k === "str" || e.k === "int" || e.k === "float") return e.v;
    if (e.k === "const") return this.consts.find(([n]) => n === e.name)![1];
    if (e.k === "var") {
      if (!this.vars.has(e.name)) throw new Error(`no value for ${e.name}`);
      return this.vars.get(e.name)!;
    }
    const c = this.evalCache.get(e);
    if (c !== undefined) return c;
    let r: V;
    if (this.funcValues.has(e.fn)) r = this.funcValues.get(e.fn)!;
    else r = BUILTINS[e.fn]!(...e.args.map((a) => this.value(a)));
    this.evalCache.set(e, r);
    return r;
  }

  // --- values -------------------------------------------------------------------------------------------------

  /** A JSON value as an expression. hint says what the builder's parameter is (float, int, an enum's options). */
  json(v: V | undefined, hint: Hint = null): Expr {
    if (v === undefined || v === null) return call("JsonNull");
    if (typeof v === "string") return call("JsonString", str(v));
    if (typeof v === "boolean") return call("JsonBool", nbool(v));
    if (typeof v === "number") {
      if (Array.isArray(hint)) {
        const o = hint.find((x) => x.value === v);
        if (o && Number.isInteger(v)) return call("JsonInt", int(v, o.constant));
      }
      if (hint === "float" || !Number.isInteger(v)) return call("JsonFloat", flt(v));
      return call("JsonInt", int(v));
    }
    if (Array.isArray(v)) {
      if (hint === "combo" && v.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === "string" && typeof x[1] === "number" && Number.isInteger(x[1]))) {
        return this.array(v.map((x) => call("NuiComboEntry", str((x as V[])[0] as string), int((x as V[])[1] as number))), "jEntries");
      }
      return this.array(v.map((x) => this.json(x, hint === "floats" ? "float" : null)), "jArray");
    }
    if (typeof v.bind === "string" && Object.keys(v).every((k) => ["bind", "number_flags", "number_precision", "text_flags"].includes(k))) {
      const flags = [v.number_flags, v.number_precision, v.text_flags];
      if (Object.keys(v).length === 4 && flags.every((x) => typeof x === "number" && Number.isInteger(x))) {
        const args: Expr[] = [this.constant("BIND", v.bind)];
        const nums = flags as number[];
        let last = nums.length;
        while (last > 0 && nums[last - 1] === 0) last--;
        for (let i = 0; i < last; i++) args.push(int(nums[i]!));
        return call("NuiBind", ...args);
      }
    }
    const keys = Object.keys(v).sort().join(",");
    const allNum = Object.values(v).every((x) => typeof x === "number");
    if (keys === "strref" && Number.isInteger(v.strref)) return call("NuiStrRef", int(v.strref as number));
    if (keys === "a,b,g,r" && Object.values(v).every((x) => typeof x === "number" && Number.isInteger(x))) {
      const args = [int(v.r as number), int(v.g as number), int(v.b as number)];
      if (v.a !== 255) args.push(int(v.a as number));
      return call("NuiColor", ...args);
    }
    if (keys === "h,w,x,y" && allNum) return call("NuiRect", flt(v.x as number), flt(v.y as number), flt(v.w as number), flt(v.h as number));
    if (keys === "x,y" && allNum) return call("NuiVec", flt(v.x as number), flt(v.y as number));
    let out: Expr = call("JsonObject");
    for (const [k, x] of Object.entries(v)) out = call("JsonObjectSet", out, str(k), this.json(x));
    return out;
  }

  /** An array: inline when short and simple, else built in a local variable. */
  array(items: Expr[], base: string): Expr {
    if (!items.length) return call("JsonArray");
    const simple = items.every((x) => size(x) <= 4);
    if (items.length <= 3 && simple) {
      let out: Expr = call("JsonArray");
      for (const x of items) out = call("JsonArrayInsert", out, x);
      return out;
    }
    const name = this.local(base);
    this.emit({ k: "decl", name, e: call("JsonArray") });
    for (const x of items) this.emit({ k: "set", name, e: call("JsonArrayInsert", { k: "var", name }, x) });
    // Its value, for the fixups' comparisons.
    this.setVar(name, items.map((x) => this.value(x)));
    return { k: "var", name };
  }

  // --- elements -----------------------------------------------------------------------------------------------

  /** The element as builder calls, exact. */
  elem(e: JsonObject): Expr {
    const t = typeOf(e);
    const g = (k: string, h: Hint = null) => this.json(e[k], h);
    const asInt = (k: string, d: number, opts?: EnumOption[]): Expr => {
      const v = e[k];
      const n = typeof v === "number" && Number.isInteger(v) ? v : d;
      const o = opts?.find((x) => x.value === n);
      return int(n, o?.constant);
    };
    const asBool = (k: string, d: boolean): Expr => nbool(typeof e[k] === "boolean" ? (e[k] as boolean) : d);
    const asFloat = (k: string, d: number): Expr => flt(typeof e[k] === "number" ? (e[k] as number) : d);
    let x: Expr;
    switch (t) {
      case "row":
      case "col":
        x = call(t === "row" ? "NuiRow" : "NuiCol", this.children(e));
        break;
      case "group": {
        const kids = Array.isArray(e.children) ? e.children : [];
        const child = kids.length === 1 && isObject(kids[0]) ? this.elem(kids[0]) : call("JsonNull");
        x = call("NuiGroup", child, asBool("border", true), asInt("scrollbars", 4, SCROLLBARS));
        break;
      }
      case "spacer":
        x = call("NuiSpacer");
        break;
      case "label":
        x = call("NuiLabel", g("value"), g("text_halign", HALIGN), g("text_valign", VALIGN));
        break;
      case "text":
        x = call("NuiText", g("value"), asBool("border", true), asInt("scrollbars", 4, SCROLLBARS));
        break;
      case "button":
        x = call("NuiButton", g("label"));
        break;
      case "button_image":
        x = call("NuiButtonImage", g("label"));
        break;
      case "button_select":
        x = call("NuiButtonSelect", g("label"), g("value"));
        break;
      case "check":
        x = call("NuiCheck", g("label"), g("value"));
        break;
      case "image":
        x = call("NuiImage", g("value"), g("image_aspect", ASPECT), g("image_halign", HALIGN), g("image_valign", VALIGN));
        if ("image_region" in e) x = call("NuiImageRegion", x, g("image_region"));
        break;
      case "combo":
        x = call("NuiCombo", g("elements", "combo"), g("value"));
        break;
      case "slider":
        x = call("NuiSlider", g("value"), g("min"), g("max"), g("step"));
        break;
      case "sliderf":
        x = call("NuiSliderFloat", g("value", "float"), g("min", "float"), g("max", "float"), g("step", "float"));
        break;
      case "progress":
        x = call("NuiProgress", g("value", "float"));
        break;
      case "textedit":
        x = call("NuiTextEdit", g("label"), g("value"), asInt("max", 64), asBool("multiline", false), asBool("wordwrap", true));
        break;
      case "list":
        x = call("NuiList", this.template(e), g("row_count"), asFloat("row_height", 25), asBool("border", true), asInt("scrollbars", 2, SCROLLBARS));
        break;
      case "color_picker":
        x = call("NuiColorPicker", g("value"));
        break;
      case "options":
      case "tabbar":
        x = call(t === "options" ? "NuiOptions" : "NuiToggles", asInt("direction", 0, DIRECTION), g("elements"), g("value"));
        break;
      case "chart":
        x = call("NuiChart", this.chart(e.value));
        break;
      default:
        x = call("NuiElement", str(t), g("label"), g("value"));
    }
    // The modifiers, in a fixed order.
    if (typeof e.id === "string") x = call("NuiId", x, this.constant("ID", e.id));
    for (const [k, fn] of [["width", "NuiWidth"], ["height", "NuiHeight"], ["aspect", "NuiAspect"], ["margin", "NuiMargin"], ["padding", "NuiPadding"]] as const) {
      if (typeof e[k] === "number") x = call(fn, x, flt(e[k] as number));
    }
    for (const [k, fn] of [["enabled", "NuiEnabled"], ["visible", "NuiVisible"], ["tooltip", "NuiTooltip"], ["disabled_tooltip", "NuiDisabledTooltip"], ["encouraged", "NuiEncouraged"], ["foreground_color", "NuiStyleForegroundColor"], ["font", "NuiStyleFont"]] as const) {
      if (k in e) x = call(fn, x, g(k));
    }
    if (Array.isArray(e.draw_list)) x = call("NuiDrawList", x, g("draw_list_scissor"), this.drawList(e.draw_list));
    return this.spill(this.fixups(x, e), t);
  }

  /**
   * A long element as statements: its builder in a local, then each modifier on its own line
   * (json jLabel = NuiLabel(...); jLabel = NuiWidth(jLabel, 100.0); ...). A short one stays one expression.
   */
  spill(x: Expr, type: string): Expr {
    if (exprText(x).length <= 100 || x.k !== "call" || !MODIFIERS.has(x.fn)) return x;
    const chain: { fn: string; rest: Expr[] }[] = [];
    let cur: Expr = x;
    while (cur.k === "call" && MODIFIERS.has(cur.fn) && cur.args.length) {
      chain.unshift({ fn: cur.fn, rest: cur.args.slice(1) });
      cur = cur.args[0]!;
    }
    const base = { button_select: "jSelect", button_image: "jImageButton", textedit: "jTextEdit", color_picker: "jColorPicker", tabbar: "jToggles" }[type] ?? `j${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    const name = this.local(base);
    this.emit({ k: "decl", name, e: cur });
    for (const c of chain) this.emit({ k: "set", name, e: call(c.fn, { k: "var", name }, ...c.rest) });
    this.setVar(name, this.value(x));
    return { k: "var", name };
  }

  /** JsonObjectSet / JsonObjectDel for whatever the builders made differently from the JSON. */
  fixups(x: Expr, want: JsonObject): Expr {
    const got = this.value(x);
    if (!isObject(got)) return this.json(want);
    let out = x;
    for (const [k, v] of Object.entries(want)) {
      if (!(k in got) || !jsonEqual(got[k], v, true)) out = call("JsonObjectSet", out, str(k), this.json(v));
    }
    for (const k of Object.keys(got)) if (!(k in want)) out = call("JsonObjectDel", out, str(k));
    return out;
  }

  children(e: JsonObject): Expr {
    const kids = Array.isArray(e.children) ? e.children : [];
    if (!kids.length) return call("JsonArray");
    const items = kids.map((c) => (isObject(c) ? this.maybeSplit(c) : this.json(c)));
    if (items.length === 1 && size(items[0]!) <= 3) return call("JsonArrayInsert", call("JsonArray"), items[0]!);
    const name = this.local(typeOf(e) === "row" ? "jRow" : typeOf(e) === "col" ? "jCol" : "jChildren");
    this.emit({ k: "decl", name, e: call("JsonArray") });
    for (const it of items) this.emit({ k: "set", name, e: call("JsonArrayInsert", { k: "var", name }, it) });
    this.setVar(name, items.map((it) => this.value(it)));
    return { k: "var", name };
  }

  /** A big container gets a function of its own. */
  maybeSplit(c: JsonObject): Expr {
    const limit = this.o.splitOver ?? 40;
    if (typeOf(c) && ["row", "col", "group", "list"].includes(typeOf(c)) && countElems(c) > limit) {
      const id = typeof c.id === "string" && c.id ? ident(c.id) : `${typeOf(c)}${this.funcs.length + 1}`;
      let name = `${ident(this.o.prefix)}_${id.charAt(0).toUpperCase()}${id.slice(1)}`;
      let n = 2;
      while (this.funcs.some((fn) => fn.name === name)) name = `${ident(this.o.prefix)}_${id}${n++}`;
      const kind = typeOf(c) === "col" ? "column" : typeOf(c);
      const doc = typeof c.id === "string" && c.id ? `The ${kind} '${c.id}' in the window, with its children.` : `A ${kind} in the window, with its children.`;
      return this.func(name, doc, () => this.elem(c));
    }
    return this.elem(c);
  }

  template(e: JsonObject): Expr {
    const tpl = Array.isArray(e.row_template) ? e.row_template : [];
    const cells = tpl.map((c) => {
      if (Array.isArray(c) && c.length === 3 && isObject(c[0]) && typeof c[1] === "number" && typeof c[2] === "boolean") {
        return call("NuiListTemplateCell", this.maybeSplit(c[0]), flt(c[1]), nbool(c[2]));
      }
      return this.json(c);
    });
    if (!cells.length) return call("JsonArray");
    const name = this.local("jTemplate");
    this.emit({ k: "decl", name, e: call("JsonArray") });
    for (const c of cells) this.emit({ k: "set", name, e: call("JsonArrayInsert", { k: "var", name }, c) });
    this.setVar(name, cells.map((c) => this.value(c)));
    return { k: "var", name };
  }

  chart(v: V | undefined): Expr {
    if (!Array.isArray(v)) return this.json(v);
    const slots = v.map((s) => {
      if (!isObject(s)) return this.json(s);
      const x = call("NuiChartSlot", int(typeof s.type === "number" ? s.type : 0, CHART_TYPE.find((o) => o.value === s.type)?.constant), this.json(s.legend), this.json(s.color), this.json(s.data, "floats"));
      return this.spill(this.fixups(x, s), "slot");
    });
    return this.array(slots, "jSlots");
  }

  drawList(items: V[]): Expr {
    const exprs = items.map((it) => (isObject(it) ? this.drawItem(it) : this.json(it)));
    const name = this.local("jDraw");
    this.emit({ k: "decl", name, e: call("JsonArray") });
    for (const x of exprs) this.emit({ k: "set", name, e: call("JsonArrayInsert", { k: "var", name }, x) });
    this.setVar(name, exprs.map((x) => this.value(x)));
    return { k: "var", name };
  }

  drawItem(it: JsonObject): Expr {
    const g = (k: string, h: Hint = null) => this.json(it[k], h);
    const order = typeof it.order === "number" ? it.order : 1;
    const render = typeof it.render === "number" ? it.render : 0;
    const arr = it.arrayBinds === true;
    const full: Expr[] = [int(order, DRAW_ORDER.find((o) => o.value === order)?.constant), int(render, DRAW_RENDER.find((o) => o.value === render)?.constant), nbool(arr)];
    // The trailing parameters that are not their defaults (NUI_DRAW_LIST_ITEM_ORDER_AFTER, _RENDER_ALWAYS, FALSE).
    const tail = (all = false): Expr[] => full.slice(0, all || arr ? 3 : render !== 0 ? 2 : order !== 1 ? 1 : 0);
    let x: Expr;
    const t = typeof it.type === "number" ? it.type : -1;
    switch (t) {
      case 0:
        x = call("NuiDrawListPolyLine", g("enabled"), g("color"), g("fill"), g("line_thickness", "float"), g("points", "floats"), ...tail());
        break;
      case 1:
        x = call("NuiDrawListCurve", g("enabled"), g("color"), g("line_thickness", "float"), g("a"), g("b"), g("ctrl0"), g("ctrl1"), ...tail());
        break;
      case 2:
        x = call("NuiDrawListCircle", g("enabled"), g("color"), g("fill"), g("line_thickness", "float"), g("rect"), ...tail());
        break;
      case 3:
        x = call("NuiDrawListArc", g("enabled"), g("color"), g("fill"), g("line_thickness", "float"), g("c"), g("radius", "float"), g("amin", "float"), g("amax", "float"), ...tail());
        break;
      case 4: {
        const font = it.font !== "" && it.font !== undefined;
        x = call("NuiDrawListText", g("enabled"), g("color"), g("rect"), g("text"), ...tail(font), ...(font ? [g("font")] : []));
        break;
      }
      case 5:
        x = call("NuiDrawListImage", g("enabled"), g("image"), g("rect"), g("image_aspect", ASPECT), g("image_halign", HALIGN), g("image_valign", VALIGN), ...tail());
        if ("image_region" in it) x = call("NuiDrawListImageRegion", x, g("image_region"));
        break;
      case 6:
        x = call("NuiDrawListLine", g("enabled"), g("color"), g("line_thickness", "float"), g("a"), g("b"), ...tail());
        break;
      case 7:
        x = call("NuiDrawListRect", g("enabled"), g("color"), g("fill"), g("line_thickness", "float"), g("rect"), ...tail());
        break;
      default:
        return this.json(it);
    }
    return this.spill(this.fixups(x, it), "item");
  }

  window(win: JsonObject): Expr {
    const g = (k: string) => this.json(win[k]);
    const root = isObject(win.root) ? this.maybeSplit(win.root) : g("root");
    const x = call("NuiWindow", root, g("title"), g("geometry"), g("resizable"), g("collapsed"), g("closable"), g("transparent"), g("border"), g("accepts_input"), g("size_constraint"), g("edge_constraint"), g("font"));
    return this.fixups(x, win);
  }
}

type Hint = "float" | "floats" | "combo" | EnumOption[] | null;

/** Calls that take an element first and return it changed. */
const MODIFIERS = new Set(["NuiId", "NuiWidth", "NuiHeight", "NuiAspect", "NuiMargin", "NuiPadding", "NuiEnabled", "NuiVisible", "NuiTooltip", "NuiDisabledTooltip", "NuiEncouraged", "NuiStyleForegroundColor", "NuiStyleFont", "NuiDrawList", "NuiImageRegion", "NuiDrawListImageRegion", "JsonObjectSet", "JsonObjectDel"]);

function size(e: Expr): number {
  return e.k === "call" ? 1 + e.args.reduce((s, a) => s + size(a), 0) : 1;
}

function countElems(e: JsonObject): number {
  let n = 1;
  const kids = typeOf(e) === "list" ? (Array.isArray(e.row_template) ? e.row_template.map((c) => (Array.isArray(c) ? c[0] : null)) : []) : Array.isArray(e.children) ? e.children : [];
  for (const c of kids) if (isObject(c)) n += countElems(c);
  if (Array.isArray(e.draw_list)) n += e.draw_list.length;
  return n;
}

/** The program that builds doc's window. */
export function buildProgram(win: JsonObject, o: NwscriptOptions): Program {
  const g = new Gen(o);
  const entry = `${ident(o.prefix)}_Window`;
  g.func(entry, "The window's JSON, as NuiCreate takes it.", () => g.window(win));
  return { consts: g.consts, funcs: g.funcs, entry };
}

// --- writing it ---------------------------------------------------------------------------------------------

const CP1252: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };

/** A string as an NWScript literal: ASCII as itself, other characters as their cp1252 byte (\xNN), the script's
 * encoding. Characters cp1252 does not have become "?". */
export function nssString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (c >= 0x20 && c <= 0x7e) out += ch;
    else {
      const byte = c < 0x100 && !(c >= 0x80 && c < 0xa0) ? c : CP1252[c];
      out += byte === undefined ? "?" : `\\x${byte.toString(16).padStart(2, "0")}`;
    }
  }
  return out + '"';
}

function fmtFloat(v: number): string {
  if (!Number.isFinite(v)) return "0.0";
  let s = String(v);
  if (/e/i.test(s)) s = v.toFixed(10).replace(/0+$/, "").replace(/\.$/, ".0");
  if (!s.includes(".")) s += ".0";
  return s;
}

function exprText(e: Expr): string {
  switch (e.k) {
    case "str":
      return nssString(e.v);
    case "int":
      return e.c ?? String(e.v);
    case "float":
      return fmtFloat(e.v);
    case "const":
    case "var":
      return e.name;
    case "call":
      return `${e.fn}(${e.args.map(exprText).join(", ")})`;
  }
}

/** One expression, wrapped at its outer calls when it is long. */
function exprLines(e: Expr, indent: string, width = 120): string {
  const flat = exprText(e);
  if (flat.length + indent.length <= width || e.k !== "call" || !e.args.length) return flat;
  // A chain of modifiers, NuiWidth(NuiHeight(NuiLabel(...), ...), ...), reads best as the innermost call and then
  // each modifier on its own line: write it as is, but break the arguments of the outermost call.
  const inner = indent + "    ";
  return `${e.fn}(\n${e.args.map((a) => inner + exprLines(a, inner, width)).join(",\n")})`;
}

function stmtText(s: Stmt, indent: string): string {
  switch (s.k) {
    case "decl":
      return `${indent}json ${s.name} = ${exprLines(s.e, indent)};`;
    case "set":
      return `${indent}${s.name} = ${exprLines(s.e, indent)};`;
    case "comment":
      return `${indent}// ${s.text}`;
    case "blank":
      return "";
    case "return":
      return `${indent}return ${exprLines(s.e, indent)};`;
  }
}

/** A bind's sample value as the expression that sets it. */
function sampleExpr(g: Gen, v: JsonValue): string {
  const hasArray = (x: JsonValue): boolean => Array.isArray(x) || (isObject(x) && Object.values(x).some(hasArray));
  // Arrays (row values) as one JsonParse: the skeleton is a starting point, not the window's code.
  if (hasArray(v)) return `JsonParse(${nssString(JSON.stringify(v))})`;
  return exprText(g.json(v));
}

/** The whole script. */
export function writeNwscript(win: JsonObject, o: NwscriptOptions): string {
  const prog = buildProgram(win, o);
  const P = ident(o.prefix);
  const PU = P.toUpperCase();
  const lines: string[] = [];
  const binds = [...bindDetails(win).values()];
  lines.push(`/// @file   ${o.script}.nss`);
  lines.push(`/// @brief  The ${o.windowId} window${o.source ? ` (from ${o.source})` : ""}, as nw_inc_nui.nss builds it.`);
  lines.push("///         Written by nwn-nui-designer. It builds exactly the JSON of the designer's .jui export.");
  if (o.skeleton) {
    lines.push(`///         ${P}_Open(oPC) opens the window with this script as its event script; main() handles its events.`);
  } else {
    lines.push(`///         An include: ${P}_Window() returns the window for NuiCreate.`);
  }
  lines.push("");
  lines.push('#include "nw_inc_nui"');
  lines.push("");
  lines.push(`const string ${PU}_WINDOW_ID = ${nssString(o.windowId)};`);
  const bindConsts = prog.consts.filter(([n]) => n.startsWith(`${PU}_BIND_`));
  const idConsts = prog.consts.filter(([n]) => n.startsWith(`${PU}_ID_`));
  if (bindConsts.length) {
    lines.push("");
    lines.push("// Binds");
    for (const [n, v] of bindConsts) {
      const d = binds.find((x) => x.name === v);
      const kind = d ? (d.kind === "text" || d.kind === "title" ? "string" : d.kind) : "";
      const what = d ? `${d.perRow ? "one per row, " : ""}${kind}${d.countsRowsOf.length ? ", the row count" : ""}` : "";
      lines.push(`const string ${n} = ${nssString(v)};${what ? ` // ${what}` : ""}`);
    }
  }
  if (idConsts.length) {
    lines.push("");
    lines.push("// Element ids (their events name them)");
    for (const [n, v] of idConsts) lines.push(`const string ${n} = ${nssString(v)};`);
  }
  if (o.skeleton) {
    lines.push("");
    lines.push(`json ${prog.entry}();`);
    lines.push(`int ${P}_Open(object oPC);`);
    lines.push(`void ${P}_OnEvent();`);
    lines.push("void main();");
  }
  // Helpers first (they are called by the entry).
  const ordered = [...prog.funcs.filter((fn) => fn.name !== prog.entry), prog.funcs.find((fn) => fn.name === prog.entry)!];
  for (const fn of ordered) {
    lines.push("");
    lines.push(`/// ${fn.doc}`);
    lines.push(`json ${fn.name}()`);
    lines.push("{");
    for (const s of fn.body) lines.push(stmtText(s, "    "));
    lines.push("}");
  }
  if (o.skeleton) {
    const g = new Gen(o);
    lines.push("");
    lines.push(`/// Opens the window on oPC and sets the designer's sample values; returns its token (0 if it failed).`);
    lines.push(`int ${P}_Open(object oPC)`);
    lines.push("{");
    lines.push(`    int nToken = NuiCreate(oPC, ${prog.entry}(), ${PU}_WINDOW_ID, ${nssString(o.script)});`);
    lines.push("    if (nToken == 0)");
    lines.push("        return 0;");
    const samples = Object.entries(o.binds ?? {}).filter(([k]) => bindConsts.some(([, v]) => v === k));
    if (samples.length) {
      lines.push("    // The designer's sample values: replace them with the real ones.");
      for (const [k, v] of samples) {
        const c = bindConsts.find(([, x]) => x === k)![0];
        lines.push(`    NuiSetBind(oPC, nToken, ${c}, ${sampleExpr(g, v)});`);
      }
    }
    lines.push("    return nToken;");
    lines.push("}");
    lines.push("");
    lines.push("/// The window's events (NuiCreate's event script is this script).");
    lines.push(`void ${P}_OnEvent()`);
    lines.push("{");
    lines.push("    object oPC = NuiGetEventPlayer();");
    lines.push("    int nToken = NuiGetEventWindow();");
    lines.push("    string sEvent = NuiGetEventType();");
    lines.push("    string sElement = NuiGetEventElement();");
    lines.push(`    if (NuiGetWindowId(oPC, nToken) != ${PU}_WINDOW_ID)`);
    lines.push("        return;");
    lines.push('    if (sEvent == "click")');
    lines.push("    {");
    if (idConsts.length) {
      idConsts.forEach(([n], i) => {
        lines.push(`        ${i ? "else " : ""}if (sElement == ${n})`);
        lines.push("        {");
        lines.push("        }");
      });
    }
    lines.push("    }");
    const watched = binds.filter((d) => d.uses.some((u) => ["value", "selected"].includes(u.key) && ["bool", "int", "float", "string", "color"].includes(String(u.kind))) && !d.perRow);
    if (watched.length) {
      lines.push('    else if (sEvent == "watch")');
      lines.push("    {");
      lines.push("        // NuiSetBindWatch(oPC, nToken, <bind>, TRUE) in Open sends these when the player changes a value.");
      lines.push("    }");
    }
    lines.push("}");
    lines.push("");
    lines.push("void main()");
    lines.push("{");
    lines.push(`    ${P}_OnEvent();`);
    lines.push("}");
  }
  return lines.join("\n") + "\n";
}

/** The export settings of a document as options. */
export function nwscriptOptions(d: EditorDoc, skeleton = true): NwscriptOptions {
  return { prefix: d.export.prefix, windowId: d.export.windowId, script: d.export.script, skeleton, binds: d.binds, source: d.name };
}
