/**
 * A skin being edited: its nui_skin.tml (kept as text, so comments and order survive: tmldoc.ts) and the files that
 * are the user's own (uploads, a hak's contents, generated textures, the open skin's files), each with whose terms it
 * is under. Everything else the skin names (the game's textures and fonts) is read from the resources and is never
 * exported: an export holds only these files, the .tml and a licence note.
 *
 * Projects are plain immutable values (edits return a new one), so the editor's undo is a stack of them.
 */
import { MemoryContainer } from "../res/containers.js";
import { type ErfEntry, writeErf } from "../res/erfwrite.js";
import { CLIENT_PROBE } from "../res/images.js";
import { ResMan } from "../res/resman.js";
import { RES_TYPES, resType } from "../res/restype.js";
import { writeZip } from "../res/zip.js";
import { checkSkin, getPath, type SkinFinding } from "./check.js";
import { SKIN_KEYS, texturesOf } from "./keys.js";
import { type FontEntryEdit, TmlDoc } from "./tmldoc.js";
import type { TomlTable, TomlValue } from "./toml.js";
import type { Style } from "./gen/style.js";
import { errorText } from "../errors.js";

/** Whose terms a file is under: the user's own work (or a hak they loaded), the open skin's CC0 art, an OFL font, or
 * a licence text that travels with one. */
export type FileLicence = "user" | "cc0" | "ofl" | "text";

export interface SkinFile {
  data: Uint8Array;
  licence: FileLicence;
  /** Where it came from ("uploaded nui_button_n.png", "generated", "assets/skin"), for the export list. */
  from: string;
}

export interface SkinProject {
  /** The export's name (the hak's file name: at most 16 characters). */
  name: string;
  tml: string;
  /** Own files by lower-case file name: "nui_button_n.tga", "myfont.ttf", "ofl-nuio_philo_b.txt". */
  files: Record<string, SkinFile>;
  origin: { kind: "builtin" | "game" | "hak" | "files"; label: string };
  /** The generator's style, when the textures were generated (the open skin, or a tweak of it). */
  style: Style | null;
}

const dec = new TextDecoder("utf-8");
const enc = new TextEncoder();

export const fileKey = (resref: string, ext: string) => `${resref.toLowerCase()}.${ext.toLowerCase()}`;

/** "nui_button_n.tga" -> ["nui_button_n", "tga"]. */
export function splitFile(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? [name.toLowerCase(), ""] : [name.slice(0, dot).toLowerCase(), name.slice(dot + 1).toLowerCase()];
}

// --- reading ------------------------------------------------------------------------------------------------------

export function data(p: SkinProject): TomlTable {
  return new TmlDoc(p.tml).data();
}

export function valueOf(p: SkinProject, key: string): TomlValue | undefined {
  return getPath(data(p), key);
}

/** The project's own files as a resource layer (searched before the game). */
export function projectLayer(p: SkinProject): MemoryContainer {
  const c = new MemoryContainer(`skin: ${p.name}`);
  for (const [name, f] of Object.entries(p.files)) {
    const [resref, ext] = splitFile(name);
    const t = resType(ext);
    if (t !== undefined && resref.length <= 16) c.set(resref, t, f.data);
  }
  c.set("nui_skin", RES_TYPES.tml!, enc.encode(p.tml));
  return c;
}

/** Checks the project with its resources (own files first, then the rest of resman). */
export function checkProject(p: SkinProject, resman: ResMan | null): SkinFinding[] {
  let parsed: TmlDoc;
  try {
    parsed = new TmlDoc(p.tml);
    parsed.data();
  } catch (e) {
    return [{ severity: "error", code: "parse", key: "", text: `nui_skin.tml does not parse: ${errorText(e)} (the client would skip the whole skin)` }];
  }
  const own = projectLayer(p);
  let res = null;
  if (resman) {
    const rm = new ResMan();
    rm.layers = [{ kind: "memory", container: own }, ...resman.layers.filter((l) => !l.container.label.startsWith("skin: "))];
    res = { resman: rm, isOwn: (l: { container: unknown }) => l.container === own };
  }
  return checkSkin(parsed.data(), res, { literal: (k) => parsed.literal(k) });
}

// --- editing ------------------------------------------------------------------------------------------------------

export function setValue(p: SkinProject, key: string, v: TomlValue | undefined): SkinProject {
  const doc = new TmlDoc(p.tml);
  doc.set(key, v);
  return { ...p, tml: doc.text() };
}

export function setValues(p: SkinProject, values: Record<string, TomlValue | undefined>): SkinProject {
  const doc = new TmlDoc(p.tml);
  for (const [k, v] of Object.entries(values)) doc.set(k, v);
  return { ...p, tml: doc.text() };
}

export function setFonts(p: SkinProject, fonts: FontEntryEdit[]): SkinProject {
  const doc = new TmlDoc(p.tml);
  doc.setFonts(fonts);
  return { ...p, tml: doc.text() };
}

/** The [[fonts]] entries, each marked with its source block (for setFonts). */
export function fontsOf(p: SkinProject): FontEntryEdit[] {
  return new TmlDoc(p.tml).fonts().map((values, source) => ({ values, source }));
}

export function putFile(p: SkinProject, name: string, f: SkinFile): SkinProject {
  return { ...p, files: { ...p.files, [name.toLowerCase()]: f } };
}

export function removeFile(p: SkinProject, name: string): SkinProject {
  const files = { ...p.files };
  delete files[name.toLowerCase()];
  return { ...p, files };
}

// --- export -------------------------------------------------------------------------------------------------------

export interface ExportItem {
  file: string;
  resref: string;
  ext: string;
  data: Uint8Array;
  licence: FileLicence | "tml" | "note";
  why: string;
}

export interface ExportPlan {
  items: ExportItem[];
  /** What the skin names but the export does not hold, and own files nothing uses. */
  leftOut: { name: string; reason: string }[];
  /** The licence note that goes with it (also an item). */
  note: string;
}

/** The lower-case file names of the textures and fonts the skin names. */
export function referenced(p: SkinProject): { textures: string[]; fonts: string[] } {
  const d = data(p);
  const textures = [...texturesOf((k) => getPath(d, k))].sort();
  const raw = Array.isArray(d.fonts) ? d.fonts : [];
  const fonts = [...new Set(raw.map((f) => (typeof f === "object" && f && !Array.isArray(f) && typeof (f as TomlTable).resref === "string" ? ((f as TomlTable).resref as string) : "fnt_maintext").toLowerCase()))];
  return { textures, fonts };
}

export const NOTE_RESREF = "nuid_skin_lic";

/**
 * What an export holds: nui_skin.tml, the own files the skin uses (for a texture, the format the client would pick
 * among them), the OFL texts of OFL fonts, and a licence note. resman (the game and haks) only tells where a left-out
 * texture or font is found.
 */
export function planExport(p: SkinProject, resman: ResMan | null = null): ExportPlan {
  const items: ExportItem[] = [];
  const leftOut: ExportPlan["leftOut"] = [];
  const used = new Set<string>();
  const ref = referenced(p);
  const outside = (resref: string, ext: string) => {
    const l = resman?.layers.find((x) => !x.container.label.startsWith("skin: ") && x.container.has(resref, RES_TYPES[ext]!));
    return l ? `${l.kind === "key" || l.kind === "game-ovr" || l.kind === "texture-pack" ? "the game's" : "found in"} ${l.container.label}` : null;
  };
  items.push({ file: "nui_skin.tml", resref: "nui_skin", ext: "tml", data: enc.encode(p.tml), licence: "tml", why: "the skin" });
  for (const t of ref.textures) {
    const own = CLIENT_PROBE.filter((e) => p.files[fileKey(t, e)]);
    if (!own.length) {
      const where = CLIENT_PROBE.map((e) => outside(t, e)).filter(Boolean).pop();
      leftOut.push({ name: t, reason: where ? `not yours: ${where} (players have it)` : "not found anywhere: the client will draw the not-found image" });
      continue;
    }
    const ext = own[own.length - 1]!;
    const k = fileKey(t, ext);
    used.add(k);
    const f = p.files[k]!;
    items.push({ file: k, resref: t, ext, data: f.data, licence: f.licence, why: f.from });
    for (const other of own.slice(0, -1)) {
      used.add(fileKey(t, other));
      leftOut.push({ name: fileKey(t, other), reason: `the client would use ${k} instead` });
    }
  }
  for (const r of ref.fonts) {
    const k = fileKey(r, "ttf");
    const f = p.files[k];
    if (!f) {
      const where = outside(r, "ttf");
      leftOut.push({ name: k, reason: where ? `not yours: ${where} (players have it)` : "not found anywhere: the client skips this font" });
      continue;
    }
    used.add(k);
    items.push({ file: k, resref: r, ext: "ttf", data: f.data, licence: f.licence, why: f.from });
    if (f.licence === "ofl") {
      const t = Object.keys(p.files).find((n) => n === `ofl-${r}.txt`);
      if (t) {
        used.add(t);
        items.push({ file: t, resref: `ofl_${r}`.slice(0, 16), ext: "txt", data: p.files[t]!.data, licence: "text", why: `the SIL OFL 1.1 text for ${k}` });
      } else leftOut.push({ name: `ofl-${r}.txt`, reason: `${k} is under the OFL, whose text must travel with it: add it` });
    }
  }
  // Own textures and fonts the skin does not name still go: a texture under a game name (nui_button_d) replaces the
  // game's wherever the game itself uses it.
  for (const n of Object.keys(p.files).sort()) {
    if (used.has(n) || n === "license" || n === "provenance.md" || n.startsWith("ofl-")) continue;
    const [resref, ext] = splitFile(n);
    if (!(CLIENT_PROBE as readonly string[]).includes(ext) && ext !== "ttf") {
      leftOut.push({ name: n, reason: "not a texture or a font" });
      continue;
    }
    if (resref.length > 16) {
      leftOut.push({ name: n, reason: "its name is longer than 16 characters" });
      continue;
    }
    const f = p.files[n]!;
    items.push({ file: n, resref, ext, data: f.data, licence: f.licence, why: `${f.from}; not named by the skin (the game may load it by name)` });
  }
  const note = licenceNote(p, items);
  items.push({ file: `${NOTE_RESREF}.txt`, resref: NOTE_RESREF, ext: "txt", data: enc.encode(note), licence: "note", why: "who made what, under which terms" });
  return { items, leftOut, note };
}

function licenceNote(p: SkinProject, items: ExportItem[]): string {
  const by = (l: FileLicence) => items.filter((i) => i.licence === l).map((i) => i.file);
  const lines = [
    `NUI skin "${p.name}", made with nwn-nui-designer (https://github.com/plenarius/nwn-nui-designer).`,
    "",
    "nui_skin.tml and the files below are what the skin's author put in; nothing in this export is Beamdog's.",
    "The skin may name textures and fonts of the game itself, which players already have; they are not included.",
    "",
  ];
  const user = by("user");
  if (user.length) lines.push("The author's own files (their terms):", ...user.map((f) => `  ${f}`), "");
  const cc0 = by("cc0");
  if (cc0.length) {
    lines.push(
      "Made by nwn-nui-designer's skin generator, dedicated to the public domain under CC0 1.0",
      "(https://creativecommons.org/publicdomain/zero/1.0/):",
      ...cc0.map((f) => `  ${f}`),
      "",
    );
  }
  const ofl = by("ofl");
  if (ofl.length) {
    lines.push("Fonts under the SIL Open Font License 1.1 (each ofl_*.txt is its licence; keep it with the font):", ...ofl.map((f) => `  ${f}`), "");
  }
  lines.push("nui_skin.tml: the skin author's terms. The key names it uses are the game's interface.");
  return lines.join("\n") + "\n";
}

export interface HakOptions {
  fileType?: "HAK" | "ERF";
  date?: Date;
}

export function exportHak(plan: ExportPlan, name: string, o: HakOptions = {}): Uint8Array {
  const entries: ErfEntry[] = plan.items.map((i) => ({ resref: i.resref, type: i.ext, data: i.data }));
  return writeErf(entries, { fileType: o.fileType ?? "HAK", description: `NUI skin ${name}, made with nwn-nui-designer (see ${NOTE_RESREF}.txt)`, date: o.date });
}

/** Loose files for the override or development folder (the licence texts under their resource names). */
export function exportZip(plan: ExportPlan, when?: Date): Uint8Array {
  return writeZip(plan.items.map((i) => ({ name: `${i.resref}.${i.ext}`, data: i.data })), when);
}

// --- starting points ----------------------------------------------------------------------------------------------

/** A built-in open skin (assets/skin/<theme>): CC0 textures and .tml, OFL fonts with their texts. */
export function fromOpenSkin(files: Record<string, Uint8Array>, style: Style | null, title = "Bronze", name = "nuid_open_skin"): SkinProject {
  const tml = files["nui_skin.tml"];
  if (!tml) throw new Error("the open skin has no nui_skin.tml");
  const out: Record<string, SkinFile> = {};
  for (const [file, d] of Object.entries(files)) {
    const n = file.toLowerCase();
    const [, ext] = splitFile(n);
    if (ext === "tga") out[n] = { data: d, licence: "cc0", from: `the open skin (${title})` };
    else if (ext === "ttf") out[n] = { data: d, licence: "ofl", from: "the open skin's font" };
    else if (n.startsWith("ofl-") && ext === "txt") out[n] = { data: d, licence: "text", from: "the open skin" };
  }
  return { name, tml: dec.decode(tml), files: out, origin: { kind: "builtin", label: `${title} (a built-in open skin)` }, style };
}

/** The game's skin: only the .tml is the user's to edit; the textures and fonts stay the game's. */
export function fromGameSkin(tml: Uint8Array | string, label: string): SkinProject {
  return { name: "my_skin", tml: typeof tml === "string" ? tml : dec.decode(tml), files: {}, origin: { kind: "game", label }, style: null };
}

/** A skin from a hak, an ERF or a set of loose files: nui_skin.tml and every image, font and text it holds. */
export async function fromResources(
  label: string,
  kind: "hak" | "files",
  entries: Iterable<[resref: string, ext: string, get: () => Promise<Uint8Array | null>]>,
  name = "my_skin",
): Promise<SkinProject> {
  let tml: Uint8Array | null = null;
  const files: Record<string, SkinFile> = {};
  const wanted = new Set<string>([...CLIENT_PROBE, "ttf", "txt"]);
  for (const [resref, ext, get] of entries) {
    if (resref === "nui_skin" && ext === "tml") {
      tml = await get();
      continue;
    }
    if (!wanted.has(ext)) continue;
    const d = await get();
    if (!d) continue;
    // Licence texts of our own exports come back as ofl_<font>.txt.
    const n = ext === "txt" && resref.startsWith("ofl_") ? `ofl-${resref.slice(4)}.txt` : fileKey(resref, ext);
    if (ext === "txt" && resref === NOTE_RESREF) continue;
    files[n] = { data: d, licence: ext === "txt" ? "text" : "user", from: label };
  }
  if (!tml) throw new Error(`${label}: no nui_skin.tml in it`);
  return { name: name.slice(0, 16), tml: dec.decode(tml), files, origin: { kind, label }, style: null };
}

/** Values every 9-slice key needs; for a new key added in the editor. */
export const KEY_ORDER = SKIN_KEYS.map((k) => k.key);

// --- saving the project -------------------------------------------------------------------------------------------

function b64(d: Uint8Array): string {
  let s = "";
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const SKIN_PROJECT_EXT = ".nuiskin.json";

export function writeSkinProject(p: SkinProject): string {
  return JSON.stringify({
    format: "nwn-nui-designer/skin",
    version: 1,
    name: p.name,
    origin: p.origin,
    style: p.style,
    tml: p.tml,
    files: Object.fromEntries(Object.entries(p.files).map(([n, f]) => [n, { licence: f.licence, from: f.from, data: b64(f.data) }])),
  });
}

export function readSkinProject(text: string): SkinProject {
  const j = JSON.parse(text) as {
    format?: string;
    name: string;
    origin: SkinProject["origin"];
    style: Style | null;
    tml: string;
    files: Record<string, { licence: FileLicence; from: string; data: string }>;
  };
  if (j.format !== "nwn-nui-designer/skin") throw new Error("not a skin project");
  return {
    name: j.name,
    origin: j.origin,
    style: j.style ?? null,
    tml: j.tml,
    files: Object.fromEntries(Object.entries(j.files ?? {}).map(([n, f]) => [n, { licence: f.licence, from: f.from, data: unb64(f.data) }])),
  };
}
