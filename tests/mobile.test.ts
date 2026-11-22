// Mobile clients (docs/MOBILE.md, the nwn-nui-spec's spec/mobile.md): the client profiles, the mobile checks, the
// preview's multipliers (with the spec's measured points as cases), the portable-margins export and nui_touch.nss.
// No game needed, except for the compile test (skipped without nwn_script_comp and a game).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as N from "../src/core/model/nui.js";
import type { JsonObject, JsonValue } from "../src/core/model/types.js";
import { isObject } from "../src/core/model/types.js";
import { windowFindings, windowIssues } from "../src/core/edit/lint.js";
import { buildProgram, evalProgram, jsonEqual, nwscriptOptions, writeNwscript } from "../src/core/edit/nwscript.js";
import { type EditorDoc, defaultExport, openText, readProject, projectJson } from "../src/core/edit/project.js";
import { marginOf } from "../src/core/layout/layout.js";
import { clientProfile } from "../src/core/mobile/client.js";
import { MOBILE_RULES, imageRiskOf, mobileFindings } from "../src/core/mobile/lint.js";
import { REFUSAL } from "../src/core/mobile/preview.js";
import { exportWindow, portableMargins } from "../src/core/mobile/portable.js";
import { pointWindow } from "../src/core/mobile/transform.js";
import { ResMan } from "../src/core/res/resman.js";
import { resType } from "../src/core/res/restype.js";
import type { Resources } from "../src/core/session.js";
import { CHROME } from "../src/core/render/render.js";
import { ctx2d } from "../src/core/render/canvas.js";
import { layoutView, renderView } from "../src/core/view.js";
import { nodeCanvas } from "../src/node/fs.js";
import { findGame, openResources } from "../src/node/setup.js";
import { main as check } from "../src/node/check.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures");
let res: Resources;
beforeAll(async () => {
  res = await openResources({ game: null });
});

const IOS3 = clientProfile("ios3", 1);
const doc = (root: JsonObject, geo: JsonValue = N.NuiRect(0, 0, 400, 300), binds: Record<string, JsonValue> = {}) => ({ name: "t", form: "t", window: N.NuiWindow(root, "T", geo), binds, panes: {} });
const lay = (d: ReturnType<typeof doc>, client = IOS3) => layoutView(d, res.skin, res.images, { client });
const desk = (d: ReturnType<typeof doc>) => layoutView(d, res.skin, res.images);
const rectOf = (r: { outlines: { elem: JsonObject; rect: [number, number, number, number] }[] }, e: JsonObject) => r.outlines.find((o) => o.elem === e)!.rect;
const refused = (r: { problems: { kind: string }[] }) => r.problems.some((p) => /unsolvable/.test(p.kind));
const label = (h = 32, margin?: number) => {
  const l = N.NuiHeight(N.NuiWidth(N.NuiLabel("x", 1, 0), 100), h);
  return margin === undefined ? l : N.NuiMargin(l, margin);
};
const zero = (e: JsonObject) => N.NuiMargin(e, 0);

describe("client profiles (tables/mobile.yaml)", () => {
  it("desktop and Android are desktop-like, iOS multiplies by f = d / s", () => {
    for (const k of ["desktop", "android"] as const) expect(clientProfile(k, 1.6)).toMatchObject({ f: 1, pointBased: false, listInset: 4, rowSpacing: 4, frameExtra: [0, 0] });
    expect(IOS3).toMatchObject({ d: 3, s: 1, f: 3, pointBased: true, minCell: 11, listInset: 14, rowSpacing: 12, frameExtra: [32, 66] });
    const at16 = clientProfile("ios3", 1.6);
    expect(at16.f).toBeCloseTo(1.875);
    expect(at16.listInset).toBeCloseTo(8.75); // about 8.7 measured (T68)
    expect(at16.frameExtra[0]).toBeCloseTo(12.5); // 12 measured (T65)
    expect(at16.frameExtra[1]).toBeCloseTo(25.8, 1); // about 28 measured (T65)
    // A GUI scale of 0 counts as 1 (NUI-MOBILE-040); a density-2 client at scale 2 is desktop-like (f = 1).
    expect(clientProfile("ios3", 0).f).toBe(3);
    expect(clientProfile("ios2", 2).pointBased).toBe(false);
  });
});

describe("the mobile checks", () => {
  const run = (win: JsonObject, binds: Record<string, JsonValue> = {}, imageRisk: ((r: string) => boolean) | null = null, disabled: string[] = []) =>
    mobileFindings({ win, binds, imageRisk }, new Set(disabled));
  const ids = (fs: { kind: string }[]) => fs.map((f) => MOBILE_RULES.rules.find((r) => r.title === f.kind)!.id);

  it("margins: every placed element with a margin above 0, not a solver's top, spacers or margin 0", () => {
    const btn = N.NuiButton("b");
    const inGroup = N.NuiLabel("g", 1, 0);
    const win = N.NuiWindow(N.NuiCol([N.NuiRow([btn, N.NuiSpacer(), zero(N.NuiLabel("z", 1, 0)), N.NuiMargin(N.NuiLabel("m", 1, 0), 3)]), zero(N.NuiGroup(inGroup))]), "T", N.NuiRect(0, 0, 300, 200));
    const f = run(win).filter((x) => x.kind === "Margin on iOS");
    expect(f.map((x) => x.path)).toEqual([[0], [0, 0], [0, 3]]);
    expect(f[0]!.text).toContain("margin 2 (the default) is 6 on an iPhone");
    expect(f[2]!.text).toContain("margin 3 is 9");
    expect(f[0]!.text).toContain("NUI-MOBILE-021");
  });

  it("centred or mouse-placed windows, static or a bind's sample (NUI-MOBILE-027)", () => {
    const root = zero(N.NuiCol([]));
    expect(ids(run(N.NuiWindow(root, "T", N.NuiRect(-1, -1, 300, 200))))).toEqual(["mobile-centred"]);
    expect(ids(run(N.NuiWindow(root, "T", N.NuiRect(-2, 40, 300, 200))))).toEqual(["mobile-centred"]);
    expect(run(N.NuiWindow(root, "T", N.NuiRect(10, 40, 300, 200)))).toEqual([]);
    expect(ids(run(N.NuiWindow(root, "T", N.NuiBind("geo")), { geo: N.NuiRect(-1, 5, 300, 200) }))).toEqual(["mobile-centred"]);
    expect(run(N.NuiWindow(root, "T", N.NuiBind("geo")))).toEqual([]);
  });

  it("thin fixed template cells (NUI-MOBILE-024), and the per-window note on lists and drawings (info)", () => {
    const list = zero(N.NuiList([N.NuiListTemplateCell(N.NuiSpacer(), 2, false), N.NuiListTemplateCell(zero(N.NuiLabel("a", 1, 0)), 3, true), N.NuiListTemplateCell(zero(N.NuiLabel("b", 1, 0)), 40, false)], 3));
    const f = run(N.NuiWindow(zero(N.NuiCol([list])), "T", N.NuiRect(0, 0, 300, 200)));
    expect(ids(f)).toEqual(["mobile-thin-cell", "mobile-scaling"]);
    expect(f[0]).toMatchObject({ severity: "warning", path: [0, 0] });
    expect(f[0]!.text).toContain("spacer cell 2 wide");
    expect(f[1]).toMatchObject({ severity: "info", path: null });
    expect(f[1]!.text).toContain("list row heights, fixed cell widths");
    const drawn = zero(N.NuiDrawList(zero(N.NuiSpacer()), false, [N.NuiDrawListRect(true, N.NuiColor(1, 2, 3), true, 1, N.NuiRect(0, 0, 10, 10))]));
    expect(ids(run(N.NuiWindow(zero(N.NuiCol([drawn])), "T", N.NuiRect(0, 0, 300, 200))))).toEqual(["mobile-scaling"]);
  });

  it("base-game TGA images, with a game (NUI-MOBILE-050)", () => {
    const img = zero(N.NuiImage("po_hu_m_01_", 0, 0, 0));
    const btn = zero(N.NuiButtonImage(N.NuiBind("icon")));
    const draw = zero(N.NuiDrawList(zero(N.NuiSpacer()), false, [N.NuiDrawListImage(true, "is_bless", N.NuiRect(0, 0, 8, 8), 0, 0, 0)]));
    const win = N.NuiWindow(zero(N.NuiCol([img, btn, draw])), "T", N.NuiRect(0, 0, 300, 200));
    const risky = new Set(["po_hu_m_01_", "is_bless", "ir_x"]);
    const f = run(win, { icon: "IR_X" }, (r) => risky.has(r)).filter((x) => x.kind.startsWith("Base-game"));
    expect(f.map((x) => [x.path, x.key])).toEqual([
      [[0], "value"],
      [[1], "label"],
      [[2], "draw_list"],
    ]);
    expect(f[0]!.text).toContain("NUI-MOBILE-051");
    // Without a game it says nothing.
    expect(run(win, { icon: "ir_x" }).filter((x) => x.kind.startsWith("Base-game"))).toEqual([]);
  });

  it("tells a base-game TGA from a DDS, a hak's copy or a PNG (the client's type order, NUI-IMAGE-010)", () => {
    const layer = (kind: "hak" | "key", files: [string, string][]) => ({
      kind,
      container: { label: kind, has: (r: string, t: number) => files.some(([n, e]) => n === r && resType(e) === t), get: async () => null, entries: () => [] },
    });
    const rm = new ResMan();
    rm.layers = [layer("hak", [["hakcopy", "tga"], ["hakpng", "png"]]), layer("key", [["only", "tga"], ["both", "tga"], ["both", "dds"], ["hakcopy", "tga"], ["hakpng", "tga"], ["plain", "png"]])];
    const risk = imageRiskOf(rm);
    expect(["only", "both", "hakcopy", "hakpng", "plain", "none"].filter(risk)).toEqual(["only", "hakpng"]);
  });

  it("are off unless asked, can be turned off rule by rule, and are listed as source mobile", () => {
    const win = N.NuiWindow(N.NuiCol([N.NuiButton("b")]), "T", N.NuiRect(-1, -1, 300, 200));
    const base = { win, binds: {}, name: "t" };
    expect(windowFindings(base).filter((f) => f.source === "mobile")).toEqual([]);
    const on = windowFindings({ ...base, mobile: true });
    expect(ids(on.filter((f) => f.source === "mobile"))).toEqual(["mobile-margin", "mobile-centred"]);
    expect(ids(windowFindings({ ...base, mobile: true, disabledRules: new Set(["mobile-margin"]) }).filter((f) => f.source === "mobile"))).toEqual(["mobile-centred"]);
    const issues = windowIssues(win, {}, null, new Map(), on);
    expect(issues.find((i) => i.kind === "Centred window on iOS")).toMatchObject({ source: "mobile", severity: "warning", where: "window" });
  });
});

describe("pnpm check --mobile and --client", () => {
  it("adds the mobile checks, lays out as iOS, and turns mobile rules off", async () => {
    const saved = { ini: process.env.NUI_DESIGNER_INI, root: process.env.NWN_ROOT };
    process.env.NUI_DESIGNER_INI = "/dev/null";
    delete process.env.NWN_ROOT;
    try {
      const run = async (...args: string[]) => {
        const out: string[] = [];
        const code = await check([...args, "--format", "json", join(FIX, "layout.jui")], (l) => out.push(l), () => {});
        const r = JSON.parse(out.join("\n")) as { windows: { issues: { source: string; kind: string; text: string }[] }[] };
        return { code, issues: r.windows[0]!.issues };
      };
      expect((await run()).issues.some((i) => i.source === "mobile")).toBe(false);
      const m = await run("--mobile");
      expect(m.issues.filter((i) => i.source === "mobile").map((i) => i.kind)).toContain("Margin on iOS");
      expect((await run("--mobile", "--disable-rule", "mobile-margin")).issues.some((i) => i.kind === "Margin on iOS")).toBe(false);
      const ios = await run("--client", "ios3");
      expect(ios.issues.some((i) => i.source === "mobile")).toBe(true);
      expect(ios.issues.some((i) => i.text.includes(REFUSAL))).toBe(true);
      await expect(run("--client", "phone")).rejects.toThrow(/--client phone/);
    } finally {
      if (saved.ini === undefined) delete process.env.NUI_DESIGNER_INI;
      else process.env.NUI_DESIGNER_INI = saved.ini;
      if (saved.root !== undefined) process.env.NWN_ROOT = saved.root;
    }
  }, 60_000);
});

describe("the preview: the window as iOS builds it", () => {
  it("draws exactly as before with the desktop or Android client", async () => {
    for (const f of readdirSync(FIX).filter((x) => /\.(jui|json)$/.test(x))) {
      const d = openText(readFileSync(join(FIX, f), "utf8"), f).doc;
      const nd = { name: d.name, form: d.export.windowId, window: d.window, binds: d.binds, panes: d.panes };
      const a = await renderView(nd, res.skin, res.images, nodeCanvas, { crop: true });
      for (const client of [null, clientProfile("desktop", 1.5), clientProfile("android", 1)]) {
        const b = await renderView(nd, res.skin, res.images, nodeCanvas, { crop: true, client });
        expect(b.problems, f).toEqual(a.problems);
        expect(b.outlines.map((o) => [o.elem, o.rect]), f).toEqual(a.outlines.map((o) => [o.elem, o.rect]));
        const pa = ctx2d(a.canvas).getImageData(0, 0, a.canvas.width, a.canvas.height).data;
        const pb = ctx2d(b.canvas).getImageData(0, 0, b.canvas.width, b.canvas.height).data;
        expect(Buffer.from(pb).equals(Buffer.from(pa)), f).toBe(true);
      }
    }
  }, 60_000);

  it("refuses a fixed row as the iPhone did (T57: a 32-high label in a row of height H)", () => {
    // [row height, label margin (undefined: the default), builds on the iPhone] from tables/mobile.yaml margin_fit.
    const cases: [number, number | undefined, boolean][] = [
      [36, undefined, false],
      [40, undefined, false],
      [44, undefined, true],
      [48, undefined, true],
      [36, 0, true],
      [36, 2, false],
      [38, 3, false],
      [40, 4, false],
    ];
    for (const [h, m, builds] of cases) {
      const d = doc(zero(N.NuiCol([zero(N.NuiHeight(N.NuiRow([label(32, m)]), h))])));
      expect(refused(desk(d)), `desktop ${h} ${m}`).toBe(false);
      const ios = lay(d);
      expect(refused(ios), `iOS ${h} ${m}`).toBe(!builds);
      if (!builds) expect(ios.problems.find((p) => /unsolvable/.test(p.kind))!.text).toContain(REFUSAL);
    }
  });

  it("multiplies margins, and places the window in points (T57, T63, T64)", () => {
    const l = label(32);
    const row = N.NuiRow([l]);
    const d = doc(zero(N.NuiCol([row])), N.NuiRect(100, 50, 400, 300));
    const a = desk(d);
    const b = lay(d);
    // The outlines name the document's own objects.
    expect(rectOf(b, l)[0] - b.windowRect[0]).toBe(rectOf(a, l)[0] - a.windowRect[0] + 8);
    expect(b.windowRect.slice(0, 2)).toEqual([300, 150]);
    // -1: worked out as on the desktop, multiplied, clamped into the bottom-right corner.
    const c = lay(doc(zero(N.NuiCol([])), N.NuiRect(-1, -1, 400, 300)));
    expect(c.windowRect).toEqual([1440 - 400, 900 - 300, 400, 300]);
    // The frame's extra: the content has 32 x 66 less room (NUI-MOBILE-030 at s = 1).
    const sp = zero(N.NuiSpacer());
    const e = lay(doc(zero(N.NuiCol([sp])), N.NuiRect(0, 0, 400, 300)));
    expect(rectOf(e, sp).slice(2)).toEqual([400 - 2 * CHROME.content_x - 32, 300 - CHROME.header_h - CHROME.content_y - CHROME.content_bottom - 66]);
  });

  it("multiplies row heights, row spacing, cell widths (with the 11 px minimum) and draw coordinates", () => {
    const cell = zero(N.NuiLabel(N.NuiBind("v"), 1, 0));
    const thin = zero(N.NuiSpacer());
    const list = N.NuiHeight(zero(N.NuiList([N.NuiListTemplateCell(thin, 2 / 3, false), N.NuiListTemplateCell(cell, 40, false)], 3, 20, true, 0)), 260);
    const d = doc(zero(N.NuiCol([list])), N.NuiRect(0, 0, 400, 400), { v: ["a", "b", "c"] });
    const b = lay(d);
    const rows = b.outlines.filter((o) => o.elem === cell);
    expect(rows.map((o) => o.rect[3])).toEqual([60, 60, 60]); // 20 x 3 (T59: 59.5 px)
    expect(rows[1]!.rect[1] - rows[0]!.rect[1]).toBe(72); // 3 h + 12 (T59)
    expect(rows[0]!.rect[0] - rectOf(b, list)[0]).toBe(14 + 11); // the inset, then the 11 px minimum cell (T61, T68)
    expect(rows[0]!.rect[2]).toBe(120); // 40 x 3 (T60)
    const pw = pointWindow(N.NuiWindow(zero(N.NuiDrawList(zero(N.NuiSpacer()), false, [N.NuiDrawListRect(true, null, true, 1, N.NuiRect(0, 1, 10, 2)), N.NuiDrawListRect(true, null, true, 1, N.NuiBind("r"))])), "T", N.NuiRect(0, 0, 9, 9)), { r: [N.NuiRect(1, 1, 1, 1)] }, IOS3)!;
    const items = (pw.window.root as JsonObject).draw_list as JsonObject[];
    expect(items[0]!.rect).toEqual(N.NuiRect(0, 3, 30, 6)); // T62: a rect 10 high drew 27.9 px
    expect(items[0]!.line_thickness).toBe(1);
    expect(pw.binds.r).toEqual([N.NuiRect(3, 3, 3, 3)]);
  });
});

describe("the portable-margins export (NUI-MOBILE-060)", () => {
  /** Every element tagged, so the elements can be found in the exported window. */
  function tag(v: JsonValue, n = { i: 0 }): JsonValue {
    if (Array.isArray(v)) return v.map((x) => tag(x, n));
    if (!isObject(v)) return v;
    const o: JsonObject = {};
    for (const [k, x] of Object.entries(v)) o[k] = tag(x, n);
    if (typeof o.type === "string") o.tag = n.i++;
    return o;
  }
  const widgets = (r: { outlines: { elem: JsonObject; rect: number[] }[] }) =>
    new Map(r.outlines.filter((o) => o.elem.tag !== undefined && !["row", "col", "spacer"].includes(String(o.elem.type))).map((o) => [o.elem.tag, o.rect]));
  const b = (w: number, h: number) => N.NuiHeight(N.NuiWidth(N.NuiButton("b"), w), h);
  const fixed = () =>
    tag(N.NuiWindow(N.NuiCol([N.NuiRow([b(100, 30), N.NuiMargin(b(60, 30), 5), b(80, 40)]), N.NuiRow([N.NuiSpacer(), b(120, 30), N.NuiSpacer()]), N.NuiHeight(N.NuiRow([N.NuiWidth(N.NuiCol([b(50, 20), b(50, 20)]), 54), b(90, 44)]), 60)]), "T", N.NuiRect(0, 0, 420, 300))) as JsonObject;

  it("writes margin 0 on every element, and lays a fixed window out where it was, on the desktop and on iOS", () => {
    const win = fixed();
    const out = portableMargins(win);
    let max = 0;
    const walk = (e: JsonValue) => {
      if (Array.isArray(e)) e.forEach(walk);
      else if (isObject(e)) {
        if (typeof e.type === "string") max = Math.max(max, marginOf(e));
        Object.values(e).forEach(walk);
      }
    };
    walk(out);
    expect(max).toBe(0);
    expect(mobileFindings({ win: out, binds: {} })).toEqual([]);
    const d = (w: JsonObject) => ({ name: "t", form: "t", window: w, binds: {}, panes: {} });
    const before = widgets(desk(d(win)));
    expect(before.size).toBe(7);
    expect(widgets(desk(d(out)))).toEqual(before);
    // On iOS the portable window is laid out as on the desktop (only the frame differs, and it is at the top left).
    expect(widgets(lay(d(out)))).toEqual(new Map([...before].map(([k, r]) => [k, [...r]])));
    expect(refused(lay(d(out)))).toBe(false);
  });

  it("lays the fixtures' widgets out where they were; list cells' content fills the cell", () => {
    let compared = 0;
    for (const f of readdirSync(FIX).filter((x) => /\.(jui|json)$/.test(x))) {
      const ed = openText(readFileSync(join(FIX, f), "utf8"), f).doc;
      const win = tag(ed.window) as JsonObject;
      const d = (w: JsonObject) => ({ name: f, form: f, window: w, binds: ed.binds, panes: ed.panes });
      const key = (o: { elem: JsonObject; row: number | null }) => `${String(o.elem.tag)} ${o.row}`;
      const shown = (r: ReturnType<typeof desk>) => r.outlines.filter((o) => o.elem.tag !== undefined && !["row", "col", "spacer"].includes(String(o.elem.type)));
      const out = new Map(shown(desk(d(portableMargins(win)))).map((o) => [key(o), o.rect]));
      for (const o of shown(desk(d(win)))) {
        const got = out.get(key(o));
        if (!got) continue;
        compared++;
        const [x, y, w, h] = o.rect;
        // A list cell's element loses its margin and fills the cell (NUI-MOBILE-060, item 2).
        const m = o.row === null ? 0 : marginOf(o.elem);
        const grow = typeof o.elem.width === "number" ? 0 : 2 * m;
        expect(got, `${f} ${o.path}`).toEqual([x - m, y, w + grow, h]);
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("never turns a window the desktop builds into one it refuses, nor one iOS refuses", () => {
    const checked: string[] = [];
    for (const f of readdirSync(FIX).filter((x) => /\.(jui|json)$/.test(x))) {
      const ed = openText(readFileSync(join(FIX, f), "utf8"), f).doc;
      const d = (w: JsonObject) => ({ name: f, form: f, window: w, binds: ed.binds, panes: ed.panes });
      if (refused(desk(d(ed.window)))) continue;
      const out = portableMargins(ed.window);
      expect(refused(desk(d(out))), `${f} on the desktop`).toBe(false);
      expect(refused(lay(d(out))), `${f} on iOS`).toBe(false);
      checked.push(f);
    }
    expect(checked).toContain("options-window.jui");
  });

  it("is a project setting the .jui and NWScript exports follow", () => {
    const win = N.NuiWindow(N.NuiCol([N.NuiButton("b")]), "T", N.NuiRect(0, 0, 300, 200));
    const ed: EditorDoc = { name: "t", window: win, binds: {}, panes: {}, notes: "", export: { ...defaultExport("t"), portableMargins: true, touch: true } };
    expect(exportWindow(ed)).toEqual(portableMargins(win));
    expect(exportWindow({ ...ed, export: defaultExport("t") })).toBe(win);
    expect(readProject(projectJson(ed)).export).toMatchObject({ portableMargins: true, touch: true });
    expect(readProject(projectJson({ ...ed, export: defaultExport("t") })).export).toEqual(defaultExport("t"));
    // The NWScript builds the portable window exactly; the touch skeleton opens it through nui_touch.
    const o = nwscriptOptions(ed);
    expect(jsonEqual(evalProgram(buildProgram(exportWindow(ed), o)), exportWindow(ed), true)).toBe(true);
    const nss = writeNwscript(exportWindow(ed), o);
    expect(nss).toContain('#include "nui_touch"');
    expect(nss).toContain("NuiCreate(oPC, NuiTouch_Window(oPC, ");
    expect(writeNwscript(win, { ...o, touch: false })).not.toContain("nui_touch");
  });
});

describe("nui_touch.nss", () => {
  const src = readFileSync(join(ROOT, "nss", "nui_touch.nss"), "latin1");
  it("is a resref, ASCII, and carries the spec's numbers", () => {
    expect("nui_touch".length).toBeLessThanOrEqual(16);
    expect([...src].every((c) => c === "\t" || c === "\n" || c === "\r" || (c >= " " && c <= "~"))).toBe(true);
    for (const n of ["20000.0", "300.0", "150.0", "0.25", "32.0", "66.0", "6.0", "4.0", "25.0"]) expect(src).toContain(n);
    expect(src).toContain("MIT License");
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
  it.skipIf(!game || !compiler)(`compiles, with a touch skeleton that includes it (${game ?? "no game"})`, () => {
    dir = mkdtempSync(join(tmpdir(), "nuid-touch-"));
    copyFileSync(join(ROOT, "nss", "nui_touch.nss"), join(dir, "nui_touch.nss"));
    const win = N.NuiWindow(N.NuiCol([N.NuiList([N.NuiListTemplateCell(N.NuiLabel(N.NuiBind("v"), 1, 0), 40, false)], N.NuiBind("n"))]), "T", N.NuiBind("geo"));
    const ed: EditorDoc = { name: "t", window: win, binds: { geo: N.NuiRect(-1, -1, 300, 200), v: ["a"], n: 1 }, panes: {}, notes: "", export: { ...defaultExport("t"), script: "nuid_touch_t", portableMargins: true, touch: true } };
    writeFileSync(join(dir, "nuid_touch_t.nss"), writeNwscript(exportWindow(ed), nwscriptOptions(ed)), "latin1");
    // Throws (with the compiler's output) when it does not compile.
    execFileSync("nwn_script_comp", ["--root", game!, "-y", "-d", dir, "-c", join(dir, "nuid_touch_t.nss")], { encoding: "utf8", stdio: "pipe" });
    expect(readdirSync(dir)).toContain("nuid_touch_t.ncs");
    expect(readFileSync(join(dir, "nuid_touch_t.nss"), "latin1")).toContain("NuiTouch_Rect(oPC, -1.0, -1.0, 300.0, 200.0)");
  }, 60_000);
});
