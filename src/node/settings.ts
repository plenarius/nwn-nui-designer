/**
 * The local settings file, nui-designer.ini in the repository root: where the game, the haks, the module's hak order,
 * loose override folders and a folder of windows are. The editor's dev server (localapi.ts) and the CLIs read it
 * through loadSettings, so both use the same folders.
 *
 * The format is a small INI: `key = value` lines, whole-line comments starting with `;` or `#`, `[section]` lines
 * ignored. A value in double quotes is taken as it is (for a path with a comma). `~` at the start of a path is the
 * home folder; a relative path is relative to the repository root. `overrides` and `haks` take several values, comma
 * separated or on repeated lines, and so does `styles` (style files and folders of them). Environment variables beat
 * the file: NWN_ROOT (game), NWN_HAK_DIR (hak_dir), NWN_MODULE_IFO (module_ifo), NUI_DESIGNER_STYLES (styles, several
 * separated as in PATH). NUI_DESIGNER_INI names another settings file.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root (the folder of package.json). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const INI_NAME = "nui-designer.ini";

/** The settings as written in the file (paths not yet resolved). Empty strings and lists mean unset. */
export interface IniSettings {
  game: string;
  hak_dir: string;
  module_ifo: string;
  overrides: string[];
  /** Hak names, best first, for a module without a module.ifo.json (module_ifo wins when both are set). */
  haks: string[];
  windows: string;
  /** Style files (.json) and folders of them: house styles of your own (README, "Your own house style"). */
  styles: string[];
}

export const EMPTY_SETTINGS: IniSettings = { game: "", hak_dir: "", module_ifo: "", overrides: [], haks: [], windows: "", styles: [] };

const LIST_KEYS = new Set(["overrides", "haks", "styles"]);
const KEYS = ["game", "hak_dir", "module_ifo", "overrides", "haks", "windows", "styles"] as const;
type Key = (typeof KEYS)[number];
const isKey = (k: string): k is Key => (KEYS as readonly string[]).includes(k);

interface Line {
  text: string;
  key?: string;
}

const LINE = /^\s*([A-Za-z0-9_.-]+)\s*[=:]\s*(.*?)\s*$/;

/** A value's parts: a quoted value whole, else split on commas (list keys) and trimmed. */
function values(raw: string, list: boolean): string[] {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return [raw.slice(1, -1)];
  if (!list) return raw ? [raw] : [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Parses the text of an INI file. Unknown keys are ignored (and kept by updateIni). */
export function parseIni(text: string): { settings: IniSettings; unknown: string[] } {
  const s: IniSettings = { ...EMPTY_SETTINGS, overrides: [], haks: [], styles: [] };
  const unknown: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith(";") || t.startsWith("#") || (t.startsWith("[") && t.endsWith("]"))) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    if (!isKey(key)) {
      unknown.push(key);
      continue;
    }
    const vs = values(m[2]!, LIST_KEYS.has(key));
    if (key === "overrides" || key === "haks" || key === "styles") s[key].push(...vs);
    else s[key] = vs[0] ?? "";
  }
  return { settings: s, unknown };
}

/** A value as written: quoted when it would not read back as it is. */
function quote(v: string, list: boolean): string {
  return (list && v.includes(",")) || v !== v.trim() || (v.startsWith('"') && v.endsWith('"')) ? `"${v}"` : v;
}

function lines(key: Key, s: IniSettings): string[] {
  if (key === "overrides" || key === "haks" || key === "styles") {
    const vs = s[key] ?? [];
    if (!vs.length) return [];
    // Haks are resrefs (no commas): one line. Folders get a line each, so a comma in a path survives.
    if (key === "haks") return [`haks = ${vs.join(", ")}`];
    return vs.map((v) => `${key} = ${quote(v, true)}`);
  }
  return s[key] ? [`${key} = ${quote(s[key], false)}`] : [];
}

/**
 * The INI text with s's values: each key's first line is replaced in place (a list's lines go there), its other lines
 * dropped, keys not in the file added at the end. Comments, blank lines, sections and unknown keys stay as they were.
 */
export function updateIni(text: string, s: IniSettings): string {
  const src: Line[] = (text ? text.replace(/\r?\n$/, "").split(/\r?\n/) : []).map((t) => {
    const tt = t.trim();
    const m = !tt.startsWith(";") && !tt.startsWith("#") ? LINE.exec(t) : null;
    return { text: t, key: m ? m[1]!.toLowerCase() : undefined };
  });
  const done = new Set<string>();
  const out: string[] = [];
  for (const l of src) {
    if (l.key && isKey(l.key)) {
      if (done.has(l.key)) continue;
      done.add(l.key);
      out.push(...lines(l.key, s));
    } else out.push(l.text);
  }
  const added = KEYS.filter((k) => !done.has(k)).flatMap((k) => lines(k, s));
  if (added.length && out.length && out[out.length - 1]!.trim() !== "") out.push("");
  out.push(...added);
  return out.join("\n") + "\n";
}

/** A path from the file or the environment: `~` expanded, relative to base. */
export function resolvePath(p: string, base = REPO_ROOT, home = homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
  return isAbsolute(p) ? p : resolve(base, p);
}

/** Where a setting's value came from. */
export type Source = "env" | "ini";

/** The settings with paths resolved and the environment applied. */
export interface Settings {
  /** The settings file's path, and whether it exists. */
  iniPath: string;
  iniExists: boolean;
  /** As written in the file. */
  file: IniSettings;
  game: string | null;
  gameFrom: Source | null;
  hakDir: string | null;
  hakDirFrom: Source | null;
  moduleIfo: string | null;
  moduleIfoFrom: Source | null;
  overrides: string[];
  haks: string[];
  windows: string | null;
  /** The style files and folders: $NUI_DESIGNER_STYLES (path-list separated, as PATH) beats the file's `styles`. */
  styles: string[];
  stylesFrom: Source | null;
}

export interface LoadOptions {
  /** The settings file (default: $NUI_DESIGNER_INI, else nui-designer.ini in the repository root). */
  iniPath?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export function iniPath(o: LoadOptions = {}): string {
  const env = o.env ?? process.env;
  return o.iniPath ?? (env.NUI_DESIGNER_INI ? resolvePath(env.NUI_DESIGNER_INI, process.cwd(), o.home) : join(REPO_ROOT, INI_NAME));
}

/** Reads the settings file (if any) and applies the environment. Never throws for a missing file. */
export function loadSettings(o: LoadOptions = {}): Settings {
  const env = o.env ?? process.env;
  const path = iniPath(o);
  const exists = existsSync(path);
  const file = exists ? parseIni(readFileSync(path, "utf8")).settings : { ...EMPTY_SETTINGS, overrides: [], haks: [], styles: [] };
  // Paths in the file are relative to the repository root; the default file sits there anyway.
  const r = (p: string) => resolvePath(p, REPO_ROOT, o.home);
  const pick = (envName: string, v: string): [string | null, Source | null] =>
    env[envName] ? [r(env[envName]!), "env"] : v ? [r(v), "ini"] : [null, null];
  const [game, gameFrom] = pick("NWN_ROOT", file.game);
  const [hakDir, hakDirFrom] = pick("NWN_HAK_DIR", file.hak_dir);
  const [moduleIfo, moduleIfoFrom] = pick("NWN_MODULE_IFO", file.module_ifo);
  return {
    iniPath: path,
    iniExists: exists,
    file,
    game,
    gameFrom,
    hakDir,
    hakDirFrom,
    moduleIfo,
    moduleIfoFrom,
    overrides: file.overrides.map(r),
    haks: file.haks.map((h) => h.toLowerCase().replace(/\.hak$/, "")),
    windows: file.windows ? r(file.windows) : null,
    ...(env.NUI_DESIGNER_STYLES
      ? { styles: env.NUI_DESIGNER_STYLES.split(delimiter).filter(Boolean).map(r), stylesFrom: "env" as const }
      : { styles: file.styles.map(r), stylesFrom: file.styles.length ? ("ini" as const) : null }),
  };
}

/** Writes s to the settings file, keeping its comments and the keys it does not know. */
export function saveSettings(s: IniSettings, o: LoadOptions = {}): string {
  const path = iniPath(o);
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, updateIni(before, s));
  return path;
}
