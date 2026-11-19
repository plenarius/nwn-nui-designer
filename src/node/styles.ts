/**
 * House styles of your own: style files (.json, styles/style.schema.json) listed in nui-designer.ini's `styles` (or
 * $NUI_DESIGNER_STYLES), each a file or a folder of them, read for `pnpm check` and the editor's local API.
 *
 * A style file may name a plugin (a .js or .mjs file beside it, or below it): JavaScript run with this program's
 * rights, as any plugin. It is imported only when the style is chosen (pnpm check --style) or listed by the editor.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { STYLE_RULE_SETS } from "../core/edit/styles/index.js";
import { type StyleDef, StyleFileError, addPluginRules, parseStyleDef } from "../core/edit/styles/generic.js";
import type { StyleRuleSet } from "../core/edit/style.js";
import { confine } from "./localapi.js";
import { type LoadOptions, loadSettings } from "./settings.js";

/** Style files in a folder (not its subfolders): *.json, except schemas (*.schema.json). */
const isStyleFile = (name: string) => /\.json$/i.test(name) && !/\.schema\.json$/i.test(name) && !name.startsWith(".");

/** The style files the paths name: a file as it is, a folder's style files (sorted). Missing paths throw. */
export function styleFiles(paths: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    let st;
    try {
      st = statSync(p);
    } catch {
      throw new StyleFileError(p, "", "no such file or folder");
    }
    if (st.isDirectory()) out.push(...readdirSync(p).filter(isStyleFile).sort().map((n) => resolve(p, n)));
    else out.push(p);
  }
  return out;
}

/** Reads and checks a style file (not its plugin). */
export function readStyleDef(file: string): StyleDef {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new StyleFileError(file, "", e instanceof Error && "code" in e && e.code === "ENOENT" ? "no such file" : "cannot read it");
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new StyleFileError(file, "", `not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parseStyleDef(json, file);
}

/** The plugin's path: inside the style file's folder (no absolute path, no `..`, no link that leads out), or throws. */
export function pluginPath(def: StyleDef): string {
  const p = confine(dirname(def.file), def.plugin!);
  if (!p) throw new StyleFileError(def.file, "plugin", `${def.plugin}: no such file in the style file's folder (a plugin sits beside the style file or below it)`);
  return p;
}

/** A style file as a rule set: its generic rules, and its plugin's rules (the plugin runs). */
export async function loadStyleFile(file: string): Promise<StyleRuleSet> {
  const def = readStyleDef(file);
  if (!def.plugin) return def.set;
  const p = pluginPath(def);
  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(p).href)) as { default?: unknown };
  } catch (e) {
    throw new StyleFileError(file, "plugin", `${def.plugin}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return addPluginRules(def, mod.default);
}

/** The configured style files (settings `styles`, or $NUI_DESIGNER_STYLES), each loaded or with its error. */
export async function configuredStyles(o: LoadOptions = {}): Promise<{ file: string; set?: StyleRuleSet; error?: string }[]> {
  const out: { file: string; set?: StyleRuleSet; error?: string }[] = [];
  for (const p of loadSettings(o).styles) {
    let files: string[];
    try {
      files = styleFiles([p]);
    } catch (e) {
      out.push({ file: p, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    for (const file of files) {
      try {
        out.push({ file, set: await loadStyleFile(file) });
      } catch (e) {
        out.push({ file, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return out;
}

/** Whether a --style value names a file rather than an id. */
export const looksLikePath = (s: string) => /[\\/]/.test(s) || /\.json$/i.test(s);

/**
 * The style `--style` names: a style file's path (relative to base), or an id among the built-in sets and the
 * configured style files (a configured file with the id of a built-in one wins: it is yours). Throws a StyleFileError
 * for a bad file, and an Error listing the ids for an unknown id.
 */
export async function resolveStyle(arg: string, base: string, o: LoadOptions = {}): Promise<StyleRuleSet> {
  if (looksLikePath(arg)) return loadStyleFile(resolve(base, arg));
  const configured = await configuredStyles(o);
  const mine = configured.find((c) => c.set?.id === arg);
  if (mine?.set) return mine.set;
  const builtIn = STYLE_RULE_SETS.find((s) => s.id === arg);
  if (builtIn) return builtIn;
  const ids = [...STYLE_RULE_SETS.map((s) => s.id), ...configured.flatMap((c) => (c.set ? [c.set.id] : []))];
  const broken = configured.filter((c) => c.error).map((c) => c.error);
  throw new Error(`--style ${arg}: expected ${[...new Set(ids), "none"].join(", ")} or a style file's path${broken.length ? ` (could not load: ${broken.join("; ")})` : ""}`);
}

