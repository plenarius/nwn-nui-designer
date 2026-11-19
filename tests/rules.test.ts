// The Layonara (example) rule set (DESIGN.md, "Problems and house style"), the problem list's noise fixes, and
// reading haks without reading them whole. Small fixtures only: no Layonara or Beamdog files.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as N from "../src/core/model/nui.js";
import type { Binds, JsonObject, JsonValue } from "../src/core/model/types.js";
import { boundValue, profileBinds, windowGeometry } from "../src/core/model/binds.js";
import { editorProblems, groupIssues, layoutSeverity, runtimeGeometry, textPattern } from "../src/core/edit/issues.js";
import { runStyle } from "../src/core/edit/style.js";
import { LAYONARA, TOOLTIP_MAX, isCloseButton } from "../src/core/edit/styles/layonara.js";
import { validateWindow } from "../src/core/edit/validate.js";
import { COMBO_BORDER, type Problem, comboList } from "../src/core/render/render.js";
import { writeErf } from "../src/core/res/erfwrite.js";
import { renderView } from "../src/core/view.js";
import { checkReadable, nodeCanvas } from "../src/node/fs.js";
import { type Resources, openResources } from "../src/node/setup.js";

const ROOT = join(import.meta.dirname, "..");
const win = (root: JsonObject, extra: JsonObject = {}): JsonObject => ({ ...N.NuiWindow(root, "T", N.NuiRect(-1, -1, 420, 353), false), ...extra });
const style = (w: JsonObject, binds: Binds = {}, names?: string[]) => runStyle(LAYONARA, { win: w, binds, names });
const of = (w: JsonObject, title: string, binds: Binds = {}, names?: string[]) => style(w, binds, names).filter((f) => f.kind === title);
const row = (kids: JsonObject[], h: number) => N.NuiHeight(N.NuiRow(kids), h);
const wide = (e: JsonObject, w: number) => N.NuiWidth(e, w);

describe("Layonara rules", () => {
  it("1. checks 36 px rows only on control rows: a tile row or a board has its own height", () => {
    const rule = "36 px control rows";
    expect(of(win(N.NuiCol([row([N.NuiButton("a"), N.NuiLabel("b", 0, 0)], 40)])), rule)).toHaveLength(1);
    expect(of(win(N.NuiCol([row([N.NuiButton("a"), N.NuiSpacer()], 32)])), rule)).toHaveLength(0);
    // A 72 px row of image buttons (tiles), with a select button among them.
    expect(of(win(N.NuiCol([row([N.NuiButtonImage("t1"), N.NuiButtonImage("t2"), N.NuiButtonSelect("x", false)], 68)])), rule)).toHaveLength(0);
    // A board: a drawn spacer beside the controls; a nested column.
    const board = N.NuiDrawList(N.NuiSpacer(), false, [N.NuiDrawListRect(true, N.NuiColor(0, 0, 0), true, 1, N.NuiRect(0, 0, 8, 8))]);
    expect(of(win(N.NuiCol([row([board, N.NuiButton("Move")], 300)])), rule)).toHaveLength(0);
    expect(of(win(N.NuiCol([row([N.NuiCol([N.NuiButton("a")]), N.NuiButton("b")], 80)])), rule)).toHaveLength(0);
  });

  it("2. checks gaps of 8 or 16 but not fillers wider than 32", () => {
    const gaps = (w: number) => of(win(N.NuiCol([N.NuiRow([N.NuiButton("a"), wide(N.NuiSpacer(), w), N.NuiButton("Close")])])), "Gaps of 8 or 16");
    // A spacer has no margin of its own (Widgets::spacer): its width is its footprint.
    expect(gaps(8)).toHaveLength(0);
    expect(gaps(16)).toHaveLength(0); // gods' spacer
    expect(gaps(4)).toHaveLength(1);
    expect(gaps(10)).toHaveLength(1);
    expect(gaps(32)).toHaveLength(1); // still a gap
    expect(gaps(33)).toHaveLength(0); // a filler
    expect(gaps(300)).toHaveLength(0);
    expect(gaps(12)[0]!.text).toBe("a gap of 12 where the grid's gaps are 8 or 16: width 12: make it 16");
    // A margin set on the spacer counts, and the message spells it out (the panel shows the width alone).
    expect(of(win(N.NuiCol([N.NuiRow([N.NuiButton("a"), N.NuiMargin(wide(N.NuiSpacer(), 16), 2), N.NuiButton("Close")])])), "Gaps of 8 or 16")[0]!.text).toBe(
      "a gap of 20 where the grid's gaps are 8 or 16: width 16 plus a 2 px margin on each side takes 20: set its margin to 0 and keep 16, or make it 12 with the 2 px margin",
    );
  });

  it("4. sizes a window whose geometry or resizable is bound, from the dump's binds or the framework profile", () => {
    const root = N.NuiHeight(N.NuiWidth(N.NuiCol([N.NuiButton("Close")]), 400), 300);
    const bound = { ...N.NuiWindow(root, "T", N.NuiBind("geometry"), N.NuiBind("resizable")) };
    const frame = (w: JsonObject, b: Binds = {}) => of(w, "Sized to its content", b);
    // No sample value: nothing to check (the runtime-geometry note says so, validate.ts).
    expect(frame(bound)).toEqual([]);
    expect(of(bound, "Fixed size")).toEqual([]);
    // From the dump's binds.
    expect(frame(bound, { geometry: N.NuiRect(-1, -1, 444, 353) })[0]!.text).toContain("444 wide");
    expect(frame(bound, { geometry: N.NuiRect(-1, -1, 420, 353) })).toEqual([]);
    expect(of(bound, "Fixed size", { resizable: true })).toHaveLength(1);
    expect(of(bound, "Fixed size", { resizable: false })).toHaveLength(0);
    // From the framework's profiles key (the dump's binds win over it).
    const prof = { ...bound, profiles: { default: { geometry: N.NuiRect(-1, -1, 444, 353), resizable: true } } };
    expect(frame(prof)).toHaveLength(1);
    expect(of(prof, "Fixed size")).toHaveLength(1);
    expect(frame(prof, { geometry: N.NuiRect(-1, -1, 420, 353) })).toEqual([]);
    expect(of({ ...bound, profiles: { default: { geometry: N.NuiRect(-1, -1, 1200, 400) } } }, "At most 1000 x 720")[0]!.text).toContain("1184 x 351");
  });

  it("5. exempts the customisation window from Fixed size, by name or by its framework id", () => {
    const w = { ...N.NuiWindow(N.NuiCol([]), "T", N.NuiRect(-1, -1, 420, 353), true) };
    expect(of(w, "Fixed size")).toHaveLength(1);
    expect(of(w, "Fixed size", {}, ["cust"])).toHaveLength(0);
    expect(of({ ...w, id: "cust" }, "Fixed size")).toHaveLength(0);
    expect(of(w, "Fixed size", {}, ["customer"])).toHaveLength(1);
  });

  it("6. wants Close 120 wide, finding Close conservatively", () => {
    const ctx = { win: {}, binds: { a: "Close", b: "Done" } as Binds };
    expect(isCloseButton(ctx, N.NuiButton("Close"))).toBe(true);
    expect(isCloseButton(ctx, N.NuiButton(" close "))).toBe(true);
    expect(isCloseButton(ctx, N.NuiButton(N.NuiBind("a")))).toBe(true);
    expect(isCloseButton(ctx, N.NuiButton(N.NuiBind("b")))).toBe(false);
    expect(isCloseButton(ctx, N.NuiButton(N.NuiBind("close_label")))).toBe(true);
    expect(isCloseButton(ctx, N.NuiButton(N.NuiBind("closed_count")))).toBe(false);
    expect(isCloseButton(ctx, N.NuiButton("Close shop"))).toBe(false);
    expect(isCloseButton(ctx, N.NuiId(N.NuiButton("Done"), "close"))).toBe(false);
    expect(isCloseButton(ctx, N.NuiButtonSelect("Close", false))).toBe(false);
    const close = (w: number) => of(win(N.NuiCol([N.NuiRow([N.NuiSpacer(), wide(N.NuiButton("Close"), w)])])), "Close is 120 wide");
    // A footprint: width 116 plus the default 2 px margin each side.
    expect(close(116)).toEqual([]);
    expect(close(120)[0]!.text).toBe("Close is width 120, 124 with its margins: make it 116 (120 with its margins), as in every window");
    expect(close(90)[0]!.text).toBe("Close is width 90, 94 with its margins: make it 116 (120 with its margins), as in every window");
    expect(of(win(N.NuiCol([N.NuiRow([N.NuiSpacer(), { ...wide(N.NuiButton("Close"), 120), margin: 0 }])])), "Close is 120 wide")).toEqual([]);
  });

  it("7. budgets 8 px a character for bound text only", () => {
    const budget = (e: JsonObject, b: Binds = {}) => of(win(N.NuiCol([e])), "8 px a character", b);
    // Static text that fits is not reported (the layout reports static text that does not: clipped text).
    expect(budget(wide(N.NuiLabel("Fifteen letters", 0, 0), 60))).toEqual([]);
    expect(budget(wide(N.NuiButton("Fifteen letters"), 60))).toEqual([]);
    // Bound: by its sample value, the longest of a per-row array; no sample value, nothing to budget.
    expect(budget(wide(N.NuiLabel(N.NuiBind("n"), 0, 0), 100), { n: "A twenty-char name.." })[0]!.text).toContain("budgets 168 px; it has 100");
    expect(budget(wide(N.NuiLabel(N.NuiBind("n"), 0, 0), 100), { n: ["ab", "a much longer one"] })[0]!.text).toContain("(17 characters, bind n)");
    expect(budget(wide(N.NuiButton(N.NuiBind("n")), 100), { n: "Ten chars!" })[0]!.text).toContain("budgets 104 px");
    expect(budget(wide(N.NuiLabel(N.NuiBind("n"), 0, 0), 100))).toEqual([]);
  });

  it("9. reports each off-palette colour once per element, and leaves game art and level colours alone", () => {
    const red = N.NuiColor(250, 0, 0);
    const texts = [0, 1, 2].map((i) => N.NuiDrawListText(true, red, N.NuiRect(0, i * 20, 100, 18), "x"));
    const f = of(win(N.NuiCol([N.NuiDrawList(N.NuiSpacer(), false, [...texts, N.NuiDrawListRect(true, N.NuiColor(1, 2, 3), true, 1, N.NuiRect(0, 0, 5, 5))])])), "The house colours");
    expect(f.map((x) => x.text)).toEqual(["colour (250, 0, 0) is not one of the house colours (3 uses)", "colour (1, 2, 3) is not one of the house colours (draw_list[3])"]);
    // Image items, and a board (many shapes, no text).
    const img = { ...N.NuiDrawListImage(true, "po_x", N.NuiRect(0, 0, 32, 32), 0, 0, 0), color: red };
    expect(of(win(N.NuiCol([N.NuiDrawList(N.NuiSpacer(), false, [img])])), "The house colours")).toEqual([]);
    const squares = Array.from({ length: 64 }, (_, i) => N.NuiDrawListRect(true, i % 2 ? N.NuiColor(181, 136, 99) : N.NuiColor(240, 217, 181), true, 1, N.NuiRect((i % 8) * 40, Math.floor(i / 8) * 40, 40, 40)));
    expect(of(win(N.NuiCol([N.NuiDrawList(N.NuiSpacer(), false, squares)])), "The house colours")).toEqual([]);
    // The achievement levels' colours, and the palette's.
    for (const c of [N.NuiColor(255, 150, 60), N.NuiColor(190, 120, 240), N.NuiColor(225, 225, 225), N.NuiColor(222, 184, 80, 128)]) {
      expect(of(win(N.NuiCol([N.NuiStyleForegroundColor(N.NuiLabel("a", 0, 0), c)])), "The house colours")).toEqual([]);
    }
  });

  it("declares the framework's window keys, so the client check does not call them unknown", () => {
    const fw = win(N.NuiCol([]), { event_data: {}, formfile: "f", id: "x", local_version: 1, profiles: {}, subforms: {}, user_data: {}, mystery: 1 });
    const unknown = (o: Parameters<typeof validateWindow>[1]) => validateWindow(fw, o).filter((f) => f.kind === "unknown key" && !f.path).map((f) => f.key);
    expect(unknown({})).toEqual(["event_data", "formfile", "id", "local_version", "profiles", "subforms", "user_data", "mystery"]);
    expect(unknown({ extraWindowKeys: LAYONARA.knownWindowKeys })).toEqual(["mystery"]);
  });
});

describe("runtime geometry", () => {
  const fw = (geometry?: JsonObject, profiles?: JsonObject): JsonObject => {
    const w: JsonObject = { version: 1, title: "Chess", root: N.NuiCol([]), formfile: "chess", resizable: false };
    if (geometry) w.geometry = geometry;
    if (profiles) w.profiles = profiles;
    return w;
  };
  const kinds = (w: JsonObject, binds: Binds = {}) => validateWindow(w, { binds }).filter((f) => !f.path).map((f) => `${f.severity}:${f.kind}`);

  it("says once that the game sets it, in place of 'no geometry'", () => {
    expect(kinds(fw())).toContain("info:runtime geometry");
    expect(kinds(fw())).not.toContain("error:no geometry");
    expect(kinds(fw(N.NuiBind("geometry")))).toContain("info:runtime geometry");
    expect(kinds(fw(N.NuiBind("geometry")), { geometry: N.NuiRect(-1, -1, 400, 300) })).not.toContain("info:runtime geometry");
    expect(kinds(fw(N.NuiBind("geometry"), { default: { geometry: N.NuiRect(-1, -1, 400, 300) } }))).not.toContain("info:runtime geometry");
    // A plain window with no geometry is still an error.
    expect(kinds({ version: 1, root: N.NuiCol([]) })).toContain("error:no geometry");
    expect(runtimeGeometry(fw(), {})).toBe(true);
    expect(runtimeGeometry(win(N.NuiCol([])), {})).toBe(false);
  });

  it("leaves out the layout's problems at the default size", () => {
    const p: Problem[] = [{ path: "/col", kind: "clipped text", text: "x", rect: [0, 0, 1, 1] }];
    expect(editorProblems(p, fw(), {})).toEqual([]);
    expect(editorProblems(p, fw(N.NuiBind("geometry")), { geometry: N.NuiRect(-1, -1, 400, 300) })).toEqual(p);
  });

  it("reads bound values from the dump's binds, then the framework profile", () => {
    const w = fw(N.NuiBind("geometry"), { default: { geometry: N.NuiRect(1, 2, 300, 200), a: "p" }, big: { a: "q" } });
    expect(profileBinds(w)).toEqual({ geometry: N.NuiRect(1, 2, 300, 200), a: "p" });
    expect(profileBinds(w, "big").a).toBe("q");
    expect(boundValue(N.NuiBind("a"), {}, w)).toBe("p");
    expect(boundValue(N.NuiBind("a"), { a: "dump" }, w)).toBe("dump");
    expect(boundValue(N.NuiBind("zz"), {}, w)).toBeUndefined();
    expect(boundValue("static", {}, w)).toBe("static");
    expect(windowGeometry(w, {})).toEqual({ x: 1, y: 2, w: 300, h: 200 });
  });
});

describe("problem list", () => {
  let res: Resources;
  beforeAll(async () => {
    res = await openResources({ game: null });
  });

  // Its own timeout: three renders, the first with the skin's textures and glyphs not yet cached.
  it("calls an empty bound text box with no sample value that, not wasted room", async () => {
    const box = (value: JsonObject | string) => win(N.NuiCol([N.NuiHeight(N.NuiText(value), 100)]));
    const kinds = async (w: JsonObject, binds: Binds) => {
      const doc = { name: "t", form: "t", window: w, binds, panes: {} };
      const r = await renderView(doc, res.skin, res.images, nodeCanvas, {});
      return editorProblems(r.problems, w, binds).map((p) => `${p.kind}: ${p.text}`);
    };
    expect(await kinds(box(N.NuiBind("log")), { log: "" })).toEqual([expect.stringMatching(/^no sample value: no sample value for bind "log"/)]);
    expect(await kinds(box(""), {})).toEqual([expect.stringMatching(/^empty: .*wasted room/)]);
    expect(await kinds(box(N.NuiBind("log")), { log: "Some text." })).toEqual([]);
  }, 30_000);

  it("draws a framework window at its profile's geometry", async () => {
    const w = { ...N.NuiWindow(N.NuiCol([]), "T", N.NuiBind("geometry")), profiles: { default: { geometry: N.NuiRect(-1, -1, 321, 234) } } };
    const r = await renderView({ name: "t", form: "t", window: w, binds: {}, panes: {} }, res.skin, res.images, nodeCanvas, {});
    expect(r.windowRect.slice(2)).toEqual([321, 234]);
  });

  it("groups identical notes: same rule, same text but for its numbers and quoted parts", () => {
    expect(textPattern('a row of controls 40 tall (footprint): "x" is 2.5')).toBe('a row of controls # tall (footprint): "…" is #');
    const n = (kind: string, text: string, severity = "info", source = "style:layonara") => ({ kind, text, severity, source });
    const g = groupIssues([
      n("36 px control rows", "a row of controls 40 tall (footprint): the grid's control row is 36"),
      n("Gaps of 8 or 16", "a gap of 10 (footprint): use 8 or 16"),
      n("36 px control rows", "a row of controls 44 tall (footprint): the grid's control row is 36"),
      n("36 px control rows", "a row of controls 44 tall (footprint): the grid's control row is 36", "warning"),
      n("unknown key", 'the client does not read "formfile" on a window', "info", "client"),
      n("unknown key", 'the client does not read "profiles" on a window', "info", "client"),
    ]);
    expect(g.map((x) => x.items.length)).toEqual([2, 1, 1, 2]);
    expect(g[0]!.items.map((i) => i.text)).toEqual(["a row of controls 40 tall (footprint): the grid's control row is 36", "a row of controls 44 tall (footprint): the grid's control row is 36"]);
  });
});

describe("haks", () => {
  const dir = mkdtempSync(join(tmpdir(), "nui-hak-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("checks a hak over Node's string limit without reading it whole", () => {
    // A valid, empty ERF made 600 MB long (sparse: no disk used). Read as a string, it would throw ERR_STRING_TOO_LONG.
    const hak = join(dir, "big.hak");
    writeFileSync(hak, writeErf([]));
    truncateSync(hak, 600 * 1024 * 1024);
    expect(() => checkReadable(hak)).not.toThrow();
    expect(() => checkReadable(join(dir, "missing.hak"))).toThrow(/ENOENT/);
    // And the command line draws with it.
    const out = join(dir, "w.png");
    const r = spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "src/node/cli.ts"), join(ROOT, "fixtures/layout.jui"), "--fallback", "--hak", hak, "-o", out, "--quiet"], { cwd: ROOT, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status === 0 || r.status === 1).toBe(true); // 1: the window's own problems; 2 would be a file it cannot read
  }, 60000);
});

describe("tooltips (docs/CLIENT-BEHAVIOUR.md#tooltips)", () => {
  let res: Resources;
  beforeAll(async () => {
    res = await openResources({ game: null });
  });
  const offScreen = async (w: JsonObject, binds: Binds = {}, canvasW = 1440) => {
    const r = await renderView({ name: "t", form: "t", window: w, binds, panes: {} }, res.skin, res.images, nodeCanvas, { canvasW, canvasH: 900 });
    return r.problems.filter((p) => p.kind === "tooltip off screen");
  };
  const long = "Choose the theme every Layonara window is drawn with. ".repeat(6);

  it("reports a tooltip or disabled tooltip that runs off the screen, as an error", async () => {
    const btn = (k: (e: JsonObject, v: string) => JsonObject, v: string) => win(N.NuiCol([N.NuiHeight(N.NuiRow([N.NuiWidth(k(N.NuiButton("Theme"), v), 120)]), 36)]));
    expect(await offScreen(btn(N.NuiTooltip, "Choose a theme."))).toHaveLength(0);
    const p = await offScreen(btn(N.NuiTooltip, long));
    expect(p).toHaveLength(1);
    expect(p[0]!.text).toMatch(/drawn on one line, \d+ px wide, and runs \d+ px off the 1440 px screen/);
    expect(layoutSeverity(p[0]!.kind)).toBe("error");
    expect(await offScreen(btn(N.NuiDisabledTooltip, long))).toHaveLength(1);
    // The same tooltip fits a wider screen.
    expect(await offScreen(btn(N.NuiTooltip, long), {}, 8000)).toHaveLength(0);
    // "\n" does not start a line: the whole string is one line.
    const nl = await offScreen(btn(N.NuiTooltip, long.replace(/\. /g, ".\n")));
    expect(nl[0]!.text).toMatch(/does not start a line/);
  });

  it("measures a bound tooltip by its sample value", async () => {
    const w = win(N.NuiCol([N.NuiHeight(N.NuiRow([N.NuiWidth(N.NuiTooltip(N.NuiButton("Theme"), N.NuiBind("tip")), 120)]), 36)]));
    expect(await offScreen(w, { tip: long })).toHaveLength(1);
    expect(await offScreen(w, { tip: "Short." })).toHaveLength(0);
    expect(await offScreen(w, {})).toHaveLength(0);
  });

  it("Layonara: one short line, at most 60 characters, static or bound", () => {
    const rule = "Short tooltips";
    const one = (e: JsonObject, binds: Binds = {}) => of(win(N.NuiCol([e])), rule, binds);
    expect(one(N.NuiTooltip(N.NuiButton("a"), "x".repeat(TOOLTIP_MAX)))).toHaveLength(0);
    expect(one(N.NuiTooltip(N.NuiButton("a"), "x".repeat(TOOLTIP_MAX + 1)))[0]!.text).toMatch(/61 characters/);
    expect(one(N.NuiDisabledTooltip(N.NuiButton("a"), "Pick one.\nThen press OK."))[0]!.text).toMatch(/line break/);
    expect(one(N.NuiTooltip(N.NuiButton("a"), N.NuiBind("t")), { t: ["short", "y".repeat(70)] })[0]!.text).toMatch(/sample value of bind t\) is 70 characters/);
    expect(one(N.NuiTooltip(N.NuiButton("a"), N.NuiBind("t")))).toHaveLength(0);
    expect(one(N.NuiTooltip(N.NuiButton("a"), "x".repeat(70)))[0]!.severity).toBe("warning");

    // The gods window's deity titles are game data: exempt by name or framework id, and only from this rule.
    const godsTip = win(N.NuiCol([N.NuiTooltip(N.NuiButton("a"), "x".repeat(70))]));
    expect(of(godsTip, rule, {}, ["gods"])).toHaveLength(0);
    expect(of({ ...godsTip, id: "gods" }, rule)).toHaveLength(0);
    expect(of(godsTip, rule, {}, ["godsend"])).toHaveLength(1);
  });
});

describe("combo boxes (docs/CLIENT-BEHAVIOUR.md#combo-boxes)", () => {
  let res: Resources;
  beforeAll(async () => {
    res = await openResources({ game: null });
  });
  const entries = (n: number, label = "Entry") => Array.from({ length: n }, (_, i) => N.NuiComboEntry(`${label} ${i}`, i));
  const combo = (elements: JsonValue[] | JsonObject) => N.NuiCombo(elements, 0);
  const empty = (w: JsonObject, binds: Binds = {}) => validateWindow(w, { binds }).filter((f) => f.kind === "empty combo" || (f.kind === "no sample value" && f.key === "elements"));

  it("sizes the open list as nk_combo_callback does: label + 50 + scrollbar wide, rows of font + 2 and spacing, 300 at most", () => {
    const g = comboList([100, 200, 150, 35], 80, 3, 17, 4, 18);
    expect(g.rect).toEqual([100, 200 + 35 - COMBO_BORDER, 80 + 50 + 18, (4 + 19) * 3 + 2 * (4 + 4)]);
    expect(g.scrolls).toBe(false);
    // Past 300 it scrolls; the GUI scale multiplies the label width and the height.
    const big = comboList([0, 0, 150, 35], 80, 40, 17, 4, 18);
    expect(big.rect[3]).toBe(300);
    expect(big.scrolls).toBe(true);
    const s2 = comboList([0, 0, 150, 35], 80, 3, 17, 4, 18, 2);
    expect(s2.rect[2]).toBe(160 + 50 + 18);
    expect(s2.rect[3]).toBe(2 * ((4 + 19) * 3 + 16));
    // An empty combo still opens: s x 2 x (pad + spacing) high.
    expect(comboList([0, 0, 150, 35], 0, 0, 17, 4, 18).rect[3]).toBe(16);
  });

  it("warns about a combo with no entries, static or by its bind's sample value; asks for a missing sample", () => {
    expect(empty(win(N.NuiCol([combo(entries(2))])))).toHaveLength(0);
    const st = empty(win(N.NuiCol([combo([])])));
    expect(st).toHaveLength(1);
    expect(st[0]!.severity).toBe("warning");
    expect(st[0]!.text).toMatch(/opens empty in game \(looks like nothing happens\)/);
    const bound = win(N.NuiCol([combo(N.NuiBind("ents"))]));
    expect(empty(bound, { ents: [] }).map((f) => f.severity)).toEqual(["warning"]);
    expect(empty(bound, { ents: entries(2) })).toHaveLength(0);
    const none = empty(bound);
    expect(none.map((f) => `${f.severity} ${f.kind}`)).toEqual(["info no sample value"]);
    expect(none[0]!.text).toMatch(/no sample value for bind "ents"/);
    // A framework profile's default counts as the sample.
    expect(empty(win(N.NuiCol([combo(N.NuiBind("ents"))]), { profiles: { default: { ents: [] } } }))).toHaveLength(1);
  });

  it("a combo with a tooltip is an error (the tooltip and the open list share the window's one popup); the label takes it", () => {
    const tip = (w: JsonObject, binds: Binds = {}) => validateWindow(w, { binds }).filter((f) => f.kind === "combo tooltip");
    const f = tip(win(N.NuiCol([N.NuiTooltip(combo(entries(2)), "Pick one")])));
    expect(f.map((x) => `${x.severity} ${x.source} ${x.key}`)).toEqual(["error client tooltip"]);
    expect(f[0]!.text).toMatch(/one popup/);
    expect(f[0]!.text).toMatch(/on the combo's label instead/);
    // Bound: by its sample value; an empty one shows nothing, and no sample counts as a tooltip.
    const bound = win(N.NuiCol([N.NuiTooltip(combo(entries(2)), N.NuiBind("tip"))]));
    expect(tip(bound)).toHaveLength(1);
    expect(tip(bound, { tip: "Pick one" })).toHaveLength(1);
    expect(tip(bound, { tip: "" })).toHaveLength(0);
    // No tooltip, an empty one, or a disabled tooltip only (a disabled combo cannot open): fine.
    expect(tip(win(N.NuiCol([combo(entries(2))])))).toHaveLength(0);
    expect(tip(win(N.NuiCol([N.NuiTooltip(combo(entries(2)), "")])))).toHaveLength(0);
    expect(tip(win(N.NuiCol([{ ...combo(entries(2)), disabled_tooltip: "Locked" }])))).toHaveLength(0);
    // The fix it asks for: the tooltip on the label beside the combo.
    expect(tip(win(N.NuiCol([N.NuiRow([N.NuiTooltip(N.NuiLabel("Colour", 0, 0), "Pick one"), combo(entries(2))])])))).toHaveLength(0);
  });

  it("in a list, a bound combo's sample holds entries per row: an empty row is told", () => {
    const w = win(N.NuiCol([N.NuiList([N.NuiListTemplateCell(combo(N.NuiBind("ents")), 160, false)], 3, 39)]));
    expect(empty(w, { ents: [entries(2), entries(1), entries(2)] as never })).toHaveLength(0);
    const f = empty(w, { ents: [entries(2), [], entries(2)] as never });
    expect(f).toHaveLength(1);
    expect(f[0]!.text).toMatch(/no entries in row 1:/);
  });

  const view = async (w: JsonObject, opts: { canvasW?: number; canvasH?: number; openCombo?: JsonObject | null; crop?: boolean } = {}) =>
    renderView({ name: "t", form: "t", window: w, binds: {}, panes: {} }, res.skin, res.images, nodeCanvas, { canvasW: 1440, canvasH: 900, ...opts });
  const offScreen = (r: { problems: Problem[] }) => r.problems.filter((p) => p.kind === "combo list off screen");

  it("warns when the open list runs off the screen (it is never clipped to the window, only to its own bounds)", async () => {
    // A 400 x 300 window centred on 1440 x 900: its bottom is at 600. A combo near the window's bottom with 12 entries
    // opens a 300 high list well inside the screen, but past the window: no problem.
    const w = win(N.NuiCol([N.NuiSpacer(), N.NuiHeight(combo(entries(12)), 35)]), { geometry: N.NuiRect(-1, -1, 400, 300) });
    expect(offScreen(await view(w))).toHaveLength(0);
    // On a short screen it runs off the bottom.
    const short = offScreen(await view(w, { canvasH: 700 }));
    expect(short).toHaveLength(1);
    expect(short[0]!.text).toMatch(/px past the bottom of the 1440 x 700 screen/);
    expect(layoutSeverity(short[0]!.kind)).toBe("warning");
    // Long labels at the right edge of the screen run off its right edge.
    const right = win(N.NuiCol([N.NuiHeight(combo(entries(2, "A very long entry label that goes on and on")), 35)]), { geometry: N.NuiRect(1100, 100, 330, 200) });
    expect(offScreen(await view(right))[0]!.text).toMatch(/px past the right edge/);
    // An empty combo opens too small to matter.
    expect(offScreen(await view(win(N.NuiCol([N.NuiSpacer(), N.NuiHeight(combo([]), 35)]), { geometry: N.NuiRect(-1, 860, 400, 40) }), { canvasH: 900 }))).toHaveLength(0);
  });

  it("draws the open list on demand, past the window's edge, and the crop keeps it", async () => {
    const w = win(N.NuiCol([N.NuiSpacer(), N.NuiHeight(combo(entries(12)), 35)]), { geometry: N.NuiRect(-1, -1, 400, 300) });
    const shut = await view(w, { crop: true });
    // The element as it is in the window (NuiHeight makes a copy).
    const inWin = ((w.root as JsonObject).children as JsonObject[])[1]!;
    const open = await view(w, { crop: true, openCombo: inWin });
    expect(shut.canvas.height).toBe(300 + 2 * 12);
    // The window's bottom is 600; the list starts 4 px over the combo's bottom and is 300 high.
    expect(open.canvas.height).toBeGreaterThan(shut.canvas.height + 200);
    expect(open.origin).toEqual(shut.origin);
    expect(open.problems.map((p) => p.kind)).toEqual(shut.problems.map((p) => p.kind));
  });
});
