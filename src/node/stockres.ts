/**
 * What `pnpm reskin` and `pnpm export-theme` share: the stock textures' resources (the game, and the haks and override
 * folders the settings name), and the rule that their output, derived from the game's art, stays out of the repository.
 */
import { basename, isAbsolute, relative, resolve } from "node:path";
import { ResMan } from "../core/res/resman.js";
import { REPO_ROOT } from "./settings.js";
import { findGame, isGameDir, noGameReason, openResources, settingsResources } from "./setup.js";

/** A command-line mistake: one line, exit code 2. */
export class UsageError extends Error {}

/** Refuses an output folder inside the repository, except the ignored local/ (no game-derived file may be committed). */
export function checkOutDir(dir: string): void {
  const rel = relative(REPO_ROOT, resolve(dir));
  const inside = !rel.startsWith("..") && !isAbsolute(rel);
  if (inside && !/^(local|\.out|\.scratch)([\\/]|$)/.test(rel)) {
    throw new UsageError(`${dir}: inside the repository. The output is derived from your game's art and must never be committed: write it elsewhere (or under local/).`);
  }
}

export interface StockOptions {
  /** --game (else $NWN_ROOT, else nui-designer.ini's game). */
  game?: string;
  /** --hak, --override: instead of the settings' haks and folders. */
  haks?: string[];
  overrides?: string[];
  /** --no-haks: the game alone. */
  noHaks?: boolean;
  /** Hak names (without .hak) being written: never read through them (they would be recoloured again). */
  writing?: string[];
}

export interface Stock {
  game: string;
  haks: string[];
  overrides: string[];
  resman: ResMan;
  /** Haks left out because they are the ones being written. */
  leftOut: string[];
}

/** The game, haks and folders the stock textures are read through (no memory layer: the fallback skin is not stock). */
export async function stockResources(o: StockOptions): Promise<Stock> {
  const game = o.game ?? findGame();
  if (!game) throw new UsageError(`no game (${noGameReason()}). The original GUI is redrawn from your own install's textures: set NWN_ROOT, set game in nui-designer.ini, or give --game DIR`);
  if (!isGameDir(game)) throw new UsageError(`${game}: not an NWN:EE install with data (no data/nwn_base.key, or empty BIFs)`);
  let haks = o.haks ?? [];
  let overrides = o.overrides ?? [];
  if (!o.noHaks && !o.haks && !o.overrides) {
    const s = await settingsResources();
    haks = s.haks;
    overrides = s.overrides;
  }
  if (o.noHaks) {
    haks = [];
    overrides = [];
  }
  const writing = new Set((o.writing ?? []).map((n) => `${n.toLowerCase()}.hak`));
  const leftOut = haks.filter((h) => writing.has(basename(h).toLowerCase()));
  haks = haks.filter((h) => !leftOut.includes(h));
  const r = await openResources({ game, haks, overrides });
  const resman = new ResMan();
  resman.layers = r.resman.layers.filter((l) => l.kind !== "memory");
  return { game, haks, overrides, resman, leftOut };
}
