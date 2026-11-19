/**
 * Finds NWN:EE installs in the places Steam, GOG and the Beamdog client put them, on Linux, Windows and macOS, and the
 * player's own hak folder. Every candidate is checked with isGameDir, so a folder only counts when it has the game's
 * data. Everything it reads comes from DetectOptions, so the tests can point it at fake installs in a temporary folder.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export type Store = "Steam" | "GOG" | "Beamdog";

export interface Install {
  path: string;
  store: Store;
}

export interface DetectOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Reads a value from the Windows registry ("HKCU\\Software\\Valve\\Steam", "SteamPath"), as text, or null. Default:
   * `reg query` on Windows, nothing elsewhere (so a test that pretends to be on Windows never asks the real one).
   */
  registry?: (key: string, value: string) => string | null;
}

/** A registry value through `reg query` (Windows only; null on any failure). */
export function regQuery(key: string, value: string): string | null {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync("reg", ["query", key, "/v", value], { encoding: "utf8", timeout: 3000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    return parseRegQuery(out, value);
  } catch {
    return null;
  }
}

/** The data of value in `reg query` output ("    Personal    REG_EXPAND_SZ    %USERPROFILE%\\Documents"). */
export function parseRegQuery(out: string, value: string): string | null {
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s+(.+?)\s{4}(REG_[A-Z_]+)\s{4}(.*)$/.exec(line);
    if (m && m[1]!.toLowerCase() === value.toLowerCase() && m[2]!.endsWith("_SZ")) return m[3]!.trim() || null;
  }
  return null;
}

/** %NAME% expanded from env, ignoring the name's case as Windows does; an unknown name is left as it is. */
export function expandWindowsEnv(s: string, env: NodeJS.ProcessEnv): string {
  return s.replace(/%([^%]+)%/g, (all, name: string) => {
    const k = Object.keys(env).find((e) => e.toLowerCase() === name.toLowerCase());
    return k && env[k] ? env[k]! : all;
  });
}

/** A Windows path as Windows writes it: Steam keeps "c:/program files (x86)/steam". */
const winPath = (p: string) => p.replace(/\//g, "\\");

/** Whether two paths name the same folder on this platform's usual file system (case-insensitive on Windows and macOS). */
const samePath = (platform: NodeJS.Platform, a: string, b: string) => (platform === "win32" || platform === "darwin" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** The default registry reader for o: the real one only when o does not pretend to be another system. */
const registryOf = (o: DetectOptions, platform: NodeJS.Platform) => o.registry ?? (platform === process.platform ? regQuery : () => null);

const GAME = "Neverwinter Nights";
const GOG_NAME = "Neverwinter Nights Enhanced Edition";

/** The real path of p (links followed; on Windows and macOS the disk's case), or p when it cannot be resolved. */
export function realPath(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

/** Whether dir is an NWN:EE install with real data (a KEY, and BIFs that are not empty placeholders). */
export function isGameDir(dir: string): boolean {
  try {
    const bif = join(dir, "data", "ovr.bif");
    return existsSync(join(dir, "data", "nwn_base.key")) && existsSync(bif) && statSync(bif).size > 0;
  } catch {
    return false;
  }
}

/** Why dir is not a game, for messages (null when it is one). */
export function notGameReason(dir: string): string | null {
  if (isGameDir(dir)) return null;
  if (!isDir(dir)) return `${dir}: no such folder`;
  if (!existsSync(join(dir, "data", "nwn_base.key"))) return `${dir}: not an NWN:EE install (no data/nwn_base.key; pick the folder that holds data/ and ovr/)`;
  return `${dir}: the install has no data (data/ovr.bif is missing or empty)`;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const subdirs = (p: string): string[] => {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(p, e.name))
      .sort();
  } catch {
    return [];
  }
};

/**
 * The game folder in or under dir: dir itself, GOG's `game/` subfolder (Linux), or inside a macOS app bundle
 * (`X.app/Contents/Resources/game` or `.../Resources`). Null when none has the data.
 */
export function gameIn(dir: string): string | null {
  for (const p of [dir, join(dir, "game"), join(dir, "Contents", "Resources", "game"), join(dir, "Contents", "Resources")]) {
    if (isGameDir(p)) return p;
  }
  return null;
}

/** The library folders a Steam install lists in steamapps/libraryfolders.vdf ("path" entries), itself included. */
export function steamLibraries(steamRoot: string): string[] {
  const out = [steamRoot];
  for (const f of [join(steamRoot, "steamapps", "libraryfolders.vdf"), join(steamRoot, "config", "libraryfolders.vdf")]) {
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    // Both the old format ("1" "D:\\Games") and the new one ("path" "D:\\Games") quote the folder after a key.
    for (const m of text.matchAll(/^\s*"(?:path|\d+)"\s+"([^"]+)"/gm)) {
      const p = m[1]!.replace(/\\\\/g, "\\");
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

/** Steam's own folders on each system (on Windows, also where the registry says Steam is). */
function steamRoots(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv, registry: DetectOptions["registry"] & {}): string[] {
  if (platform === "win32") {
    const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const pf = env.ProgramFiles || "C:\\Program Files";
    const reg = [registry("HKCU\\Software\\Valve\\Steam", "SteamPath"), registry("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"), registry("HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath")];
    return [...reg.filter((p): p is string => !!p).map(winPath), join(pf86, "Steam"), join(pf, "Steam")];
  }
  if (platform === "darwin") return [join(home, "Library", "Application Support", "Steam")];
  return [
    join(home, ".steam", "steam"),
    join(home, ".steam", "root"),
    join(home, ".local", "share", "Steam"),
    join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
    join(home, "snap", "steam", "common", ".local", "share", "Steam"),
  ];
}

/** Folders that may hold a GOG install (the game's own folder, or a folder of games). */
function gogDirs(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") {
    const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    return [join("C:\\GOG Games", GOG_NAME), join(pf86, "GOG Galaxy", "Games", GOG_NAME), join(pf86, "GOG Games", GOG_NAME)];
  }
  if (platform === "darwin") return [join("/Applications", `${GOG_NAME}.app`), join(home, "Applications", `${GOG_NAME}.app`), join("/Applications", GOG_NAME)];
  return [join(home, "GOG Games", GOG_NAME), join(home, "Games", GOG_NAME), join(home, "Games", "gog", GOG_NAME.toLowerCase().replace(/ /g, "-"))];
}

/** An XDG base folder: the spec ignores an empty or relative value (and so must we: it would be relative to the cwd). */
const xdg = (v: string | undefined) => (v && isAbsolute(v) ? v : undefined);

/** The Beamdog client's folders of games (one numbered subfolder per game: 00829 is NWN:EE, 00840 its preview). */
function beamdogDirs(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") return [join(env.APPDATA || join(home, "AppData", "Roaming"), "Beamdog Client")];
  if (platform === "darwin") return [join(home, "Library", "Application Support", "Beamdog Client")];
  return [join(xdg(env.XDG_CONFIG_HOME) ?? join(home, ".config"), "Beamdog Client"), join(home, ".local", "share", "Beamdog Client")];
}

/** Every NWN:EE install found, in the order Steam, GOG, Beamdog; each folder once. */
export function detectInstalls(o: DetectOptions = {}): Install[] {
  const platform = o.platform ?? process.platform;
  const home = o.home ?? homedir();
  const env = o.env ?? process.env;
  const out: Install[] = [];
  // Steam on Linux reaches one install through several links (~/.steam/steam, ~/.steam/root, ~/.local/share/Steam),
  // and on Windows through the registry's lower-case path and Program Files: each install is listed once, under its
  // real path (the native realpath: the disk's case on Windows and macOS, a long name for an 8.3 one).
  const add = (p: string | null, store: Store) => {
    if (!p) return;
    const r = realPath(p);
    if (!out.some((i) => samePath(platform, i.path, r))) out.push({ path: r, store });
  };
  for (const root of steamRoots(platform, home, env, registryOf(o, platform))) {
    if (!isDir(root)) continue;
    for (const lib of steamLibraries(root)) add(gameIn(join(lib, "steamapps", "common", GAME)), "Steam");
  }
  for (const d of gogDirs(platform, home, env)) add(gameIn(d), "GOG");
  for (const d of beamdogDirs(platform, home, env)) {
    for (const sub of subdirs(d)) add(gameIn(sub), "Beamdog");
  }
  return out;
}

/**
 * The Windows Documents folder candidates, best first: where the registry's User Shell Folders says it is (a
 * Documents folder moved to OneDrive, another drive or a network share; Windows writes the move there), OneDrive's
 * Documents (%OneDrive%, else ~/OneDrive), then ~/Documents.
 */
export function windowsDocuments(home: string, env: NodeJS.ProcessEnv, registry: DetectOptions["registry"] & {}): string[] {
  const out: string[] = [];
  const reg =
    registry("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "Personal") ??
    registry("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders", "Personal");
  if (reg) out.push(winPath(expandWindowsEnv(reg, { USERPROFILE: home, ...env })));
  for (const od of [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial, join(home, "OneDrive")]) if (od) out.push(join(od, "Documents"));
  out.push(join(home, "Documents"));
  return out.filter((p, i) => out.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
}

/**
 * The player's own NWN folder ("user folder"), where the game keeps haks, override files and saves:
 * ~/.local/share/Neverwinter Nights on Linux, Documents/Neverwinter Nights on Windows (wherever Documents is:
 * windowsDocuments) and macOS. NWN_HOME (the game's own variable for it) wins.
 */
export function userFolders(o: DetectOptions = {}): string[] {
  const platform = o.platform ?? process.platform;
  const home = o.home ?? homedir();
  const env = o.env ?? process.env;
  const out: string[] = [];
  if (env.NWN_HOME) out.push(env.NWN_HOME);
  if (platform === "win32") {
    out.push(...windowsDocuments(home, env, registryOf(o, platform)).map((d) => join(d, GAME)));
  } else if (platform === "darwin") {
    out.push(join(home, "Documents", GAME));
  } else {
    out.push(join(xdg(env.XDG_DATA_HOME) ?? join(home, ".local", "share"), GAME));
  }
  return out;
}

/** The user folder's hak/ folder, if there is one. */
export function detectHakDir(o: DetectOptions = {}): string | null {
  for (const u of userFolders(o)) {
    const h = join(u, "hak");
    if (isDir(h)) return h;
  }
  return null;
}

