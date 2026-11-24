/**
 * Draws NUI windows to PNG from the command line (headless, the same core as the browser).
 *
 *   pnpm render local/dumps/cnr-carpenter.json --overlay -o out.png
 *   pnpm render fixtures/widgets.jui --fallback
 *
 * Resources: --game (default $NWN_ROOT, else game in nui-designer.ini), --hak FILE (repeat, best first) or
 * --hak-dir DIR with --module-ifo FILE (the module's hak order: a nasher module.ifo.json, a module.ifo or a .mod), --override DIR (loose files after the
 * haks). Without --hak and --hak-dir, the haks and override folders nui-designer.ini names. Without a game (or with --fallback), a built-in skin: --theme ink (Ink and brass, the default), bronze, brass, verdigris, oxblood or winter.
 *
 * Prints the problems and exits 1 when there are any; exits 2 on bad options or a file it cannot read.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { InputError, loadDocument } from "../core/model/input.js";
import { problemString } from "../core/render/render.js";
import { renderView } from "../core/view.js";
import { HakOrderError } from "./hakorder.js";
import { checkReadable, nodeCanvas, savePng } from "./fs.js";
import { THEMES } from "../core/skin/themes.js";
import { cliResources } from "./setup.js";
import { errorText } from "../core/errors.js";

/** Stops with a one-line message (no stack trace) and exit code 2. */
class UsageError extends Error {}

function usage(): string {
  return readFileSync(new URL(import.meta.url)).toString().split("*/")[0]!.replace(/^\/\*\*?|^ \* ?/gm, "");
}

/** "1440x900" -> [1440, 900]. */
function parseCanvas(s: string): [number, number] {
  const m = /^(\d+)x(\d+)$/i.exec(s.trim());
  if (!m || !Number(m[1]) || !Number(m[2])) throw new UsageError(`--canvas ${s}: expected WIDTHxHEIGHT, e.g. 1440x900`);
  return [Number(m[1]), Number(m[2])];
}

/** "name=JSON" (or "name=text", kept as a string). */
function parseSet(s: string): [string, unknown] {
  const i = s.indexOf("=");
  if (i <= 0) throw new UsageError(`--set ${s}: expected bind=VALUE`);
  const v = s.slice(i + 1);
  try {
    return [s.slice(0, i), JSON.parse(v)];
  } catch {
    return [s.slice(0, i), v];
  }
}

function readText(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    throw new UsageError(`${file}: ${e instanceof Error && "code" in e && e.code === "ENOENT" ? "no such file" : "cannot read it"}`);
  }
}

/** Checks that a file can be read without reading it all (a hak can be over Node's string and buffer limits). */
function canRead(file: string): void {
  try {
    checkReadable(file);
  } catch (e) {
    throw new UsageError(`${file}: ${e instanceof Error && "code" in e && e.code === "ENOENT" ? "no such file" : "cannot read it"}`);
  }
}

function readJson(file: string): unknown {
  const text = readText(file);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`${file}: not JSON (${errorText(e)})`);
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      overlay: { type: "boolean" },
      crop: { type: "boolean" },
      canvas: { type: "string", default: "1440x900" },
      scale: { type: "string", default: "1" },
      "text-model": { type: "string", default: "nuklear" },
      game: { type: "string" },
      hak: { type: "string", multiple: true },
      "hak-dir": { type: "string" },
      "module-ifo": { type: "string" },
      override: { type: "string", multiple: true },
      fallback: { type: "boolean" },
      theme: { type: "string" },
      set: { type: "string", multiple: true },
      binds: { type: "string", multiple: true },
      json: { type: "string" },
      quiet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(usage());
    return 0;
  }
  if (!positionals.length) {
    console.error(usage());
    return 2;
  }

  const [cw, ch] = parseCanvas(values.canvas!);
  const scale = Number(values.scale);
  if (!(scale > 0)) throw new UsageError(`--scale ${values.scale}: expected a number above 0`);
  const textModel = values["text-model"];
  if (textModel !== "nuklear" && textModel !== "nui-preview") throw new UsageError(`--text-model ${textModel}: expected nuklear or nui-preview`);
  if (values.theme !== undefined && !THEMES.some((t) => t.id === values.theme)) {
    throw new UsageError(`--theme ${values.theme}: expected ${THEMES.map((t) => t.id).join(", ")}`);
  }
  if (positionals.length > 1 && values.out?.endsWith(".png")) throw new UsageError("-o: with several windows, give a folder, not a .png");
  if (!!values["hak-dir"] !== !!values["module-ifo"]) throw new UsageError("--hak-dir and --module-ifo go together");

  const overrides: Record<string, unknown> = {};
  for (const f of values.binds ?? []) Object.assign(overrides, readJson(f));
  for (const s of values.set ?? []) {
    const [k, v] = parseSet(s);
    overrides[k] = v;
  }

  if (values["module-ifo"]) canRead(values["module-ifo"]);
  const { res, used } = await cliResources(
    { game: values.game, hak: values.hak, hakDir: values["hak-dir"], moduleIfo: values["module-ifo"], override: values.override, fallback: values.fallback, theme: values.theme, textModel },
    canRead,
  );
  for (const h of used.missing) console.error(`hak ${h}: not in ${used.hakDir}`);
  if (used.noGame) console.error(`note: no game (${used.noGame}; or --game DIR): drawing with the built-in skin`);
  for (const w of res.warnings) console.error(`warning: ${w}`);

  let status = 0;
  const report: unknown[] = [];
  for (const file of positionals) {
    const name = basename(file, extname(file));
    let doc;
    try {
      doc = loadDocument(readText(file), name);
    } catch (e) {
      if (e instanceof InputError) throw new UsageError(`${file}: ${e.message}`);
      throw e;
    }
    const r = await renderView(doc, res.skin, res.images, nodeCanvas, {
      canvasW: cw,
      canvasH: ch,
      overlay: values.overlay,
      crop: values.crop,
      scale,
      binds: overrides,
    });
    let out = values.out;
    if (!out || (positionals.length > 1 && !out.endsWith(".png"))) {
      out = join(out ?? dirname(file), `${doc.name}${values.overlay ? ".overlay" : ""}.png`);
    }
    mkdirSync(dirname(out), { recursive: true });
    await savePng(r.canvas, out);
    if (!values.quiet) console.log(`${doc.name}: ${out}`);
    if (r.problems.length) {
      status = 1;
      console.log(`${doc.name}: ${r.problems.length} problem(s)`);
      r.problems.forEach((p, i) => console.log(`  ${i + 1}. ${problemString(p)}`));
    } else if (!values.quiet) console.log(`${doc.name}: no problems found`);
    report.push({ name: doc.name, window: r.windowRect, problems: r.problems, outlines: r.outlines.map((o) => ({ path: o.path, rect: o.rect, visible: o.visible, row: o.row })) });
  }
  if (values.json) writeFileSync(values.json, JSON.stringify(report, null, 1));
  return status;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    // parseArgs' own errors (an unknown option) are usage errors too.
    const usageError = e instanceof UsageError || e instanceof HakOrderError || (e instanceof Error && "code" in e && String(e.code).startsWith("ERR_PARSE_ARGS"));
    console.error(`render: ${e instanceof Error ? (usageError ? e.message : (e.stack ?? e.message)) : String(e)}`);
    process.exit(2);
  },
);
