/**
 * The golden check: draws the same windows with nwn-module's nui-preview (Python, the reference; it draws as the
 * client does since nwn-module PRs #1115 and #1121) and with this project's core (TypeScript, the one drawing mode there is),
 * and compares every element's rectangle, the problems and the pixels.
 *
 *   pnpm golden                      # the committed fixtures, and local/dumps/{cnr-carpenter,gods,achv} if present
 *   pnpm golden local/dumps/*.json   # any windows
 *
 * Needs the game (NWN_ROOT) and uv. Haks: --hak-dir DIR (default $NWN_HAK_DIR) and the module's hak order from
 * --module-ifo FILE, else $NWN_MODULE_IFO, else local/res/module.ifo.json, else module.ifo.json at origin/ee in the
 * nwn-module checkout (NWN_MODULE, default ../nwn-module); a hak folder without a hak order loads no haks and says so;
 * --override DIR (default local/res/layo-skin if it exists: a skin and fonts newer than the built haks; the name is
 * Layonara's, kept as an example, and any folder of loose skin files works). The reference code is read from
 * NUI_PREVIEW (a folder) or extracted from the nwn-module
 * checkout at NWN_MODULE (default ../nwn-module) at origin/ee (reference.ts).
 *
 * Output: .golden-out/ (both renders, the JSON, summary.md) and the side-by-side pictures (Python | TypeScript |
 * diff) in .out/ at the repository root (OUT_DIR to change it).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { loadDocument } from "../src/core/model/input.js";
import { renderView } from "../src/core/view.js";
import { nodeCanvas } from "../src/node/fs.js";
import { findGame, moduleHakPaths, noGameReason, openResources } from "../src/node/setup.js";
import { loadSettings } from "../src/node/settings.js";
import { die, findModuleIfo, referenceCode, referenceSha, requireUv } from "./reference.js";

const ROOT = resolve(import.meta.dirname, "..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "hak-dir": { type: "string" },
    "module-ifo": { type: "string" },
    override: { type: "string", multiple: true },
    tolerance: { type: "string", default: "32" },
    // nuklear (the designer's default, the client's, and nui-preview's since nwn-module #1121) or nui-preview (the
    // em metrics nui-preview used before #1121).
    "text-model": { type: "string", default: "nuklear" },
  },
});

const game = findGame();
if (!game) die(`golden: no game data: ${noGameReason()}`);
const settings = loadSettings();
const hakDir = values["hak-dir"] ?? settings.hakDir ?? undefined;
// The module's hak order: haks are only loaded with it (a hak folder alone does not say which haks, or in which order).
const { ifo, tried: ifoTried } = findModuleIfo(values["module-ifo"]);
if (ifo && !existsSync(ifo)) die(`golden: module.ifo.json not found: ${ifo}`);
const overrides = values.override ?? (settings.overrides.length ? settings.overrides : existsSync(join(ROOT, "local/res/layo-skin")) ? [join(ROOT, "local/res/layo-skin")] : []);
const tol = Number(values.tolerance);

let files = positionals;
if (!files.length) {
  files = readdirSync(join(ROOT, "fixtures"))
    .filter((f) => f.endsWith(".jui") || f.endsWith(".json"))
    .map((f) => join(ROOT, "fixtures", f));
  for (const n of ["cnr-carpenter", "gods", "achv"]) {
    const p = join(ROOT, "local/dumps", `${n}.json`);
    if (existsSync(p)) files.push(p);
  }
}
files = files.map((f) => resolve(f));

const out = join(ROOT, ".golden-out");
const pyOut = join(out, "py");
const tsOut = join(out, "ts");
const sideOut = resolve(process.env.OUT_DIR ?? join(ROOT, ".out"));
for (const d of [pyOut, tsOut, sideOut]) mkdirSync(d, { recursive: true });

requireUv();
const ref = referenceCode(out);
const sha = referenceSha();

console.log(`reference: ${ref} (nwn-module origin/ee ${sha})`);
const pyArgs = [join(ROOT, "golden/py_export.py"), "--nui-preview", ref, "--out", pyOut, "--game", game];
if (hakDir && ifo) pyArgs.push("--hak-dir", hakDir, "--module-ifo", ifo);
for (const o of overrides) pyArgs.push("--override", o);
execFileSync("uv", ["run", "--quiet", "--script", ...pyArgs, ...files], { stdio: "inherit" });

let haks: string[] = [];
if (hakDir && ifo) {
  const m = await moduleHakPaths(hakDir, ifo);
  haks = m.haks;
  console.log(`haks: ${haks.length} from ${hakDir} in the order of ${ifo}`);
  if (m.missing.length) console.error(`warning: ${m.missing.length} hak(s) the module lists are not in ${hakDir}: ${m.missing.join(", ")}`);
  if (!haks.length) console.error(`warning: a hak folder was given (${hakDir}) but none of ${ifo}'s haks are in it: no haks loaded`);
} else if (hakDir) {
  console.error(`warning: a hak folder was given (${hakDir}) but no module.ifo.json (no --module-ifo, NWN_MODULE_IFO or module_ifo in ${settings.iniPath}, and none of ${ifoTried.join(", ")}): no haks loaded`);
}
const textModel = values["text-model"] === "nui-preview" ? "nui-preview" : "nuklear";
const res = await openResources({ game, haks, overrides, textModel });
for (const w of res.warnings) console.error(`warning: ${w}`);

interface PyOutline {
  rect: number[];
  path: string;
  span: boolean;
}

async function pixels(path: string) {
  const im = await loadImage(readFileSync(path));
  const c = createCanvas(im.width, im.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(im, 0, 0);
  return { w: im.width, h: im.height, data: ctx.getImageData(0, 0, im.width, im.height).data };
}

// Fonts: the advances both sides measure.
const pyFonts = JSON.parse(readFileSync(join(pyOut, "fonts.json"), "utf8")) as Record<string, { size: number; ascent: number; descent: number; advances: Record<string, number> }>;
const fontLines: string[] = [];
for (const [name, f] of Object.entries(pyFonts)) {
  const tf = res.skin.font(name);
  let worst = 0;
  for (const [ch, a] of Object.entries(f.advances)) worst = Math.max(worst, Math.abs(tf.advance(ch) - a));
  fontLines.push(`| ${name} | ${f.size} | ${f.ascent}/${f.descent} | ${tf.ascent}/${tf.descent} | ${worst.toFixed(4)} |`);
}

const rows: string[] = [];
const results: unknown[] = [];
for (const file of files) {
  const stem = basename(file, extname(file));
  const doc = loadDocument(readFileSync(file, "utf8"), stem);
  const py = JSON.parse(readFileSync(join(pyOut, `${stem}.json`), "utf8")) as { error?: string; window: number[]; outlines: PyOutline[]; problems: { path: string; kind: string }[] };
  const r = await renderView(doc, res.skin, res.images, nodeCanvas);
  const tsPng = join(tsOut, `${stem}.png`);
  writeFileSync(tsPng, await (r.canvas as unknown as { encode(f: "png"): Promise<Buffer> }).encode("png"));
  if (py.error) {
    rows.push(`| ${stem} | - | - | - | - | - | - | - | - | nui-preview cannot draw it: ${py.error.replace(/\|/g, "/")} |`);
    console.log(`${stem}: nui-preview failed (${py.error}); TypeScript render only`);
    results.push({ name: stem, error: py.error });
    continue;
  }

  // Rectangles, matched by path and occurrence.
  const key = (p: string, seen: Map<string, number>) => {
    const k = seen.get(p) ?? 0;
    seen.set(p, k + 1);
    return `${p}#${k}`;
  };
  const tsRects = new Map<string, number[]>();
  const seenT = new Map<string, number>();
  for (const o of r.outlines) tsRects.set(key(o.path, seenT), o.rect);
  let worst = 0;
  let worstPath = "";
  let missing = 0;
  const seenP = new Map<string, number>();
  const pairs: [number[], number[], string][] = [];
  for (const o of py.outlines) {
    const t = tsRects.get(key(o.path, seenP));
    if (!t) {
      missing++;
      continue;
    }
    pairs.push([o.rect, t, o.path]);
    for (let i = 0; i < 4; i++) {
      const d = Math.abs(t[i]! - o.rect[i]!);
      if (d > worst) {
        worst = d;
        worstPath = o.path;
      }
    }
  }
  // The window body's offset (the most common move of a rect: (0, -1) for a window with a title in a nui-preview
  // before nwn-module #1121, which drew the body 1 px lower; (0, 0) since), and the worst difference once that is taken
  // out.
  const moves = new Map<string, number>();
  for (const [a, b] of pairs) {
    const k = `${b[0]! - a[0]!},${b[1]! - a[1]!}`;
    moves.set(k, (moves.get(k) ?? 0) + 1);
  }
  const [ox, oy] = ([...moves.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? "0,0").split(",").map(Number) as [number, number];
  let residual = 0;
  let residualPath = "";
  for (const [a, b, p] of pairs) {
    const d = Math.max(Math.abs(b[0]! - a[0]! - ox), Math.abs(b[1]! - a[1]! - oy), Math.abs(b[2]! - a[2]!), Math.abs(b[3]! - a[3]!));
    if (d > residual) {
      residual = d;
      residualPath = `${p}: py ${a.map((v) => +v.toFixed(2)).join(",")} ts ${b.map((v) => +v.toFixed(2)).join(",")}`;
    }
  }
  const extra = r.outlines.length - (py.outlines.length - missing);

  // Pixels.
  const a = await pixels(join(pyOut, `${stem}.png`));
  const b = await pixels(tsPng);
  const [wx, wy, ww, wh] = r.windowRect;
  const m = 12;
  const x0 = Math.max(0, wx - m);
  const y0 = Math.max(0, wy - m);
  const x1 = Math.min(a.w, wx + ww + m);
  const y1 = Math.min(a.h, wy + wh + m);
  const cw = x1 - x0;
  const chh = y1 - y0;
  let anyDiff = 0;
  let bigDiff = 0;
  let total = 0;
  let sumAbs = 0;
  // Below nui-preview's title bar, the TypeScript pixel to compare is moved by the body's offset (above).
  const bodyTop = typeof py.window[1] === "number" ? py.window[1] + 33 : y0;
  const side = createCanvas(cw * 3 + 16, chh);
  const sctx = side.getContext("2d");
  sctx.fillStyle = "#ffffff";
  sctx.fillRect(0, 0, side.width, side.height);
  const diff = sctx.createImageData(cw, chh);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.w + x) * 4;
      const j = y >= bodyTop ? ((y + oy) * a.w + (x + ox)) * 4 : i;
      const d = Math.max(Math.abs(a.data[i]! - b.data[j]!), Math.abs(a.data[i + 1]! - b.data[j + 1]!), Math.abs(a.data[i + 2]! - b.data[j + 2]!));
      total++;
      sumAbs += d;
      if (d > 0) anyDiff++;
      if (d > tol) bigDiff++;
      const o = ((y - y0) * cw + (x - x0)) * 4;
      const g = Math.round((a.data[i]! + a.data[i + 1]! + a.data[i + 2]!) / 3 / 3);
      if (d > tol) {
        diff.data[o] = 255;
        diff.data[o + 1] = 40;
        diff.data[o + 2] = 40;
      } else if (d > 0) {
        diff.data[o] = 255;
        diff.data[o + 1] = 190;
        diff.data[o + 2] = 0;
      } else {
        diff.data[o] = diff.data[o + 1] = diff.data[o + 2] = g;
      }
      diff.data[o + 3] = 255;
    }
  }
  const pyIm = await loadImage(readFileSync(join(pyOut, `${stem}.png`)));
  const tsIm = await loadImage(readFileSync(tsPng));
  sctx.drawImage(pyIm, x0, y0, cw, chh, 0, 0, cw, chh);
  sctx.drawImage(tsIm, x0, y0, cw, chh, cw + 8, 0, cw, chh);
  sctx.putImageData(diff, 2 * cw + 16, 0);
  const sidePng = join(sideOut, `${stem}.png`);
  writeFileSync(sidePng, await side.encode("png"));

  // "unsolvable size" is the designer's port of nwn-module's nui_i_check (src/core/render/check.ts), which nui-preview
  // does not run: it names the span whose fixed size its children cannot fit, next to the solver's "unsolvable
  // layout" that both sides report. It is compared on its own (counted after the "+"), not as a difference. So is
  // "tooltip off screen" (docs/CLIENT-BEHAVIOUR.md#tooltips), which nui-preview does not check either.
  const CHECK_ONLY = ["unsolvable size", "tooltip off screen"];
  const pyKinds = py.problems.map((p) => `${p.kind} ${p.path}`).sort();
  const tsAll = r.problems.map((p) => `${p.kind} ${p.path}`).sort();
  const tsKinds = tsAll.filter((k) => !CHECK_ONLY.some((c) => k.startsWith(`${c} `)));
  const checkOnly = tsAll.length - tsKinds.length;
  const problemsMatch = JSON.stringify(pyKinds) === JSON.stringify(tsKinds);
  const row = {
    name: stem,
    elements: py.outlines.length,
    worstRect: worst,
    worstPath,
    bodyOffset: [ox, oy],
    residualRect: residual,
    residualPath,
    missing,
    extra,
    pixelsDiffering: (100 * anyDiff) / total,
    pixelsOverTolerance: (100 * bigDiff) / total,
    meanAbs: sumAbs / total,
    problems: `${py.problems.length} / ${tsKinds.length}${checkOnly ? ` + ${checkOnly} nui_i_check` : ""}${problemsMatch ? "" : " (differ)"}`,
    side: sidePng,
  };
  results.push({ ...row, pyProblems: pyKinds, tsProblems: tsAll });
  rows.push(
    `| ${stem} | ${row.elements} | ${worst.toFixed(3)} | ${ox},${oy} | ${residual.toFixed(3)} | ${missing}/${extra} | ${row.pixelsOverTolerance.toFixed(3)}% | ${row.pixelsDiffering.toFixed(2)}% | ${row.meanAbs.toFixed(3)} | ${row.problems} |`,
  );
  console.log(
    `${stem}: rects worst ${worst.toFixed(3)} px${worstPath ? ` (${worstPath})` : ""}, missing ${missing}, extra ${extra}; ` +
      `pixels > ${tol}: ${row.pixelsOverTolerance.toFixed(3)}%, any: ${row.pixelsDiffering.toFixed(2)}%; problems ${row.problems} -> ${sidePng}`,
  );
}

const summary = [
  `# Golden check`,
  ``,
  `Reference: nwn-module tools/nui-preview at origin/ee ${sha}. Game: ${game}. Haks: ${haks.length}. Overrides: ${overrides.join(", ") || "none"}. Text model: ${textModel}.`,
  ``,
  `Problems compare kind and path. "+ N nui_i_check" counts the designer's "unsolvable size" findings (its port of nwn-module's nui_i_check, which nui-preview does not run); they are left out of the comparison.`,
  ``,
  `Pixels are compared over the window and a 12 px margin; "> ${tol}" counts pixels whose largest channel differs by more than ${tol}. Below the title bar the TypeScript render is compared moved back by the body offset, if any (a nui-preview before nwn-module #1121 left a 1 px gap under the title bar that the client does not: DESIGN.md).`,
  ``,
  `| window | elements | worst rect diff (px) | body offset | worst rect diff after it | missing/extra | pixels > ${tol} | pixels differing | mean abs diff | problems py / ts |`,
  `|---|---|---|---|---|---|---|---|---|---|`,
  ...rows,
  ``,
  `Fonts (advances for U+0020..U+007E):`,
  ``,
  `| font | size | ascent/descent py | ascent/descent ts | worst advance diff (px) |`,
  `|---|---|---|---|---|`,
  ...fontLines,
  ``,
];
writeFileSync(join(out, "summary.md"), summary.join("\n"));
writeFileSync(join(out, "summary.json"), JSON.stringify(results, null, 1));
console.log(`\n${summary.join("\n")}`);
