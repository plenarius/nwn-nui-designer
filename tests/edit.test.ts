// The editor's model operations: every tree edit, undo and redo, bind switching, presets, validation, style rules.
import { describe, expect, it } from "vitest";
import * as N from "../src/core/model/nui.js";
import type { JsonObject } from "../src/core/model/types.js";
import { ELEMENTS, newWindow, specOf } from "../src/core/edit/catalog.js";
import { canRedo, canUndo, push, redo, startHistory, undo } from "../src/core/edit/history.js";
import { applyPreset, bindDetails, fillList } from "../src/core/edit/binds.js";
import { addDrawItem, addElement, bindProp, deleteElement, duplicateElement, getValue, moveDrawItem, moveElement, nudge, rebindProp, removeDrawItem, renameBindDoc, retypeDrawItem, setValue, unbindProp, unwrapElement, wrapElement } from "../src/core/edit/ops.js";
import { type EditorDoc, defaultExport, openText, readProject, projectJson, writeProject } from "../src/core/edit/project.js";
import { EditError, getElem, kidsOf, moveRefusal, pathIndex, refusal } from "../src/core/edit/tree.js";
import { validateWindow } from "../src/core/edit/validate.js";
import { runStyle } from "../src/core/edit/style.js";
import { LAYONARA, frameOf } from "../src/core/edit/styles/layonara.js";

const label = (s: string) => N.NuiLabel(s, 1, 0);
function doc(win: JsonObject = N.NuiWindow(N.NuiCol([label("a"), N.NuiRow([label("b"), label("c")]), label("d")]), "T", N.NuiRect(-1, -1, 300, 200))): EditorDoc {
  return { name: "t", window: win, binds: {}, panes: {}, notes: "", export: defaultExport("t") };
}
const texts = (d: EditorDoc, path: number[] = []) => kidsOf(getElem(d.window, path)).map((e) => (e.type === "label" ? e.value : e.type));

describe("tree edits", () => {
  it("adds every palette element, in rows, columns, groups and lists", () => {
    let d = doc(newWindow());
    for (const spec of ELEMENTS) {
      const r = addElement(d, { parent: [], index: 999 }, spec.make());
      d = r.doc;
      expect(getElem(d.window, r.select!)!.type).toBe(spec.type === "drawing" ? "spacer" : spec.type);
    }
    expect(kidsOf(d.window.root as JsonObject)).toHaveLength(ELEMENTS.length);
    // A group holds one child; a widget none; a list's template a cell per element.
    const group = ELEMENTS.findIndex((e) => e.type === "group");
    // The palette's group comes with a column in it, so things dropped on it have somewhere to go.
    expect(getElem(d.window, [group, 0])!.type).toBe("col");
    d = addElement(d, { parent: [group, 0], index: 0 }, label("in group")).doc;
    expect(() => addElement(d, { parent: [group], index: 1 }, label("second"))).toThrow(EditError);
    const lab = ELEMENTS.findIndex((e) => e.type === "label");
    expect(() => addElement(d, { parent: [lab], index: 0 }, label("x"))).toThrow(/no children/);
    const list = ELEMENTS.findIndex((e) => e.type === "list");
    d = addElement(d, { parent: [list], index: 1 }, N.NuiButton("Go")).doc;
    const l = getElem(d.window, [list])!;
    expect(l.row_template).toHaveLength(2);
    expect((l.row_template as unknown[][])[1]![1]).toBe(0);
    expect((l.row_template as unknown[][])[1]![2]).toBe(true);
    expect(refusal(l, N.NuiList([], 1))).toMatch(/list cannot hold a list/);
  });

  it("deletes, and selects a neighbour", () => {
    const r = deleteElement(doc(), [1]);
    expect(texts(r.doc)).toEqual(["a", "d"]);
    expect(r.select).toEqual([1]);
    const last = deleteElement(doc(), [2]);
    expect(last.select).toEqual([1]);
    const only = deleteElement(deleteElement(doc(), [1, 0]).doc, [1, 0]);
    expect(only.select).toEqual([1]);
    expect(() => deleteElement(doc(), [])).toThrow(/root/);
  });

  it("reorders within a parent and moves across parents", () => {
    let r = moveElement(doc(), [0], { parent: [], index: 3 });
    expect(texts(r.doc)).toEqual(["row", "d", "a"]);
    expect(r.select).toEqual([2]);
    r = moveElement(doc(), [2], { parent: [], index: 0 });
    expect(texts(r.doc)).toEqual(["d", "a", "row"]);
    // Into the row, from before it: the row's index shifts down by one.
    r = moveElement(doc(), [0], { parent: [1], index: 1 });
    expect(texts(r.doc)).toEqual(["row", "d"]);
    expect(texts(r.doc, [0])).toEqual(["b", "a", "c"]);
    expect(r.select).toEqual([0, 1]);
    // Out of the row.
    r = moveElement(doc(), [1, 1], { parent: [], index: 0 });
    expect(texts(r.doc)).toEqual(["c", "a", "row", "d"]);
    expect(moveRefusal(doc().window, [1], { parent: [1], index: 0 })).toMatch(/into itself/);
    expect(() => moveElement(doc(), [], { parent: [], index: 0 })).toThrow(/root cannot be moved/);
    expect(nudge(doc(), [0], 1)!.doc.window).toEqual(moveElement(doc(), [0], { parent: [], index: 2 }).doc.window);
    expect(texts(nudge(doc(), [2], -1)!.doc)).toEqual(["a", "d", "row"]);
    expect(nudge(doc(), [0], -1)).toBeNull();
  });

  it("keeps a list cell's width and flag when its element moves within the list", () => {
    const list = N.NuiList([N.NuiListTemplateCell(label("x"), 40, false), N.NuiListTemplateCell(label("y"), 0, true)], 3);
    const d = doc(N.NuiWindow(N.NuiCol([list]), "T", N.NuiRect(-1, -1, 300, 200)));
    const r = moveElement(d, [0, 0], { parent: [0], index: 2 });
    expect(getElem(r.doc.window, [0])!.row_template).toEqual([[label("y"), 0, true], [label("x"), 40, false]]);
  });

  it("duplicates with fresh ids, keeping binds", () => {
    const e = N.NuiId(N.NuiButton(N.NuiBind("lbl")), "ok");
    const d = doc(N.NuiWindow(N.NuiCol([e]), "T", N.NuiRect(-1, -1, 300, 200)));
    const r = duplicateElement(d, [0]);
    const kids = kidsOf(r.doc.window.root as JsonObject);
    expect(kids.map((k) => k.id)).toEqual(["ok", "ok_2"]);
    expect(kids[1]!.label).toEqual(N.NuiBind("lbl"));
    expect(r.select).toEqual([1]);
    expect(kidsOf(duplicateElement(r.doc, [1]).doc.window.root as JsonObject).map((k) => k.id)).toEqual(["ok", "ok_2", "ok_3"]);
  });

  it("wraps in a row, column or group, and unwraps", () => {
    let r = wrapElement(doc(), [0], "row");
    expect(getElem(r.doc.window, [0])!.type).toBe("row");
    expect(getElem(r.doc.window, [0, 0])!.value).toBe("a");
    r = wrapElement(doc(), [], "group");
    expect((r.doc.window.root as JsonObject).type).toBe("group");
    const u = unwrapElement(r.doc, []);
    expect(u.doc.window.root).toEqual(doc().window.root);
    const v = unwrapElement(doc(), [1]);
    expect(texts(v.doc)).toEqual(["a", "b", "c", "d"]);
    expect(() => unwrapElement(doc(), [0])).toThrow(/only a row, column, group or list/);
    // Unwrapping into a group that would hold two children is refused.
    const g = doc(N.NuiWindow(N.NuiGroup(N.NuiRow([label("a"), label("b")])), "T", N.NuiRect(-1, -1, 300, 200)));
    expect(() => unwrapElement(g, [0])).toThrow(/one child/);
  });

  it("leaves keys it does not know alone", () => {
    const e = { ...label("a"), future_key: { anything: [1, 2] } };
    const d = doc(N.NuiWindow(N.NuiCol([e, label("b")]), "T", N.NuiRect(-1, -1, 300, 200)));
    const r = moveElement(d, [0], { parent: [], index: 2 });
    expect(getElem(r.doc.window, [1])!.future_key).toEqual({ anything: [1, 2] });
  });

  it("maps the renderer's element objects to paths", () => {
    const d = doc();
    const idx = pathIndex(d.window);
    expect(idx.get(getElem(d.window, [1, 1])!)).toEqual([1, 1]);
  });
});

describe("history", () => {
  it("undoes and redoes every step, and merges typing in one field", () => {
    let h = startHistory(doc());
    const a = setValue(h.present, { path: [0] }, "value", "x");
    h = push(h, a, "value@0", 1000);
    h = push(h, setValue(h.present, { path: [0] }, "value", "xy"), "value@0", 1500);
    expect(h.past).toHaveLength(1);
    h = push(h, deleteElement(h.present, [2]).doc, null, 1600);
    expect(h.past).toHaveLength(2);
    expect(texts(h.present)).toEqual(["xy", "row"]);
    h = undo(h);
    expect(texts(h.present)).toEqual(["xy", "row", "d"]);
    h = undo(h);
    expect(texts(h.present)).toEqual(["a", "row", "d"]);
    expect(canUndo(h)).toBe(false);
    h = redo(redo(h));
    expect(texts(h.present)).toEqual(["xy", "row"]);
    expect(canRedo(h)).toBe(false);
    // A new edit after an undo drops the redo branch; a key after the coalescing window is a new step.
    h = push(undo(h), setValue(h.present, { path: [0] }, "value", "z"), "value@0", 5000);
    expect(canRedo(h)).toBe(false);
    expect(h.past).toHaveLength(2);
  });
});

describe("binds", () => {
  it("switches a property between static and bound, keeping what is drawn", () => {
    let d = doc();
    d = bindProp(d, { path: [0] }, "value", "first");
    expect(getValue(d, { path: [0] }, "value")).toEqual(N.NuiBind("first"));
    expect(d.binds.first).toBe("a");
    d = setValue(d, { path: [0] }, "value", N.NuiBind("first"));
    d = { ...d, binds: { first: "edited" } };
    d = unbindProp(d, { path: [0] }, "value", "");
    expect(getValue(d, { path: [0] }, "value")).toBe("edited");
    // A second property bound to an existing bind keeps that bind's sample.
    d = bindProp(d, { path: [2] }, "value", "first");
    expect(d.binds.first).toBe("edited");
    // Without a name, a fresh one.
    d = bindProp(d, { path: [1, 0] }, "value");
    expect(getValue(d, { path: [1, 0] }, "value")).toEqual(N.NuiBind("value"));
    d = rebindProp(d, { path: [1, 0] }, "value", "other");
    expect(getValue(d, { path: [1, 0] }, "value")).toEqual(N.NuiBind("other"));
    // Window properties and draw-list items too.
    d = bindProp(d, { path: null }, "title", "title");
    expect(d.binds.title).toBe("T");
    d = addDrawItem(d, [0], 7);
    d = bindProp(d, { path: [0], item: 0 }, "color", "col");
    expect(d.binds.col).toEqual(N.NuiColor(255, 255, 255));
    d = renameBindDoc(d, "first", "renamed");
    expect(getValue(d, { path: [2] }, "value")).toEqual(N.NuiBind("renamed"));
    expect(d.binds.renamed).toBe("edited");
    expect("first" in d.binds).toBe(false);
  });

  it("knows each bind's kind, its rows and its list", () => {
    const tpl = [N.NuiListTemplateCell(N.NuiLabel(N.NuiBind("name"), 1, 0), 0, true), N.NuiListTemplateCell(N.NuiImage(N.NuiBind("icon"), 0, 0, 0), 32, false)];
    const win = N.NuiWindow(N.NuiCol([N.NuiList(tpl, N.NuiBind("rows")), N.NuiProgress(N.NuiBind("prog"))]), N.NuiBind("title"), N.NuiRect(-1, -1, 300, 200));
    const b = bindDetails(win);
    expect(b.get("name")).toMatchObject({ kind: "text", perRow: true });
    expect(b.get("name")!.uses[0]!.list).toEqual([0]);
    expect(b.get("icon")).toMatchObject({ kind: "resref", perRow: true });
    expect(b.get("rows")!.countsRowsOf).toEqual([[0]]);
    expect(b.get("prog")).toMatchObject({ kind: "float", perRow: false });
    expect(b.get("title")).toMatchObject({ kind: "title" });
    const full = fillList(win, {}, [0], 30, "long");
    expect(full.rows).toBe(30);
    expect(full.name).toHaveLength(30);
    expect((full.name as string[])[0]!.length).toBeGreaterThan(100);
    const empty = applyPreset(win, full, "empty");
    expect(empty).toMatchObject({ rows: 0, name: [], title: "", prog: 0 });
    const long = applyPreset(win, {}, "long", {}, 12);
    expect(long.rows).toBe(12);
    expect((long.title as string).length).toBeGreaterThan(100);
  });
});

describe("draw lists", () => {
  it("adds, retypes, reorders and removes items", () => {
    let d = addDrawItem(doc(), [0], 7);
    d = addDrawItem(d, [0], 4);
    let dl = getElem(d.window, [0])!.draw_list as JsonObject[];
    expect(dl.map((x) => x.type)).toEqual([7, 4]);
    expect(getElem(d.window, [0])!.draw_list_scissor).toBe(true);
    d = setValue(d, { path: [0], item: 0 }, "color", N.NuiColor(1, 2, 3));
    d = retypeDrawItem(d, [0], 0, 2);
    dl = getElem(d.window, [0])!.draw_list as JsonObject[];
    expect(dl[0]).toMatchObject({ type: 2, color: N.NuiColor(1, 2, 3) });
    d = moveDrawItem(d, [0], 0, 1);
    expect((getElem(d.window, [0])!.draw_list as JsonObject[]).map((x) => x.type)).toEqual([4, 2]);
    d = removeDrawItem(removeDrawItem(d, [0], 0), [0], 0);
    expect(getElem(d.window, [0])!.draw_list).toBeUndefined();
  });
});

describe("validation", () => {
  it("passes every palette default and a new window", () => {
    let d = doc(newWindow());
    for (const spec of ELEMENTS) d = addElement(d, { parent: [], index: 999 }, spec.make()).doc;
    expect(validateWindow(d.window).filter((f) => f.severity === "error")).toEqual([]);
  });

  it("reports what the client would not take", () => {
    const bad = N.NuiWindow(
      N.NuiCol([
        { ...N.NuiLabel("x", 7, 0), width: N.NuiBind("w"), background_color: N.NuiColor(0, 0, 0) },
        N.NuiStyleForegroundColor(N.NuiImage("is_x", 0, 0, 0), N.NuiColor(300, 0, 0)),
        N.NuiId(N.NuiButton("a"), "same"),
        N.NuiId(N.NuiButton("b"), "same"),
        N.NuiStyleFont(N.NuiTextEdit("p", "", 70000, false), "nope"),
        N.NuiList([], 1, 25, true, 4),
        { type: "widget_from_the_future" },
      ]),
      "T",
      N.NuiRect(-1, -1, 300, 200),
    );
    const kinds = validateWindow(bad, { fonts: ["default"] }).map((f) => `${f.kind}:${f.key ?? ""}`);
    expect(kinds).toContain("cannot be bound:width");
    expect(kinds).toContain("bad value:text_halign");
    expect(kinds).toContain("cannot be styled:background_color");
    expect(kinds).toContain("bad value:foreground_color");
    expect(kinds).toContain("cannot be styled:foreground_color");
    expect(kinds.filter((k) => k === "duplicate id:id")).toHaveLength(2);
    expect(kinds).toContain("unknown font:font");
    expect(kinds).toContain("bad value:max");
    expect(kinds).toContain("list:scrollbars");
    expect(kinds).toContain("unknown type:");
  });

  it("checks the Layonara house style when asked", () => {
    const win = N.NuiWindow(N.NuiHeight(N.NuiWidth(N.NuiCol([N.NuiEnabled(N.NuiButton("Close"), N.NuiBind("can")), N.NuiProgress(0.5), N.NuiText("x".repeat(300))]), 400), 300), "T", N.NuiRect(-1, -1, 500, 400), true);
    const f = runStyle(LAYONARA, { win, binds: {} });
    const rules = new Set(f.map((x) => x.kind));
    expect(rules).toContain("Fixed size");
    expect(rules).toContain("Sized to its content");
    expect(rules).toContain("Disabled controls say why");
    expect(rules).toContain("Drawn progress bars");
    expect(rules).toContain("No help paragraphs");
    expect(rules).toContain("Close at the bottom right");
    expect(f.every((x) => x.source === "style:layonara")).toBe(true);
    const ok = N.NuiWindow(N.NuiHeight(N.NuiWidth(N.NuiCol([N.NuiButton("Close")]), 400), 300), "T", N.NuiRect(-1, -1, 420, 353), false);
    expect(runStyle(LAYONARA, { win: ok, binds: {} }).filter((x) => x.severity !== "info")).toEqual([]);
    expect(runStyle(LAYONARA, { win, binds: {} }, new Set(["fixed-size"])).some((x) => x.kind === "Fixed size")).toBe(false);
  });

  it("sizes the Layonara frame as the client draws it: + 16 wide, + 49 tall, + 16 with no title bar", () => {
    // Root 400 x 300 with its margins of 2: a footprint of 404 x 304.
    // No title bar: no title, and collapse and close off (NuiWindow defaults to both on).
    const win = (w: number, h: number, title: string | boolean = "T") =>
      N.NuiWindow(N.NuiHeight(N.NuiWidth(N.NuiCol([N.NuiButton("Close")]), 400), 300), title, N.NuiRect(-1, -1, w, h), false, title === false ? false : null, title !== false);
    const frame = (w: Record<string, unknown>) => runStyle(LAYONARA, { win: w as never, binds: {} }).filter((x) => x.kind === "Sized to its content");
    expect(frame(win(420, 353))).toEqual([]);
    const old = frame(win(444, 364));
    expect(old).toHaveLength(1);
    expect(old[0]!.text).toContain("444 wide where the root's footprint (404) + 16 is 420");
    expect(old[0]!.text).toContain("364 tall where the root's footprint (304) + 49 is 353");
    expect(frame(win(420, 320, false))).toEqual([]);
    expect(frame(win(420, 353, false))[0]!.text).toContain("+ 16 (no title bar) is 320");
    expect(frameOf({ title: { bind: "t" } })).toEqual({ w: 16, h: 49 });
    // The title bar goes only when the title is empty and close and collapse are both off.
    expect(frameOf({ title: false })).toEqual({ w: 16, h: 49 });
    expect(frameOf({ title: false, closable: false })).toEqual({ w: 16, h: 16 });
    expect(frameOf({ title: false, closable: false, collapsed: null })).toEqual({ w: 16, h: 49 });
    expect(frameOf({ title: "", closable: { bind: "c" }, collapsed: false }, { c: false })).toEqual({ w: 16, h: 16 });
    // The 1000 x 720 content limit uses the same frame.
    const big = (w: number, h: number) => runStyle(LAYONARA, { win: N.NuiWindow(N.NuiCol([]), "T", N.NuiRect(-1, -1, w, h), false) as never, binds: {} }).filter((x) => x.kind === "At most 1000 x 720");
    expect(big(1016, 769)).toEqual([]);
    expect(big(1017, 769)[0]!.text).toContain("1001 x 720");
  });
});

describe("projects", () => {
  it("saves and opens a project, and opens the other inputs", () => {
    let d = doc();
    d = bindProp(d, { path: [0] }, "value", "first");
    d = { ...d, notes: "Check the width." };
    const back = openText(writeProject(d));
    expect(back.kind).toBe("project");
    expect(back.doc).toEqual(d);
    expect(readProject(projectJson(d))).toEqual(d);
    expect(openText(JSON.stringify(d.window), "w").kind).toBe("jui");
    expect(openText(JSON.stringify({ name: "x", form: "x", window: d.window, binds: { a: 1 }, panes: {} })).kind).toBe("dump");
    expect(openText('{"type":"label","value":"x"}').kind).toBe("layout");
    expect(() => openText(JSON.stringify({ format: "nwn-nui-designer/project", version: 99, window: {} }))).toThrow(/newer/);
  });

  it("has a spec for every type the renderer draws", () => {
    for (const t of ["row", "col", "group", "list", "spacer", "label", "text", "button", "button_image", "button_select", "check", "image", "combo", "slider", "sliderf", "progress", "textedit", "color_picker", "options", "tabbar", "toggles", "chart"]) {
      expect(specOf(t), t).not.toBeNull();
    }
  });
});
