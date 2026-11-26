/**
 * The local API the editor's dev server serves under /api/local/ (vite.config.ts): the settings file, the installs
 * found on this computer, and the files of the configured folders, read straight from the disk. It answers only
 * requests from this computer (a loopback address and a localhost Host header), and a file request only inside the
 * configured folders: no absolute paths, no `..`, no symlink that leads out.
 *
 *   GET  /api/local/state                       settings, detected installs, the game's file list, haks, overrides, windows
 *   PUT  /api/local/settings  (JSON IniSettings) checks the folders, writes nui-designer.ini: { saved: true, state }, or
 *                                                { saved: false, error, errors } (200 too: a typo is not a failed request)
 *   GET  /api/local/windows                     the windows folder's window files with their titles (the window switcher)
 *   GET  /api/local/file?root=R&path=P          a file of root R (game, hak, ovr:N, windows, style:N: a style file's
 *                                                folder, for its plugin), with Range support
 *
 * The browser reads the game the way it reads a picked folder: a list of files with their sizes, then byte ranges as
 * the containers ask for them (a hak's directory, one texture), so first draw costs the same few reads (DESIGN.md
 * "Local settings and the local API").
 */
import { createReadStream, existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, isAbsolute, join, sep } from "node:path";
import { readHakOrderFile } from "./hakorder.js";
import { openText } from "../core/edit/project.js";
import { pluginPath, readStyleDef, styleFiles } from "./styles.js";
import { type DetectOptions, type Install, detectHakDir, detectInstalls, isGameDir, notGameReason } from "./detect.js";
import type { HakOrderFormat } from "../core/res/hakorder.js";
import { EMPTY_SETTINGS, type IniSettings, type LoadOptions, REPO_ROOT, loadSettings, resolvePath, saveSettings } from "./settings.js";

export const API_PREFIX = "/api/local/";

export interface FileEntry {
  /** The path under the root, "/"-separated, with the disk's case. */
  path: string;
  size: number;
}

export type From = "env" | "ini" | "detected";

export interface HakEntry {
  /** The resref (lower case, no extension). */
  name: string;
  /** The file name in the hak folder, when it is there. */
  file?: string;
  size?: number;
  found: boolean;
}

export interface FolderState {
  path: string;
  error?: string;
  files: FileEntry[];
}

export interface LocalState {
  version: 1;
  ini: { path: string; exists: boolean; settings: IniSettings };
  /** The environment variables that override the file. */
  env: { NWN_ROOT?: string; NWN_HAK_DIR?: string; NWN_MODULE_IFO?: string };
  detected: Install[];
  game: { path: string; from: From; files: FileEntry[] } | null;
  gameError: string | null;
  hakDir: { path: string; from: From } | null;
  hakDirError: string | null;
  /**
   * Where the hak order comes from: module_ifo (a module.ifo.json, a binary module.ifo or a .mod; format says which),
   * the ini's haks list, or nowhere (no haks loaded).
   */
  order: { from: "module_ifo" | "haks" | null; path?: string; format?: HakOrderFormat; error?: string };
  haks: HakEntry[];
  /** Every .hak in the hak folder (resrefs), to add to the haks list. */
  available: string[];
  overrides: FolderState[];
  windows: FolderState | null;
  /**
   * The configured style files (settings `styles`): each one's JSON, which the editor turns into a rule set as
   * `pnpm check` does, or why it cannot be used. A plugin is read from root `style:N` (the style file's folder).
   */
  styles: StyleFileState[];
}

export interface StyleFileState {
  file: string;
  /** The root its plugin is read from (`style:N`). */
  root: string;
  id?: string;
  json?: unknown;
  /** The plugin's path under the root, as the file names it. */
  plugin?: string;
  error?: string;
}

export interface LocalApiOptions extends LoadOptions {
  /** Where to look for installs; false: do not look (the browser tests). */
  detect?: DetectOptions | false;
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The files directly in dir (not hidden), with their sizes; symlinks to files count. */
function listFiles(dir: string, prefix = ""): FileEntry[] {
  const out: FileEntry[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    try {
      const st = statSync(join(dir, name));
      if (st.isFile()) out.push({ path: prefix + name, size: st.size });
    } catch {
      /* a dangling link */
    }
  }
  return out;
}

/** The real name of a child of dir, ignoring case ("Data" for "data"). */
function child(dir: string, name: string): string | null {
  try {
    const want = name.toLowerCase();
    return readdirSync(dir).find((n) => n.toLowerCase() === want) ?? null;
  } catch {
    return null;
  }
}

/** The files of an install the editor reads: data/, data/txpk/ and ovr/ (the rest is never asked for). */
export function gameFiles(game: string): FileEntry[] {
  const out: FileEntry[] = [];
  for (const rel of ["data", "data/txpk", "ovr"]) {
    let cur = game;
    let real = "";
    for (const part of rel.split("/")) {
      const n = child(cur, part);
      if (!n) {
        cur = "";
        break;
      }
      cur = join(cur, n);
      real += `${n}/`;
    }
    if (cur && isDir(cur)) out.push(...listFiles(cur, real));
  }
  return out;
}

function folderState(path: string, filter?: (name: string) => boolean): FolderState {
  if (!isDir(path)) return { path, error: `${path}: no such folder`, files: [] };
  try {
    const files = listFiles(path);
    return { path, files: filter ? files.filter((f) => filter(f.path)) : files };
  } catch (e) {
    return { path, error: `${path}: ${e instanceof Error ? e.message : String(e)}`, files: [] };
  }
}

/** Window files the start screen lists: projects, .jui, window JSON and dumps. */
export const isWindowFile = (name: string) => /\.(jui|json)$/i.test(name);

export interface WindowFileEntry extends FileEntry {
  /** The window's title, when it is a string (not a bind) and the file opens. */
  title?: string;
}

export interface WindowList {
  path: string;
  error?: string;
  files: WindowFileEntry[];
}

/** Files bigger than this are listed without a title (reading them for one line is not worth it). */
const TITLE_MAX_BYTES = 4 << 20;
const titles = new Map<string, { mtime: number; size: number; title: string | undefined }>();

/** A window file's title, as the editor would open it; cached by modification time and size. */
export function windowFileTitle(file: string): string | undefined {
  try {
    const st = statSync(file);
    const hit = titles.get(file);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.title;
    let title: string | undefined;
    if (st.size <= TITLE_MAX_BYTES) {
      try {
        const t = openText(readFileSync(file, "utf8"), "window").doc.window.title;
        if (typeof t === "string" && t.trim()) title = t.trim();
      } catch {
        /* not a window: listed by name only */
      }
    }
    titles.set(file, { mtime: st.mtimeMs, size: st.size, title });
    return title;
  } catch {
    return undefined;
  }
}

/** The windows folder's window files with their titles, or null when no windows folder is set. */
export function windowList(o: LocalApiOptions = {}): WindowList | null {
  const s = loadSettings(o);
  if (!s.windows) return null;
  const f = folderState(s.windows, isWindowFile);
  return { ...f, files: f.files.map((e) => ({ ...e, title: windowFileTitle(join(s.windows!, e.path)) })) };
}

/** Everything the editor needs to know, from the settings file, the environment and the disk. */
export async function localState(o: LocalApiOptions = {}): Promise<LocalState> {
  const env = o.env ?? process.env;
  const s = loadSettings(o);
  const detected = o.detect === false ? [] : detectInstalls(o.detect);
  let game: LocalState["game"] = null;
  let gameError: string | null = null;
  if (s.game) {
    gameError = notGameReason(s.game);
    if (!gameError) game = { path: s.game, from: s.gameFrom!, files: [] };
  } else if (detected[0]) game = { path: detected[0].path, from: "detected", files: [] };
  if (game) game.files = gameFiles(game.path);

  let hakDir: LocalState["hakDir"] = null;
  let hakDirError: string | null = null;
  if (s.hakDir) {
    if (isDir(s.hakDir)) hakDir = { path: s.hakDir, from: s.hakDirFrom! };
    else hakDirError = `${s.hakDir}: no such folder`;
  } else {
    const d = o.detect === false ? null : detectHakDir(o.detect);
    if (d) hakDir = { path: d, from: "detected" };
  }
  const inDir = new Map<string, FileEntry>();
  if (hakDir) {
    for (const f of listFiles(hakDir.path)) if (/\.hak$/i.test(f.path)) inDir.set(f.path.slice(0, -4).toLowerCase(), f);
  }

  let order: LocalState["order"] = { from: null };
  let names: string[] = [];
  if (s.moduleIfo) {
    order = { from: "module_ifo", path: s.moduleIfo };
    try {
      const h = await readHakOrderFile(s.moduleIfo);
      names = h.haks;
      order.format = h.format;
      if (!h.field) order.error = `${s.moduleIfo}: no Mod_HakList (or Mod_Hak) in it`;
    } catch (e) {
      order.error = e instanceof Error ? e.message : String(e);
    }
  } else if (s.haks.length) {
    order = { from: "haks" };
    names = s.haks;
  }
  const haks: HakEntry[] = names.map((name) => {
    const f = inDir.get(name);
    return f ? { name, file: f.path, size: f.size, found: true } : { name, found: false };
  });

  return {
    version: 1,
    ini: { path: s.iniPath, exists: s.iniExists, settings: s.file },
    env: Object.fromEntries((["NWN_ROOT", "NWN_HAK_DIR", "NWN_MODULE_IFO"] as const).filter((k) => env[k]).map((k) => [k, env[k]])),
    detected,
    game,
    gameError,
    hakDir,
    hakDirError,
    order,
    haks,
    available: [...inDir.keys()].sort(),
    overrides: s.overrides.map((p) => folderState(p)),
    windows: s.windows ? folderState(s.windows, isWindowFile) : null,
    styles: styleStates(s.styles),
  };
}

/** The style files the settings name, read and checked (their plugins are not run here: the editor runs them). */
export function styleStates(paths: string[]): StyleFileState[] {
  const out: StyleFileState[] = [];
  const files: string[] = [];
  for (const p of paths) {
    try {
      files.push(...styleFiles([p]));
    } catch (e) {
      out.push({ file: p, root: "", error: e instanceof Error ? e.message : String(e) });
    }
  }
  files.forEach((file, i) => {
    const st: StyleFileState = { file, root: `style:${i}` };
    try {
      const def = readStyleDef(file);
      st.id = def.set.id;
      st.json = JSON.parse(readFileSync(file, "utf8"));
      if (def.plugin) {
        pluginPath(def);
        st.plugin = def.plugin;
      }
    } catch (e) {
      st.error = e instanceof Error ? e.message : String(e);
    }
    out.push(st);
  });
  return out;
}

/** Checks new settings before they are written: each message is keyed by the setting. */
export async function checkSettings(n: IniSettings, base = REPO_ROOT): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const r = (p: string) => resolvePath(p, base);
  if (n.game) {
    const why = notGameReason(r(n.game));
    if (why) errors.game = why;
  }
  if (n.hak_dir && !isDir(r(n.hak_dir))) errors.hak_dir = `${r(n.hak_dir)}: no such folder`;
  if (n.module_ifo) {
    try {
      if (!(await readHakOrderFile(r(n.module_ifo))).field) errors.module_ifo = `${r(n.module_ifo)}: no Mod_HakList (or Mod_Hak) in it`;
    } catch (e) {
      errors.module_ifo = e instanceof Error ? e.message : String(e);
    }
  }
  const badOvr = n.overrides.filter((p) => !isDir(r(p)));
  if (badOvr.length) errors.overrides = `no such folder: ${badOvr.map(r).join(", ")}`;
  if (n.windows && !isDir(r(n.windows))) errors.windows = `${r(n.windows)}: no such folder`;
  const badStyles = n.styles.filter((p) => !existsSync(r(p)));
  if (badStyles.length) errors.styles = `no such file or folder: ${badStyles.map(r).join(", ")}`;
  return errors;
}

/**
 * The real path of rel inside root, or null: rel must be a relative "/"-separated path without empty, "." or ".."
 * parts, backslashes or colons (a drive, or an NTFS stream such as "x.tga::$DATA"), and once symlinks (and Windows
 * junctions) are followed the file must still be inside root's real path. Both real paths come from the native
 * realpath, which on Windows gives the disk's case and long names for 8.3 ones, so the two compare as written.
 */
export function confine(root: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || rel.includes("\\") || rel.includes(":") || isAbsolute(rel)) return null;
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  let rootReal: string;
  let real: string;
  try {
    rootReal = realpathSync.native(root);
    real = realpathSync.native(join(rootReal, ...parts));
  } catch {
    return null;
  }
  if (!real.startsWith(rootReal.endsWith(sep) ? rootReal : rootReal + sep)) return null;
  try {
    return statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** The folders files may be read from, in the current settings (what localState reports, without listing them). */
export interface Roots {
  game: string | null;
  hak: string | null;
  overrides: string[];
  windows: string | null;
  /** The style files' folders, by their index in the list of style files (root `style:N`). */
  styles: string[];
}

export function currentRoots(o: LocalApiOptions = {}): Roots {
  const s = loadSettings(o);
  const detect = o.detect === false ? null : o.detect;
  const game = s.game ? (isGameDir(s.game) ? s.game : null) : detect === null ? null : (detectInstalls(detect)[0]?.path ?? null);
  const hak = s.hakDir ? (isDir(s.hakDir) ? s.hakDir : null) : detect === null ? null : detectHakDir(detect);
  const styles: string[] = [];
  for (const p of s.styles) {
    try {
      styles.push(...styleFiles([p]).map((f) => dirname(f)));
    } catch {
      /* reported by localState */
    }
  }
  return { game, hak, overrides: s.overrides, windows: s.windows, styles };
}

/** The folder a root name (game, hak, ovr:N, windows, style:N) stands for. */
export function rootPath(roots: Roots, root: string): string | null {
  if (root === "game") return roots.game;
  if (root === "hak") return roots.hak;
  if (root === "windows") return roots.windows;
  const st = /^style:(\d+)$/.exec(root);
  if (st) return roots.styles[Number(st[1])] ?? null;
  const m = /^ovr:(\d+)$/.exec(root);
  return m ? (roots.overrides[Number(m[1])] ?? null) : null;
}

const originHost = (o: string) => {
  try {
    return new URL(o).host;
  } catch {
    return null;
  }
};

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i;
const isLoopback = (a: string | undefined) => !!a && (a === "::1" || a.startsWith("127.") || a.startsWith("::ffff:127."));

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit = 1 << 16): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new Error("request too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

/** A JSON body as IniSettings (unknown fields dropped, strings trimmed). */
export function toIniSettings(v: unknown): IniSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { ...EMPTY_SETTINGS, game: str(o.game), hak_dir: str(o.hak_dir), module_ifo: str(o.module_ifo), overrides: strs(o.overrides), haks: strs(o.haks).map((h) => h.toLowerCase().replace(/\.hak$/, "")), windows: str(o.windows), styles: strs(o.styles) };
}

function serveFile(req: IncomingMessage, res: ServerResponse, path: string): void {
  const size = statSync(path).size;
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/octet-stream");
  const range = req.headers.range;
  let start = 0;
  let end = size - 1;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === "" && m[2] === "")) {
      res.statusCode = 416;
      res.setHeader("content-range", `bytes */${size}`);
      res.end();
      return;
    }
    if (m[1] === "") start = Math.max(0, size - Number(m[2]));
    else {
      start = Number(m[1]);
      if (m[2] !== "") end = Math.min(end, Number(m[2]));
    }
    if (start >= size || start > end) {
      res.statusCode = size === 0 && start === 0 ? 200 : 416;
      res.setHeader("content-range", `bytes */${size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
  } else res.statusCode = 200;
  res.setHeader("content-length", String(end - start + 1));
  if (req.method === "HEAD" || end < start) {
    res.end();
    return;
  }
  const stream = createReadStream(path, { start, end });
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

/** A connect-style middleware (Vite's dev and preview servers, the browser tests' server). */
export function localApi(o: LocalApiOptions = {}) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(API_PREFIX)) {
      next();
      return;
    }
    // Only this computer: a loopback peer, and a Host header naming localhost (DNS rebinding cannot fake that).
    if (!isLoopback(req.socket.remoteAddress) || !LOCAL_HOST.test(req.headers.host ?? "")) {
      send(res, 403, { error: "the local API answers only on localhost" });
      return;
    }
    const what = url.pathname.slice(API_PREFIX.length);
    void (async () => {
      try {
        if (what === "state" && req.method === "GET") {
          send(res, 200, await localState(o));
        } else if (what === "windows" && req.method === "GET") {
          send(res, 200, { windows: windowList(o) });
        } else if (what === "settings" && req.method === "PUT") {
          // JSON only, and from this origin: a page elsewhere cannot send it without a CORS preflight, which fails.
          const origin = req.headers.origin;
          if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "") || (origin !== undefined && originHost(origin) !== req.headers.host)) {
            send(res, 403, { error: "settings are changed only by the editor itself" });
            return;
          }
          const next_ = toIniSettings(JSON.parse(await readBody(req)));
          const errors = await checkSettings(next_, o.base);
          if (Object.keys(errors).length) {
            send(res, 200, { saved: false, error: Object.values(errors).join("; "), errors });
            return;
          }
          saveSettings(next_, o);
          send(res, 200, { saved: true, state: await localState(o) });
        } else if (what === "file" && (req.method === "GET" || req.method === "HEAD")) {
          const root = rootPath(currentRoots(o), url.searchParams.get("root") ?? "");
          const p = root ? confine(root, url.searchParams.get("path") ?? "") : null;
          if (!p) {
            send(res, 404, { error: "no such file in the configured folders" });
            return;
          }
          serveFile(req, res, p);
        } else send(res, 404, { error: `unknown request ${req.method} ${url.pathname}` });
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  };
}

export { isGameDir };
