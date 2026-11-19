/**
 * A small "game folder" for the browser tests: the resources that drawing some windows reads (the skin, its fonts and
 * textures, the windows' images), copied out of the real game and haks into <dir>/ovr/. The browser can be handed
 * that folder instead of gigabytes of BIFs. It holds Beamdog's and Layonara's files: it is made in a temporary folder
 * and deleted after the run, never committed.
 */
import { existsSync, writeFileSync } from "node:fs";
import { writeFakeInstall } from "./fakegame.js";
import { join } from "node:path";
import { ResMan } from "../src/core/res/resman.js";
import type { NuiDocument } from "../src/core/model/types.js";
import { renderView } from "../src/core/view.js";
import { nodeCanvas } from "../src/node/fs.js";
import { findGame, openResources, settingsResources } from "../src/node/setup.js";
import { findModuleIfo } from "../golden/reference.js";

const ROOT = join(import.meta.dirname, "..");

/** The haks of the local module (the hak folder of nui-designer.ini or $NWN_HAK_DIR, in the order of the
 * module.ifo.json findModuleIfo finds, else the ini's haks list) and the override folders (the ini's, else
 * local/res/layo-skin), as the golden check finds them. */
export async function localHaks(): Promise<{ haks: string[]; overrides: string[] }> {
  const { ifo } = findModuleIfo();
  const s = await settingsResources(ifo && existsSync(ifo) ? ifo : null);
  const skin = join(ROOT, "local/res/layo-skin");
  return { haks: s.haks, overrides: s.overrides.length ? s.overrides : existsSync(skin) ? [skin] : [] };
}

/** Writes the resources drawing docs needs into dir/ovr; returns dir, or null without a game. */
export async function makeMiniGame(docs: NuiDocument[], dir: string): Promise<string | null> {
  const game = findGame();
  if (!game) return null;
  const used = new Map<string, Uint8Array>();
  const get = ResMan.prototype.get;
  ResMan.prototype.get = async function (this: ResMan, resref: string, ext: string) {
    const d = await get.call(this, resref, ext);
    if (d) used.set(`${resref.toLowerCase()}.${ext}`, d);
    return d;
  };
  try {
    const { haks, overrides } = await localHaks();
    const res = await openResources({ game, haks, overrides });
    for (const d of docs) await renderView(d, res.skin, res.images, nodeCanvas, { crop: true });
  } finally {
    ResMan.prototype.get = get;
  }
  // An empty KEY and a stub BIF: the folder passes isGameDir, so nui-designer.ini can name it as the game.
  writeFakeInstall(dir);
  for (const [name, bytes] of used) writeFileSync(join(dir, "ovr", name), bytes);
  return dir;
}
