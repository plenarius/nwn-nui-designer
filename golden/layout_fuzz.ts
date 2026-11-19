/**
 * Random layouts solved by nui-preview's layout.py (kiwisolver, C++ Kiwi) and by this project's layout.ts, compared
 * rectangle by rectangle. Rows and columns nested a few deep, with fixed, missing and conflicting sizes, margins,
 * padding, aspect, spacers and unsized buttons: the cases where several solutions are equally good and the solver's
 * pivoting decides.
 *
 *   pnpm golden:layout [COUNT] [SEED]
 *
 * Needs uv and the reference code (NUI_PREVIEW, or an nwn-module checkout at NWN_MODULE or ../nwn-module): reference.ts.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { marginOf, solveContent, walk } from "../src/core/layout/layout.js";
import type { JsonObject } from "../src/core/model/types.js";
import { referenceCode, requireUv } from "./reference.js";

const ROOT = resolve(import.meta.dirname, "..");
const count = Number(process.argv[2] ?? 500);
let seed = Number(process.argv[3] ?? 1);
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;

function leaf(): JsonObject {
  const t = pick(["label", "button", "button_select", "spacer", "image", "text", "spacer"]);
  const e: JsonObject = { type: t };
  if (rnd() < 0.6) e.width = pick([20, 32, 50, 100, 150, 220]);
  if (rnd() < 0.7) e.height = pick([16, 24, 30, 32, 40]);
  // A button without a height asks for 50 at strong strength (docs/CLIENT-BEHAVIOUR.md#default-sizes), which
  // nui-preview's layout.py may not do yet: the fuzz gives buttons a height and leaves the default to tests/layout.
  if (t === "button" && e.height === undefined) e.height = pick([24, 32]);
  if (rnd() < 0.15) e.margin = pick([0, 1, 4, 8]);
  if (rnd() < 0.08) e.aspect = pick([0.5, 1, 2]);
  // A spacer's own margin is 0 in the client (layout.ts marginOf); nui-preview's layout.py still gives it 2, so the
  // fuzz spells it out and compares the solvers on the same constraints.
  if (e.margin === undefined) e.margin = marginOf(e);
  return e;
}

function span(depth: number): JsonObject {
  const e: JsonObject = { type: pick(["row", "col"]), children: [] };
  const n = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) (e.children as JsonObject[]).push(depth < 3 && rnd() < 0.4 ? span(depth + 1) : leaf());
  if (rnd() < 0.3) e.width = pick([100, 200, 300, 500]);
  if (rnd() < 0.3) e.height = pick([40, 80, 120, 300]);
  if (rnd() < 0.2) e.margin = pick([0, 2, 4]);
  if (rnd() < 0.15) e.padding = pick([2, 4, 6]);
  return e;
}

const cases = Array.from({ length: count }, () => ({ root: span(0), w: pick([300, 500, 640, 960]), h: pick([200, 400, 600]) }));
const out = join(ROOT, ".golden-out");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "fuzz-cases.json"), JSON.stringify(cases));

const py = `
import sys, json
sys.path.insert(0, sys.argv[1])
import layout as L
cases = json.load(open(sys.argv[2]))
res = []
for c in cases:
    try:
        s = L.solve_content([c["root"]], c["w"], c["h"], "")
        res.append([[n.path, list(n.rect)] for top in s.nodes for n in L.walk(top)])
    except Exception as e:
        res.append(type(e).__name__)
json.dump(res, open(sys.argv[3], "w"))
`;
writeFileSync(join(out, "fuzz.py"), `# /// script\n# dependencies = ["kiwisolver>=1.4"]\n# ///\n${py}`);
requireUv();
const ref = referenceCode(out);
execFileSync("uv", ["run", "--quiet", "--script", join(out, "fuzz.py"), ref, join(out, "fuzz-cases.json"), join(out, "fuzz-py.json")], { stdio: "inherit" });
const pyRes = JSON.parse(readFileSync(join(out, "fuzz-py.json"), "utf8")) as ([string, number[]][] | string)[];

let worst = 0;
let same = 0;
let bothFail = 0;
const mismatches: string[] = [];
cases.forEach((c, i) => {
  let ts: [string, number[]][] | string;
  try {
    const s = solveContent([c.root], c.w, c.h, "");
    ts = s.nodes.flatMap((top) => [...walk(top)].map((n) => [n.path, n.rect] as [string, number[]]));
  } catch (e) {
    ts = "UnsatisfiableConstraint";
  }
  const p = pyRes[i]!;
  if (typeof p === "string" || typeof ts === "string") {
    if (typeof p === "string" && typeof ts === "string") bothFail++;
    else mismatches.push(`case ${i}: python ${typeof p === "string" ? p : "solved"}, ts ${typeof ts === "string" ? ts : "solved"}`);
    return;
  }
  let w = 0;
  p.forEach(([path, r], k) => {
    const t = ts[k];
    if (!t || t[0] !== path) w = Infinity;
    else for (let j = 0; j < 4; j++) w = Math.max(w, Math.abs(t[1][j]! - r[j]!));
  });
  if (w <= 0.5) same++;
  else mismatches.push(`case ${i}: worst ${w}`);
  if (Number.isFinite(w)) worst = Math.max(worst, w);
});
console.log(`${count} random layouts: ${same} within 0.5 px (worst ${worst.toFixed(4)} px), ${bothFail} refused by both, ${mismatches.length} differ`);
for (const m of mismatches.slice(0, 20)) console.log(`  ${m}`);
writeFileSync(join(out, "fuzz-summary.txt"), `${count} random layouts (seed ${process.argv[3] ?? 1}): ${same} within 0.5 px, worst ${worst.toFixed(4)} px, ${bothFail} refused by both, ${mismatches.length} differ\n${mismatches.join("\n")}\n`);
process.exitCode = mismatches.length ? 1 : 0;
