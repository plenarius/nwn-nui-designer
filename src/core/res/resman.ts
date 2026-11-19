/**
 * A small read-only resource manager, in the client's order of precedence: the module's haks (the first listed
 * wins), loose override files, then the game's ovr/ folder, its texture packs and its KEY/BIF archives. A port of
 * nui-preview's resman.py ResMan.
 */
import { type Container, Erf, Folder, Key } from "./containers.js";
import { resType } from "./restype.js";
import type { ByteSource } from "./source.js";
import { errorText } from "../errors.js";

/** A game install as a tree of files (a folder picked in the browser, a path in Node). Paths are relative to the
 * install's root, "/"-separated; lookups ignore case. */
export interface FileTree {
  readonly label: string;
  file(relPath: string): ByteSource | null;
  /** The files directly in a folder ("" for the root). */
  list(relDir: string): ByteSource[];
}

export type LayerKind = "hak" | "override" | "game-ovr" | "texture-pack" | "key" | "memory";

export interface Layer {
  kind: LayerKind;
  container: Container;
}

/** The texture packs the client reads GUI textures from, best first (nui-preview's list). */
export const TEXTURE_PACKS = ["GUI_32bit.erf", "xp2_gui.erf", "XP1_GUI.erf", "Textures_Tpa.erf"];
export const KEYS = ["nwn_base.key", "nwn_retail.key"];

export class ResMan {
  /** Searched in order: the first that has a resource gives it. */
  layers: Layer[] = [];

  /** The layers of a game install: ovr/, the texture packs, the keys. Missing parts are skipped. */
  static async gameLayers(tree: FileTree): Promise<{ layers: Layer[]; warnings: string[] }> {
    const layers: Layer[] = [];
    const warnings: string[] = [];
    layers.push({ kind: "game-ovr", container: new Folder("ovr/", tree.list("ovr")) });
    for (const name of TEXTURE_PACKS) {
      const f = tree.file(`data/txpk/${name}`);
      if (!f) continue;
      try {
        layers.push({ kind: "texture-pack", container: await Erf.open(f, `data/txpk/${name}`) });
      } catch (e) {
        warnings.push(errorText(e));
      }
    }
    for (const name of KEYS) {
      const f = tree.file(`data/${name}`);
      if (!f) {
        if (name === "nwn_base.key") warnings.push(`no data/${name}: is this an NWN:EE install?`);
        continue;
      }
      try {
        const key = await Key.open(f, (p) => tree.file(p), `data/${name}`);
        const missing = key.bifs().filter((b) => !b.found);
        if (missing.length) {
          warnings.push(`data/${name}: ${missing.length} BIF file(s) not found (${missing.slice(0, 3).map((b) => b.name).join(", ")}...)`);
        }
        layers.push({ kind: "key", container: key });
      } catch (e) {
        warnings.push(errorText(e));
      }
    }
    return { layers, warnings };
  }

  async get(resref: string, ext: string): Promise<Uint8Array | null> {
    const type = resType(ext);
    if (type === undefined) return null;
    const name = resref.toLowerCase();
    for (const l of this.layers) {
      if (!l.container.has(name, type)) continue;
      const d = await l.container.get(name, type);
      if (d) return d;
    }
    return null;
  }

  /** The layer that has resref of type ext, if any. */
  where(resref: string, ext: string): Layer | null {
    const type = resType(ext);
    if (type === undefined) return null;
    const name = resref.toLowerCase();
    return this.layers.find((l) => l.container.has(name, type)) ?? null;
  }

  has(resref: string, ext: string): boolean {
    return this.where(resref, ext) !== null;
  }

  /** The first layer's resource of any of the types exts (nui-preview's get_any: a hak's DDS beats the game's TGA). */
  async getAny(resref: string, exts: readonly string[]): Promise<[Uint8Array, string] | null> {
    const name = resref.toLowerCase();
    for (const l of this.layers) {
      for (const ext of exts) {
        const type = resType(ext);
        if (type === undefined) continue;
        if (!l.container.has(name, type)) continue;
        const d = await l.container.get(name, type);
        if (d) return [d, ext];
      }
    }
    return null;
  }
}
