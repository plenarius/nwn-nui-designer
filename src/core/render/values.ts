/** Python's value semantics, as nui-preview's renderer reads a window's JSON: truthiness, str(), "{:g}". */

/** Python's bool(v). */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** f"{v:g}" (six significant digits, no trailing zeros, exponent past 1e-4 / 1e6). */
export function fmtG(v: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf";
  if (v === 0) return Object.is(v, -0) ? "-0" : "0";
  const exp = Math.floor(Math.log10(Math.abs(v)));
  let s: string;
  if (exp < -4 || exp >= 6) {
    s = v.toExponential(5);
    let [m, e] = s.split("e") as [string, string];
    if (m.includes(".")) m = m.replace(/0+$/, "").replace(/\.$/, "");
    const sign = e.startsWith("-") ? "-" : "+";
    const digits = e.replace(/^[+-]/, "").padStart(2, "0");
    return `${m}e${sign}${digits}`;
  }
  s = v.toPrecision(6);
  if (s.includes("e")) return fmtG(Number(s));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/** Python's repr of a JSON value (str() of a list or dict). */
function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "string") return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  return `{${Object.entries(v as object).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(", ")}}`;
}

/** str(v) as nui-preview's Renderer.text makes it: true/false for booleans, {:g} for non-integral numbers. JSON
 * cannot tell 36 from 36.0, so whole numbers print as integers. */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : fmtG(v);
  if (typeof v === "string") return v;
  return pyRepr(v);
}

/** float(v) for numbers and numeric strings, else NaN. */
export function pyFloat(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return NaN;
}
