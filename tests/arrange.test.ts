// Multi-select, match size, align and distribute: every tool's edit is measured by laying the window out again as the
// canvas does (the renderer's dry pass), and impossible requests are refused whole with a reason.
import { beforeAll, describe, expect, it } from "vitest";
import * as N from "../src/core/model/nui.js";
import type { JsonObject } from "../src/core/model/types.js";
import { type Measure, align, alignRefusal, distribute, distributeRefusal, matchSize, measured } from "../src/core/edit/arrange.js";
import { deleteMany, duplicateMany, nudgeMany, nudgeRefusal, removeRefusal, setValueMany } from "../src/core/edit/multi.js";
import { type EditorDoc, defaultExport, toNuiDocument } from "../src/core/edit/project.js";
import { boxSelect, outermostOf, plainName, siblingRange, stillThere, toggle, treeOrder, treeRange } from "../src/core/edit/selection.js";
import { type ElemPath, EditError, getElem, kidsOf } from "../src/core/edit/tree.js";
import { placements } from "../src/core/edit/drop.js";
import { pathIndex } from "../src/core/edit/tree.js";
import { layoutView } from "../src/core/view.js";
import { type Resources, openResources } from "../src/node/setup.js";

let res: Resources;
let measure: Measure;
beforeAll(async () => {
  res = await openResources({ game: null });
  measure = (d) => {
    const r = layoutView(toNuiDocument(d), res.skin, res.images);
    return measured(d.window, r.outlines, r.problems);
  };
});

const btn = (id: string, w?: number, h = 30): JsonObject => {
  const b: JsonObject = { type: "button", label: id, value: null, id, height: h };
  if (w !== undefined) b.width = w;
  return b;
};
const sp = (w?: number): JsonObject => (w === undefined ? { type: "spacer", label: null, value: null } : { type: "spacer", label: null, value: null, width: w });
const row = (...c: JsonObject[]): JsonObject => N.NuiRow(c);
const col = (...c: JsonObject[]): JsonObject => N.NuiCol(c);
function doc(root: JsonObject, w = 420, h = 320): EditorDoc {
  const win = N.NuiWindow(root, "T", N.NuiRect(-1, -1, w, h));
  return { name: "t", window: win, binds: {}, panes: {}, notes: "", export: defaultExport("t") };
}
const rect = (d: EditorDoc, p: ElemPath) => measure(d).rects.get(p.join("/"))!;
const left = (d: EditorDoc, p: ElemPath) => rect(d, p)[0];
const right = (d: EditorDoc, p: ElemPath) => rect(d, p)[0] + rect(d, p)[2];
const top = (d: EditorDoc, p: ElemPath) => rect(d, p)[1];

/** Three rows: a (after a 50 spacer), b (first, then a free spacer), c. */
const rows3 = () => doc(col(row(sp(50), btn("a", 100)), row(btn("b", 80), sp()), row(btn("c", 60), sp())));

describe("selection", () => {
  const win = rows3().window;
  it("Ctrl+click toggles; the first picked is the key", () => {
    let s = toggle([], [0, 1]);
    s = toggle(s, [1, 0]);
    expect(s).toEqual([[0, 1], [1, 0]]);
    expect(toggle(s, [0, 1])).toEqual([[1, 0]]);
  });
  it("Shift+click: a range in tree order in the tree, siblings between on the canvas", () => {
    const rows = treeOrder(win);
    expect(treeRange([[0, 1]], [1, 0], rows)).toEqual([[0, 1], [1], [1, 0]]);
    expect(siblingRange([[0, 0]], [0, 1])).toEqual([[0, 0], [0, 1]]);
    expect(siblingRange([[2]], [0])).toEqual([[2], [0], [1]]);
    // Not siblings: the clicked one is added.
    expect(siblingRange([[0, 1]], [1, 0])).toEqual([[0, 1], [1, 0]]);
  });
  it("a box picks the widgets drawn fully inside it, not the rows and spacers around them", () => {
    const d = rows3();
    const r = layoutView(toNuiDocument(d), res.skin, res.images);
    const placed = placements(r.outlines, pathIndex(d.window));
    const a = placed.get("0/1")!.rect;
    const c = placed.get("2/0")!.rect;
    const box: [number, number, number, number] = [c[0] - 1, a[1] - 1, a[0] + a[2] - c[0] + 2, c[1] + c[3] - a[1] + 2];
    expect(boxSelect(d.window, placed, box)).toEqual([[0, 1], [1, 0], [2, 0]]);
    // Nothing fully inside: nothing picked.
    expect(boxSelect(d.window, placed, [a[0] + 1, a[1] + 1, 4, 4])).toEqual([]);
  });
  it("after an undo or delete, missing paths drop out; the key's ancestor when none is left", () => {
    expect(stillThere([[0, 1], [7]], win)).toEqual([[0, 1]]);
    expect(stillThere([[0, 9]], win)).toEqual([[0]]);
    expect(outermostOf([[0], [0, 1], [1]])).toEqual([[0], [1]]);
  });
});

describe("multi-element edits", () => {
  it("delete removes them all in one step, and selects what takes the key's place", () => {
    const d = rows3();
    const r = deleteMany(d, [[1, 0], [0, 1], [2]]);
    expect(kidsOf(r.doc.window.root as JsonObject)).toHaveLength(2);
    expect(getElem(r.doc.window, [0, 1])).toBeNull();
    expect(r.selectMany).toEqual([[1, 0]]);
    expect(removeRefusal([[], [0]])).toMatch(/main row or column can't be deleted/);
  });
  it("duplicate copies each right after itself and selects the copies", () => {
    const d = rows3();
    const r = duplicateMany(d, [[1, 0], [0, 1]]);
    expect(getElem(r.doc.window, [0, 2])!.id).toBe("a_2");
    expect(getElem(r.doc.window, [1, 1])!.id).toBe("b_2");
    expect(r.selectMany).toEqual([[1, 1], [0, 2]]);
  });
  it("move up / down moves siblings as a block, and refuses elements of different parents", () => {
    const d = doc(row(btn("a"), btn("b"), btn("c"), btn("d")));
    const r = nudgeMany(d, [[1], [2]], 1)!;
    expect(kidsOf(r.doc.window.root as JsonObject).map((e) => e.id)).toEqual(["a", "d", "b", "c"]);
    expect(r.selectMany).toEqual([[2], [3]]);
    expect(nudgeRefusal(d, [[0], [1]], -1)).toMatch(/already at the top/);
    expect(nudgeRefusal(rows3(), [[0, 1], [1, 0]], 1)).toMatch(/one row/);
    expect(() => nudgeMany(rows3(), [[0, 1], [1, 0]], 1)).toThrow(EditError);
  });
  it("a property set on the selection sets it on each", () => {
    const d = setValueMany(rows3(), [[0, 1], [1, 0]], "enabled", false);
    expect(getElem(d.window, [0, 1])!.enabled).toBe(false);
    expect(getElem(d.window, [1, 0])!.enabled).toBe(false);
    expect(getElem(d.window, [2, 0])!.enabled).toBeUndefined();
  });
});

describe("measuring", () => {
  it("the dry layout pass gives exactly the rects and problems the canvas draws", async () => {
    const { readFileSync } = await import("node:fs");
    const { openText } = await import("../src/core/edit/project.js");
    const { renderView } = await import("../src/core/view.js");
    const { nodeCanvas } = await import("../src/node/fs.js");
    for (const f of ["layout.jui", "widgets.jui", "unsolvable.jui"]) {
      const d = openText(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"), f).doc;
      const dry = layoutView(toNuiDocument(d), res.skin, res.images);
      const drawn = await renderView(toNuiDocument(d), res.skin, res.images, nodeCanvas);
      expect(dry.outlines.map((o) => [o.path, o.rect])).toEqual(drawn.outlines.map((o) => [o.path, o.rect]));
      // The layout's own problems (drawing adds text and image ones).
      const layoutKinds = (ps: { kind: string; text: string }[]) => ps.filter((p) => ["unsolvable layout", "unsolvable size", "overflow"].includes(p.kind)).map((p) => p.text);
      expect(layoutKinds(dry.problems)).toEqual(layoutKinds(drawn.problems));
    }
  });
});

describe("match size", () => {
  it("to the largest, or to the key element", () => {
    const d = rows3();
    const big = matchSize(d, [[1, 0], [0, 1], [2, 0]], measure, ["w"], "largest");
    for (const p of [[0, 1], [1, 0], [2, 0]]) expect(rect(big.doc, p)[2]).toBe(100);
    const key = matchSize(d, [[2, 0], [0, 1]], measure, ["w", "h"], "key");
    expect(rect(key.doc, [0, 1]).slice(2)).toEqual([60, 30]);
  });
  it("refuses a size a column is too narrow for, and changes nothing", () => {
    const d = doc(row(col(btn("x", 100)).valueOf() as JsonObject, col(btn("y", 200))));
    const narrow = { ...d, window: { ...d.window, root: { ...(d.window.root as JsonObject), children: [{ ...col(btn("x", 100)), width: 120 }, col(btn("y", 200))] } } };
    expect(() => matchSize(narrow, [[0, 0], [1, 0]], measure, ["w"], "largest")).toThrow(/refuse to open the window: the first column in its row would be 120 px wide, but what's inside it needs \d+ px\. Match to the key instead/);
  });
  it("refuses a height a row is too low for", () => {
    const d = doc(col(row(btn("x", 50, 30), btn("y", 50, 30)), row(btn("z", 50, 60))));
    expect(() => matchSize(d, [[1, 0], [0, 0]], measure, ["h"], "key")).not.toThrow();
    expect(() => matchSize(d, [[0, 0], [1, 0]], measure, ["h"], "largest")).not.toThrow();
    const low = doc(col({ ...row(btn("x", 50, 30)), height: 34 }, row(btn("z", 50, 60))));
    expect(() => matchSize(low, [[0, 0], [1, 0]], measure, ["h"], "largest")).toThrow(/refuse to open the window: the first row in its column would be 34 px high, but what's inside it needs 64 px/);
  });
  it("needs two elements, never the root, never one inside the other", () => {
    const w = rows3().window;
    expect(() => matchSize(rows3(), [[0, 1]], measure, ["w"], "largest")).toThrow(/Select two or more/);
    expect(() => matchSize(rows3(), [[], [0, 1]], measure, ["w"], "largest")).toThrow(/main row or column.*Take it out of the selection/);
    expect(alignRefusal(w, [[0], [0, 1]], "left")).toMatch(/^“a” is inside the first row in its column\. Select one or the other/);
  });
});

describe("align", () => {
  it("left edges: a spacer goes in before an element that has none", () => {
    const d = rows3();
    const r = align(d, [[0, 1], [1, 0], [2, 0]], measure, "left");
    expect(left(r.doc, [0, 1])).toBe(left(d, [0, 1]));
    // The paths moved by the inserted spacers come back as the selection.
    expect(r.selectMany).toEqual([[0, 1], [1, 1], [2, 1]]);
    expect(left(r.doc, [1, 1])).toBe(left(d, [0, 1]));
    expect(left(r.doc, [2, 1])).toBe(left(d, [0, 1]));
    expect(getElem(r.doc.window, [1, 0])).toMatchObject({ type: "spacer", width: 50 });
  });
  it("right edges and centres land exactly on the key's", () => {
    const d = rows3();
    for (const edge of ["right", "hcenter"] as const) {
      const r = align(d, [[0, 1], [1, 0], [2, 0]], measure, edge);
      const [ka, kw] = [rect(r.doc, r.selectMany![0]!)[0], rect(r.doc, r.selectMany![0]!)[2]];
      for (const p of r.selectMany!.slice(1)) {
        const [x, , w] = rect(r.doc, p);
        if (edge === "right") expect(x + w).toBe(ka + kw);
        else expect(x + w / 2).toBe(ka + kw / 2);
      }
    }
    expect(right(align(d, [[0, 1], [2, 0]], measure, "right").doc, [2, 1])).toBe(right(d, [0, 1]));
  });
  it("reuses the spacer before an element, shrinking it to move it left", () => {
    const d = rows3();
    const r = align(d, [[1, 0], [0, 1]], measure, "left");
    expect(getElem(r.doc.window, [0, 0])).toMatchObject({ type: "spacer", width: 0 });
    expect(left(r.doc, [0, 1])).toBe(left(d, [1, 0]));
    expect(kidsOf(getElem(r.doc.window, [0]))).toHaveLength(2);
  });
  it("tops across columns, through the spacer above", () => {
    const d = doc(row(col(sp(40), btn("a", 80)), col(btn("b", 80), sp())));
    const r = align(d, [[0, 1], [1, 0]], measure, "top");
    expect(top(r.doc, [1, 1])).toBe(top(d, [0, 1]));
  });
  it("moves a widget with the column it is in when the column is what a row places", () => {
    const d = doc(col(row(sp(30), col(btn("a", 80))), row(btn("b", 80), sp())));
    const r = align(d, [[0, 1, 0], [1, 0]], measure, "left");
    expect(left(r.doc, r.selectMany![1]!)).toBe(left(d, [0, 1, 0]));
    // The other way the column would have to move 32 px left with a 30 px spacer before it: refused.
    expect(() => align(d, [[1, 0], [0, 1, 0]], measure, "left")).toThrow(/^“a” would have to move 32 px left \(it moves with the column\), but the spacer before it is only 30 px\. Make it the key/);
  });
  it("refuses an element that would have to move left with nothing before it to give room", () => {
    const d = doc(col(row(btn("k", 60), sp()), row(btn("l", 30), btn("e", 80), sp())));
    expect(() => align(d, [[0, 0], [1, 1]], measure, "left")).toThrow(/^“e” would have to move \d+ px left, but there's no spacer before it to shrink/);
  });
  it("refuses two elements side by side in one row", () => {
    const d = rows3();
    expect(alignRefusal(d.window, [[0, 1], [0, 0]], "left")).toBe("The spacer and “a” are side by side in one row, so their left edges can't line up. Align works across rows; to make them the same size, use Match size.");
    const two = doc(col(row(btn("a", 50), btn("b", 50), sp()), row(btn("c", 50), sp())));
    expect(alignRefusal(two.window, [[1, 0], [0, 0], [0, 1]], "left")).toMatch(/^“a” and “b” are side by side in one row, so only one of them can line up with “c”\. Leave one/);
    // In a column: one above the other.
    const stacked = doc(row(col(btn("a", 50), btn("b", 50)), col(btn("c", 50))));
    expect(alignRefusal(stacked.window, [[0, 0], [0, 1]], "top")).toMatch(/one above the other in one column, so their top edges can't line up\. Align works across columns/);
  });
  it("names elements as the builder sees them (the reported case: a text field and Sell in one row)", () => {
    const d = doc(col(row({ type: "label", label: null, value: "Price" }, { type: "textedit", label: null, value: { bind: "price" }, max: 10, multiline: false }, { ...btn("se_sell", 60), label: "Sell" }), row(btn("c", 50), sp())));
    const why = alignRefusal(d.window, [[0, 2], [0, 1]], "right")!;
    expect(why).toBe("The text field and “Sell” are side by side in one row, so their right edges can't line up. Align works across rows; to make them the same size, use Match size.");
    expect(why).not.toMatch(/#|textedit|of \d/);
    const w = d.window;
    expect(plainName(w, [0, 0])).toBe("the label “Price”");
    expect(plainName(w, [0, 2])).toBe("“Sell”");
    expect(plainName(w, [0])).toBe("the first row in its column");
    expect(plainName(w, [])).toBe("the window's main column");
    const ids = doc(row({ type: "button", label: { bind: "lbl" }, value: null, id: "se_sell" }, { type: "button", label: null, value: null }, { type: "button", label: null, value: null }));
    expect(plainName(ids.window, [0])).toBe("button se_sell");
    expect(plainName(ids.window, [2])).toBe("the third button in its row");
  });
  it("refuses an element no row places (it cannot move sideways)", () => {
    const d = doc(col(btn("a", 50), btn("b", 80)));
    expect(alignRefusal(d.window, [[0], [1]], "right")).toBe("“b” isn't in a row, so nothing can move it sideways. Wrap it in a row first (Alt+R).");
  });
  it("refuses when the row gives the change to an unsized element before it, changing nothing", () => {
    // b sits at the row's end, after a label with no width: a spacer before b only narrows the label.
    const d = doc(col(row(sp(), btn("a", 40)), row({ type: "label", label: null, value: "free" }, btn("b", 80))));
    expect(() => align(d, [[0, 1], [1, 1]], measure, "left")).toThrow(/^The left edges can't line up: the label “free” has no width of its own, so it soaks up the change and “b” doesn't move\. Give it a width first/);
    // Moving it left: nothing before it gives room.
    const leftward = doc(col(row(sp(50), btn("a", 100), sp()), row({ type: "label", label: null, value: "free" }, btn("b", 80))));
    expect(() => align(leftward, [[0, 1], [1, 1]], measure, "left")).toThrow(/no spacer before it to shrink/);
  });
  it("says so when they already line up", () => {
    const d = doc(col(row(btn("a", 50), sp()), row(btn("b", 80), sp())));
    const r = align(d, [[0, 0], [1, 0]], measure, "left");
    expect(r.doc).toBe(d);
    expect(r.note).toMatch(/already/);
  });
});

describe("distribute", () => {
  it("equal widths: each the average, together the room they took", () => {
    const d = doc(row(btn("a", 50), btn("b", 100), btn("c", 150), sp()));
    const r = distribute(d, [[0], [1], [2]], measure, "sizes");
    for (const p of [[0], [1], [2]]) expect(rect(r.doc, p)[2]).toBe(100);
    expect(right(r.doc, [2])).toBe(right(d, [2]));
  });
  it("equal gaps: the spacers between are evened out, inserted where missing", () => {
    const d = doc(row(btn("a", 50), sp(10), btn("b", 50), btn("c", 50), sp()));
    const r = distribute(d, [[0], [2], [3]], measure, "gaps");
    const [a, b, c] = r.selectMany!.map((p) => rect(r.doc, p));
    expect(b![0] - (a![0] + a![2])).toBe(9);
    expect(c![0] - (b![0] + b![2])).toBe(9);
    expect(right(r.doc, r.selectMany![2]!)).toBe(right(d, [3]));
  });
  it("equal gaps down a column", () => {
    const vsp = (h: number): JsonObject => ({ type: "spacer", label: null, value: null, height: h });
    const d = doc(col(btn("a", 50), vsp(10), btn("b", 50), vsp(30), btn("c", 50), sp()), 420, 400);
    const r = distribute(d, [[0], [2], [4]], measure, "gaps");
    const [a, b, c] = r.selectMany!.map((p) => rect(r.doc, p));
    expect(b![1] - (a![1] + a![3])).toBe(24);
    expect(c![1] - (b![1] + b![3])).toBe(24);
  });
  it("refuses gaps that cannot be even (an element between two of them), changing nothing", () => {
    const d = doc(row(btn("a", 50), { type: "label", label: null, value: "x", width: 40 }, btn("b", 50), btn("c", 50), sp()));
    expect(() => distribute(d, [[0], [2], [3]], measure, "gaps")).toThrow(/^The gaps can't be evened out: something sits between “a” and “b”, so that gap can't be less than \d+ px.*Move it out, or select it too\./);
  });
  it("only within one row or column, three or more for gaps", () => {
    const w = rows3().window;
    expect(distributeRefusal(w, [[0, 1], [1, 0]], "sizes")).toMatch(/^Distribute works inside one row or column/);
    expect(distributeRefusal(w, [[0, 0], [0, 1]], "gaps")).toMatch(/^Select three or more/);
    expect(distributeRefusal(w, [[0, 0], [0, 1]], "sizes")).toBeNull();
  });
});
