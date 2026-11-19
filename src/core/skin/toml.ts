/**
 * A TOML reader, enough for nui_skin.tml and the files people write by hand from it: tables, dotted table names,
 * arrays of tables, dotted keys, basic and literal strings (one line and multi-line), integers (with _ , hex, octal,
 * binary), floats, booleans, arrays and inline tables, comments. Dates are kept as strings. Written from the TOML
 * 1.0 specification; the client itself parses the skin with cpptoml.
 */

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export class TomlError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`line ${line}: ${message}`);
  }
}

export function parseToml(text: string): TomlTable {
  return new Parser(text).parse();
}

const BARE = /[A-Za-z0-9_-]/;

/** t's own value at key: a key named like an Object.prototype member ("constructor", "toString") is just a key. */
function own(t: TomlTable, key: string): TomlValue | undefined {
  return Object.hasOwn(t, key) ? t[key] : undefined;
}

/** Sets t's own key (defineProperty, so "__proto__" is a key too and never t's prototype). */
function put<V extends TomlValue>(t: TomlTable, key: string, v: V): V {
  Object.defineProperty(t, key, { value: v, writable: true, enumerable: true, configurable: true });
  return v;
}

class Parser {
  private i = 0;
  private readonly root: TomlTable = {};
  private current: TomlTable = this.root;
  /** Tables made by a [header] (so a second [same] is an error, as TOML says; cpptoml says so too). */
  private readonly defined = new Set<TomlTable>();

  constructor(private readonly s: string) {}

  private get line(): number {
    let n = 1;
    for (let k = 0; k < this.i && k < this.s.length; k++) if (this.s[k] === "\n") n++;
    return n;
  }

  private fail(msg: string): never {
    throw new TomlError(msg, this.line);
  }

  private peek(o = 0): string {
    return this.s[this.i + o] ?? "";
  }

  private skipWs(): void {
    while (this.peek() === " " || this.peek() === "\t") this.i++;
  }

  /** Skips spaces, newlines and comments. */
  private skipAll(): void {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\r" || c === "\n") this.i++;
      else if (c === "#") this.skipComment();
      else return;
    }
  }

  private skipComment(): void {
    while (this.i < this.s.length && this.peek() !== "\n") this.i++;
  }

  /** After a value or header: only a comment may follow on the line. */
  private endLine(): void {
    this.skipWs();
    if (this.peek() === "#") this.skipComment();
    if (this.peek() === "\r") this.i++;
    if (this.i < this.s.length && this.peek() !== "\n") this.fail(`unexpected "${this.peek()}"`);
    this.i++;
  }

  parse(): TomlTable {
    for (;;) {
      this.skipAll();
      if (this.i >= this.s.length) return this.root;
      if (this.peek() === "[") this.header();
      else {
        this.keyValue(this.current);
        this.endLine();
      }
    }
  }

  private header(): void {
    const array = this.peek(1) === "[";
    this.i += array ? 2 : 1;
    this.skipWs();
    const keys = this.keyPath();
    this.skipWs();
    if (array) {
      if (this.peek() !== "]" || this.peek(1) !== "]") this.fail('expected "]]"');
      this.i += 2;
    } else {
      if (this.peek() !== "]") this.fail('expected "]"');
      this.i++;
    }
    this.endLine();
    let t = this.root;
    for (let k = 0; k < keys.length - 1; k++) t = this.descend(t, keys[k]!);
    const last = keys[keys.length - 1]!;
    if (array) {
      let arr = own(t, last);
      if (arr === undefined) arr = put(t, last, []);
      if (!Array.isArray(arr)) this.fail(`"${last}" is not an array of tables`);
      const nt: TomlTable = {};
      arr.push(nt);
      this.current = nt;
    } else {
      let nt = own(t, last);
      if (nt === undefined) nt = put(t, last, {});
      if (typeof nt !== "object" || Array.isArray(nt)) this.fail(`"${last}" is already a value`);
      if (this.defined.has(nt)) this.fail(`table "${keys.join(".")}" defined twice`);
      this.defined.add(nt);
      this.current = nt;
    }
  }

  /** The table at key in t (made if missing; the last table of an array of tables). */
  private descend(t: TomlTable, key: string): TomlTable {
    let v = own(t, key);
    if (v === undefined) v = put(t, key, {});
    if (Array.isArray(v)) {
      const last = v[v.length - 1];
      if (typeof last !== "object" || last === null || Array.isArray(last)) this.fail(`"${key}" is not a table`);
      return last as TomlTable;
    }
    if (typeof v !== "object") this.fail(`"${key}" is already a value`);
    return v;
  }

  private keyPath(): string[] {
    const keys = [this.key()];
    for (;;) {
      this.skipWs();
      if (this.peek() !== ".") return keys;
      this.i++;
      this.skipWs();
      keys.push(this.key());
    }
  }

  private key(): string {
    const c = this.peek();
    if (c === '"') return this.basicString();
    if (c === "'") return this.literalString();
    const start = this.i;
    while (BARE.test(this.peek())) this.i++;
    if (this.i === start) this.fail(`expected a key, found "${c}"`);
    return this.s.slice(start, this.i);
  }

  private keyValue(t: TomlTable): void {
    const keys = this.keyPath();
    this.skipWs();
    if (this.peek() !== "=") this.fail('expected "="');
    this.i++;
    this.skipWs();
    const v = this.value();
    let target = t;
    for (let k = 0; k < keys.length - 1; k++) target = this.descend(target, keys[k]!);
    const last = keys[keys.length - 1]!;
    if (Object.hasOwn(target, last)) this.fail(`key "${keys.join(".")}" defined twice`);
    put(target, last, v);
  }

  private value(): TomlValue {
    const c = this.peek();
    if (c === '"') return this.peek(1) === '"' && this.peek(2) === '"' ? this.multiBasic() : this.basicString();
    if (c === "'") return this.peek(1) === "'" && this.peek(2) === "'" ? this.multiLiteral() : this.literalString();
    if (c === "[") return this.array();
    if (c === "{") return this.inlineTable();
    if (this.s.startsWith("true", this.i)) {
      this.i += 4;
      return true;
    }
    if (this.s.startsWith("false", this.i)) {
      this.i += 5;
      return false;
    }
    return this.numberOrDate();
  }

  private numberOrDate(): TomlValue {
    const start = this.i;
    while (/[0-9A-Za-z_+\-.:]/.test(this.peek()) || (this.peek() === " " && /\d/.test(this.peek(1)) && /\d/.test(this.s[this.i - 1] ?? ""))) this.i++;
    const raw = this.s.slice(start, this.i);
    if (!raw) this.fail(`expected a value, found "${this.peek()}"`);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw) || /^\d{2}:\d{2}/.test(raw)) return raw;
    const t = raw.replace(/_/g, "");
    if (/^[+-]?inf$/.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
    if (/^[+-]?nan$/.test(t)) return NaN;
    if (/^0x[0-9A-Fa-f]+$/.test(t)) return parseInt(t.slice(2), 16);
    if (/^0o[0-7]+$/.test(t)) return parseInt(t.slice(2), 8);
    if (/^0b[01]+$/.test(t)) return parseInt(t.slice(2), 2);
    if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);
    if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return parseFloat(t);
    this.fail(`bad value "${raw}"`);
  }

  private basicString(): string {
    this.i++;
    let out = "";
    for (;;) {
      const c = this.peek();
      if (c === "" || c === "\n") this.fail("unterminated string");
      this.i++;
      if (c === '"') return out;
      if (c === "\\") out += this.escape();
      else out += c;
    }
  }

  private escape(): string {
    const c = this.peek();
    this.i++;
    switch (c) {
      case "b":
        return "\b";
      case "t":
        return "\t";
      case "n":
        return "\n";
      case "f":
        return "\f";
      case "r":
        return "\r";
      case '"':
        return '"';
      case "\\":
        return "\\";
      case "u":
      case "U": {
        const n = c === "u" ? 4 : 8;
        const hex = this.s.slice(this.i, this.i + n);
        if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== n) this.fail("bad unicode escape");
        this.i += n;
        return String.fromCodePoint(parseInt(hex, 16));
      }
      default:
        this.fail(`bad escape "\\${c}"`);
    }
  }

  private literalString(): string {
    this.i++;
    const start = this.i;
    while (this.peek() !== "'") {
      if (this.peek() === "" || this.peek() === "\n") this.fail("unterminated string");
      this.i++;
    }
    const out = this.s.slice(start, this.i);
    this.i++;
    return out;
  }

  private multiBasic(): string {
    this.i += 3;
    if (this.peek() === "\r") this.i++;
    if (this.peek() === "\n") this.i++;
    let out = "";
    for (;;) {
      if (this.i >= this.s.length) this.fail("unterminated string");
      if (this.s.startsWith('"""', this.i)) {
        this.i += 3;
        while (this.peek() === '"') {
          out += '"';
          this.i++;
        }
        return out;
      }
      const c = this.peek();
      this.i++;
      if (c === "\\") {
        if (/[ \t\r\n]/.test(this.peek())) {
          // A line-ending backslash: drop the newline and the whitespace after it.
          while (/[ \t\r\n]/.test(this.peek())) this.i++;
        } else out += this.escape();
      } else out += c;
    }
  }

  private multiLiteral(): string {
    this.i += 3;
    if (this.peek() === "\r") this.i++;
    if (this.peek() === "\n") this.i++;
    const end = this.s.indexOf("'''", this.i);
    if (end < 0) this.fail("unterminated string");
    let out = this.s.slice(this.i, end);
    this.i = end + 3;
    while (this.peek() === "'") {
      out += "'";
      this.i++;
    }
    return out;
  }

  private array(): TomlValue[] {
    this.i++;
    const out: TomlValue[] = [];
    for (;;) {
      this.skipAll();
      if (this.peek() === "]") {
        this.i++;
        return out;
      }
      out.push(this.value());
      this.skipAll();
      if (this.peek() === ",") this.i++;
      else if (this.peek() !== "]") this.fail('expected "," or "]"');
    }
  }

  private inlineTable(): TomlTable {
    this.i++;
    const t: TomlTable = {};
    this.skipWs();
    if (this.peek() === "}") {
      this.i++;
      return t;
    }
    for (;;) {
      this.skipWs();
      this.keyValue(t);
      this.skipWs();
      if (this.peek() === ",") {
        this.i++;
        continue;
      }
      if (this.peek() === "}") {
        this.i++;
        return t;
      }
      this.fail('expected "," or "}"');
    }
  }
}
