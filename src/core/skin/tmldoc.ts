/**
 * nui_skin.tml as a text document that can be edited without losing what a person wrote: a changed value is replaced
 * in its line (its comment stays), a new key goes next to its siblings, a removed key loses only its line, and the
 * [[fonts]] blocks keep their comments when they are edited or reordered. Everything else (comments, blank lines,
 * order, the way keys are written) is kept as it was.
 *
 * Parsing for values is toml.ts's job; this file only finds where each key's value sits in the text. It handles what
 * skins are written with: [tables], [[fonts]], dotted and quoted keys, one-line values and multi-line arrays and
 * strings. A file it cannot follow is rewritten in the generator's layout (writeTml) by the caller.
 */
import { KEY_BY_NAME, SKIN_KEYS } from "./keys.js";
import { type TomlTable, type TomlValue, parseToml } from "./toml.js";

interface Line {
  text: string;
  kind: "blank" | "comment" | "table" | "array" | "kv" | "cont" | "other";
  /** "table" / "array": the header's path. "kv": the full dotted path. */
  path?: string;
  /** "kv": the key as written (relative to its table), and where the value starts and ends in text. */
  rel?: string;
  v0?: number;
  v1?: number;
  /** "kv": the number of continuation lines of a multi-line value. */
  span?: number;
}

/** One section: the lines before the first header, a [table] or one [[array]] entry, with the comment lines that
 * lead into its header. */
interface Section {
  header: Line | null;
  lead: Line[];
  body: Line[];
  /** For [[fonts]] entries: which entry of the original file. */
  fontIndex?: number;
}

const BARE = /^[A-Za-z0-9_-]+$/;

export function splitKey(k: string): string[] {
  const out: string[] = [];
  let i = 0;
  const s = k.trim();
  while (i < s.length) {
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i]!;
      let j = i + 1;
      let v = "";
      while (j < s.length && s[j] !== q) {
        if (q === '"' && s[j] === "\\") {
          v += s[j + 1];
          j += 2;
        } else v += s[j++];
      }
      out.push(v);
      i = j + 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== "." && s[j] !== " " && s[j] !== "\t") j++;
      out.push(s.slice(i, j));
      i = j;
    }
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === ".") i++;
  }
  return out;
}

export const joinKey = (parts: string[]) => parts.map((p) => (BARE.test(p) ? p : JSON.stringify(p))).join(".");

/** Where a value written at text[i] ends (exclusive), on this line; -1 when it continues on later lines. */
function valueEnd(text: string, i: number): number {
  const c = text[i];
  if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
    const q = text.slice(i, i + 3);
    const e = text.indexOf(q, i + 3);
    return e < 0 ? -1 : e + 3;
  }
  if (c === '"') {
    let j = i + 1;
    while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
    return j + 1;
  }
  if (c === "'") return text.indexOf("'", i + 1) + 1;
  if (c === "[" || c === "{") {
    let depth = 0;
    let j = i;
    while (j < text.length) {
      const ch = text[j]!;
      if (ch === '"' || ch === "'") {
        j = valueEnd(text, j);
        if (j < 0) return -1;
        continue;
      }
      if (ch === "#") return -1;
      if (ch === "[" || ch === "{") depth++;
      if (ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) return j + 1;
      }
      j++;
    }
    return -1;
  }
  let j = i;
  while (j < text.length && text[j] !== "#") j++;
  while (j > i && /\s/.test(text[j - 1]!)) j--;
  return j;
}

/** The index of the key's = sign (outside quotes), or -1. */
function eqIndex(text: string): number {
  let q: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "=") return i;
    else if (c === "#") return -1;
  }
  return -1;
}

function lex(text: string): Line[] {
  const raw = text.split("\n");
  const lines: Line[] = [];
  let table = "";
  for (let n = 0; n < raw.length; n++) {
    const t = raw[n]!;
    const s = t.trim();
    if (!s) lines.push({ text: t, kind: "blank" });
    else if (s.startsWith("#")) lines.push({ text: t, kind: "comment" });
    else if (s.startsWith("[[")) {
      table = joinKey(splitKey(s.slice(2, s.indexOf("]]"))));
      lines.push({ text: t, kind: "array", path: table });
    } else if (s.startsWith("[")) {
      table = joinKey(splitKey(s.slice(1, s.indexOf("]"))));
      lines.push({ text: t, kind: "table", path: table });
    } else {
      const eq = eqIndex(t);
      if (eq < 0) {
        lines.push({ text: t, kind: "other" });
        continue;
      }
      const rel = t.slice(0, eq).trim();
      let v0 = eq + 1;
      while (t[v0] === " " || t[v0] === "\t") v0++;
      const line: Line = { text: t, kind: "kv", rel, path: joinKey([...(table ? splitKey(table) : []), ...splitKey(rel)]), v0 };
      let end = valueEnd(t, v0);
      if (end >= 0) {
        line.v1 = end;
        lines.push(line);
        continue;
      }
      // A multi-line value: join lines until it closes.
      let joined = t;
      let m = n;
      while (end < 0 && m + 1 < raw.length) {
        m++;
        joined += "\n" + raw[m]!;
        end = valueEnd(joined, v0);
      }
      line.span = m - n;
      line.v1 = end < 0 ? joined.length : end - (joined.length - raw[m]!.length);
      lines.push(line);
      for (let c = n + 1; c <= m; c++) lines.push({ text: raw[c]!, kind: "cont" });
      n = m;
    }
  }
  return lines;
}

function sectionsOf(lines: Line[]): Section[] {
  const out: Section[] = [{ header: null, lead: [], body: [] }];
  let fontIndex = 0;
  for (const l of lines) {
    if (l.kind === "table" || l.kind === "array") {
      const prev = out[out.length - 1]!;
      // Comment lines right above a header belong to it.
      const lead: Line[] = [];
      while (prev.body.length && prev.body[prev.body.length - 1]!.kind === "comment") lead.unshift(prev.body.pop()!);
      const sec: Section = { header: l, lead, body: [] };
      if (l.kind === "array" && l.path === "fonts") sec.fontIndex = fontIndex++;
      out.push(sec);
    } else out[out.length - 1]!.body.push(l);
  }
  return out;
}

/** A TOML value as text. ints: whole numbers written without a fraction (for int keys); otherwise floats keep ".0". */
export function tomlValue(v: TomlValue, asInt = false): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (asInt) return String(Math.trunc(v));
    if (Number.isNaN(v)) return "nan";
    if (!Number.isFinite(v)) return v > 0 ? "inf" : "-inf";
    // Python's repr of a float: the shortest round-trip digits, always with a fraction or exponent.
    const s = String(v);
    return /[.e]/.test(s) ? s.replace(/e\+?/, "e+").replace("e+-", "e-") : `${s}.0`;
  }
  if (typeof v === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
  if (Array.isArray(v)) return `[${v.map((x) => tomlValue(x)).join(", ")}]`;
  return `{ ${Object.entries(v).map(([k, x]) => `${joinKey([k])} = ${tomlValue(x)}`).join(", ")} }`;
}

const isIntKey = (path: string) => KEY_BY_NAME.get(path)?.type === "int";

/** The [[fonts]] keys in the order the generator writes them. */
export const FONT_ORDER = ["name", "resref", "pixel_height", "pixel_snap", "oversample_h", "oversample_v", "font_size", "spacing_h", "spacing_v"];

export interface FontEntryEdit {
  /** The entry's values (key -> value). */
  values: TomlTable;
  /** Which [[fonts]] entry of the source this is (to keep its comments), or undefined for a new one. */
  source?: number;
}

export class TmlDoc {
  private lines: Line[];

  constructor(text: string) {
    this.lines = lex(text.replace(/\r\n/g, "\n"));
  }

  text(): string {
    return this.lines.map((l) => l.text).join("\n");
  }

  data(): TomlTable {
    return parseToml(this.text());
  }

  /** The value's text as written (for telling 3 from 3.0). */
  literal(path: string): string | undefined {
    const l = this.lines.find((x) => x.kind === "kv" && x.path === path && !this.inFonts(x));
    return l ? l.text.slice(l.v0!, l.v1!) : undefined;
  }

  private inFonts(l: Line): boolean {
    return !!l.path && (l.path === "fonts" || l.path.startsWith("fonts."));
  }

  /** Sets (or with undefined removes) a key outside [[fonts]]. */
  set(path: string, v: TomlValue | undefined): void {
    this.setRaw(path, v);
    // Lines made in isolation do not know their table: lex the whole text again.
    this.lines = lex(this.text());
  }

  private setRaw(path: string, v: TomlValue | undefined): void {
    const i = this.lines.findIndex((x) => x.kind === "kv" && x.path === path && !this.inFonts(x));
    if (v === undefined) {
      if (i >= 0) this.lines.splice(i, 1 + (this.lines[i]!.span ?? 0));
      return;
    }
    const val = tomlValue(v, isIntKey(path));
    if (i >= 0) {
      const l = this.lines[i]!;
      if (l.span) {
        const all = this.lines.slice(i, i + 1 + l.span).map((x) => x.text).join("\n");
        const tail = all.slice(all.length - (this.lines[i + l.span]!.text.length - l.v1!));
        this.lines.splice(i, 1 + l.span, ...lex(l.text.slice(0, l.v0) + val + tail));
      } else {
        this.lines[i] = { ...l, text: l.text.slice(0, l.v0) + val + l.text.slice(l.v1), v1: l.v0! + val.length };
      }
      return;
    }
    this.insert(path, val);
  }

  private insert(path: string, val: string): void {
    const parts = splitKey(path);
    const parent = joinKey(parts.slice(0, -1));
    const parentOf = (p: string) => joinKey(splitKey(p).slice(0, -1));
    // 1. Next to a sibling (same parent table), written relative to the sibling's section.
    let last = -1;
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i]!;
      if (l.kind === "kv" && !this.inFonts(l) && parentOf(l.path!) === parent) last = i;
    }
    if (last >= 0) {
      const l = this.lines[last]!;
      const sectionParts = splitKey(l.path!).length - splitKey(l.rel!).length;
      const rel = joinKey(parts.slice(sectionParts));
      const indent = /^\s*/.exec(l.text)![0];
      this.lines.splice(last + 1 + (l.span ?? 0), 0, ...lex(`${indent}${rel} = ${val}`));
      return;
    }
    // 2. At the end of the [parent] table, or 3. a top-level key before the first header.
    const secs = sectionsOf(this.lines);
    const sec = parent ? secs.find((s) => s.header?.kind === "table" && s.header.path === parent) : secs[0];
    const rel = joinKey(parts.slice(parent ? splitKey(parent).length : 0));
    if (sec) {
      const lastKv = [...sec.body].reverse().find((x) => x.kind === "kv" || x.kind === "cont");
      const anchor = lastKv ?? sec.header;
      const at = anchor ? this.lines.indexOf(anchor) + 1 : sec.body.length ? this.lines.indexOf(sec.body[0]!) : 0;
      this.lines.splice(at, 0, ...lex(`${rel} = ${val}`));
      return;
    }
    // 4. A new table at the end.
    while (this.lines.length && this.lines[this.lines.length - 1]!.kind === "blank") this.lines.pop();
    this.lines.push(...lex(`\n[${parent}]\n${rel} = ${val}\n`));
  }

  /** The [[fonts]] entries as they are. */
  fonts(): TomlTable[] {
    const f = this.data().fonts;
    return Array.isArray(f) ? (f.filter((x) => typeof x === "object" && x !== null && !Array.isArray(x)) as TomlTable[]) : [];
  }

  /** Replaces the [[fonts]] list: entries with a source keep that block's comments and key order. */
  setFonts(entries: FontEntryEdit[]): void {
    const secs = sectionsOf(this.lines);
    const fontSecs = secs.filter((s) => s.fontIndex !== undefined);
    const blocks: Line[][] = entries.map((e) => {
      const src = e.source !== undefined ? fontSecs.find((s) => s.fontIndex === e.source) : undefined;
      return src ? this.editFontBlock(src, e.values) : lex(newFontBlock(e.values));
    });
    const firstIdx = fontSecs.length ? secs.indexOf(fontSecs[0]!) : -1;
    const out: Line[] = [];
    const emit = (s: Section) => out.push(...s.lead, ...(s.header ? [s.header] : []), ...s.body);
    if (firstIdx < 0) {
      // No fonts yet: after the top-level keys (the generator's layout), before the first table.
      const first = secs[0]!;
      emit(first);
      if (out.length && out[out.length - 1]!.kind !== "blank") out.push({ text: "", kind: "blank" });
      for (const b of blocks) out.push(...b);
      for (const s of secs.slice(1)) emit(s);
    } else {
      secs.forEach((s, i) => {
        if (s.fontIndex === undefined) emit(s);
        else if (i === firstIdx) for (const b of blocks) out.push(...b);
      });
    }
    this.lines = lex(out.map((l) => l.text).join("\n"));
  }

  private editFontBlock(sec: Section, values: TomlTable): Line[] {
    const lines = [...sec.lead, sec.header!, ...sec.body];
    const seen = new Set<string>();
    const out: Line[] = [];
    let lastKv = -1;
    let indent = "  ";
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (l.kind === "kv") {
        const k = splitKey(l.rel!).join(".");
        indent = /^\s*/.exec(l.text)![0];
        seen.add(k);
        if (!(k in values)) {
          i += l.span ?? 0;
          continue;
        }
        const val = tomlValue(values[k]!);
        if (l.span) {
          out.push(...lex(l.text.slice(0, l.v0) + val));
          i += l.span;
        } else out.push({ ...l, text: l.text.slice(0, l.v0) + val + l.text.slice(l.v1), v1: l.v0! + val.length });
        lastKv = out.length - 1;
      } else {
        out.push(l);
        if (l.kind === "array") lastKv = out.length - 1;
      }
    }
    const extra = Object.keys(values).filter((k) => !seen.has(k));
    const add = extra.map((k) => ({ text: `${indent}${joinKey([k])} = ${tomlValue(values[k]!)}`, kind: "kv" as const }));
    out.splice(lastKv + 1, 0, ...add);
    if (out[out.length - 1]?.kind !== "blank") out.push({ text: "", kind: "blank" });
    return out;
  }
}

function newFontBlock(values: TomlTable): string {
  const keys = [...FONT_ORDER.filter((k) => k in values), ...Object.keys(values).filter((k) => !FONT_ORDER.includes(k))];
  return ["[[fonts]]", ...keys.map((k) => `  ${joinKey([k])} = ${tomlValue(values[k]!)}`), ""].join("\n");
}

/**
 * A whole nui_skin.tml in the generator's layout (as tools/open-skin/gen_skin.py's write_tml did, byte for byte): the header comment, the
 * top-level keys, the [[fonts]], then one [table] per section in the order the client reads the keys. values: dotted
 * key -> value.
 */
export function writeTml(values: Record<string, TomlValue>, fonts: TomlTable[], header: string): string {
  const lines = [header.replace(/\s+$/, ""), ""];
  const order = SKIN_KEYS.map((k) => k.key).filter((k) => k in values);
  const extra = Object.keys(values).filter((k) => !KEY_BY_NAME.has(k));
  const all = [...order, ...extra];
  const top = all.filter((k) => !k.includes("."));
  for (const k of top) lines.push(`${k} = ${tomlValue(values[k]!, isIntKey(k))}`);
  if (top.length) lines.push("");
  for (const f of fonts) lines.push(newFontBlock(f));
  const tables = new Map<string, [string, TomlValue][]>();
  for (const k of all) {
    if (!k.includes(".")) continue;
    const parts = splitKey(k);
    const t = joinKey(parts.slice(0, -1));
    if (!tables.has(t)) tables.set(t, []);
    tables.get(t)!.push([joinKey(parts.slice(-1)), values[k]!]);
  }
  for (const [t, kv] of tables) {
    lines.push(`[${t}]`);
    for (const [leaf, v] of kv) lines.push(`${leaf} = ${tomlValue(v, isIntKey(`${t}.${leaf}`))}`);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

/** Every value outside [[fonts]] as dotted key -> value (tables flattened). */
export function flatValues(data: TomlTable): Record<string, TomlValue> {
  const out: Record<string, TomlValue> = {};
  const walk = (d: TomlTable, prefix: string) => {
    for (const [k, v] of Object.entries(d)) {
      if (!prefix && k === "fonts") continue;
      const p = prefix ? `${prefix}.${joinKey([k])}` : joinKey([k]);
      if (typeof v === "object" && v !== null && !Array.isArray(v)) walk(v as TomlTable, p);
      else out[p] = v;
    }
  };
  walk(data, "");
  return out;
}
