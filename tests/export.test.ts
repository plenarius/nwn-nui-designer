// The exports: the .jui round trip (model, layout and render identical) over the fixtures and every local dump, and
// the NWScript export (its program builds the window's JSON exactly; the CI's compiler compiles it against the base
// game's nw_inc_nui.nss).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as N from "../src/core/model/nui.js";
import { writeJui } from "../src/core/edit/jui.js";
import { buildProgram, evalProgram, jsonEqual, nssString, nwscriptOptions, sameFloat32, writeNwscript } from "../src/core/edit/nwscript.js";
import { defaultExport, openText } from "../src/core/edit/project.js";
import { ELEMENTS, newWindow } from "../src/core/edit/catalog.js";
import { addElement } from "../src/core/edit/ops.js";
import { findGame, openResources } from "../src/node/setup.js";
import type { Resources } from "../src/core/session.js";
import { inputs, load, roundTrip } from "./roundtrip.js";

const all = inputs();
const local = all.filter((x) => x.local).length;
let res: Resources;
beforeAll(async () => {
  res = await openResources({ game: null });
});

describe(".jui", () => {
  it("writes floats where the builders make floats, and nothing else changes", () => {
    const w = N.NuiWindow(N.NuiCol([N.NuiHeight(N.NuiLabel(N.NuiBind("x"), 1, 0), 30), N.NuiList([N.NuiListTemplateCell(N.NuiButton("b"), 40, false)], 3, 36)]), "T", N.NuiRect(-1, -1, 300, 200));
    const t = writeJui(w);
    expect(t).toContain('"height": 30.0');
    expect(t).toContain('"x": -1.0');
    expect(t).toContain('"row_height": 36.0');
    expect(t).toMatch(/40\.0,\s+false/);
    expect(t).toContain('"text_halign": 1,');
    expect(t).toContain('"number_flags": 0');
    expect(t).toContain('"version": 1,');
    expect(JSON.parse(t)).toEqual(w);
    expect(JSON.parse(writeJui(w, ""))).toEqual(w);
    expect(writeJui(w, "")).not.toContain("\n");
  });

  it(`round-trips ${all.length} windows (${local} local dumps): same model, rects, problems and pixels`, async () => {
    const bad: string[] = [];
    for (const x of all) {
      const r = await roundTrip(load(x.file, x.name), res);
      const fails = (["model", "binds", "rects", "problems", "pixels"] as const).filter((k) => !r[k]);
      if (fails.length) bad.push(`${x.name}: ${fails.join(", ")}`);
    }
    expect(bad).toEqual([]);
  }, 300_000);
});

describe("NWScript", () => {
  it("compares numbers as NWScript floats: the compiler's literal can be one float32 step low", () => {
    // nwn_script_comp parses 0.05 as 0.049999997 (truncated); a correctly rounded parse gives 0.050000001.
    expect(sameFloat32(0.04999999701976776, 0.05)).toBe(true);
    expect(sameFloat32(3.1399998664855957, 3.14)).toBe(true);
    expect(sameFloat32(0.0499999, 0.05)).toBe(false);
    expect(sameFloat32(150, 150)).toBe(true);
    expect(jsonEqual({ a: [0.04999999701976776] }, { a: [0.05] }, true)).toBe(true);
    expect(jsonEqual({ a: [0.04999999701976776] }, { a: [0.05] })).toBe(false);
  });

  it("escapes strings as cp1252 bytes", () => {
    expect(nssString('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
    expect(nssString("é…一")).toBe('"\\xe9\\x85?"');
  });

  it(`builds exactly the window's JSON, for ${all.length} windows and every palette element`, () => {
    let d = { name: "palette", window: newWindow(), binds: {}, panes: {}, notes: "", export: defaultExport("palette") };
    for (const spec of ELEMENTS) d = addElement(d, { parent: [], index: 999 }, spec.make()).doc;
    const docs = [d, ...all.map((x) => load(x.file, x.name))];
    const bad: string[] = [];
    for (const doc of docs) {
      const p = buildProgram(doc.window, nwscriptOptions(doc));
      const got = evalProgram(p);
      if (!jsonEqual(got, doc.window, true)) bad.push(doc.name);
      // Through the .jui too: the same window either way.
      if (!jsonEqual(evalProgram(buildProgram(openText(writeJui(doc.window)).doc.window, nwscriptOptions(doc))), got, true)) bad.push(`${doc.name} (via .jui)`);
    }
    expect(bad).toEqual([]);
  });

  const game = findGame();
  const compiler = (() => {
    try {
      execFileSync("nwn_script_comp", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  let dir = "";
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!game || !compiler)(`compiles with nwn_script_comp against the base game's nw_inc_nui.nss (${game ?? "no game"})`, () => {
    dir = mkdtempSync(join(tmpdir(), "nuid-nss-"));
    let d = { name: "palette", window: newWindow(), binds: {}, panes: {}, notes: "", export: defaultExport("palette") };
    for (const spec of ELEMENTS) d = addElement(d, { parent: [], index: 999 }, spec.make()).doc;
    const docs = [d, ...all.map((x) => load(x.file, x.name))];
    const names: string[] = [];
    docs.forEach((doc, i) => {
      const script = `nuid_t${i}`;
      const o = { ...nwscriptOptions(doc), script, prefix: `W${i}` };
      writeFileSync(join(dir, `${script}.nss`), writeNwscript(doc.window, o), "latin1");
      writeFileSync(join(dir, `nuid_i${i}.nss`), writeNwscript(doc.window, { ...o, skeleton: false }), "latin1");
      names.push(script);
    });
    // Scripts with main (the skeleton), and the include-only form checked as includes.
    const run = (args: string[]) => {
      try {
        return { ok: true, out: execFileSync("nwn_script_comp", ["--root", game!, "-y", ...args], { encoding: "utf8", stdio: "pipe" }) };
      } catch (e) {
        const x = e as { stdout?: string; stderr?: string };
        return { ok: false, out: `${x.stdout ?? ""}${x.stderr ?? ""}` };
      }
    };
    const withMain = run(["-d", dir, "-c", ...names.map((n) => join(dir, `${n}.nss`))]);
    expect(withMain.out).not.toMatch(/ERROR|errored(?!.*\b0 errored)/);
    expect(withMain.ok, withMain.out).toBe(true);
    for (const n of names) expect(existsSync(join(dir, `${n}.ncs`)), n).toBe(true);
    const includes = run(["--no-require-entry-point", "-s", "-c", ...docs.map((_, i) => join(dir, `nuid_i${i}.nss`))]);
    expect(includes.ok, includes.out).toBe(true);
  }, 120_000);
});
