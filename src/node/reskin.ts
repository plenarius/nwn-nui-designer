/**
 * pnpm reskin: the original (MDL-panel) GUI's textures retoned to match a designer skin, so one theme covers the NUI
 * windows and the old ones. docs/RESKIN-EVERYTHING.md is the playbook.
 *
 *   pnpm reskin SKIN -o DIR [--out-hak NAME] [--game DIR] [--hak FILE]... [--override DIR]... [--no-haks]
 *               [--alpha keep|opaque] [--format auto|dds|tga] [--only NAME,NAME] [--no-sheet]
 *
 * SKIN: a built-in skin (ink, bronze, ...), a generator preset (a-bronze, b-clean, d-iron), or a skin project
 * (*.nuiskin.json) whose textures came from the generator.
 *
 * Reads the stock textures from the game (--game, else $NWN_ROOT, else nui-designer.ini's game) and the haks and
 * override folders the settings name (or --hak / --override; --no-haks: the game alone). Writes, all under DIR:
 *
 *   textures/       the new textures under the stock names, with the stock .txi files (put the folder's contents in
 *                   the game's development/ folder to try them)
 *
 * --format: what a texture that is a TGA in the game is written as. auto (the default): a BioWare DDS (DXT1, or DXT5
 * with alpha, every mip level) unless its compression error is too high, then the TGA; dds: always DDS; tga: always
 * the TGA. A texture that is a DDS in the game stays DDS. Each name is written in one format only (an older file of
 * the other format in textures/ is removed: the client would prefer the DDS).
 *   NAME.hak        with --out-hak NAME (at most 16 characters): the same files as a hak
 *   manifest.json   every texture: its source, format, size, what was done, the checks
 *   report.md       failed checks, skipped textures, and the textures left to a person
 *   contact-*.png   stock and new side by side, per group (--no-sheet: none)
 *
 * Everything written is derived from the user's own game files: keep it out of any public repository. DIR may not be
 * inside this repository (except its ignored local/ folder).
 *
 * Exit code: 0 when every texture passed its checks, 1 when one failed, 2 on a usage error.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { errorText } from "../core/errors.js";
import { type AlphaMode, alphaModeOf } from "../core/reskin/colour.js";
import type { OutputFormat } from "../core/reskin/compress.js";
import { paletteFromStyle } from "../core/reskin/palette.js";
import { TEXTURE_EXTS, reskin, reskinHak, reportMarkdown } from "../core/reskin/reskin.js";
import { nuiPieces } from "../core/reskin/theme.js";
import { AUTO } from "../core/reskin/textures.js";
import { SkinChoiceError, chooseSkin } from "./openskin.js";
import { writeContactSheets } from "./reskinsheet.js";
import { UsageError, checkOutDir, stockResources } from "./stockres.js";

const USAGE = "pnpm reskin SKIN -o DIR [--out-hak NAME] [--game DIR] [--hak FILE]... [--override DIR]... [--no-haks] [--alpha keep|opaque] [--format auto|dds|tga] [--only A,B] [--no-sheet]";


async function main(): Promise<number> {
  const { values: a, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      "out-hak": { type: "string" },
      game: { type: "string" },
      hak: { type: "string", multiple: true },
      override: { type: "string", multiple: true },
      "no-haks": { type: "boolean" },
      alpha: { type: "string" },
      format: { type: "string" },
      only: { type: "string" },
      "no-sheet": { type: "boolean" },
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
  const hakName = a["out-hak"]?.replace(/\.hak$/i, "");
  if (hakName !== undefined && (!/^[a-z0-9_]{1,16}$/i.test(hakName))) throw new UsageError(`--out-hak ${hakName}: a hak name is 1 to 16 letters, digits or _`);
  if (a.alpha !== undefined && a.alpha !== "keep" && a.alpha !== "opaque") throw new UsageError("--alpha: keep or opaque");
  if (a.format !== undefined && !["auto", "dds", "tga"].includes(a.format)) throw new UsageError("--format: auto, dds or tga");
  const format = (a.format ?? "auto") as OutputFormat;
  const only = a.only?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (only) {
    const unknown = only.filter((n) => !AUTO.some((t) => t.name === n));
    if (unknown.length) throw new UsageError(`--only: not a texture the reskin handles: ${unknown.join(", ")}`);
  }

  const skin = chooseSkin(positionals[0]!);
  const palette = paletteFromStyle(skin.style);
  const alpha: AlphaMode = (a.alpha as AlphaMode | undefined) ?? alphaModeOf(palette);

  const { game, haks, overrides, resman, leftOut } = await stockResources({ game: a.game, haks: a.hak, overrides: a.override, noHaks: a["no-haks"], writing: hakName ? [hakName] : [] });
  if (leftOut.length) console.log(`leaving out ${leftOut.join(", ")}: it is the hak being written (the reskin reads the stock textures)`);
  console.log(`skin: ${skin.title} (${skin.from}); alpha: ${alpha}; format: ${format}`);
  console.log(`reading: ${game}${haks.length ? `, ${haks.length} hak(s)` : ""}${overrides.length ? `, override ${overrides.join(", ")}` : ""}`);

  const res = await reskin(resman, { palette, nui: nuiPieces(skin.style, skin.own), skin: { id: skin.id, title: skin.title, from: skin.from }, alpha, format, only, previews: !a["no-sheet"] });

  const out = a.out;
  const texDir = join(out, "textures");
  mkdirSync(texDir, { recursive: true });
  for (const t of res.manifest.textures) {
    // one format per name: a DDS left from an earlier run would win over a new TGA (and the other way round, a stale
    // TGA would sit unused beside the DDS)
    for (const e of TEXTURE_EXTS) {
      const stale = join(texDir, `${t.name}.${e}`);
      if (`${t.name}.${e}` !== t.file && existsSync(stale)) rmSync(stale);
    }
  }
  for (const [n, d] of Object.entries(res.files)) writeFileSync(join(texDir, n), d);
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(res.manifest, null, 1)}\n`);
  writeFileSync(join(out, "report.md"), reportMarkdown(res.manifest));
  if (hakName) {
    const epoch = process.env.SOURCE_DATE_EPOCH;
    const hak = reskinHak(res.files, skin.title, epoch ? new Date(Number(epoch) * 1000) : new Date());
    writeFileSync(join(out, `${hakName}.hak`), hak);
    console.log(`${join(out, `${hakName}.hak`)}: ${Object.keys(res.files).length} resources, ${hak.length} bytes`);
  }
  if (!a["no-sheet"]) for (const f of writeContactSheets(out, skin.title, res.previews, palette)) console.log(f);
  const m = res.manifest;
  const bad = m.textures.filter((t) => !t.validation.ok);
  const kept = m.textures.filter((t) => t.compression?.kept);
  const dds = m.textures.filter((t) => t.output.startsWith("dds")).length;
  console.log(`formats: ${dds} DDS, ${m.textures.length - dds} TGA${kept.length ? ` (kept as TGA by the error measure: ${kept.map((t) => t.name).join(", ")})` : ""}`);
  console.log(`${m.textures.length} textures written to ${texDir} (${bad.length} failed a check, ${m.skipped.length} skipped, ${m.manual.length} left to a person: ${join(out, "report.md")})`);
  for (const t of bad) console.log(`  check failed: ${t.name}: ${t.validation.problems.join("; ")}`);
  for (const s of m.skipped) console.log(`  skipped: ${s.name}: ${s.why}`);
  return bad.length ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (e: unknown) => {
    const plain = e instanceof UsageError || e instanceof SkinChoiceError || (e instanceof Error && "code" in e && String(e.code).startsWith("ERR_PARSE_ARGS"));
    console.error(`reskin: ${plain ? errorText(e) : e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(2);
  },
);
