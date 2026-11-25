/**
 * pnpm old-gui check: the original-GUI checks (src/core/oldgui/checks.ts) on an inventory folder and a theme folder,
 * as text lines and a count of failures.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Finding } from "../core/oldgui/checks.js";
import { type CellsFile, readInventoryTsv } from "../core/oldgui/inventory.js";
import { type CheckPalette, type IconsFile, runOldGuiChecks, themeInput } from "../core/oldgui/runchecks.js";
import { parseHex } from "../core/reskin/palette.js";

export interface CheckRun {
  findings: Finding[];
  failures: number;
  lines: string[];
  counts: Record<string, { checked: number; failed: number }>;
  /** The theme folder the checks read (null without one). */
  theme: string | null;
  /** The theme's hover glow, from its manifest. */
  glow: number[] | null;
  /** With --frames: the frame check, screen by screen. */
  frames?: { key: string; missing: number; stray: number; ends: number; spurs: number; where: string }[];
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

export type { CheckPalette };

export async function runChecks(dir: string, themeDir: string | null, skinPalette: CheckPalette | null = null): Promise<CheckRun> {
  const rows = readInventoryTsv(readFileSync(join(dir, "old-gui-inventory.tsv"), "utf8"));
  const cellsPath = join(dir, "old-gui-cells.json");
  const cells: CellsFile = existsSync(cellsPath) ? (JSON.parse(readFileSync(cellsPath, "utf8")) as CellsFile) : { about: "", textures: {} };
  // the theme: the folder itself, or its stock/ folder when it is an export-theme output
  let theme = themeDir;
  if (theme === null && readdirSync(dir).some((f) => /\.(dds|tga)$/i.test(f))) theme = dir;
  if (theme && !readdirSync(theme).some((f) => /\.(dds|tga)$/i.test(f)) && existsSync(join(theme, "stock"))) theme = join(theme, "stock");
  const input = theme
    ? themeInput(
        readdirSync(theme)
          .filter((f) => /\.(dds|tga|ttf|otf)$/i.test(f))
          .map((f) => [f, new Uint8Array(readFileSync(join(theme!, f)))] as [string, Uint8Array]),
        findManifest(theme),
      )
    : null;
  const iconsPath = join(dir, "old-gui-icons.json");
  const icons = existsSync(iconsPath) ? (JSON.parse(readFileSync(iconsPath, "utf8")) as IconsFile) : null;
  const { findings, failures, counts } = runOldGuiChecks(rows, cells, input, skinPalette, icons);

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
  if (!theme) lines.push("no theme folder (--theme DIR): coverage, flatness, fonts and icon size not run");
  else if (!icons) lines.push("no old-gui-icons.json in the inventory folder (an older inventory): icon size not run");
  lines.push(failures ? `${failures} failures` : "all checks pass");
  let glow: number[] | null = null;
  if (theme) {
    const g = findManifest(theme)?.palette?.glow;
    if (g) glow = parseHex(g).slice(0, 3);
  }
  return { findings, failures, lines, counts, theme, glow };
}
