/**
 * The .jui round trip with the real game (and Layonara's haks and skin when they are here), as a table: every fixture
 * and local dump is exported as a .jui, read back, and compared (model, binds, element rects, problems, pixels).
 * `pnpm test` runs the same comparison with the open fallback skin.
 *
 *   pnpm roundtrip [--fallback]
 */
import { parseArgs } from "node:util";
import { findGame, openResources } from "../src/node/setup.js";
import { localHaks } from "./minigame.js";
import { inputs, load, roundTrip } from "./roundtrip.js";

const { values } = parseArgs({ options: { fallback: { type: "boolean", default: false } } });
const game = values.fallback ? null : findGame();
const { haks, overrides } = game ? await localHaks() : { haks: [], overrides: [] };
const res = await openResources({ game, haks, overrides });
console.log(`Skin: ${res.skinFrom}; ${haks.length} haks; overrides: ${overrides.join(", ") || "none"}\n`);
console.log("| window | elements | problems | pixels | .jui bytes | model | binds | rects | problems | pixels |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
let bad = 0;
for (const x of inputs()) {
  const r = await roundTrip(load(x.file, x.name), res);
  const ok = r.model && r.binds && r.rects && r.problems && r.pixels;
  if (!ok) bad++;
  const y = (b: boolean) => (b ? "same" : "**DIFFERENT**");
  console.log(`| ${x.name}${x.local ? "" : " (fixture)"} | ${r.elements} | ${r.problemCount} | ${r.pixelCount.toLocaleString("en")} | ${r.juiBytes.toLocaleString("en")} | ${y(r.model)} | ${y(r.binds)} | ${y(r.rects)} | ${y(r.problems)} | ${y(r.pixels)} |`);
}
console.log(`\n${inputs().length - bad} of ${inputs().length} identical after the round trip.`);
if (bad) process.exitCode = 1;
