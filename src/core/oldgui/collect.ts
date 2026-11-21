/**
 * Collects every resource of the original GUI from the user's own game and haks: every GUI model, every `.gui`
 * layout, the names the client has built in, and every texture any of them, or a `.txi`, names. Reads through a
 * ResMan, so a hak's model or texture beats the game's, as in the client.
 */
import { Key } from "../res/containers.js";
import type { ResMan } from "../res/resman.js";
import { TYPE_EXT } from "../res/restype.js";
import { errorText } from "../errors.js";
import { type UvEntry, uvEntries } from "./cells.js";
import { type GuiLayout, layoutRefs, readGuiLayout } from "./guilayout.js";
import { type Mdl, modelTextures, readMdl } from "./mdl.js";
import { type Txi, readTxi } from "./txi.js";

/** The archives that hold the stock GUI. */
export const GUI_BIFS = ["aurora_gui.bif", "bd_ui.bif"];
/** Model names of the GUI's panels and controls wherever they are kept. */
export const GUI_MODEL_PREFIX =
  /^(ctl_|pnl_|edit_|gui_|qb_|pb_|ct_|credit_|scrollbar|dth_|cg_|dm_|inv_|jnl_|map_|opt_|pre_|srv_|util_|fnt_|load|chat|rad|btn_|er_|but_|csrv_|plmod_|pmod_)/;
/** Texture types, in the order the client prefers them. */
export const TEXTURE_TYPES = ["dds", "tga", "plt", "ktx"];

export interface TextureInfo {
  name: string;
  /** The format found first ("dds", "tga", ...), or "" when the game and haks have no such texture. */
  format: string;
  /** Where it is read from: a hak's or archive's label. */
  source: string;
  width: number;
  height: number;
  txi: Txi | null;
  models: Set<string>;
  layouts: Set<string>;
  /** Other textures whose txi names this one. */
  txiFrom: Set<string>;
  /** The client names it in its code. */
  client: boolean;
  /** It sits in one of the GUI archives. */
  guiArchive: boolean;
}

export interface ModelInfo {
  name: string;
  source: string;
  textures: string[];
  anims: string[];
  error?: string;
}

export interface Collection {
  models: Map<string, ModelInfo>;
  layouts: Map<string, { name: string; source: string; models: string[]; fonts: string[]; layout: GuiLayout }>;
  textures: Map<string, TextureInfo>;
  /** Every UV rectangle the models sample, by texture. */
  uv: Map<string, UvEntry[]>;
  /** The parsed models, for previews. */
  parsed: Map<string, Mdl>;
  /** Models a layout or the client names that no archive has. */
  missingModels: string[];
  warnings: string[];
}

export interface CollectOptions {
  /** The client's built-in strings (lower case), e.g. from the game executable. */
  clientStrings?: Iterable<string>;
  /** Name families the client builds with a number ("ctl_inv_sto_tab%d"), as format strings. */
  clientFormats?: Iterable<string>;
  progress?: (msg: string) => void;
}

/** A format string the client builds names with ("gui_icon_%dx%d%s") as a regular expression over lower-case names. */
export function formatPattern(fmt: string): RegExp | null {
  const f = fmt.toLowerCase();
  const lead = /^[a-z0-9_]+/.exec(f)?.[0] ?? "";
  if (lead.length < 3 || !f.includes("%")) return null;
  let src = "";
  for (let i = 0; i < f.length; i++) {
    const c = f[i]!;
    if (c !== "%") {
      if (!/[a-z0-9_]/.test(c)) return null;
      src += c;
      continue;
    }
    const m = /^%(0?\d)?([dsuix])/.exec(f.slice(i));
    if (!m) return null;
    src += m[2] === "s" ? "[a-z]{0,3}" : m[1] ? `\\d{${Number(m[1])}}` : "\\d+";
    i += m[0].length - 1;
  }
  return new RegExp(`^${src}$`);
}

/** The strings worth keeping from an executable: printable runs that could be resource names, and name formats. */
export function clientNames(bin: Uint8Array): { names: Set<string>; formats: Set<string> } {
  const names = new Set<string>();
  const formats = new Set<string>();
  let s = "";
  const flush = () => {
    if (s.length >= 3) {
      const l = s.toLowerCase();
      if (/^[a-z0-9_]{3,16}$/.test(l)) names.add(l);
      else if (l.includes("%")) {
        // a format may follow other characters ("#?gui_icon_%dx%dr")
        for (const m of l.matchAll(/[a-z0-9_]*%[a-z0-9_%]*/g)) if (m[0].length <= 24 && formatPattern(m[0])) formats.add(m[0]);
      }
    }
    s = "";
  };
  for (let i = 0; i < bin.length; i++) {
    const c = bin[i]!;
    if (c >= 0x20 && c < 0x7f) {
      s += String.fromCharCode(c);
      if (s.length > 64) s = s.slice(-64);
    } else flush();
  }
  flush();
  return { names, formats };
}

/** Collects the original GUI's resources through resman. */
export async function collectOldGui(resman: ResMan, o: CollectOptions = {}): Promise<Collection> {
  const warnings: string[] = [];
  // every resource: name -> ext -> source label (first layer wins), and which sit in a GUI archive
  const index = new Map<string, Map<string, string>>();
  const guiArchive = new Set<string>();
  // "name.ext" the game itself has (not a hak or an override folder): the client's built-in names and the GUI's
  // model names are the game's; a hak's resource under such a name counts only where it replaces the game's
  const inGame = new Set<string>();
  for (const layer of resman.layers) {
    const c = layer.container;
    const game = layer.kind === "key" || layer.kind === "texture-pack" || layer.kind === "game-ovr";
    for (const [name, type] of c.entries()) {
      const ext = TYPE_EXT[type];
      if (!ext) continue;
      if (game) inGame.add(`${name}.${ext}`);
      let m = index.get(name);
      if (!m) index.set(name, (m = new Map()));
      if (!m.has(ext)) m.set(ext, c.label);
      if (c instanceof Key) {
        const bif = c.bifOf(name, type)?.split("/").pop()?.toLowerCase();
        if (bif && GUI_BIFS.includes(bif)) guiArchive.add(`${name}.${ext}`);
      }
    }
  }
  const has = (n: string, ext: string) => index.get(n)?.has(ext) ?? false;
  const textureFormat = (n: string) => TEXTURE_TYPES.find((e) => has(n, e)) ?? "";
  const gameTexture = (n: string) => TEXTURE_TYPES.some((e) => inGame.has(`${n}.${e}`));

  const client = new Set(o.clientStrings ?? []);
  const patterns = [...(o.clientFormats ?? [])].map(formatPattern).filter((p): p is RegExp => p !== null);
  if (patterns.length) {
    for (const n of index.keys()) {
      if ((inGame.has(`${n}.mdl`) || gameTexture(n)) && patterns.some((p) => p.test(n))) client.add(n);
    }
  }

  // layouts
  const layouts: Collection["layouts"] = new Map();
  const guiNames = [...index].filter(([, e]) => e.has("gui")).map(([n]) => n).sort();
  o.progress?.(`${guiNames.length} layouts`);
  for (const n of guiNames) {
    const bytes = await resman.get(n, "gui");
    if (!bytes) continue;
    try {
      const l = readGuiLayout(n, bytes);
      layouts.set(n, { name: n, source: index.get(n)!.get("gui")!, ...layoutRefs(l), layout: l });
    } catch (e) {
      warnings.push(`${n}.gui: ${errorText(e)}`);
    }
  }

  // models: every GUI model (by its name or archive), and every model a layout places (the client also names
  // creature, item and sky models: not GUI)
  const wanted = new Set<string>();
  for (const n of index.keys()) {
    if (!inGame.has(`${n}.mdl`)) continue;
    if (GUI_MODEL_PREFIX.test(n) || guiArchive.has(`${n}.mdl`)) wanted.add(n);
  }
  const missingModels = new Set<string>();
  for (const l of layouts.values()) {
    for (const m of l.models) {
      if (has(m, "mdl")) wanted.add(m);
      else missingModels.add(m);
    }
  }
  const models: Collection["models"] = new Map();
  const parsed = new Map<string, Mdl>();
  const uv = new Map<string, UvEntry[]>();
  o.progress?.(`${wanted.size} models`);
  for (const n of [...wanted].sort()) {
    const source = index.get(n)!.get("mdl")!;
    const bytes = await resman.get(n, "mdl");
    if (!bytes) continue;
    try {
      const m = readMdl(bytes);
      m.name = n;
      parsed.set(n, m);
      models.set(n, { name: n, source, textures: modelTextures(m), anims: [...m.anims.keys()].sort() });
      for (const [t, es] of uvEntries(m)) {
        const l = uv.get(t);
        if (l) l.push(...es);
        else uv.set(t, es);
      }
    } catch (e) {
      models.set(n, { name: n, source, textures: [], anims: [], error: errorText(e) });
    }
  }

  // textures
  const textures: Collection["textures"] = new Map();
  const entry = (n: string): TextureInfo => {
    let t = textures.get(n);
    if (!t) {
      const format = textureFormat(n);
      t = {
        name: n,
        format,
        source: format ? index.get(n)!.get(format)! : "",
        width: 0,
        height: 0,
        txi: null,
        models: new Set(),
        layouts: new Set(),
        txiFrom: new Set(),
        client: client.has(n),
        guiArchive: TEXTURE_TYPES.some((e) => guiArchive.has(`${n}.${e}`)),
      };
      textures.set(n, t);
    }
    return t;
  };
  for (const m of models.values()) for (const t of m.textures) entry(t).models.add(m.name);
  for (const l of layouts.values()) {
    for (const f of l.fonts) if (textureFormat(f)) entry(f).layouts.add(l.name);
    for (const [, v] of l.layout.strings) {
      const s = v.toLowerCase();
      if (/^[a-z0-9_]{1,16}$/.test(s) && textureFormat(s)) entry(s).layouts.add(l.name);
    }
  }
  for (const [n, exts] of index) if (TEXTURE_TYPES.some((e) => exts.has(e) && guiArchive.has(`${n}.${e}`))) entry(n);
  for (const c of client) if (gameTexture(c)) entry(c);

  // txi links, followed until nothing new turns up
  const seen = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    // (a Map visits entries added while it is being walked)
    for (const t of textures.values()) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      if (!has(t.name, "txi")) continue;
      const bytes = await resman.get(t.name, "txi");
      if (!bytes) continue;
      t.txi = readTxi(new TextDecoder("latin1").decode(bytes));
      for (const ref of t.txi.refs) {
        entry(ref).txiFrom.add(t.name);
        changed = true;
      }
    }
  }

  // sizes
  o.progress?.(`${textures.size} textures`);
  for (const t of textures.values()) {
    if (!t.format || t.format === "ktx") continue;
    const bytes = await resman.get(t.name, t.format);
    const s = bytes ? textureSize(bytes, t.format) : null;
    if (s) [t.width, t.height] = s;
  }
  return { models, layouts, textures, uv, parsed, missingModels: [...missingModels].sort(), warnings };
}

/** A texture's size from its header: BioWare or standard DDS, TGA, PLT. */
export function textureSize(b: Uint8Array, format: string): [number, number] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (format === "dds") {
    if (b.length >= 20 && b[0] === 0x44 && b[1] === 0x44 && b[2] === 0x53 && b[3] === 0x20) return b.length >= 20 ? [dv.getUint32(16, true), dv.getUint32(12, true)] : null;
    return b.length >= 8 ? [dv.getUint32(0, true), dv.getUint32(4, true)] : null;
  }
  if (format === "tga") return b.length >= 18 ? [dv.getUint16(12, true), dv.getUint16(14, true)] : null;
  if (format === "plt") return b.length >= 24 ? [dv.getUint32(16, true), dv.getUint32(20, true)] : null;
  return null;
}
