/** Opens the game, haks and override folders on disk as the core's resources, the way the browser does. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TextModel } from "../core/font/font.js";
import { type Resources, openResourceSet } from "../core/session.js";
import { type FallbackSkin, isFallbackSkinFile } from "../core/skin/fallback.js";
import { themeOf } from "../core/skin/themes.js";
import { NodeFileSource, NodeTree, folderSources, nodeBitmapDecoder, nodeCanvas } from "./fs.js";
import { isGameDir, notGameReason } from "./detect.js";
import { readHakOrderFile } from "./hakorder.js";
import { loadSettings } from "./settings.js";

export { isGameDir };

export interface NodeResourceOptions {
  /** An NWN:EE install (with data/nwn_base.key). Without one, the fallback skin is used. */
  game?: string | null;
  /** Hak files, best first (module.ifo order). */
  haks?: string[];
  /** Folders of loose files, searched after the haks and before the game (nui-preview's fallback dirs). */
  overrides?: string[];
  textModel?: TextModel;
  /** Ignore the game's skin and fonts: the built-in skin. */
  fallback?: boolean;
  /** Which built-in skin (assets/skin/<theme>, a themes.ts id): "ink" (the default), "bronze", "brass", "verdigris", "oxblood". */
  theme?: string;
}

export type { Resources };

/** A built-in skin's files, from assets/skin/<theme>. */
export function nodeFallbackSkin(theme?: string): FallbackSkin {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "skin", themeOf(theme).id);
  const out: FallbackSkin = {};
  for (const f of readdirSync(dir)) if (isFallbackSkinFile(f)) out[f] = new Uint8Array(readFileSync(join(dir, f)));
  return out;
}


/**
 * The game for the command line: $NWN_ROOT, else `game` in nui-designer.ini (settings.ts), if it is an install with
 * real data. The CLIs do not search the usual install folders (the editor's dialog does): a test or a golden run uses
 * only a game it was given.
 */
export function findGame(): string | null {
  const p = loadSettings().game;
  return p && isGameDir(p) ? p : null;
}

/** Why findGame() found nothing, for messages. */
export function noGameReason(): string {
  const s = loadSettings();
  if (!s.game) return `NWN_ROOT is not set and ${s.iniExists ? s.iniPath : "nui-designer.ini"} names no game`;
  const why = notGameReason(s.game) ?? "?";
  return s.gameFrom === "env" ? `NWN_ROOT=${why}` : `game in ${s.iniPath}: ${why}`;
}

/**
 * The module's haks in hak-list order (the first wins), from a hak folder and the module's hak order: a nasher
 * module.ifo.json, a binary module.ifo or a .mod (told apart by content).
 */
export async function moduleHakPaths(hakDir: string, moduleIfo: string): Promise<{ haks: string[]; missing: string[] }> {
  return hakPaths(hakDir, (await readHakOrderFile(moduleIfo)).haks);
}

/** Hak files by name (resrefs, best first) in a hak folder; the file name's case does not matter. */
export function hakPaths(hakDir: string, names: string[]): { haks: string[]; missing: string[] } {
  const files = new Map<string, string>();
  try {
    for (const f of readdirSync(hakDir)) if (/\.hak$/i.test(f)) files.set(f.slice(0, -4).toLowerCase(), join(hakDir, f));
  } catch {
    /* no folder: every hak is missing */
  }
  const haks: string[] = [];
  const missing: string[] = [];
  for (const h of names) {
    const p = files.get(h.toLowerCase());
    if (p) haks.push(p);
    else missing.push(h);
  }
  return { haks, missing };
}

/**
 * The haks and override folders nui-designer.ini (with NWN_HAK_DIR and NWN_MODULE_IFO) names, for the CLIs: the hak
 * folder's haks in the order of moduleIfo (default: the settings' module_ifo), else the settings' haks list. No hak
 * folder or no order: no haks.
 */
export async function settingsResources(moduleIfo?: string | null): Promise<{ haks: string[]; missing: string[]; hakDir: string | null; order: string | null; overrides: string[] }> {
  const s = loadSettings();
  const ifo = moduleIfo ?? s.moduleIfo;
  const base = { hakDir: s.hakDir, overrides: s.overrides };
  if (!s.hakDir) return { ...base, haks: [], missing: [], order: null };
  if (ifo && existsSync(ifo)) return { ...base, ...(await moduleHakPaths(s.hakDir, ifo)), order: ifo };
  if (s.haks.length) return { ...base, ...hakPaths(s.hakDir, s.haks), order: `haks in ${s.iniPath}` };
  return { ...base, haks: [], missing: [], order: null };
}

export async function openResources(o: NodeResourceOptions): Promise<Resources> {
  const overrides = (o.overrides ?? []).flatMap((d) => folderSources(d));
  return openResourceSet({
    game: o.game ? new NodeTree(o.game) : null,
    haks: (o.haks ?? []).map((h) => new NodeFileSource(h)),
    overrides,
    overridesLabel: (o.overrides ?? []).join(", "),
    forceFallback: o.fallback,
    fallbackSkin: async () => nodeFallbackSkin(o.theme),
    fallbackLabel: `built-in skin: ${themeOf(o.theme).title}`,
    makeCanvas: nodeCanvas,
    decodeBitmap: nodeBitmapDecoder,
    textModel: o.textModel,
  });
}

/** The resource options the CLIs share (pnpm render, pnpm check). */
export interface CliResourceOptions {
  game?: string;
  hak?: string[];
  hakDir?: string;
  moduleIfo?: string;
  override?: string[];
  fallback?: boolean;
  theme?: string;
  textModel?: TextModel;
}

/** What a CLI ended up using, for its messages. */
export interface CliResourcesUsed {
  /** The game folder, or null (the built-in skin draws). */
  game: string | null;
  /** Why there is no game, when there is none and --fallback was not given. */
  noGame: string | null;
  haks: string[];
  /** Where the haks came from: "--hak", "DIR in the order of FILE", or null for none. */
  haksFrom: string | null;
  /** Haks the hak order lists that the hak folder (hakDir) lacks. */
  missing: string[];
  hakDir: string | null;
  overrides: string[];
}

/**
 * Opens the resources a CLI was given: --game, else $NWN_ROOT, else the ini's game; --hak files, or --hak-dir with
 * --module-ifo, else the haks and override folders nui-designer.ini (with NWN_HAK_DIR, NWN_MODULE_IFO) names; --override
 * folders. canRead is called on each hak first (to stop with a usage error on one that cannot be read).
 */
export async function cliResources(o: CliResourceOptions, canRead: (file: string) => void = () => {}): Promise<{ res: Resources; used: CliResourcesUsed }> {
  const haks = [...(o.hak ?? [])];
  let haksFrom: string | null = haks.length ? "--hak" : null;
  const missing: string[] = [];
  let hakDir: string | null = null;
  let overrides = o.override ?? [];
  if (!haks.length && !o.hakDir) {
    const s = await settingsResources();
    haks.push(...s.haks);
    missing.push(...s.missing);
    hakDir = s.hakDir;
    if (s.hakDir && s.order) haksFrom = `${s.hakDir} in the order of ${s.order}`;
    if (!o.override) overrides = s.overrides;
  }
  if (o.hakDir && o.moduleIfo) {
    const m = await moduleHakPaths(o.hakDir, o.moduleIfo);
    haks.push(...m.haks);
    missing.push(...m.missing);
    hakDir = o.hakDir;
    haksFrom = `${o.hakDir} in the order of ${o.moduleIfo}`;
  }
  for (const h of haks) canRead(h);
  const game = o.fallback ? null : (o.game ?? findGame());
  const noGame = !o.fallback && !game ? noGameReason() : null;
  const res = await openResources({ game, haks, overrides, textModel: o.textModel, fallback: o.fallback, theme: o.theme });
  return { res, used: { game, noGame, haks, haksFrom: haks.length ? haksFrom : null, missing, hakDir, overrides } };
}
