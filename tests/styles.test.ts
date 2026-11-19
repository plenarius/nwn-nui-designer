// Style files (src/core/edit/styles/generic.ts, src/node/styles.ts): loading and their errors, each generic rule with
// its parameters, the JS plugin, the settings, and the Layonara equivalence (styles/layonara.json finds exactly what
// the TypeScript rule set it replaced found, tests/layonara.legacy.ts).
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as N from "../src/core/model/nui.js";
import type { Binds, JsonObject } from "../src/core/model/types.js";
import { runStyle } from "../src/core/edit/style.js";
import { windowFindings } from "../src/core/edit/lint.js";
import { openText, toNuiDocument } from "../src/core/edit/project.js";
import { GENERIC_RULES, StyleFileError, addPluginRules, parseStyleDef } from "../src/core/edit/styles/generic.js";
import { LAYONARA } from "../src/core/edit/styles/layonara.js";
import { renderView } from "../src/core/view.js";
import { nodeCanvas } from "../src/node/fs.js";
import { cliResources } from "../src/node/setup.js";
import { configuredStyles, loadStyleFile, resolveStyle, styleFiles } from "../src/node/styles.js";
import { localState, rootPath, currentRoots } from "../src/node/localapi.js";
import { loadSettings, parseIni, updateIni } from "../src/node/settings.js";
import { main } from "../src/node/check.js";
import { styleSchema } from "../tools/style-schema.js";
import { LAYONARA as LEGACY } from "./layonara.legacy.js";

const ROOT = join(import.meta.dirname, "..");
let tmp: string;
beforeAll(() => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "nuid-styles-")));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const write = (name: string, v: unknown) => {
  const p = join(tmp, name);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, typeof v === "string" ? v : JSON.stringify(v));
  return p;
};
const style = (rules: Record<string, unknown>, extra: Record<string, unknown> = {}) => parseStyleDef({ id: "t", title: "T", rules, ...extra }, "t.json").set;
const run = (rules: Record<string, unknown>, win: JsonObject, binds: Binds = {}, names?: string[]) => runStyle(style(rules), { win, binds, names });
const win = (root: JsonObject, o: { resizable?: boolean; w?: number; h?: number } = {}) => N.NuiWindow(root, "T", N.NuiRect(-1, -1, o.w ?? 300, o.h ?? 200), o.resizable ?? false);

describe("style files: errors name the file and the key", () => {
  const err = (json: unknown) => {
    try {
      parseStyleDef(json, "my.json");
    } catch (e) {
      expect(e).toBeInstanceOf(StyleFileError);
      return (e as Error).message;
    }
    throw new Error("no error");
  };
  it("refuses bad files clearly", () => {
    expect(err([])).toBe("my.json: expected a JSON object");
    expect(err({ title: "T" })).toMatch(/^my\.json: id: /);
    expect(err({ id: "a b", title: "T" })).toMatch(/^my\.json: id: /);
    expect(err({ id: "a" })).toMatch(/^my\.json: title: /);
    expect(err({ id: "a", title: "T", colour: 1 })).toMatch(/^my\.json: colour: unknown key/);
    expect(err({ id: "a", title: "T", rules: { nope: {} } })).toMatch(/^my\.json: rules\.nope: no such rule .*needs a plugin/);
    expect(err({ id: "a", title: "T", rules: { gaps: { allowed: "8" } } })).toBe("my.json: rules.gaps.allowed: expected a non-empty list of numbers");
    expect(err({ id: "a", title: "T", rules: { gaps: { size: 8 } } })).toMatch(/^my\.json: rules\.gaps\.size: unknown parameter \(expected allowed, fillerOver\)/);
    expect(err({ id: "a", title: "T", rules: { gaps: { severity: "loud" } } })).toBe("my.json: rules.gaps.severity: expected error, warning or info");
    expect(err({ id: "a", title: "T", rules: { "fixed-size": { exempt: "cust" } } })).toBe("my.json: rules.fixed-size.exempt: expected a list of window names");
    expect(err({ id: "a", title: "T", rules: { palette: { colours: [[1, 2]] } } })).toMatch(/^my\.json: rules\.palette\.colours: expected a list of \[r, g, b\]/);
    expect(err({ id: "a", title: "T", plugin: "x.py" })).toMatch(/^my\.json: plugin: /);
  });
  it("reports missing and unreadable files, and bad JSON, by the file", async () => {
    await expect(loadStyleFile(join(tmp, "missing.json"))).rejects.toThrow(`${join(tmp, "missing.json")}: no such file`);
    const bad = write("bad.json", "{ nope");
    await expect(loadStyleFile(bad)).rejects.toThrow(/bad\.json: not JSON/);
    expect(() => styleFiles([join(tmp, "nowhere")])).toThrow(/nowhere: no such file or folder/);
  });
  it("the shipped files load, and the schema is the generated one", async () => {
    for (const f of ["layonara.json", "example.json"]) expect((await loadStyleFile(join(ROOT, "styles", f))).rules.length).toBeGreaterThan(5);
    expect(JSON.parse(readFileSync(join(ROOT, "styles", "style.schema.json"), "utf8"))).toEqual(JSON.parse(JSON.stringify(styleSchema())));
    // The starter lists every generic rule.
    const ex = JSON.parse(readFileSync(join(ROOT, "styles", "example.json"), "utf8"));
    for (const r of GENERIC_RULES) expect(Object.keys(ex.rules)).toContain(r.id);
  });
});

describe("the generic rules and their parameters", () => {
  it("a rule not listed or not enabled is off; severity, exempt and title apply", () => {
    const w = win(N.NuiCol([]), { resizable: true });
    expect(run({}, w)).toEqual([]);
    expect(run({ "fixed-size": false }, w)).toEqual([]);
    expect(run({ "fixed-size": { enabled: false } }, w)).toEqual([]);
    expect(run({ "fixed-size": true }, w)[0]).toMatchObject({ kind: "Fixed size", severity: "warning", source: "style:t" });
    expect(run({ "fixed-size": { severity: "error", title: "Static" } }, w)[0]).toMatchObject({ kind: "Static", severity: "error" });
    expect(run({ "fixed-size": { exempt: ["Cust"] } }, w, {}, ["cust"])).toEqual([]);
  });
  it("max-content", () => {
    const w = win(N.NuiCol([]), { w: 616, h: 449 });
    expect(run({ "max-content": { width: 600, height: 400 } }, w)).toEqual([]);
    expect(run({ "max-content": { width: 599, height: 400 } }, w)[0]).toMatchObject({ kind: "At most 599 x 400", text: "the content is 600 x 400: keep it to 599 x 400, or split the window into steps" });
  });
  it("gaps", () => {
    const w = win(N.NuiRow([N.NuiWidth(N.NuiSpacer(), 12), N.NuiWidth(N.NuiSpacer(), 10), N.NuiWidth(N.NuiSpacer(), 40)]));
    const f = run({ gaps: { allowed: [10, 20] } }, w);
    expect(f.map((x) => x.text)).toEqual(["a gap of 12 where the grid's gaps are 10 or 20: width 12: make it 10"]);
    expect(f[0]!.kind).toBe("Gaps of 10 or 20");
    expect(run({ gaps: { allowed: [10, 20], fillerOver: 50 } }, w)).toHaveLength(2);
  });
  it("row-grid and control-height", () => {
    const w = win(N.NuiCol([N.NuiHeight(N.NuiRow([N.NuiHeight(N.NuiButton("a"), 28)]), 32)]));
    // Footprints: the row's 32 and the button's 28 each with the default 2 px margins.
    expect(run({ "row-grid": { height: 36 } }, w)).toEqual([]);
    expect(run({ "row-grid": { height: 40 } }, w)[0]!.text).toMatch(/^a row of controls 36 tall where the grid's control row is 40/);
    expect(run({ "control-height": { allowed: [32] } }, w)).toEqual([]);
    expect(run({ "control-height": { allowed: [36, 40] } }, w)[0]).toMatchObject({ kind: "Controls 36 or 40 tall" });
  });
  it("margins", () => {
    const w = win(N.NuiCol([N.NuiMargin(N.NuiButton("a"), 3), N.NuiMargin(N.NuiButton("b"), 4)]));
    expect(run({ margins: { allowed: [0, 4] } }, w).map((x) => x.text)).toEqual(["a margin of 3 where the house margins are 0 or 4"]);
  });
  it("disabled-tip, tooltip-length, no-help-text", () => {
    const w = win(N.NuiCol([N.NuiEnabled(N.NuiTooltip(N.NuiButton("a"), "x".repeat(30)), false), N.NuiText("y".repeat(150))]));
    expect(run({ "disabled-tip": {} }, w)).toHaveLength(1);
    expect(run({ "tooltip-length": { max: 30 } }, w)).toEqual([]);
    expect(run({ "tooltip-length": { max: 29 } }, w)[0]!.text).toMatch(/is 30 characters: keep it to 29/);
    expect(run({ "no-help-text": { maxChars: 150 } }, w)).toEqual([]);
    expect(run({ "no-help-text": { maxChars: 100 } }, w)[0]!.text).toMatch(/^a 150-character paragraph/);
  });
  it("list-rows", () => {
    const w = win(N.NuiCol([N.NuiList([N.NuiListTemplateCell(N.NuiLabel("a", 0, 0), 0, true)], N.NuiBind("n"), 28)]));
    expect(run({ "list-rows": { minHeight: 28 } }, w)).toEqual([]);
    expect(run({ "list-rows": { minHeight: 30 } }, w)[0]).toMatchObject({ kind: "List rows of 30 or more", text: "rows 28 tall hold text: make them at least 30" });
  });
  it("close-last and close-width", () => {
    const w = win(N.NuiCol([N.NuiWidth(N.NuiButton("Close"), 96), N.NuiButton("Other")]));
    expect(run({ "close-last": {} }, w)).toHaveLength(1);
    expect(run({ "close-width": { width: 100 } }, w)).toEqual([]);
    expect(run({ "close-width": { width: 120 } }, w)[0]).toMatchObject({ kind: "Close is 120 wide", text: "Close is width 96, 100 with its margins: make it 116 (120 with its margins), as in every window" });
  });
  it("drawn-progress, no-refresh", () => {
    const w = win(N.NuiCol([N.NuiProgress(0.5), N.NuiButton("Refresh")]));
    expect(run({ "drawn-progress": { hint: "draw it" } }, w).map((x) => x.text)).toEqual(["draw it"]);
    expect(run({ "no-refresh": {} }, w)).toHaveLength(1);
  });
  it("palette", () => {
    const w = win(N.NuiCol([N.NuiStyleForegroundColor(N.NuiLabel("a", 0, 0), N.NuiColor(1, 2, 3)), N.NuiStyleForegroundColor(N.NuiLabel("b", 0, 0), N.NuiColor(9, 9, 9))]));
    expect(run({ palette: { colours: [[1, 2, 3]] } }, w).map((x) => x.text)).toEqual(["colour (9, 9, 9) is not one of the house colours"]);
  });
  it("fonts", () => {
    const w = win(N.NuiCol([N.NuiStyleFont(N.NuiLabel("a", 0, 0), "title"), N.NuiStyleFont(N.NuiLabel("b", 0, 0), "fancy")]));
    expect(run({ fonts: { allowed: ["Title", "text"] } }, w).map((x) => x.text)).toEqual(['font "fancy" is not one of the house fonts (Title or text)']);
  });
  it("label-budget", () => {
    const w = win(N.NuiCol([N.NuiWidth(N.NuiLabel(N.NuiBind("v"), 0, 0), 50)]));
    expect(run({ "label-budget": { pxPerChar: 10, labelPad: 0 } }, w, { v: "abcde" })).toEqual([]);
    expect(run({ "label-budget": { pxPerChar: 10, labelPad: 1 } }, w, { v: "abcde" })[0]!.text).toMatch(/budgets 51 px; it has 50/);
  });
});

describe("the JS plugin", () => {
  const plugin = `export default (api, entries) => [{ id: "mine", title: "Mine", summary: "s", check(ctx, report) { api.eachElem(ctx.win, (e, path) => { if (api.typeOf(e) === "button") report(path, "a button " + (entries.mine?.word ?? "")); }); } }, { id: "boom", title: "Boom", check() { throw new Error("oops"); } }];`;
  it("adds its rules, configured by the style file's entries, and a throwing rule becomes a finding", async () => {
    write("p/rules.mjs", plugin);
    const f = write("p/s.json", { id: "p", title: "P", plugin: "rules.mjs", rules: { mine: { severity: "error" }, gaps: {} } });
    const set = await loadStyleFile(f);
    expect(set.rules.map((r) => r.id)).toEqual(["gaps", "mine", "boom"]);
    const out = runStyle(set, { win: win(N.NuiCol([N.NuiButton("a")])), binds: {} });
    expect(out.map((x) => [x.kind, x.severity])).toEqual([["Mine", "error"], ["Boom", "error"]]);
    expect(out[1]!.text).toMatch(/the rule failed \(rules\.mjs\): oops/);
    const off = write("p/off.json", { id: "p2", title: "P", plugin: "rules.mjs", rules: { boom: false } });
    expect((await loadStyleFile(off)).rules.map((r) => r.id)).toEqual(["mine"]);
  });
  it("refuses a plugin outside the style file's folder, a missing one, a bad export and unknown rule entries", async () => {
    write("q/inner/s.json", { id: "q", title: "Q", plugin: "../rules.mjs" });
    write("q/rules.mjs", plugin);
    await expect(loadStyleFile(join(tmp, "q/inner/s.json"))).rejects.toThrow(/s\.json: plugin: \.\.\/rules\.mjs: no such file in the style file's folder/);
    const missing = write("q/m.json", { id: "q", title: "Q", plugin: "none.mjs" });
    await expect(loadStyleFile(missing)).rejects.toThrow(/plugin: none\.mjs: no such file/);
    const def = parseStyleDef({ id: "q", title: "Q", plugin: "x.mjs", rules: { ghost: {} } }, "q.json");
    expect(() => addPluginRules(def, 42)).toThrow(/q\.json: plugin: x\.mjs: the default export must be/);
    expect(() => addPluginRules(def, [])).toThrow(/q\.json: rules\.ghost: no such rule/);
    expect(() => addPluginRules(parseStyleDef({ id: "q", title: "Q", plugin: "x.mjs" }, "q.json"), [{ id: "a" }])).toThrow(/rule 0 needs an id, a title and a check/);
  });
});

describe("settings, pnpm check and the local API", () => {
  it("reads styles from the ini and the environment", () => {
    expect(parseIni("styles = a.json, b\nstyles = c").settings.styles).toEqual(["a.json", "b", "c"]);
    expect(updateIni("", { ...parseIni("").settings, styles: ["x.json", "my, styles"] })).toBe('styles = x.json\nstyles = "my, styles"\n');
    const ini = write("s.ini", "styles = /a/x.json\n");
    expect(loadSettings({ iniPath: ini, env: {} })).toMatchObject({ styles: ["/a/x.json"], stylesFrom: "ini" });
    expect(loadSettings({ iniPath: ini, env: { NUI_DESIGNER_STYLES: ["/b/y.json", "/c"].join(process.platform === "win32" ? ";" : ":") } })).toMatchObject({ styles: ["/b/y.json", "/c"], stylesFrom: "env" });
  });
  it("--style takes a built-in id, a configured file's id or a path, and lists the ids otherwise", async () => {
    const dir = join(tmp, "cfg");
    write("cfg/mine.json", { id: "mine", title: "Mine", rules: { "fixed-size": {} } });
    write("cfg/broken.json", { id: "broken" });
    write("cfg/style.schema.json", { not: "a style" });
    const ini = write("cfg.ini", `styles = ${dir}\n`);
    expect((await resolveStyle("layonara", tmp, { iniPath: ini, env: {} })).id).toBe("layonara");
    expect((await resolveStyle("mine", tmp, { iniPath: ini, env: {} })).name).toBe("Mine");
    expect((await resolveStyle("cfg/mine.json", tmp, { iniPath: ini, env: {} })).id).toBe("mine");
    await expect(resolveStyle("other", tmp, { iniPath: ini, env: {} })).rejects.toThrow(/--style other: expected layonara, mine, none or a style file's path \(could not load: .*broken\.json: title/);
    const c = await configuredStyles({ iniPath: ini, env: {} });
    expect(c.map((x) => [x.file.slice(dir.length + 1), !!x.set])).toEqual([["broken.json", false], ["mine.json", true]]);
  });
  it("pnpm check runs a style file by its path", async () => {
    const saved = process.env.NUI_DESIGNER_INI;
    process.env.NUI_DESIGNER_INI = "/dev/null";
    try {
      const f = write("chk/s.json", { id: "chk", title: "Chk", rules: { "fixed-size": { severity: "error", title: "Must be fixed" } } });
      const w = write("chk/w.json", JSON.stringify(win(N.NuiCol([]), { resizable: true })));
      const out: string[] = [];
      const code = await main(["--style", f, "--fallback", "--format", "json", w], (s) => out.push(s), () => {});
      const j = JSON.parse(out.join("\n"));
      expect(code).toBe(1);
      expect(j.used.style).toBe("chk");
      expect(j.windows[0].issues.some((i: { kind: string; source: string }) => i.kind === "Must be fixed" && i.source === "style:chk")).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.NUI_DESIGNER_INI;
      else process.env.NUI_DESIGNER_INI = saved;
    }
  });
  it("the local API lists style files and serves a plugin from the style file's folder only", async () => {
    write("api/rules.mjs", "export default [];");
    write("api/s.json", { id: "api", title: "Api", plugin: "rules.mjs" });
    write("api/bad.json", { id: "x", title: "X", rules: { nope: {} } });
    const ini = write("api.ini", `styles = ${join(tmp, "api")}\n`);
    const st = await localState({ iniPath: ini, env: {}, detect: false });
    expect(st.styles.map((s) => [s.id ?? null, s.root, s.plugin ?? null, !!s.error])).toEqual([[null, "style:0", null, true], ["api", "style:1", "rules.mjs", false]]);
    expect(st.styles[0]!.error).toMatch(/bad\.json: rules\.nope: no such rule/);
    const roots = currentRoots({ iniPath: ini, env: {}, detect: false });
    expect(rootPath(roots, "style:1")).toBe(join(tmp, "api"));
    expect(rootPath(roots, "style:9")).toBeNull();
  });
});

describe("Layonara as a style file finds exactly what the TypeScript rule set found", () => {
  it("keeps the rule ids, titles, summaries, exemptions and window keys", () => {
    expect(LAYONARA.rules.map((r) => [r.id, r.title, r.summary, r.exempt])).toEqual(LEGACY.rules.map((r) => [r.id, r.title, r.summary, r.exempt]));
    expect([LAYONARA.id, LAYONARA.name, LAYONARA.source, LAYONARA.knownWindowKeys]).toEqual([LEGACY.id, LEGACY.name, LEGACY.source, LEGACY.knownWindowKeys]);
    // The description now says it is an example of a style file.
    expect(LAYONARA.description).toBe(LEGACY.description.replace("style rule set", "style file"));
  });

  // The fixtures, and NUI_DUMPS (a folder of nwn-module's `tests/run.sh --nui` dumps) when set.
  const dumps = process.env.NUI_DUMPS;
  const files = [
    ...readdirSync(join(ROOT, "fixtures")).filter((f) => /\.(jui|json)$/.test(f)).map((f) => join(ROOT, "fixtures", f)),
    ...(dumps && existsSync(dumps) ? readdirSync(dumps).filter((f) => f.endsWith(".json")).map((f) => join(dumps, f)) : []),
  ];
  it(`on ${files.length} windows${dumps ? ` (with ${dumps})` : ""}`, async () => {
    const { res } = await cliResources({ fallback: true }, () => {});
    let compared = 0;
    for (const file of files) {
      const name = file.split("/").pop()!.replace(/\.(json|jui)$/, "");
      let doc;
      try {
        doc = openText(readFileSync(file, "utf8"), name).doc;
      } catch {
        continue;
      }
      const r = await renderView(toNuiDocument(doc), res.skin, res.images, nodeCanvas, { canvasW: 1440, canvasH: 900, crop: true });
      const at = (set: typeof LAYONARA) => windowFindings({ win: doc.window, binds: doc.binds, name: doc.name, style: set, outlines: r.outlines });
      expect(at(LAYONARA), file).toEqual(at(LEGACY));
      compared++;
    }
    expect(compared).toBeGreaterThan(4);
  }, 300_000);
});
