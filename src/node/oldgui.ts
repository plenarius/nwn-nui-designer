/**
 * pnpm old-gui: the original (MDL-panel) GUI's texture inventory, and the checks a theme of it must pass.
 * docs/RESKIN-EVERYTHING.md is the guide.
 *
 *   pnpm old-gui inventory -o DIR [--game DIR] [--hak FILE]... [--override DIR]... [--no-haks] [--client FILE]
 *                          [--roles FILE]
 *   pnpm old-gui check DIR [--theme DIR] [--skin SKIN] [--json] [--frames [--game DIR] [--frames-out DIR]]
 *   pnpm old-gui previews -o DIR --theme DIR [--skin SKIN] [--only KEY,...] [--game DIR] [--hak FILE]...
 *                         [--override DIR]... [--no-haks]
 *
 * inventory  reads every GUI model, every .gui layout, the txi links and the client's built-in names from your game
 *            and haks (as `pnpm reskin` reads them), gives every texture a role, and writes into DIR:
 *              old-gui-inventory.tsv   one row per texture: role, treatment, drawn or not, where it is used
 *              old-gui-cells.json      every UV cell the models sample from each drawn texture
 *              old-gui-icons.json      each icon button's stock pictogram: its cell, extent and texel count
 *            All are names and numbers only (no art), so a theme's repository may keep them and run the checks in
 *            CI without the game. --client FILE: the game executable to read the built-in names from (else the
 *            one in the game's bin/ folder). --roles FILE: your own decisions (old-gui-roles.json, see the guide),
 *            for textures your haks add.
 *
 * check      runs the checks on an inventory folder (DIR, as inventory wrote it), and on a theme folder (--theme:
 *            the textures under their stock names, e.g. export-theme's stock/; DIR itself when it holds textures):
 *              categories  every drawn texture has a role
 *              coverage    every drawn chrome texture is in the theme, redrawn (a recolour keeps the stock bevels)
 *              state icons a kept icon atlas a control reads per state holds no frames
 *              fill bars   every bar the client fills has previews at three levels or more
 *              flatness    chrome faces are flat, stretched cells flat along their stretch
 *              fonts       the old GUI's fonts, when the theme replaces them, are all three and the same font
 *              icon size   no icon button's pictogram (party bar, map buttons, creation arrows and help) is smaller
 *                          than the stock's: inward by more than 2 texels, or under 85% of its texels
 *            Without --theme only the first, third and fourth run. --skin SKIN: the skin the theme was made from
 *            (its light fills are allowed as faces; else the export's manifest beside the theme says). --json: the
 *            results as JSON.
 *              frames      with --frames (reads your game: --game, else $NWN_ROOT, else nui-designer.ini): every
 *                          screen drawn stock and themed, and its rules compared: lines that vanish, stray lines,
 *                          lines that stop or step where the stock's go on, 1-4 px stubs. Listed for a look, not
 *                          failed: a doubled stock rule drawn as one, or a rule a stretched cell drops on purpose, is
 *                          by design. --frames-out DIR: an overlay per screen (stock rules blue, theme brass,
 *                          missing red, stray green, ends white boxes, stubs magenta).
 *
 * previews   draws every screen of the original GUI from your game, stock beside the theme (--theme: the textures
 *            under their stock names, as for check): every .gui layout; the panels the client builds in code laid
 *            out on their hooks (Character Record, inventory, store, spellbook, journal, character select, the
 *            Player List filled); lists with the first row selected and the second hovered, with their scrollbar;
 *            every bar the client fills at 0, 40 and 100 %. Textures with filter 0 in their txi are drawn without
 *            blending, clamped ones clamped. Writes DIR/screen_<key>.png, the frame check's overlays
 *            DIR/frames_<key>.png and DIR/frames.txt. The pictures are your game's art: DIR may not be in this
 *            repository (except local/).
 *
 * Exit code: 0 when everything passes, 1 when a check fails, 2 on a usage error.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { errorText } from "../core/errors.js";
import { clientNames, collectOldGui } from "../core/oldgui/collect.js";
import { type RolesFile, buildInventory, cellsJson, inventoryCounts, inventoryTsv } from "../core/oldgui/inventory.js";
import { UsageError, checkOutDir, stockResources } from "./stockres.js";
import { paletteFromStyle } from "../core/reskin/palette.js";
import { SkinChoiceError, chooseSkin } from "./openskin.js";
import { lightFills } from "../core/oldgui/checks.js";
import { type CheckPalette, runChecks } from "./oldguicheck.js";
import { findClient } from "./oldguiclient.js";
import { oldGuiStyle } from "../core/oldgui/draw/index.js";
import { parseHex } from "../core/reskin/palette.js";
import { frameCheck, previewPair, previewWorld } from "./oldguipreview.js";
import { stockIcons } from "../core/oldgui/runchecks.js";

const USAGE =
  "pnpm old-gui inventory -o DIR [--game DIR] [--hak FILE]... [--override DIR]... [--no-haks] [--client FILE] [--roles FILE] | pnpm old-gui check DIR [--theme DIR] [--skin SKIN] [--json] [--frames [--game DIR] [--frames-out DIR]] | pnpm old-gui previews -o DIR --theme DIR [--skin SKIN] [--only KEY,...] [--game DIR] [--hak FILE]... [--override DIR]... [--no-haks]";

async function inventory(args: string[]): Promise<number> {
  const { values: a } = parseArgs({
    args,
    options: {
      out: { type: "string", short: "o" },
      game: { type: "string" },
      hak: { type: "string", multiple: true },
      override: { type: "string", multiple: true },
      "no-haks": { type: "boolean" },
      client: { type: "string" },
      roles: { type: "string" },
    },
  });
  if (!a.out) throw new UsageError(`-o DIR is required; usage: ${USAGE}`);
  const { game, haks, resman } = await stockResources({ game: a.game, haks: a.hak, overrides: a.override, noHaks: a["no-haks"] });
  const exe = a.client ?? findClient(game);
  let client: ReturnType<typeof clientNames> = { names: new Set(), formats: new Set() };
  if (exe) client = clientNames(new Uint8Array(readFileSync(exe)));
  else console.log("no game executable found (--client FILE): the client's built-in names are left out, so textures only the code draws show as unused");
  let roles: RolesFile | null = null;
  if (a.roles) {
    roles = JSON.parse(readFileSync(a.roles, "utf8")) as RolesFile;
    if (!roles || typeof roles.textures !== "object") throw new UsageError(`${a.roles}: not a roles file ({"textures": {...}})`);
  }
  console.log(`reading: ${game}${haks.length ? `, ${haks.length} hak(s)` : ""}${exe ? `, names from ${exe}` : ""}`);
  const c = await collectOldGui(resman, { clientStrings: client.names, clientFormats: client.formats, progress: (m) => console.log(`  ${m}`) });
  for (const w of c.warnings) console.log(`  warning: ${w}`);
  const inv = buildInventory(c, roles);
  mkdirSync(a.out, { recursive: true });
  writeFileSync(join(a.out, "old-gui-inventory.tsv"), inventoryTsv(inv.rows));
  writeFileSync(join(a.out, "old-gui-cells.json"), cellsJson(inv.cells));
  // the icon buttons' stock pictograms: cells, extents and counts (numbers only), for the icon size check
  writeFileSync(join(a.out, "old-gui-icons.json"), `${JSON.stringify(await stockIcons(resman), null, 1)}\n`);
  const counts = inventoryCounts(inv.rows);
  const bad = [...c.models.values()].filter((m) => m.error);
  console.log(`${c.models.size} models (${bad.length} unreadable), ${c.layouts.size} layouts, ${inv.rows.length} textures, ${inv.rows.filter((r) => r.drawn).length} drawn`);
  console.log(`  ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  for (const m of bad.slice(0, 10)) console.log(`  unreadable model ${m.name} (${m.source}): ${m.error}`);
  console.log(`wrote ${join(a.out, "old-gui-inventory.tsv")}, ${join(a.out, "old-gui-cells.json")} and ${join(a.out, "old-gui-icons.json")}`);
  return 0;
}

async function check(args: string[]): Promise<number> {
  const { values: a, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { theme: { type: "string" }, skin: { type: "string" }, json: { type: "boolean" }, frames: { type: "boolean" }, game: { type: "string" }, "frames-out": { type: "string" } },
  });
  const dir = positionals[0];
  if (!dir || positionals.length > 1) throw new UsageError(`one inventory folder; usage: ${USAGE}`);
  if (!existsSync(join(dir, "old-gui-inventory.tsv"))) throw new UsageError(`${dir}: no old-gui-inventory.tsv (run pnpm old-gui inventory -o ${dir} first)`);
  if ((a.game || a["frames-out"]) && !a.frames) throw new UsageError("--game and --frames-out go with --frames");
  if (a["frames-out"]) checkOutDir(a["frames-out"]);
  let pal: CheckPalette | null = null;
  let glow: number[] | null = null;
  if (a.skin) {
    const p = paletteFromStyle(chooseSkin(a.skin).style);
    pal = { ink: p.ink, allowed: lightFills(p) };
    glow = oldGuiStyle(p).glow;
  }
  const r = await runChecks(dir, a.theme ?? null, pal);
  if (a.frames) {
    if (!r.theme) throw new UsageError("--frames needs a theme folder (--theme DIR)");
    const { game, resman } = await stockResources({ game: a.game, noHaks: true });
    const w = await previewWorld(resman, game);
    glow ??= r.glow ?? [240, 204, 130];
    const out = a["frames-out"];
    if (out) mkdirSync(out, { recursive: true });
    const lines = frameCheck(w, w.theme(r.theme), glow, null, out ? (k, png) => writeFileSync(join(out, `frames_${k}.png`), png) : undefined, (i, n, k) => {
      if (process.stdout.isTTY) process.stdout.write(`\r  frames: ${i}/${n} ${k}\x1b[K`);
    });
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
    const look = lines.filter((l) => l.missing + l.stray + l.ends + l.spurs);
    for (const l of look) r.lines.splice(r.lines.length - 1, 0, `look  frames: ${l.key}: missing ${l.missing}, stray ${l.stray}, ends ${l.ends}, stubs ${l.spurs} (${l.where})`);
    r.lines.splice(r.lines.length - 1, 0, `frames: ${lines.length} screens drawn, ${look.length} with lines to look at${out ? ` (overlays in ${out})` : ""}`);
    r.frames = lines;
  }
  if (a.json) console.log(JSON.stringify(r, null, 1));
  else for (const line of r.lines) console.log(line);
  return r.failures ? 1 : 0;
}

async function previews(args: string[]): Promise<number> {
  const { values: a } = parseArgs({
    args,
    options: {
      out: { type: "string", short: "o" },
      theme: { type: "string" },
      skin: { type: "string" },
      only: { type: "string" },
      game: { type: "string" },
      hak: { type: "string", multiple: true },
      override: { type: "string", multiple: true },
      "no-haks": { type: "boolean" },
    },
  });
  if (!a.out || !a.theme) throw new UsageError(`-o DIR and --theme DIR are required; usage: ${USAGE}`);
  checkOutDir(a.out);
  let theme = a.theme;
  if (!readdirSync(theme).some((f) => /\.(dds|tga)$/i.test(f)) && existsSync(join(theme, "stock"))) theme = join(theme, "stock");
  const { game, resman } = await stockResources({ game: a.game, haks: a.hak, overrides: a.override, noHaks: a["no-haks"] });
  const w = await previewWorld(resman, game);
  let glow: readonly number[] = [240, 204, 130];
  if (a.skin) glow = oldGuiStyle(paletteFromStyle(chooseSkin(a.skin).style)).glow;
  else {
    const g = manifestGlow(theme);
    if (g) glow = g;
  }
  const only = a.only ? a.only.split(",").map((x) => x.trim()).filter(Boolean) : null;
  const screens = w.screens.all().filter((s) => !only || only.includes(s.key));
  if (only) {
    const unknown = only.filter((k) => !screens.some((s) => s.key === k));
    if (unknown.length) throw new UsageError(`no such screen: ${unknown.join(", ")}`);
  }
  mkdirSync(a.out, { recursive: true });
  const tex = w.theme(theme);
  const lines = frameCheck(
    w,
    tex,
    glow,
    screens.map((s) => s.key),
    (k, png) => writeFileSync(join(a.out!, `frames_${k}.png`), png),
    (i, n, k) => {
      if (process.stdout.isTTY) process.stdout.write(`\r  ${i}/${n} ${k}\x1b[K`);
    },
    (k, d) => writeFileSync(join(a.out!, `screen_${k}.png`), previewPair(w, d, tex, screens.find((s) => s.key === k)!.title)),
  );
  const report = lines.map((l) => `${l.key}\t${l.missing + l.stray + l.ends + l.spurs ? "look" : "ok"}\tmissing ${l.missing}\tstray ${l.stray}\tends ${l.ends}\tstubs ${l.spurs}\t${l.where}`);
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  writeFileSync(join(a.out, "frames.txt"), `${report.join("\n")}\n`);
  const look = report.filter((r) => r.split("\t")[1] === "look").length;
  console.log(`${screens.length} screens in ${a.out} (screen_*.png stock beside the theme, frames_*.png the frame check); ${look} with lines to look at (frames.txt)`);
  return 0;
}

/** The theme's hover glow, from the export's manifest beside the theme folder. */
function manifestGlow(theme: string): number[] | null {
  for (const d of [theme, dirname(theme)]) {
    const p = join(d, "reskin-manifest.json");
    if (!existsSync(p)) continue;
    try {
      const m = JSON.parse(readFileSync(p, "utf8")) as { palette?: Record<string, string> };
      if (m.palette?.glow) return parseHex(m.palette.glow).slice(0, 3);
    } catch {
      // not ours
    }
  }
  return null;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]!.replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, ""));
    return cmd ? 0 : 2;
  }
  if (cmd === "inventory") {
    const i = rest.findIndex((x) => x === "-o" || x === "--out");
    if (i >= 0 && rest[i + 1]) checkOutDir(rest[i + 1]!);
    return inventory(rest);
  }
  if (cmd === "check") return check(rest);
  if (cmd === "previews") return previews(rest);
  throw new UsageError(`unknown command ${cmd}; usage: ${USAGE}`);
}

main().then(
  (c) => process.exit(c),
  (e: unknown) => {
    const plain = e instanceof UsageError || e instanceof SkinChoiceError || (e instanceof Error && "code" in e && String(e.code).startsWith("ERR_PARSE_ARGS"));
    console.error(`old-gui: ${plain ? errorText(e) : e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(2);
  },
);
