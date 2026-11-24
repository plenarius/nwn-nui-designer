/**
 * pnpm export-theme: a whole theme in one step, the NUI skin and the original (MDL-panel) GUI redrawn to match it, so
 * a server ships one package. docs/RESKIN-EVERYTHING.md is the guide.
 *
 *   pnpm export-theme SKIN -o DIR [--out-hak NAME] [--prefix P] [--prefix-hak NAME] [--game DIR] [--hak FILE]...
 *                     [--override DIR]... [--no-haks] [--alpha keep|opaque] [--format auto|dds|tga] [--no-sheet]
 *                     [--old-gui-fonts]
 *
 * SKIN: a built-in skin (ink, bronze, brass, verdigris, oxblood, winter), a generator preset (a-bronze, d-iron, ...), or a
 * skin project (*.nuiskin.json) made in the skin editor's generator.
 *
 * Reads the stock original GUI from your own game (--game, else $NWN_ROOT, else nui-designer.ini's game) and the haks
 * and override folders the settings name (or --hak / --override; --no-haks: the game alone). Writes, under DIR:
 *
 *   stock/                output A: the NUI skin and the redrawn original GUI under the stock names (with the stock
 *                         .txi files). Put the files in a hak, or a player's override folder, for the whole look.
 *   NAME.hak              with --out-hak NAME: output A as a hak (at most 16 characters)
 *   prefixed/             output B, with --prefix P: the same files under the prefix, for a server that lets each
 *                         player choose a theme. P is 1 or 2 letters and digits; a name's first part becomes P and
 *                         one letter for that part (with bz: gui_boxes -> bzg_boxes, ctl_att -> bzc_att, nui_skin ->
 *                         bzn_skin), so every name keeps its stock length
 *   prefixed.json         output B's map: each stock texture -> its prefixed name, and the skin's resref
 *   NAME.hak              with --prefix-hak NAME: output B as a hak
 *   report.md             what was themed, what stays stock and why, failed checks, the light-skin warning
 *   reskin-manifest.json  every original-GUI texture: its source, format, size, what was done, the checks
 *   contact-*.png         stock and new side by side, per group (--no-sheet: none)
 *
 * --old-gui-fonts: also the skin's text font as the original GUI's three fonts (fnt_maintext.ttf, fnt_default.ttf,
 * fnt_default_hr.ttf) in stock/, so both GUIs draw one font. Only a font whose licence allows shipping it (the built-in
 * skins' OFL fonts, or a font whose own name table says OFL, Apache, Ubuntu Font Licence or public domain); refused
 * otherwise. Not in prefixed/: the client loads fonts once, so they reach every player.
 *
 * --format: what a texture that is a TGA in the game is written as (auto, the default: a DDS unless its error is too
 * high or it fails the flatness check). No prefixed name may start like the game's own names (gui_, ctl_, ...) or be a name the game or a hak
 * already has.
 *
 * Everything written is derived from your own game files: keep it out of any public repository. DIR may not be inside
 * this repository (except its ignored local/ folder).
 *
 * It then runs the original-GUI checks (pnpm old-gui check) on stock/ and puts them in report.md.
 *
 * Exit code: 0 when every texture and the original-GUI checks passed, 1 when one failed, 2 on a usage error (no game,
 * a bad prefix).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { errorText } from "../core/errors.js";
import type { AlphaMode } from "../core/reskin/colour.js";
import type { OutputFormat } from "../core/reskin/compress.js";
import { paletteFromStyle } from "../core/reskin/palette.js";
import { HAK_NAME, LIGHT_WARNING, ThemeError, exportTheme, themePackage } from "../core/reskin/theme.js";
import { SkinChoiceError, chooseSkin } from "./openskin.js";
import { writeContactSheets } from "./reskinsheet.js";
import { UsageError, checkOutDir, stockResources } from "./stockres.js";

const USAGE =
  "pnpm export-theme SKIN -o DIR [--out-hak NAME] [--prefix P] [--prefix-hak NAME] [--game DIR] [--hak FILE]... [--override DIR]... [--no-haks] [--alpha keep|opaque] [--format auto|dds|tga] [--no-sheet] [--old-gui-fonts]";

async function main(): Promise<number> {
  const { values: a, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      "out-hak": { type: "string" },
      prefix: { type: "string" },
      "prefix-hak": { type: "string" },
      game: { type: "string" },
      hak: { type: "string", multiple: true },
      override: { type: "string", multiple: true },
      "no-haks": { type: "boolean" },
      alpha: { type: "string" },
      format: { type: "string" },
      "no-sheet": { type: "boolean" },
      "old-gui-fonts": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (a.help || !positionals.length) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]!.replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, ""));
    return a.help ? 0 : 2;
  }
  if (positionals.length > 1) throw new UsageError(`one skin at a time; usage: ${USAGE}`);
  if (!a.out) throw new UsageError(`-o DIR is required; usage: ${USAGE}`);
  checkOutDir(a.out);
  const hak = a["out-hak"]?.replace(/\.hak$/i, "").toLowerCase();
  const prefixHak = a["prefix-hak"]?.replace(/\.hak$/i, "").toLowerCase();
  for (const [opt, n] of [["--out-hak", hak], ["--prefix-hak", prefixHak]] as const) {
    if (n !== undefined && !HAK_NAME.test(n)) throw new UsageError(`${opt} ${n}: a hak name is 1 to 16 letters, digits or _`);
  }
  if (prefixHak && a.prefix === undefined) throw new UsageError("--prefix-hak needs --prefix");
  if (hak && hak === prefixHak) throw new UsageError("--out-hak and --prefix-hak need different names");
  if (a.alpha !== undefined && a.alpha !== "keep" && a.alpha !== "opaque") throw new UsageError("--alpha: keep or opaque");
  if (a.format !== undefined && !["auto", "dds", "tga"].includes(a.format)) throw new UsageError("--format: auto, dds or tga");

  const skin = chooseSkin(positionals[0]!);
  const stock = await stockResources({ game: a.game, haks: a.hak, overrides: a.override, noHaks: a["no-haks"], writing: [hak, prefixHak].filter((x): x is string => !!x) });
  if (stock.leftOut.length) console.log(`leaving out ${stock.leftOut.join(", ")}: it is a hak being written (the export reads the stock textures)`);
  console.log(`theme: ${skin.title} (${skin.from})`);
  console.log(`reading: ${stock.game}${stock.haks.length ? `, ${stock.haks.length} hak(s)` : ""}${stock.overrides.length ? `, override ${stock.overrides.join(", ")}` : ""}`);

  let last = -1;
  const r = await exportTheme({
    project: skin.project(),
    resman: stock.resman,
    alpha: a.alpha as AlphaMode | undefined,
    format: (a.format ?? "auto") as OutputFormat,
    prefix: a.prefix,
    oldGuiFonts: a["old-gui-fonts"],
    previews: !a["no-sheet"],
    progress: (done, total) => {
      const pct = Math.floor((done / total) * 10);
      if (pct !== last && process.stdout.isTTY) process.stdout.write(`\r  original GUI: ${done}/${total}`);
      last = pct;
    },
  });
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");

  const out = a.out;
  // a fresh stock/ and prefixed/: a file left from an earlier run (another format, another skin) would ship too
  for (const d of ["stock", "prefixed"]) rmSync(join(out, d), { recursive: true, force: true });
  if (!r.prefixed && existsSync(join(out, "prefixed.json"))) rmSync(join(out, "prefixed.json"));
  const epoch = process.env.SOURCE_DATE_EPOCH;
  const files = themePackage(r, { hak, prefixHak, date: epoch ? new Date(Number(epoch) * 1000) : new Date() });
  for (const [path, data] of Object.entries(files)) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), data);
  }
  const sheets = a["no-sheet"] ? [] : writeContactSheets(out, r.title, r.reskin.previews, paletteFromStyle(skin.style));

  const m = r.reskin.manifest;
  const bad = m.textures.filter((t) => !t.validation.ok);
  const dds = m.textures.filter((t) => t.output.startsWith("dds")).length;
  console.log(`${join(out, "stock")}: ${Object.keys(r.stock).length} files (NUI skin ${r.skinItems.length}; original GUI ${m.textures.length} textures, ${dds} DDS and ${m.textures.length - dds} TGA, with their .txi)`);
  if (r.fonts) console.log(`old GUI fonts: ${Object.keys(r.fonts.files).join(", ")} from the skin's ${r.fonts.source}.ttf (${r.fonts.why})`);
  if (hak) console.log(`${join(out, `${hak}.hak`)}: ${files[`${hak}.hak`]!.length} bytes`);
  if (r.prefixed) {
    console.log(`${join(out, "prefixed")}: ${Object.keys(r.prefixed.files).length} files under ${r.prefixed.prefix} (skin ${r.prefixed.manifest.skin.resref}; ${Object.keys(r.prefixed.manifest.textures).length} texture overrides in ${join(out, "prefixed.json")})`);
    if (prefixHak) console.log(`${join(out, `${prefixHak}.hak`)}: ${files[`${prefixHak}.hak`]!.length} bytes`);
  }
  for (const s of sheets) console.log(s);
  console.log(`${join(out, "report.md")}: ${bad.length} failed a check, ${m.skipped.length} skipped, ${m.manual.length} left stock (icons, cursors, pictures, bitmap fonts: need an artist)`);
  for (const t of bad) console.log(`  check failed: ${t.name}: ${t.validation.problems.join("; ")}`);
  for (const s of m.skipped) console.log(`  skipped: ${s.name}: ${s.why}`);
  console.log(`original GUI checks: ${Object.entries(r.checks.counts).map(([k, v]) => `${k} ${v.checked - v.failed}/${v.checked}`).join(", ")}${r.checks.failures ? ` (${r.checks.failures} failures, report.md)` : ", all pass"}`);
  if (r.light.light) console.log(`\n${LIGHT_WARNING}\n(window body ${r.light.body}, luma ${r.light.luma})`);
  return bad.length || r.checks.failures ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (e: unknown) => {
    const plain = e instanceof UsageError || e instanceof SkinChoiceError || e instanceof ThemeError || (e instanceof Error && "code" in e && String(e.code).startsWith("ERR_PARSE_ARGS"));
    console.error(`export-theme: ${plain ? errorText(e) : e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(2);
  },
);
