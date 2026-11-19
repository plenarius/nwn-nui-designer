/**
 * "Export full theme": one step from a NUI skin to everything a server ships, the NUI skin and the original
 * (MDL-panel) GUI retoned to match it (reskin.ts), as
 *
 * - output A, under the stock names: drop the folder in override/ or a hak and every window has the look;
 * - output B (opt-in), the same files under a short prefix (`bzg_boxes`, `bzn_skin`), with a manifest a server uses to
 *   switch a player to the theme (SetTextureOverride per texture, a ResMan override of nui_skin);
 * - a report: what was themed, what stays stock and why, failed checks, and a warning for a light skin.
 *
 * Nothing is written here: themePackage() returns the files by path, the CLI (src/node/theme.ts) writes them to a
 * folder and the editor zips them. The original GUI's art is read from the user's own install and never kept here.
 * docs/RESKIN-EVERYTHING.md is the guide.
 */
import { writeErf } from "../res/erfwrite.js";
import type { RGBAImage } from "../res/image.js";
import { ResMan } from "../res/resman.js";
import { decodeTga } from "../res/tga.js";
import { type ExportItem, NOTE_RESREF, type SkinFile, type SkinProject, planExport, splitFile } from "../skin/project.js";
import { type Style, styleTextures } from "../skin/gen/style.js";
import { type AlphaMode, alphaModeOf, lum } from "./colour.js";
import type { OutputFormat } from "./compress.js";
import { hex, paletteFromStyle, parseHex } from "./palette.js";
import { NUI_PIECES, type NuiPieces } from "./redraw.js";
import { type Manifest, type ReskinResult, TEXTURE_EXTS, reportMarkdown, reskin } from "./reskin.js";
import { AUTO, type ManualClass } from "./textures.js";

// --- the skin's pieces ----------------------------------------------------------------------------------------------

/** The NUI pieces the redraws read: the skin's own TGA where it has one, else the generator's. */
export function nuiPieces(style: Style, own: Record<string, Uint8Array> = {}): NuiPieces {
  const gen = styleTextures(style);
  const out: Partial<Record<(typeof NUI_PIECES)[number], RGBAImage>> = {};
  for (const n of NUI_PIECES) {
    const file = own[`${n}.tga`];
    const im = file ? decodeTga(file) : gen.get(n);
    if (!im) throw new Error(`the skin has no ${n}`);
    out[n] = im;
  }
  return out as NuiPieces;
}

// --- a light skin ---------------------------------------------------------------------------------------------------

/** A window body this light (luma 0-255) or lighter makes a light skin. */
export const LIGHT_LUMA = 128;

export interface LightCheck {
  light: boolean;
  /** The lighter of the window body (its top) and the window's fixed_background, as #RRGGBB, and its luma. */
  body: string;
  luma: number;
  /** The skin's text colour. */
  text: string;
}

/**
 * Whether the skin is light: its window body or fixed background at luma 128 or more (Verdigris and paper's aged
 * paper is 214; the dark skins are 3 to 45). The original GUI draws its text light, from its .gui files and the
 * client's code, so no texture can make it readable on a light panel.
 */
export function lightCheck(style: Style): LightCheck {
  const p = paletteFromStyle(style);
  const bg = parseHex(style.fixed_background).slice(0, 3);
  const [body, l] = lum(bg) > lum(p.ink) ? [bg, lum(bg)] : [p.ink, lum(p.ink)];
  return { light: l >= LIGHT_LUMA, body: hex(body), luma: Math.round(l), text: hex(p.text) };
}

export const LIGHT_WARNING =
  "WARNING: this is a light skin. The original GUI draws its text in light colours, set by its .gui files and the " +
  "client's code, not by any texture, so on these light panels its text (the character record, inventory, chat, " +
  "the creation wizard, options, every list) will be hard to read, and no texture in this export can change that. " +
  "NUI windows that hard-code a light text colour instead of taking the skin's (some of the game's, and any " +
  "module window that sets its own colours) will be hard to read too. Try every window in the game before shipping " +
  "it, or theme the original GUI from a dark skin.";

// --- the prefix -----------------------------------------------------------------------------------------------------

/** Resource name parts the game and this designer use: a prefixed name may not start with one of them. */
export const RESERVED_PREFIXES = ["gui", "ctl", "pnl", "nui", "nuio", "nuid", "inv", "qb", "pb", "po", "edit", "fnt", "load", "pre", "ofl", "nw", "nwn", "x0", "x1", "x2", "x3", "dm", "it", "tex"];

/**
 * The letter that stands for a stock name's first part under a prefix. Several stock names are 16 characters already
 * (ctl_con_prtl_inf, gui_boxes_chrgen) and some differ only in that part (ctl_opt_gen and pnl_opt_gen, gui_slider and
 * the skin's nui_slider), so the part becomes one letter after a prefix of one or two: with "bz", gui_boxes_chrgen ->
 * bzg_boxes_chrgen, pnl_opt_gen -> bzp_opt_gen, nui_skin -> bzn_skin. Every name keeps its length.
 */
export const PART_LETTERS: Record<string, string> = { gui: "g", ctl: "c", pnl: "p", pre: "r", edit: "e", inv: "i", qb: "q", nui: "n", nuio: "o", nuid: "d" };

/** "bz", "BZ" or "bz_" -> "bz"; null if it is not 1 or 2 letters and digits starting with a letter. */
export function normalisePrefix(s: string): string | null {
  const m = /^([a-z][a-z0-9]?)_?$/.exec(s.trim().toLowerCase());
  return m ? m[1]! : null;
}

/** A stock name under the prefix: its first part (up to the first _) becomes the prefix and that part's letter. */
export function prefixName(name: string, prefix: string): string {
  const i = name.indexOf("_");
  if (i < 0) return `${prefix}_${name}`;
  const part = name.slice(0, i);
  return `${prefix}${PART_LETTERS[part] ?? part[0]}_${name.slice(i + 1)}`;
}

/**
 * What is wrong with a prefix for these stock names: not a prefix, one the game uses, a name over 16 characters, two
 * names made one, or a name the game (or a hak) already has. Empty when it can be used.
 */
export async function prefixProblems(raw: string, names: string[], resman?: ResMan | null): Promise<string[]> {
  const prefix = normalisePrefix(raw);
  if (!prefix) return [`"${raw}": a prefix is 1 or 2 letters and digits, starting with a letter (e.g. bz); each name then keeps its stock length`];
  const out: string[] = [];
  const stockParts = new Set([...RESERVED_PREFIXES, ...names.filter((n) => n.includes("_")).map((n) => n.slice(0, n.indexOf("_")))]);
  const heads = [...new Set(names.map((n) => prefixName(n, prefix).split("_")[0]!))].filter((h) => stockParts.has(h));
  if (heads.length) out.push(`${prefix}: its names would start ${heads.map((h) => `${h}_`).join(", ")}, as the game's own do; choose another prefix`);
  const long = names.filter((n) => prefixName(n, prefix).length > 16);
  if (long.length) out.push(`${prefix}: too long for ${long.length} name(s) (a resref is at most 16 characters): ${long.slice(0, 4).map((n) => `${n} -> ${prefixName(n, prefix)}`).join(", ")}${long.length > 4 ? ", ..." : ""}`);
  const seen = new Map<string, string>();
  for (const n of names) {
    const p = prefixName(n, prefix);
    const other = seen.get(p);
    if (other && other !== n) out.push(`${other} and ${n} would both become ${p}`);
    seen.set(p, n);
  }
  if (resman && !out.length) {
    const taken: string[] = [];
    for (const n of new Set(names.map((x) => prefixName(x, prefix)))) {
      if (await resman.getAny(n, [...TEXTURE_EXTS, "tml", "ttf"])) taken.push(n);
    }
    if (taken.length) out.push(`${prefix}: the game or a hak already has ${taken.slice(0, 4).join(", ")}${taken.length > 4 ? ", ..." : ""}; choose another prefix`);
  }
  return out;
}

/** The skin project under the prefix: its own files renamed, and nui_skin.tml naming the renamed ones. */
function prefixProject(p: SkinProject, prefix: string): { project: SkinProject; renamed: Record<string, string> } {
  const renamed: Record<string, string> = {};
  const files: Record<string, SkinFile> = {};
  for (const [n, f] of Object.entries(p.files)) {
    if (n.startsWith("ofl-") && n.endsWith(".txt")) {
      files[`ofl-${prefixName(n.slice(4, -4), prefix)}.txt`] = f;
      continue;
    }
    const [resref, ext] = splitFile(n);
    if (!ext || n === "license" || n === "provenance.md") continue;
    renamed[resref] = prefixName(resref, prefix);
    files[`${renamed[resref]}.${ext}`] = f;
  }
  let tml = p.tml;
  // resrefs are letters, digits and _ (splitFile lower-cases them): nothing to escape
  for (const [from, to] of Object.entries(renamed)) if (/^[a-z0-9_]+$/.test(from)) tml = tml.replace(new RegExp(`"${from}"`, "gi"), `"${to}"`);
  return { project: { ...p, tml, files }, renamed };
}

// --- the export -----------------------------------------------------------------------------------------------------

export interface ThemeOptions {
  /** The NUI skin. It needs its generator style: the original GUI's palette is derived from it. */
  project: SkinProject;
  /** The game (and the haks and folders to read the stock textures through). Memory layers (a skin) are left out. */
  resman: ResMan;
  /** Override the alpha rule (default: from the skin's window body). */
  alpha?: AlphaMode;
  format?: OutputFormat;
  only?: string[];
  previews?: boolean;
  /** Output B: the same files under this prefix (1 or 2 letters and digits: "bz"). */
  prefix?: string;
  progress?(done: number, total: number, name: string): void | Promise<void>;
}

export interface PrefixManifest {
  tool: "nwn-nui-designer export-theme";
  theme: string;
  prefix: string;
  /** The NUI skin: point the player's nui_skin at it (a ResMan override of type 2076, tml). */
  skin: { stock: "nui_skin"; resref: string; restype: 2076 };
  /** The original GUI's textures: SetTextureOverride(stock, prefixed, oPC) for each. */
  textures: Record<string, string>;
  /** The skin's own textures and fonts, renamed: the prefixed nui_skin.tml names them itself, no override needed. */
  skinFiles: Record<string, string>;
}

export interface ThemeResult {
  title: string;
  /** Output A: file name -> bytes, stock names ("nui_skin.tml", "gui_boxes.dds", "gui_boxes.txi"). */
  stock: Record<string, Uint8Array>;
  /** Output B. */
  prefixed: { prefix: string; files: Record<string, Uint8Array>; manifest: PrefixManifest } | null;
  /** The NUI skin's part of output A (what the skin export would hold). */
  skinItems: ExportItem[];
  reskin: ReskinResult;
  light: LightCheck;
  report: string;
}

export class ThemeError extends Error {}

/** True when the resources hold a game install (the stock original GUI is read from it). */
export const hasGame = (rm: ResMan | null | undefined): boolean => !!rm?.layers.some((l) => l.kind === "key");

const itemFile = (i: ExportItem) => `${i.resref}.${i.ext}`;

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * The skin's licence note, for a theme: the skin export's note says nothing in it is Beamdog's, which a theme's
 * retoned original-GUI textures are. Says so, and lists them.
 */
function themeNote(note: Uint8Array, gui: string[]): Uint8Array {
  const text = dec
    .decode(note)
    .replace("nothing in this export is Beamdog's.", "nothing in the NUI skin is Beamdog's.")
    .trimEnd();
  return enc.encode(
    `${text}\n\n` +
      "The original GUI's textures below are NOT the skin author's: nwn-nui-designer retoned them from the exporting\n" +
      "user's own copy of Beamdog's game files (same names, sizes and layout, new colours). They are derived from\n" +
      "Beamdog's art: ship them in a module's haks for players of the game, never in a public repository.\n" +
      gui.map((f) => `  ${f}`).join("\n") +
      "\n",
  );
}

export async function exportTheme(o: ThemeOptions): Promise<ThemeResult> {
  const p = o.project;
  if (!p.style) {
    throw new ThemeError(
      `${p.name}: this skin has no generator style, and the original GUI's palette is derived from one. Open it in the skin editor's Generator (or start from a built-in skin), then export again.`,
    );
  }
  const resman = new ResMan();
  resman.layers = o.resman.layers.filter((l) => l.kind !== "memory");
  if (!hasGame(resman)) throw new ThemeError("no game: the original GUI is retoned from your own install's textures. Load the game folder (NWN_ROOT, nui-designer.ini's game, or Game and haks in the editor) and try again.");
  const title = p.origin.kind === "builtin" ? p.origin.label.replace(/ \((a built-in open skin|preset [^)]*)\)$/, "") : p.name;

  // the NUI skin, as the skin export holds it
  const plan = planExport(p, resman);
  const skinItems = plan.items;
  const own: Record<string, Uint8Array> = {};
  for (const [n, f] of Object.entries(p.files)) own[n] = f.data;

  let prefix: string | null = null;
  if (o.prefix !== undefined) {
    const skinNames = skinItems.filter((i) => i.licence !== "text" && i.licence !== "note").map((i) => i.resref);
    const names = [...new Set([...skinNames, ...AUTO.map((t) => t.name), NOTE_RESREF])];
    const problems = await prefixProblems(o.prefix, names, resman);
    if (problems.length) throw new ThemeError(`prefix: ${problems.join("; ")}`);
    prefix = normalisePrefix(o.prefix)!;
  }

  const palette = paletteFromStyle(p.style);
  const alpha = o.alpha ?? alphaModeOf(palette);
  const res = await reskin(resman, {
    palette,
    nui: nuiPieces(p.style, own),
    skin: { id: p.name, title, from: p.origin.label },
    alpha,
    format: o.format,
    only: o.only,
    previews: o.previews,
    progress: o.progress,
  });

  const guiFiles = (rename: (n: string) => string) => Object.keys(res.files).filter((n) => !n.endsWith(".txi")).map(rename).sort();
  const stock: Record<string, Uint8Array> = {};
  for (const i of skinItems) stock[itemFile(i)] = i.licence === "note" ? themeNote(i.data, guiFiles((n) => n)) : i.data;
  for (const [n, d] of Object.entries(res.files)) {
    if (n in stock) throw new ThemeError(`${n}: both the NUI skin and the original GUI have it`);
    stock[n] = d;
  }

  let prefixed: ThemeResult["prefixed"] = null;
  if (prefix) {
    const { project: pp, renamed } = prefixProject(p, prefix);
    const files: Record<string, Uint8Array> = {};
    const skinFiles: Record<string, string> = {};
    const renameFile = (n: string) => {
      const [resref, ext] = splitFile(n);
      return `${prefixName(resref, prefix!)}.${ext}`;
    };
    for (const i of planExport(pp, null).items) {
      const resref = i.licence === "tml" ? prefixName("nui_skin", prefix) : i.licence === "note" ? prefixName(NOTE_RESREF, prefix) : i.resref;
      files[`${resref}.${i.ext}`] = i.licence === "note" ? themeNote(i.data, guiFiles(renameFile)) : i.data;
    }
    for (const [from, to] of Object.entries(renamed)) skinFiles[from] = to;
    const textures: Record<string, string> = {};
    for (const [n, d] of Object.entries(res.files)) {
      const [resref, ext] = splitFile(n);
      if (ext !== "txi") textures[resref] = prefixName(resref, prefix);
      files[renameFile(n)] = d;
    }
    prefixed = {
      prefix,
      files,
      manifest: {
        tool: "nwn-nui-designer export-theme",
        theme: title,
        prefix,
        skin: { stock: "nui_skin", resref: prefixName("nui_skin", prefix), restype: 2076 },
        textures: Object.fromEntries(Object.entries(textures).sort(([a], [b]) => (a < b ? -1 : 1))),
        skinFiles: Object.fromEntries(Object.entries(skinFiles).sort(([a], [b]) => (a < b ? -1 : 1))),
      },
    };
  }

  const light = lightCheck(p.style);
  const result: ThemeResult = { title, stock, prefixed, skinItems, reskin: res, light, report: "" };
  result.report = themeReport(result, plan.leftOut);
  return result;
}

// --- the report -----------------------------------------------------------------------------------------------------

const CLASS_TITLES: Record<ManualClass, string> = {
  icon: "Icons",
  picture: "Pictures",
  "baked text": "Baked text",
  cursor: "Cursors",
  font: "Bitmap fonts",
  content: "Content",
};

export function themeReport(r: ThemeResult, leftOut: { name: string; reason: string }[] = []): string {
  const m: Manifest = r.reskin.manifest;
  const out: string[] = [`# Theme export: ${r.title}`, ""];
  if (r.light.light) {
    out.push(`> **${LIGHT_WARNING}**`, ">", `> (The skin's window body is ${r.light.body}, luma ${r.light.luma} of 255; a skin is light from ${LIGHT_LUMA}. Its own text is ${r.light.text}.)`, "");
  }
  const bad = m.textures.filter((t) => !t.validation.ok);
  const fonts = r.skinItems.filter((i) => i.ext === "ttf").length;
  const skinTex = r.skinItems.filter((i) => i.ext !== "ttf" && i.ext !== "tml" && i.ext !== "txt").length;
  const txi = Object.keys(r.reskin.files).filter((n) => n.endsWith(".txi")).length;
  const groups = new Map<string, number>();
  for (const t of m.textures) groups.set(t.group, (groups.get(t.group) ?? 0) + 1);
  out.push(
    "## What is in it",
    "",
    `- **NUI skin**: nui_skin.tml, ${skinTex} textures, ${fonts} fonts and their licence texts (${r.skinItems.length} files).`,
    `- **Original GUI**: ${m.textures.length} textures retoned to the skin (${[...groups].map(([g, n]) => `${n} ${g}`).join(", ")}), with ${txi} stock .txi files. Alpha: ${m.alpha}. Formats below.`,
    `- **Output A**, \`stock/\`: ${Object.keys(r.stock).length} files under the stock names. Put them in a hak (or a player's override folder) and every window has the look, character select and the creation wizard included.`,
  );
  if (r.prefixed) {
    const pm = r.prefixed.manifest;
    out.push(
      `- **Output B**, \`prefixed/\`: the same ${Object.keys(r.prefixed.files).length} files under the prefix \`${pm.prefix}\`, and \`prefixed.json\`: the skin is \`${pm.skin.resref}\`, ${Object.keys(pm.textures).length} original-GUI textures to switch with SetTextureOverride. Per-player overrides reach a player only in the module, never character select or the creation wizard.`,
    );
  }
  out.push("");
  out.push("## Left stock", "", "The client uses these, and no export changes them: each needs an artist (or stays as it is).", "", "| What | Textures | Why |", "|---|---|---|");
  const byClass = new Map<ManualClass, { n: number; found: number; why: Set<string> }>();
  for (const t of m.manual) {
    const c = byClass.get(t.class) ?? { n: 0, found: 0, why: new Set<string>() };
    c.n++;
    if (t.found) c.found++;
    c.why.add(t.why);
    byClass.set(t.class, c);
  }
  for (const [cls, c] of byClass) out.push(`| ${CLASS_TITLES[cls]} | ${c.n}${c.found < c.n ? ` (${c.found} in your install)` : ""} | ${[...c.why].join("; ")} |`);
  out.push(
    "| Text colours and fonts, layout | - | the original GUI's text colours and fonts come from its .gui files, the client's code and the fnt_default* fonts; panel layout from its models: not textures |",
    "",
  );
  if (leftOut.length) {
    out.push("NUI skin: names it uses but does not hold (the players' own copies are used):", "", ...leftOut.map((l) => `- \`${l.name}\`: ${l.reason}`), "");
  }
  out.push("## Checks", "");
  if (!bad.length && !m.skipped.length) out.push(`Every one of the ${m.textures.length} retoned textures passed its checks (size, alpha, layout, orientation, rules and dividers kept).`, "");
  if (bad.length) out.push(`**${bad.length} texture(s) failed a check**: look at them (contact sheets) before shipping, redraw them by hand or leave them out.`, "", ...bad.map((t) => `- \`${t.name}\`: ${t.validation.problems.join("; ")}`), "");
  if (m.skipped.length) out.push(`${m.skipped.length} texture(s) skipped:`, "", ...m.skipped.map((s) => `- \`${s.name}\`: ${s.why}`), "");
  // the reskin's own report, a level down: formats, and each texture left to a person by name
  const detail = reportMarkdown(m)
    .split("\n")
    .map((l) => (l.startsWith("#") ? `#${l}` : l))
    .join("\n")
    .replace(/^## Reskin report: .*/m, "## Original GUI in detail");
  out.push(detail);
  return out.join("\n");
}

// --- the package ----------------------------------------------------------------------------------------------------

export interface PackageOptions {
  /** Also output A as NAME.hak (a resref: at most 16 characters). */
  hak?: string;
  /** Also output B as NAME.hak. */
  prefixHak?: string;
  date?: Date;
}

const hakEntries = (files: Record<string, Uint8Array>) =>
  Object.entries(files)
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([n, data]) => ({ resref: n.slice(0, n.lastIndexOf(".")), type: n.slice(n.lastIndexOf(".") + 1), data }));

export const HAK_NAME = /^[a-z0-9_]{1,16}$/;

/** Everything the export writes, by path in the output folder (or the zip). */
export function themePackage(r: ThemeResult, o: PackageOptions = {}): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [n, d] of Object.entries(r.stock)) out[`stock/${n}`] = d;
  const description = `Theme "${r.title}": NUI skin and the original GUI, made with nwn-nui-designer (see ${NOTE_RESREF}.txt). The original GUI's textures are derived from the game's own.`;
  if (o.hak) {
    if (!HAK_NAME.test(o.hak)) throw new ThemeError(`${o.hak}: a hak name is 1 to 16 letters, digits or _`);
    out[`${o.hak}.hak`] = writeErf(hakEntries(r.stock), { fileType: "HAK", description, date: o.date });
  }
  if (r.prefixed) {
    for (const [n, d] of Object.entries(r.prefixed.files)) out[`prefixed/${n}`] = d;
    out["prefixed.json"] = enc.encode(`${JSON.stringify(r.prefixed.manifest, null, 1)}\n`);
    if (o.prefixHak) {
      if (!HAK_NAME.test(o.prefixHak)) throw new ThemeError(`${o.prefixHak}: a hak name is 1 to 16 letters, digits or _`);
      if (o.prefixHak === o.hak) throw new ThemeError(`${o.prefixHak}: the two haks need different names`);
      out[`${o.prefixHak}.hak`] = writeErf(hakEntries(r.prefixed.files), { fileType: "HAK", description: `${description} Prefix ${r.prefixed.prefix} (per-player).`, date: o.date });
    }
  } else if (o.prefixHak) throw new ThemeError("a prefixed hak needs a prefix");
  out["report.md"] = enc.encode(r.report);
  out["reskin-manifest.json"] = enc.encode(`${JSON.stringify(r.reskin.manifest, null, 1)}\n`);
  return out;
}
