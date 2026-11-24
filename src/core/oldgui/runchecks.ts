/**
 * Every original-GUI check on an inventory and a theme (src/core/oldgui/checks.ts), with no files read: the command
 * line (src/node/oldguicheck.ts) gives it a folder's files, the editor the export it just built.
 */
import { errorText } from "../errors.js";
import { parseHex } from "../reskin/palette.js";
import { type Finding, type Made, type ThemeFile, checkCategories, checkCoverage, checkFillBars, checkFlat, checkFonts, checkStateIcons, flatSkips, lightFills } from "./checks.js";
import type { RGBAImage } from "../res/image.js";
import type { Cell } from "./cells.js";
import type { CellsFile, InventoryRow } from "./inventory.js";
import { decodeGuiTexture } from "./texture.js";

/** Colours a skin gives the checks: its panel fill, and the light fills it uses on purpose. */
export interface CheckPalette {
  ink?: number[];
  allowed: number[][];
}

export interface ThemeInput {
  /** The theme's textures by name (a DDS wins over a TGA of the same name, as in the client). */
  textures: Map<string, { ext: string; bytes: Uint8Array }>;
  /** Fonts by name ("fnt_default"). */
  fonts: Map<string, Uint8Array>;
  /** From the export's manifest: how each texture was made, and the palette. */
  made: Map<string, Made>;
  palette: Record<string, string>;
}

export interface ChecksResult {
  findings: Finding[];
  failures: number;
  counts: Record<string, { checked: number; failed: number }>;
}

/** The theme's files as ThemeInput: names to bytes ("gui_boxes.dds", "fnt_default.ttf"), with the export's manifest. */
export function themeInput(files: Iterable<[string, Uint8Array]>, manifest: { palette?: Record<string, string>; textures?: { name: string; action?: string }[] } | null): ThemeInput {
  const made = new Map<string, Made>();
  for (const t of manifest?.textures ?? []) made.set(t.name, t.action === "redrawn" ? "redrawn" : t.action === "recoloured" ? "recoloured" : "");
  const textures = new Map<string, { ext: string; bytes: Uint8Array }>();
  const fonts = new Map<string, Uint8Array>();
  for (const [f, bytes] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const m = /^(.+)\.(dds|tga|ttf|otf)$/i.exec(f);
    if (!m) continue;
    const name = m[1]!.toLowerCase();
    const ext = m[2]!.toLowerCase();
    if (ext === "ttf" || ext === "otf") fonts.set(name, bytes);
    else if (!textures.has(name) || ext === "dds") textures.set(name, { ext, bytes });
  }
  return { textures, fonts, made, palette: manifest?.palette ?? {} };
}

/** The flatness faults of one texture as the check sees it (its skips applied); none for a texture it skips whole. */
export function flatFailures(name: string, img: RGBAImage, cells: readonly Cell[], pal: CheckPalette): string[] {
  const sk = flatSkips(name);
  if (sk.whole) return [];
  return checkFlat(name, img, cells, sk.rects, { allowed: pal.allowed, ink: pal.ink }).filter((f) => f.fail).map((f) => f.message);
}

export function runOldGuiChecks(rows: readonly InventoryRow[], cells: CellsFile, theme: ThemeInput | null, skinPalette: CheckPalette | null = null): ChecksResult {
  const findings: Finding[] = [];
  const counts: ChecksResult["counts"] = {};
  const count = (k: string, checked: number, f: Finding[]) => {
    counts[k] = { checked, failed: new Set(f.filter((x) => x.fail).map((x) => x.texture)).size };
    findings.push(...f);
  };
  const drawn = rows.filter((r) => r.drawn);
  count("categories", drawn.length, checkCategories(rows));
  count("state icons", drawn.filter((r) => r.treatment === "icon" || r.treatment === "hold").length, checkStateIcons(rows, cells));
  count("fill bars", drawn.filter((r) => r.kind === "bar").length, checkFillBars(rows, cells));
  if (theme) {
    const files = new Map<string, ThemeFile>([...theme.textures].map(([name, t]) => [name, { name, ext: t.ext, made: theme.made.get(name) ?? "" }]));
    count("coverage", drawn.filter((r) => r.treatment === "redraw").length, checkCoverage(rows, files));
    const colour = (k: string) => (theme.palette[k] ? parseHex(theme.palette[k]).slice(0, 3) : null);
    const keys = ["ink", "accent", "activeLo", "active", "glow", "glowHi", "mark"] as const;
    const fromManifest = keys.every((k) => colour(k)) ? lightFills(Object.fromEntries(keys.map((k) => [k, colour(k)!])) as unknown as Parameters<typeof lightFills>[0]) : [];
    const allowed = skinPalette?.allowed ?? fromManifest;
    const ink = skinPalette?.ink ?? colour("ink") ?? undefined;
    const flat: Finding[] = [];
    let checked = 0;
    const soft = new Set<string>();
    for (const r of drawn.filter((x) => x.treatment === "redraw" || x.treatment === "flat")) {
      const f = theme.textures.get(r.resref);
      if (!f) continue;
      const sk = flatSkips(r.resref);
      if (sk.whole) {
        flat.push({ check: "flatness", texture: r.resref, message: `skipped: ${sk.whole}`, fail: false });
        continue;
      }
      for (const n of sk.notes) flat.push({ check: "flatness", texture: r.resref, message: `skipped ${n}`, fail: false });
      let img;
      try {
        img = decodeGuiTexture(f.bytes, f.ext);
      } catch (e) {
        flat.push({ check: "flatness", texture: r.resref, message: `unreadable: ${errorText(e)}`, fail: true });
        continue;
      }
      const t = cells.textures[r.resref];
      if (t && (t.size[0] !== img.width || t.size[1] !== img.height)) {
        flat.push({ check: "flatness", texture: r.resref, message: `${img.width}x${img.height}, the stock is ${t.size[0]}x${t.size[1]}: the models' cells no longer line up`, fail: true });
        continue;
      }
      checked++;
      flat.push(...checkFlat(r.resref, img, t?.cells ?? [], sk.rects, { allowed, ink }, soft));
    }
    if (soft.size) flat.push({ check: "flatness", texture: "", message: `${soft.size} lines of stretched cells end on a frame's 1:1 rule (a soft edge of half a texel, kept so the frame keeps its line)`, fail: false });
    count("flatness", checked, flat);
    count("fonts", theme.fonts.size, checkFonts(theme.fonts));
  }
  return { findings, failures: findings.filter((f) => f.fail).length, counts };
}
