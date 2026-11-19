/**
 * The NUI skin (nui_skin.tml) and its fonts. A port of nui-preview's skin.py Skin.
 */
import { type FontFace, NuiFont, type TextModel, parseFace } from "../font/font.js";
import type { RGBA } from "../render/text.js";
import type { CanvasFactory } from "../render/canvas.js";
import type { ResMan } from "../res/resman.js";
import { type TomlTable, type TomlValue, parseToml } from "./toml.js";

/** A colour from the skin ("#RRGGBB" or "#RRGGBBAA") or a NUI colour object ({"r","g","b","a"}). */
export function color(s: unknown, def: RGBA = [255, 255, 255, 255]): RGBA {
  if (typeof s === "object" && s !== null && !Array.isArray(s)) {
    const o = s as Record<string, unknown>;
    const ch = (k: string) => {
      const v = o[k];
      return typeof v === "number" ? Math.trunc(v) : 255;
    };
    return [ch("r"), ch("g"), ch("b"), ch("a")];
  }
  if (typeof s === "string" && s.startsWith("#") && (s.length === 7 || s.length === 9)) {
    const v = s.slice(1);
    const p = (i: number) => parseInt(v.slice(i, i + 2), 16);
    const r = p(0);
    const g = p(2);
    const b = p(4);
    const a = v.length === 8 ? p(6) : 255;
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return def;
    return [r, g, b, a];
  }
  return def;
}

export interface SkinFontEntry {
  name: string;
  resref: string;
  font_size: number;
  spacing_h: number;
  pixel_snap: boolean;
}

export interface SkinOptions {
  model?: TextModel;
  makeCanvas?: CanvasFactory | null;
  /** GUI scale: every font_size is multiplied by it, as the client re-bakes its fonts (see DESIGN.md). */
  scale?: number;
  /** Parsed fonts to reuse between loads (the skin editor reloads the skin on every edit). */
  faceCache?: Map<string, FontFace>;
}

/** A cache key for a font file: its resref, size and a sample of its bytes. */
function faceKey(resref: string, ttf: Uint8Array): string {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(ttf.length / 4096));
  for (let i = 0; i < ttf.length; i += step) h = Math.imul(h ^ ttf[i]!, 16777619);
  return `${resref}:${ttf.length}:${h >>> 0}`;
}

export class Skin {
  readonly fonts = new Map<string, NuiFont>();
  readonly fontList: NuiFont[] = [];
  /** [[fonts]] entries whose TTF is missing. */
  readonly missingFonts: SkinFontEntry[] = [];
  defaultFont!: NuiFont;

  private constructor(readonly data: TomlTable) {}

  /** Parses a skin and loads its fonts from the resources. */
  static async load(tml: Uint8Array | string, resman: ResMan, opts: SkinOptions = {}): Promise<Skin> {
    const text = typeof tml === "string" ? tml : new TextDecoder("utf-8").decode(tml);
    const skin = new Skin(parseToml(text));
    const faces = new Map<string, FontFace | null>();
    for (const f of skin.fontEntries()) {
      let face = faces.get(f.resref);
      if (face === undefined) {
        const ttf = await resman.get(f.resref, "ttf");
        if (ttf && opts.faceCache) {
          const key = faceKey(f.resref, ttf);
          face = opts.faceCache.get(key) ?? parseFace(ttf, f.resref);
          opts.faceCache.set(key, face);
        } else face = ttf ? parseFace(ttf, f.resref) : null;
        faces.set(f.resref, face);
      }
      if (!face) {
        skin.missingFonts.push(f);
        continue;
      }
      const size = f.font_size * (opts.scale ?? 1);
      const font = new NuiFont(f.name, face, size, opts.model ?? "nuklear", f.spacing_h, opts.makeCanvas ?? null);
      // The first font of a name wins (later ones are baked but never found by name).
      if (!skin.fonts.has(font.name)) skin.fonts.set(font.name, font);
      skin.fontList.push(font);
    }
    if (!skin.fontList.length) throw new Error("the skin names no font the resources have");
    skin.defaultFont = skin.fontList[0]!;
    return skin;
  }

  /** The [[fonts]] list (with the client's defaults: fnt_maintext at 17 if there is none). */
  fontEntries(): SkinFontEntry[] {
    const raw = this.data.fonts;
    const list = Array.isArray(raw) ? raw : [];
    const out: SkinFontEntry[] = [];
    for (const f of list) {
      if (typeof f !== "object" || f === null || Array.isArray(f)) continue;
      const t = f as TomlTable;
      const n = (k: string, d: number) => (typeof t[k] === "number" ? (t[k] as number) : d);
      let size = n("font_size", 17);
      if (size <= 0) size = 16;
      out.push({
        name: typeof t.name === "string" ? t.name : "(default)",
        resref: typeof t.resref === "string" ? t.resref : "fnt_maintext",
        font_size: size,
        spacing_h: n("spacing_h", 0.5),
        pixel_snap: typeof t.pixel_snap === "boolean" ? t.pixel_snap : true,
      });
    }
    if (!out.length) out.push({ name: "(default)", resref: "fnt_maintext", font_size: 17, spacing_h: 0.5, pixel_snap: true });
    return out;
  }

  get(path: string, def?: TomlValue): TomlValue | undefined {
    let d: TomlValue = this.data;
    for (const p of path.split(".")) {
      if (typeof d !== "object" || d === null || Array.isArray(d) || !(p in d)) return def;
      d = (d as TomlTable)[p]!;
    }
    return d;
  }

  str(path: string, def: string): string {
    const v = this.get(path);
    return typeof v === "string" ? v : def;
  }

  numOf(path: string, def: number): number {
    const v = this.get(path);
    return typeof v === "number" ? v : def;
  }

  font(name: unknown): NuiFont {
    if (typeof name === "string" && this.fonts.has(name)) return this.fonts.get(name)!;
    return this.defaultFont;
  }
}
