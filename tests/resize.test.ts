// Sizes set on the canvas: snapping, dragging (zoom and UI scale), key steps, and the edits they make.
import { describe, expect, it } from "vitest";
import * as N from "../src/core/model/nui.js";
import type { JsonObject } from "../src/core/model/types.js";
import { canUndo, preview, push, startHistory, undo } from "../src/core/edit/history.js";
import { bindProp, setValue } from "../src/core/edit/ops.js";
import { type EditorDoc, defaultExport } from "../src/core/edit/project.js";
import { DEFAULT_GRID, GRID_STEPS, dragSize, elementSize, resizeElement, resizeWindow, snapSize, stepSize, windowSize } from "../src/core/edit/resize.js";
import { getElem } from "../src/core/edit/tree.js";

const label = (s: string) => N.NuiLabel(s, 1, 0);
function doc(win: JsonObject = N.NuiWindow(N.NuiCol([label("a"), N.NuiWidth(label("b"), 120)]), "T", N.NuiRect(-1, -1, 300, 200))): EditorDoc {
  return { name: "t", window: win, binds: {}, panes: {}, notes: "", export: defaultExport("t") };
}

describe("size math", () => {
  it("offers 2, 4 and 8 px, 4 by default", () => {
    expect([...GRID_STEPS]).toEqual([2, 4, 8]);
    expect(DEFAULT_GRID).toBe(4);
  });

  it("snaps to the nearest step, or to whole pixels when free, and never below one step", () => {
    expect(snapSize(37, 4)).toBe(36);
    expect(snapSize(38, 4)).toBe(40);
    expect(snapSize(37, 8)).toBe(40);
    expect(snapSize(37, 2)).toBe(38);
    expect(snapSize(37.4, 4, true)).toBe(37);
    expect(snapSize(1, 4)).toBe(4);
    expect(snapSize(-20, 8)).toBe(8);
    expect(snapSize(0.2, 4, true)).toBe(1);
  });

  it("turns screen pixels into layout units through zoom and UI scale, then snaps the size (not the pointer)", () => {
    // 100 wide, dragged 30 screen px at zoom 2: 15 units, 115, snapped to 116.
    expect(dragSize(100, 30, 2, 4)).toBe(116);
    // The same at zoom 0.5: 60 units.
    expect(dragSize(100, 30, 0.5, 4)).toBe(160);
    // UI scale 1.5 x zoom 1: 20 units.
    expect(dragSize(100, 30, 1.5, 8)).toBe(120);
    // Free: whole pixels.
    expect(dragSize(100, 31, 2, 4, true)).toBe(116);
    expect(dragSize(101, 3, 1, 4, true)).toBe(104);
    // An off-grid start lands on the grid.
    expect(dragSize(37, 0, 1, 4)).toBe(36);
    // Dragged past zero: one step.
    expect(dragSize(30, -200, 1, 4)).toBe(4);
    // A centred window: the edge moves half as far as the size changes.
    expect(dragSize(300, 10, 1, 4, false, 2)).toBe(320);
  });

  it("steps to the next grid line in each direction, or 1 px when free", () => {
    expect(stepSize(36, 1, 4)).toBe(40);
    expect(stepSize(36, -1, 4)).toBe(32);
    expect(stepSize(37, 1, 4)).toBe(40);
    expect(stepSize(37, -1, 4)).toBe(36);
    expect(stepSize(37, 1, 8)).toBe(40);
    expect(stepSize(37, -1, 8)).toBe(32);
    expect(stepSize(37, 1, 4, true)).toBe(38);
    expect(stepSize(37, -1, 4, true)).toBe(36);
    expect(stepSize(4, -1, 4)).toBe(4);
    expect(stepSize(1, -1, 4, true)).toBe(1);
    expect(stepSize(36.5, 1, 4)).toBe(40);
  });
});

describe("size edits", () => {
  it("starts from the element's own size, else what was drawn", () => {
    const d = doc();
    expect(elementSize(getElem(d.window, [0])!, [284, 30])).toEqual([284, 30]);
    expect(elementSize(getElem(d.window, [1])!, [284, 30])).toEqual([120, 30]);
  });

  it("writes width and height as the properties panel does, and clears them back to automatic", () => {
    const d = doc();
    const r = resizeElement(d, [0], { w: 96, h: 40 });
    expect(r.window).toEqual(setValue(setValue(d, { path: [0] }, "width", 96), { path: [0] }, "height", 40).window);
    expect(getElem(r.window, [0])).toMatchObject({ width: 96, height: 40 });
    // Only the axis given changes; null clears it (the panel's clear button).
    const r2 = resizeElement(r, [0], { h: null });
    expect(getElem(r2.window, [0])!.width).toBe(96);
    expect("height" in getElem(r2.window, [0])!).toBe(false);
    // The rest of the document is untouched (keys the editor does not know survive).
    const odd = doc(N.NuiWindow(N.NuiCol([{ ...label("a"), house_key: 7 }]), "T", N.NuiRect(-1, -1, 300, 200)));
    expect(getElem(resizeElement(odd, [0], { w: 50 }).window, [0])!.house_key).toBe(7);
  });

  it("sets the window's geometry w and h, keeping x and y", () => {
    const d = doc(N.NuiWindow(N.NuiCol([]), "T", N.NuiRect(10, -1, 300, 200)));
    expect(windowSize(d)).toEqual([300, 200]);
    const r = resizeWindow(d, { w: 320 });
    expect(r.window.geometry).toEqual({ x: 10, y: -1, w: 320, h: 200 });
    expect(resizeWindow(r, { h: 240 }).window.geometry).toEqual({ x: 10, y: -1, w: 320, h: 240 });
    // No change: the same document.
    expect(resizeWindow(d, { w: 300 })).toBe(d);
  });

  it("sets a bound geometry's sample (what the canvas draws), not the bind", () => {
    const d = bindProp(doc(), { path: null }, "geometry", "geo");
    expect(windowSize(d)).toEqual([300, 200]);
    const r = resizeWindow(d, { w: 400, h: 248 });
    expect(r.window.geometry).toBe(d.window.geometry);
    expect(r.binds.geo).toEqual({ x: -1, y: -1, w: 400, h: 248 });
  });

  it("a window without geometry starts at the renderer's 400 x 300, centred", () => {
    const d = doc({ version: 1, title: "T", root: N.NuiCol([]) });
    expect(windowSize(d)).toEqual([400, 300]);
    expect(resizeWindow(d, { w: 480 }).window.geometry).toEqual({ x: -1, y: -1, w: 480, h: 300 });
  });
});

describe("a drag is one undo step", () => {
  it("shows every move live and commits the last as one step; cancelling leaves no step", () => {
    const base = startHistory(doc());
    let h = base;
    for (const w of [104, 108, 112, 140]) h = preview(base, resizeElement(base.present, [0], { w }));
    expect(getElem(h.present.window, [0])!.width).toBe(140);
    expect(canUndo(h)).toBe(false);
    const committed = push(base, h.present);
    expect(committed.past).toHaveLength(1);
    expect(undo(committed).present).toBe(base.present);
    // Cancelled: back to the base, nothing to undo.
    expect(canUndo(base)).toBe(false);
  });
});
