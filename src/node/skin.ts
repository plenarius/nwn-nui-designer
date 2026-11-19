/**
 * The skin tools from the command line (they replace tools/open-skin/gen_skin.py, build_hak.py, check_skin.py and
 * widget_sheet.py):
 *
 *   pnpm skin ship [--theme ID] [--check]   rebuild the built-in skins, assets/skin/<theme>/ (all five without
 *                                        --theme; --check: compare, write nothing). IDs: ink, bronze, brass,
 *                                        verdigris, oxblood (src/core/skin/themes.ts)
 *   pnpm skin preset d-iron -o DIR       a preset's files into a folder (not shipped)
 *   pnpm skin hak [--theme ID] [-o FILE] [--erf]   a built-in skin packed as a hak a module can use
 *                                        (default: Ink and brass, nuid_ink_skin.hak; each theme's hak name is in themes.ts)
 *   pnpm skin check SKIN.tml [--res DIR]... [--game [DIR]] [--hak FILE]...   every key the client reads, and the files
 *   pnpm skin sheet DIR|--game [DIR] [-o out.png] [--title T]   the widget-states sheet of a skin folder (or the game's skin)
 *
 * --game without a folder is the game at $NWN_ROOT (else nui-designer.ini's game).
 *
 * Set SOURCE_DATE_EPOCH for a reproducible hak.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { writeErf } from "../core/res/erfwrite.js";
import { Folder } from "../core/res/containers.js";
import { ResMan } from "../core/res/resman.js";
import { checkSkin } from "../core/skin/check.js";
import { openSkinHakDescription, openSkinHakEntries, styleFontKeys } from "../core/skin/gen/ship.js";
import { PRESETS } from "../core/skin/gen/style.js";
import { THEMES, themeOf } from "../core/skin/themes.js";
import { preloadSkinImages, widgetSheet } from "../core/skin/sheet.js";
import { TmlDoc } from "../core/skin/tmldoc.js";
import { TomlError } from "../core/skin/toml.js";
import { folderSources, nodeCanvas, savePng } from "./fs.js";
import { shipFiles, sources, themeDir } from "./openskin.js";
import { findGame, isGameDir, noGameReason, openResources } from "./setup.js";
import { imageToCanvas } from "../core/render/canvas.js";
import { errorText } from "../core/errors.js";


/** Stops with a one-line message and exit code 2. */
class UsageError extends Error {}

// "--game" with no folder after it means $NWN_ROOT: parseArgs has no optional values, so it becomes "--game=".
const argv = process.argv.slice(2).map((x, i, all) => (x === "--game" && (i === all.length - 1 || all[i + 1]!.startsWith("-")) ? "--game=" : x));

const { values: a, positionals } = (() => {
  try {
    return parseOptions();
  } catch (e) {
    console.error(`skin: ${errorText(e)}`);
    process.exit(2);
  }
})();

function parseOptions() {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      check: { type: "boolean" },
      erf: { type: "boolean" },
      res: { type: "string", multiple: true },
      game: { type: "string" },
      hak: { type: "string", multiple: true },
      theme: { type: "string" },
      title: { type: "string" },
    },
  });
}

/** The game folder --game names: its value, or $NWN_ROOT for a bare --game; undefined without --game. */
function gameOption(): string | undefined {
  if (a.game === undefined) return undefined;
  if (a.game) {
    if (!isGameDir(a.game)) throw new UsageError(`--game ${a.game}: not an NWN:EE install with data (no data/nwn_base.key, or empty BIFs)`);
    return a.game;
  }
  const g = findGame();
  if (!g) throw new UsageError(`--game: no game (${noGameReason()}): set NWN_ROOT or give the folder, --game DIR`);
  return g;
}

/** The --theme (default: the default theme); an unknown one is an error, not a quiet fallback. */
function themeOption() {
  if (a.theme !== undefined && !THEMES.some((t) => t.id === a.theme)) throw new UsageError(`--theme ${a.theme}: expected ${THEMES.map((t) => t.id).join(", ")}`);
  return themeOf(a.theme);
}

function sameBytes(x: Uint8Array, y: Uint8Array): boolean {
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

async function main(): Promise<number> {
  const cmd = positionals[0];
  if (cmd === "ship") {
    const themes = a.theme ? [themeOption()] : THEMES;
    let bad = 0;
    for (const t of themes) {
      const dir = themeDir(t.id);
      const files = shipFiles(t.style);
      if (a.check) {
        const have = existsSync(dir) ? readdirSync(dir) : [];
        const diff = [
          ...Object.keys(files).filter((n) => !have.includes(n) || !sameBytes(files[n]!, new Uint8Array(readFileSync(join(dir, n))))),
          ...have.filter((n) => !(n in files)),
        ];
        if (diff.length) {
          console.log(`${dir}: differs from a fresh build: ${diff.sort().join(", ")}`);
          bad++;
        } else console.log(`${dir}: same as a fresh build (${Object.keys(files).length} files)`);
        continue;
      }
      mkdirSync(dir, { recursive: true });
      for (const [n, d] of Object.entries(files)) writeFileSync(join(dir, n), d);
      console.log(`built ${dir} (${Object.keys(files).length} files)`);
    }
    return bad ? 1 : 0;
  }
  if (cmd === "preset") {
    const style = PRESETS.find((s) => s.key === positionals[1]);
    if (!style || !a.out) throw new UsageError(`pnpm skin preset <${PRESETS.map((s) => s.key).join("|")}> -o DIR`);
    mkdirSync(a.out, { recursive: true });
    for (const [n, d] of Object.entries(shipFiles(style))) if (n !== "LICENSE") writeFileSync(join(a.out, n), d);
    console.log(`built ${a.out}`);
    return 0;
  }
  if (cmd === "hak") {
    const t = themeOption();
    const out = a.out ?? `${t.hak}.${a.erf ? "erf" : "hak"}`;
    if (basename(out).replace(/\.[^.]+$/, "").length > 16) throw new Error(`${out}: a hak's name must be at most 16 characters`);
    const files: Record<string, Uint8Array> = {};
    for (const f of readdirSync(themeDir(t.id))) files[f] = new Uint8Array(readFileSync(join(themeDir(t.id), f)));
    const epoch = process.env.SOURCE_DATE_EPOCH;
    const entries = openSkinHakEntries(files);
    const src = sources();
    const description = openSkinHakDescription(styleFontKeys(t.style).map((k) => src[k]!), t.title);
    const bytes = writeErf(entries, { fileType: a.erf ? "ERF" : "HAK", description, date: epoch ? new Date(Number(epoch) * 1000) : new Date() });
    writeFileSync(out, bytes);
    console.log(`${out}: ${t.title}, ${entries.length} resources, ${bytes.length} bytes`);
    return 0;
  }
  if (cmd === "check") {
    const file = positionals[1];
    if (!file) throw new UsageError("pnpm skin check SKIN.tml [--res DIR]... [--game [DIR]] [--hak FILE]...");
    if (!existsSync(file)) throw new UsageError(`${file}: no such file`);
    const doc = new TmlDoc(readFileSync(file, "utf8"));
    const game = gameOption();
    let res = null;
    if (a.res?.length || game || a.hak?.length) {
      const r = await openResources({ game: game ?? null, haks: a.hak ?? [], fallback: !game });
      const rm = new ResMan();
      const own = (a.res ?? []).map((d) => new Folder(d, folderSources(d)));
      rm.layers = [...own.map((c) => ({ kind: "override" as const, container: c })), ...r.resman.layers.filter((l) => l.kind !== "memory")];
      res = { resman: rm, isOwn: (l: { container: unknown }) => own.includes(l.container as Folder) };
    }
    const found = checkSkin(doc.data(), res, { literal: (k) => doc.literal(k) });
    for (const f of found) console.log(`${f.severity.padEnd(7)} ${f.text}`);
    const errors = found.filter((f) => f.severity === "error").length;
    console.log(`${file}: ${errors} error(s), ${found.filter((f) => f.severity === "warning").length} warning(s), ${found.filter((f) => f.severity === "note").length} note(s)`);
    return errors ? 1 : 0;
  }
  if (cmd === "sheet") {
    const dir = positionals[1];
    if (dir && !existsSync(dir)) throw new UsageError(`${dir}: no such folder`);
    // No folder and no --game: the game at $NWN_ROOT if there is one, else the built-in skin (--theme).
    const game = gameOption() ?? (dir ? null : findGame());
    const r = await openResources({ game, overrides: dir ? [dir] : [], fallback: !game && !dir, theme: themeOption().id });
    let res = r;
    if (dir) {
      // A folder's own nui_skin.tml over the fallback.
      const { skinResources } = await import("../core/skin/preview.js");
      const { fromResources } = await import("../core/skin/project.js");
      const files = readdirSync(dir).map((f) => {
        const dot = f.lastIndexOf(".");
        return [f.slice(0, dot).toLowerCase(), f.slice(dot + 1).toLowerCase(), async () => new Uint8Array(readFileSync(join(dir, f)))] as [string, string, () => Promise<Uint8Array>];
      });
      res = await skinResources(r, await fromResources(dir, "files", files), { makeCanvas: nodeCanvas });
    }
    await preloadSkinImages(res.skin, res.images);
    const im = widgetSheet(res.skin, res.images, { makeCanvas: nodeCanvas, title: a.title ?? (dir ? basename(dir) : "game skin") });
    const out = a.out ?? "widgets.png";
    await savePng(imageToCanvas(nodeCanvas, im), out);
    console.log(out);
    return 0;
  }
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]!.replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, ""));
  return cmd ? 2 : 0;
}

main().then(
  (c) => process.exit(c),
  (e: unknown) => {
    // Usage errors and bad files are one line; anything else is a bug, with its stack.
    const plain = e instanceof UsageError || e instanceof TomlError || (e instanceof Error && "code" in e && String(e.code).startsWith("ERR_PARSE_ARGS"));
    console.error(`skin: ${e instanceof Error ? (plain ? e.message : (e.stack ?? e.message)) : String(e)}`);
    process.exit(2);
  },
);
