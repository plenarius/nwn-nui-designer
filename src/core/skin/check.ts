/**
 * Checks a nui_skin.tml the way the client will read it (keys.ts): missing keys (the client's defaults are usually
 * wrong: transparent colours, the not-found image), wrong value types, keys it never reads, a #colour where only an
 * image works, resrefs over 16 characters, fonts it skips; and, given the resources, textures and fonts that are
 * missing, two image formats under one name (the client's lookup keeps dds > jpg > tga > png > gif > wbm whatever
 * layer each is in), and the user's own image that a base-game file of a better format beats.
 *
 * A port and extension of tools/open-skin/check_skin.py (removed in phase 3; in git at e38d1ca).
 */
import { CLIENT_PROBE } from "../res/images.js";
import type { Layer, ResMan } from "../res/resman.js";
import { RES_TYPES } from "../res/restype.js";
import { CODE_PAGES, FONT_KEYS, KEY_BY_NAME, KNOWN_UNREAD, SKIN_KEYS, keysByTexture } from "./keys.js";
import type { TomlTable, TomlValue } from "./toml.js";

export type Severity = "error" | "warning" | "note";

export interface SkinFinding {
  severity: Severity;
  code:
    | "parse"
    | "missing"
    | "type"
    | "colour-in-image9"
    | "colour-no-alpha"
    | "not-int"
    | "unread"
    | "resref-long"
    | "texture-missing"
    | "formats"
    | "beaten"
    | "font-missing"
    | "font-snap"
    | "font-key"
    | "font-value"
    | "font-dup"
    | "no-fonts";
  /** The key ("button.hover"), "fonts[1].resref", or the texture name. */
  key: string;
  text: string;
}

const COLOUR = /^#[0-9A-Fa-f]{8}$/;
const COLOUR6 = /^#[0-9A-Fa-f]{6}$/;

export function getPath(data: TomlTable, path: string): TomlValue | undefined {
  let d: TomlValue = data;
  for (const p of path.split(".")) {
    if (typeof d !== "object" || d === null || Array.isArray(d) || !Object.hasOwn(d, p)) return undefined;
    d = (d as TomlTable)[p]!;
  }
  return d;
}

function* walk(d: TomlTable, prefix = ""): Generator<[string, TomlValue]> {
  for (const [k, v] of Object.entries(d)) {
    const p = prefix + k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) yield* walk(v as TomlTable, p + ".");
    else yield [p, v];
  }
}

export interface CheckResources {
  resman: ResMan;
  /** Whether a layer holds the user's own files (an upload, their hak), as opposed to the game's. */
  isOwn?: (l: Layer) => boolean;
}

const show = (v: unknown) => JSON.stringify(v);

export interface CheckOptions {
  /** The value's text in the file (cpptoml tells 3 from 3.0; our TOML reader keeps both as numbers). */
  literal?: (path: string) => string | undefined;
}

export function checkSkin(data: TomlTable, res: CheckResources | null = null, opts: CheckOptions = {}): SkinFinding[] {
  const isFloatLiteral = (key: string) => {
    const t = opts.literal?.(key);
    return t !== undefined && /[.eEn]/.test(t.replace(/^[+-]?0x/, ""));
  };
  const out: SkinFinding[] = [];
  const add = (severity: Severity, code: SkinFinding["code"], key: string, text: string) => out.push({ severity, code, key, text });

  for (const sk of SKIN_KEYS) {
    const v = getPath(data, sk.key);
    if (v === undefined) {
      if (!sk.read) continue;
      if (sk.group === "chart" && !sk.key.includes(".")) {
        add("note", "missing", sk.key, `missing: ${sk.key} (NuiChart colours are read at the top level; transparent without it)`);
      } else {
        const def = sk.type === "image9" ? 'the image "" (the not-found placeholder)' : sk.type === "int" ? "0" : "#00000000 (transparent)";
        add("error", "missing", sk.key, `missing: ${sk.key} (${sk.type}); the client uses ${def}`);
      }
      continue;
    }
    if (!sk.read) {
      add("note", "unread", sk.key, `not read by the client: ${sk.key} (${sk.note})`);
      continue;
    }
    if (sk.type === "colour") {
      if (typeof v === "string" && COLOUR6.test(v)) add("error", "colour-no-alpha", sk.key, `${sk.key} = ${show(v)}: the client reads #RRGGBBAA; without the alpha digits it comes out wrong (transparent)`);
      else if (!(typeof v === "string" && COLOUR.test(v))) add("error", "type", sk.key, `not a #RRGGBBAA colour: ${sk.key} = ${show(v)}`);
    } else if (sk.type === "image9") {
      if (typeof v !== "string") add("error", "type", sk.key, `needs a texture resref: ${sk.key} = ${show(v)}`);
      else if (v.startsWith("#")) add("error", "colour-in-image9", sk.key, `${sk.key} = ${show(v)}: only an image works here; the client reads the colour as a resref and draws the not-found image`);
      else if (!v) add("error", "type", sk.key, `${sk.key} is empty: the client draws the not-found image`);
    } else if (sk.type === "imgcol") {
      if (typeof v !== "string") add("error", "type", sk.key, `needs a #RRGGBBAA colour or a resref: ${sk.key} = ${show(v)}`);
      else if (v.startsWith("#") && !COLOUR.test(v)) {
        add("error", COLOUR6.test(v) ? "colour-no-alpha" : "type", sk.key, `${sk.key} = ${show(v)}: a colour here must be #RRGGBBAA`);
      }
    } else if (sk.type === "int" && !(typeof v === "number" && Number.isInteger(v) && !isFloatLiteral(sk.key))) {
      add("warning", "not-int", sk.key, `not a whole number: ${sk.key} = ${show(v)} (the client reads an integer; cpptoml gives it the default, 0, for anything else)`);
    }
    if ((sk.type === "image9" || sk.type === "imgcol") && typeof v === "string" && !v.startsWith("#") && v.length > 16) {
      add("error", "resref-long", sk.key, `resref longer than 16 characters: ${sk.key} = ${show(v)}`);
    }
  }

  for (const [path] of walk(data)) {
    if (path === "fonts") continue;
    if (KEY_BY_NAME.has(path)) continue;
    const why = KNOWN_UNREAD[path];
    add("note", "unread", path, `not read by the client: ${path}${why ? ` (${why})` : ""}`);
  }

  // Fonts.
  const raw = data.fonts;
  const fonts = Array.isArray(raw) ? raw.filter((f): f is TomlTable => typeof f === "object" && f !== null && !Array.isArray(f)) : [];
  if (raw !== undefined && !Array.isArray(raw)) add("error", "font-key", "fonts", "fonts must be an array of tables ([[fonts]])");
  if (!fonts.length) add("note", "no-fonts", "fonts", "no [[fonts]]: the client adds fnt_maintext at 17 px (Beamdog's font)");
  const names = new Map<string, number>();
  fonts.forEach((f, i) => {
    const label = `font ${i + 1} (${typeof f.name === "string" ? f.name : "(default)"})`;
    if (!("pixel_snap" in f)) add("error", "font-snap", `fonts[${i}]`, `${label}: no pixel_snap; the client skips this entry`);
    for (const key of Object.keys(f)) {
      const fk = FONT_KEYS.find((x) => x.key === key);
      if (!fk) {
        add("note", "font-key", `fonts[${i}].${key}`, `${label}: key not read: ${key}`);
        continue;
      }
      const v = f[key];
      const ok = fk.type === "string" ? typeof v === "string" : fk.type === "bool" ? typeof v === "boolean" : typeof v === "number";
      if (!ok) add("error", "font-value", `fonts[${i}].${key}`, `${label}: ${key} should be a ${fk.type === "float" ? "number" : fk.type}, not ${show(v)} (the client uses ${show(fk.def)})`);
    }
    const resref = typeof f.resref === "string" ? f.resref : "fnt_maintext";
    if (resref.length > 16) add("error", "resref-long", `fonts[${i}].resref`, `${label}: resref longer than 16 characters: ${resref}`);
    for (const o of ["oversample_h", "oversample_v"]) {
      const v = f[o];
      if (typeof v === "number" && !Number.isInteger(v)) add("note", "font-value", `fonts[${i}].${o}`, `${label}: ${o} = ${v} is truncated to ${Math.trunc(v)}`);
    }
    if (typeof f.pixel_height === "number" && f.pixel_height !== 0) add("note", "font-value", `fonts[${i}].pixel_height`, `${label}: pixel_height is read but not used; font_size sets the size`);
    if (typeof f.font_size === "number" && f.font_size <= 0) add("warning", "font-value", `fonts[${i}].font_size`, `${label}: font_size ${f.font_size}: the client uses 16`);
    const name = typeof f.name === "string" ? f.name : "(default)";
    if (names.has(name)) add("warning", "font-dup", `fonts[${i}].name`, `${label}: the name is already used by font ${names.get(name)! + 1}; scripts can reach only one of them`);
    else names.set(name, i);
  });

  if (res) checkResources(data, fonts, res, add);
  return out;
}

function checkResources(
  data: TomlTable,
  fonts: TomlTable[],
  res: CheckResources,
  add: (s: Severity, c: SkinFinding["code"], k: string, t: string) => void,
): void {
  const { resman, isOwn } = res;
  const textures = keysByTexture((k) => getPath(data, k));
  for (const [tex, keys] of [...textures].sort((a, b) => a[0].localeCompare(b[0]))) {
    const used = keys.map((x) => x.key);
    const where = (ext: string) => resman.layers.filter((l) => l.container.has(tex, RES_TYPES[ext]!));
    const present = CLIENT_PROBE.filter((ext) => where(ext).length > 0);
    if (!present.length) {
      add("error", "texture-missing", tex, `texture not found: ${tex} (used by ${used.slice(0, 3).join(", ")}${used.length > 3 ? ", …" : ""})`);
      continue;
    }
    const winner = present[present.length - 1]!;
    if (present.length > 1) {
      add("warning", "formats", tex, `${tex} exists as ${present.map((e) => `.${e}`).join(" and ")}: the client uses the .${winner} (dds > jpg > tga > png > gif > wbm, whichever layer each is in). Ship one format under one name.`);
    }
    if (isOwn) {
      const ownTypes = present.filter((e) => where(e).some(isOwn));
      const winnerOwn = where(winner).some(isOwn);
      if (ownTypes.length && !winnerOwn) {
        const from = where(winner)[0]!.container.label;
        add("error", "beaten", tex, `your ${ownTypes.map((e) => `${tex}.${e}`).join(", ")} loses to ${tex}.${winner} in ${from}: the client prefers .${winner}. Save it as TGA (or DDS).`);
      }
    }
  }
  for (let i = 0; i < fonts.length; i++) {
    const r = (typeof fonts[i]!.resref === "string" ? (fonts[i]!.resref as string) : "fnt_maintext").toLowerCase();
    if (!resman.has(r, "ttf")) add("error", "font-missing", `fonts[${i}].resref`, `font file not found: ${r}.ttf`);
  }
}

export const codePage = (id: string) => CODE_PAGES.find((c) => c.id === id) ?? CODE_PAGES[0]!;
