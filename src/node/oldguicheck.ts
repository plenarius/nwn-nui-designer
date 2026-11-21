/**
 * pnpm old-gui check: the original-GUI checks (src/core/oldgui/checks.ts) on an inventory folder and a theme folder,
 * as text lines and a count of failures.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { errorText } from "../core/errors.js";
import { type Finding, type Made, type ThemeFile, checkCategories, checkCoverage, checkFillBars, checkFlat, checkFonts, checkStateIcons, flatSkips, lightFills } from "../core/oldgui/checks.js";
import { type CellsFile, readInventoryTsv } from "../core/oldgui/inventory.js";
import { decodeGuiTexture } from "../core/oldgui/texture.js";
import { parseHex } from "../core/reskin/palette.js";

export interface CheckRun {
  findings: Finding[];
  failures: number;
  lines: string[];
  counts: Record<string, { checked: number; failed: number }>;
}

interface ManifestLike {
  palette?: Record<string, string>;
  textures?: { name: string; action?: string }[];
}

/** The export's manifest beside or above the theme folder (export-theme writes reskin-manifest.json beside stock/). */
function findManifest(theme: string): ManifestLike | null {
  for (const d of [theme, dirname(theme)]) {
    for (const f of ["reskin-manifest.json", "manifest.json"]) {
      const p = join(d, f);
      if (!existsSync(p)) continue;
      try {
        const m = JSON.parse(readFileSync(p, "utf8")) as ManifestLike;
        if (m && Array.isArray(m.textures)) return m;
      } catch {
        // not ours
      }
    }
  }
  return null;
}

/** Colours a skin gives the checks: its panel fill, and the light fills it uses on purpose. */
export interface CheckPalette {
  ink?: number[];
  allowed: number[][];
}

export async function runChecks(dir: string, themeDir: string | null, skinPalette: CheckPalette | null = null): Promise<CheckRun> {
  const rows = readInventoryTsv(readFileSync(join(dir, "old-gui-inventory.tsv"), "utf8"));
  const cellsPath = join(dir, "old-gui-cells.json");
  const cells: CellsFile = existsSync(cellsPath) ? (JSON.parse(readFileSync(cellsPath, "utf8")) as CellsFile) : { about: "", textures: {} };
  const findings: Finding[] = [];
  const counts: CheckRun["counts"] = {};
  const count = (k: string, checked: number, f: Finding[]) => {
    counts[k] = { checked, failed: new Set(f.filter((x) => x.fail).map((x) => x.texture)).size };
    findings.push(...f);
  };
  const drawn = rows.filter((r) => r.drawn);
  count("categories", drawn.length, checkCategories(rows));
  count("state icons", drawn.filter((r) => r.treatment === "icon" || r.treatment === "hold").length, checkStateIcons(rows, cells));
  count("fill bars", drawn.filter((r) => r.kind === "bar").length, checkFillBars(rows, cells));

  // the theme: the folder itself, or its stock/ folder when it is an export-theme output
  let theme = themeDir;
  if (theme === null && readdirSync(dir).some((f) => /\.(dds|tga)$/i.test(f))) theme = dir;
  if (theme && !readdirSync(theme).some((f) => /\.(dds|tga)$/i.test(f)) && existsSync(join(theme, "stock"))) theme = join(theme, "stock");
  if (theme) {
    const manifest = findManifest(theme);
    const made = new Map<string, Made>();
    for (const t of manifest?.textures ?? []) made.set(t.name, t.action === "redrawn" ? "redrawn" : t.action === "recoloured" ? "recoloured" : "");
    const files = new Map<string, ThemeFile>();
    const fonts = new Map<string, Uint8Array>();
    for (const f of readdirSync(theme).sort()) {
      const m = /^(.+)\.(dds|tga|ttf|otf)$/i.exec(f);
      if (!m) continue;
      const name = m[1]!.toLowerCase();
      const ext = m[2]!.toLowerCase();
      if (ext === "ttf" || ext === "otf") fonts.set(name, new Uint8Array(readFileSync(join(theme, f))));
      // the client prefers the DDS when both are there
      else if (!files.has(name) || ext === "dds") files.set(name, { name, ext, made: made.get(name) ?? "" });
    }
    const chrome = drawn.filter((r) => r.treatment === "redraw");
    count("coverage", chrome.length, checkCoverage(rows, files));

    const pal = manifest?.palette ?? {};
    const colour = (k: string) => (pal[k] ? parseHex(pal[k]).slice(0, 3) : null);
    const keys = ["ink", "accent", "activeLo", "active", "glow", "glowHi", "mark"] as const;
    const fromManifest = keys.every((k) => colour(k)) ? lightFills(Object.fromEntries(keys.map((k) => [k, colour(k)!])) as unknown as Parameters<typeof lightFills>[0]) : [];
    const allowed = skinPalette?.allowed ?? fromManifest;
    const ink = skinPalette?.ink ?? colour("ink") ?? undefined;
    const flat: Finding[] = [];
    let checked = 0;
    const soft = new Set<string>();
    for (const r of drawn.filter((x) => x.treatment === "redraw" || x.treatment === "flat")) {
      const f = files.get(r.resref);
      if (!f) continue;
      const sk = flatSkips(r.resref);
      if (sk.whole) {
        flat.push({ check: "flatness", texture: r.resref, message: `skipped: ${sk.whole}`, fail: false });
        continue;
      }
      for (const n of sk.notes) flat.push({ check: "flatness", texture: r.resref, message: `skipped ${n}`, fail: false });
      let img;
      try {
        img = decodeGuiTexture(new Uint8Array(readFileSync(join(theme, `${f.name}.${f.ext}`))), f.ext);
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
    count("fonts", fonts.size, checkFonts(fonts));
  }

  // at most a few lines per texture and check: a recoloured panel can have dozens of faults of one kind
  const lines: string[] = [];
  const PER = 4;
  const seen = new Map<string, number>();
  for (const f of findings) {
    const k = `${f.fail}/${f.check}/${f.texture}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n <= PER) lines.push(`${f.fail ? "FAIL" : "note"}  ${f.check}: ${f.texture ? `${f.texture}: ` : ""}${f.message}`);
  }
  for (const [k, n] of seen) {
    if (n <= PER) continue;
    const [fail, check, texture] = k.split("/");
    lines.push(`${fail === "true" ? "FAIL" : "note"}  ${check}: ${texture}: ${n - PER} more (--json lists them all)`);
  }
  for (const [k, v] of Object.entries(counts)) lines.push(`${k}: ${v.checked} checked, ${v.failed} failed`);
  if (!theme) lines.push("no theme folder (--theme DIR): coverage, flatness and fonts not run");
  const failures = findings.filter((f) => f.fail).length;
  lines.push(failures ? `${failures} failures` : "all checks pass");
  return { findings, failures, lines, counts };
}
