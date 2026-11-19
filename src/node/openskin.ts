/**
 * The open skin's files on disk, for the command line: the built-in skins (assets/skin/<theme>), a preset built as
 * `pnpm skin ship` builds it (its fonts from a built-in skin's folder or fetch.py's cache, checked against
 * tools/open-skin/sources.toml), and the skin a theme export starts from (a built-in skin, a preset or a project).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type FontSource, buildOpenSkin, styleFontKeys } from "../core/skin/gen/ship.js";
import { PRESETS, type Style } from "../core/skin/gen/style.js";
import { type SkinProject, fromOpenSkin, readSkinProject } from "../core/skin/project.js";
import { THEMES } from "../core/skin/themes.js";
import { parseToml } from "../core/skin/toml.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SKINS = join(ROOT, "assets", "skin");
export const themeDir = (id: string) => join(SKINS, id);
export const TOOLS = join(ROOT, "tools", "open-skin");

export function sources(): Record<string, FontSource> {
  const t = parseToml(readFileSync(join(TOOLS, "sources.toml"), "utf8"));
  return t.fonts as unknown as Record<string, FontSource>;
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** fetch.py's cache folder. */
const fontCache = () => process.env.NUI_SKIN_CACHE || join(homedir(), ".cache", "nwn-nui-designer", "open-skin");

/**
 * A font of the open skin: committed in whichever theme folder has it, else in fetch.py's cache (a preset's font that
 * no built-in skin ships yet). Returns the TTF and its licence text.
 */
function fontFiles(key: string, f: FontSource): [string, string] {
  for (const t of THEMES) {
    const d = themeDir(t.id);
    if (existsSync(join(d, `${f.resref}.ttf`))) return [join(d, `${f.resref}.ttf`), join(d, `OFL-${f.resref}.txt`)];
  }
  const d = join(fontCache(), "fonts", key);
  const ttf = join(d, basename(new URL(f.url).pathname));
  if (existsSync(ttf)) return [ttf, join(d, "OFL.txt")];
  throw new Error(`no ${f.resref}.ttf in ${SKINS}/*/ or ${d} (fetch it: tools/open-skin/fetch.py)`);
}

/** A built-in skin's files as `ship` makes them, with its fonts checked against sources.toml. */
export function shipFiles(style: Style): Record<string, Uint8Array> {
  const src = sources();
  const out = buildOpenSkin({ style, fonts: src, cc0: readFileSync(join(TOOLS, "CC0-1.0.txt"), "utf8") });
  for (const key of styleFontKeys(style)) {
    const f = src[key]!;
    const [ttf, ofl] = fontFiles(key, f);
    const bytes = new Uint8Array(readFileSync(ttf));
    if (sha256(bytes) !== f.sha256) throw new Error(`${ttf}: sha256 is not the one pinned in sources.toml`);
    out[`${f.resref}.ttf`] = bytes;
    out[`OFL-${f.resref}.txt`] = new Uint8Array(readFileSync(ofl));
  }
  return out;
}

/** A skin given on the command line could not be used: a one-line message. */
export class SkinChoiceError extends Error {}

export interface SkinChoice {
  id: string;
  title: string;
  from: string;
  style: Style;
  /** The skin's own files by lower-case file name (textures and fonts). */
  own: Record<string, Uint8Array>;
  /** The skin as a project (what the NUI skin export holds). */
  project(): SkinProject;
}

/** A built-in skin id (ink, bronze, ...), a generator preset key (a-bronze, d-iron, ...) or a skin project file. */
export function chooseSkin(arg: string): SkinChoice {
  const theme = THEMES.find((t) => t.id === arg);
  if (theme) {
    const files: Record<string, Uint8Array> = {};
    for (const f of readdirSync(themeDir(theme.id))) files[f] = new Uint8Array(readFileSync(join(themeDir(theme.id), f)));
    const own = Object.fromEntries(Object.entries(files).map(([n, d]) => [n.toLowerCase(), d]));
    return { id: theme.id, title: theme.title, from: `built-in skin ${theme.id}`, style: theme.style, own, project: () => fromOpenSkin(files, theme.style, theme.title, theme.hak) };
  }
  const preset = PRESETS.find((s) => s.key === arg);
  if (preset) {
    const title = preset.title.replace(/^[A-Z0-9]+: /, "");
    let files: Record<string, Uint8Array> | null = null;
    const get = () => (files ??= shipFiles(preset));
    return {
      id: preset.key,
      title,
      from: `generator preset ${preset.key}`,
      style: preset,
      own: {},
      project: () => {
        const p = fromOpenSkin(get(), preset, title, `nuid_${preset.key.replace(/-/g, "_")}`.slice(0, 16));
        return { ...p, origin: { kind: "builtin", label: `${title} (preset ${preset.key})` } };
      },
    };
  }
  if (/\.json$/i.test(arg)) {
    let text: string;
    try {
      text = readFileSync(arg, "utf8");
    } catch {
      throw new SkinChoiceError(`${arg}: cannot read it`);
    }
    const p = readSkinProject(text);
    if (!p.style) {
      throw new SkinChoiceError(
        `${arg}: this skin has no generator style, and the original GUI's palette is derived from one. Open it in the skin editor's generator (or start from a preset), then save the project again.`,
      );
    }
    const own: Record<string, Uint8Array> = {};
    for (const [n, f] of Object.entries(p.files)) own[n.toLowerCase()] = f.data;
    return { id: p.name, title: p.name, from: `skin project ${basename(arg)}`, style: p.style, own, project: () => p };
  }
  throw new SkinChoiceError(`${arg}: not a built-in skin (${THEMES.map((t) => t.id).join(", ")}), a preset (${PRESETS.map((s) => s.key).join(", ")}) or a .nuiskin.json project`);
}
