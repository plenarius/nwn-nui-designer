/**
 * pnpm old-gui: the original (MDL-panel) GUI's texture inventory, and the checks a theme of it must pass.
 * docs/RESKIN-EVERYTHING.md is the guide.
 *
 *   pnpm old-gui inventory -o DIR [--game DIR] [--hak FILE]... [--override DIR]... [--no-haks] [--client FILE]
 *                          [--roles FILE]
 *   pnpm old-gui check DIR [--theme DIR] [--skin SKIN] [--json]
 *
 * inventory  reads every GUI model, every .gui layout, the txi links and the client's built-in names from your game
 *            and haks (as `pnpm reskin` reads them), gives every texture a role, and writes into DIR:
 *              old-gui-inventory.tsv   one row per texture: role, treatment, drawn or not, where it is used
 *              old-gui-cells.json      every UV cell the models sample from each drawn texture
 *            Both are names and numbers only (no art), so a theme's repository may keep them and run the checks in
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
 *            Without --theme only the first, third and fourth run. --skin SKIN: the skin the theme was made from
 *            (its light fills are allowed as faces; else the export's manifest beside the theme says). --json: the
 *            results as JSON.
 *
 * Exit code: 0 when everything passes, 1 when a check fails, 2 on a usage error.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

const USAGE = "pnpm old-gui inventory -o DIR [--game DIR] [--hak FILE]... [--override DIR]... [--no-haks] [--client FILE] [--roles FILE] | pnpm old-gui check DIR [--theme DIR] [--skin SKIN] [--json]";

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
  const counts = inventoryCounts(inv.rows);
  const bad = [...c.models.values()].filter((m) => m.error);
  console.log(`${c.models.size} models (${bad.length} unreadable), ${c.layouts.size} layouts, ${inv.rows.length} textures, ${inv.rows.filter((r) => r.drawn).length} drawn`);
  console.log(`  ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  for (const m of bad.slice(0, 10)) console.log(`  unreadable model ${m.name} (${m.source}): ${m.error}`);
  console.log(`wrote ${join(a.out, "old-gui-inventory.tsv")} and ${join(a.out, "old-gui-cells.json")}`);
  return 0;
}

async function check(args: string[]): Promise<number> {
  const { values: a, positionals } = parseArgs({ args, allowPositionals: true, options: { theme: { type: "string" }, skin: { type: "string" }, json: { type: "boolean" } } });
  const dir = positionals[0];
  if (!dir || positionals.length > 1) throw new UsageError(`one inventory folder; usage: ${USAGE}`);
  if (!existsSync(join(dir, "old-gui-inventory.tsv"))) throw new UsageError(`${dir}: no old-gui-inventory.tsv (run pnpm old-gui inventory -o ${dir} first)`);
  let pal: CheckPalette | null = null;
  if (a.skin) {
    const p = paletteFromStyle(chooseSkin(a.skin).style);
    pal = { ink: p.ink, allowed: lightFills(p) };
  }
  const r = await runChecks(dir, a.theme ?? null, pal);
  if (a.json) console.log(JSON.stringify(r, null, 1));
  else for (const line of r.lines) console.log(line);
  return r.failures ? 1 : 0;
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
