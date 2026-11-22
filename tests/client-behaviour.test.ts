// Facts from docs/CLIENT-BEHAVIOUR.md marked [compared], each on a small window built for it, with the fallback skin
// (no game data).
import { beforeAll, describe, expect, it } from "vitest";
import { loadDocument } from "../src/core/model/input.js";
import type { JsonObject } from "../src/core/model/types.js";
import { type CanvasLike, ctx2d } from "../src/core/render/canvas.js";
import { resize } from "../src/core/render/resample.js";
import { nineSlice } from "../src/core/render/slice.js";
import { newImage } from "../src/core/res/image.js";
import type { Skin } from "../src/core/skin/skin.js";
import { renderView } from "../src/core/view.js";
import { nodeCanvas } from "../src/node/fs.js";
import { type Resources, openResources } from "../src/node/setup.js";

let res: Resources;
beforeAll(async () => {
  res = await openResources({ game: null });
});

const RED = { r: 200, g: 0, b: 0, a: 255 };

/** A window holding one 40 x 40 spacer with the given keys, drawn; px reads a pixel at the spacer's (x, y). */
async function spacer(keys: JsonObject, binds: JsonObject = {}) {
  const root = { type: "col", children: [{ type: "spacer", width: 40, height: 40, ...keys }] };
  const doc = loadDocument(JSON.stringify({ version: 1, title: "t", root, geometry: { x: -1, y: -1, w: 120, h: 120 } }), "t");
  const r = await renderView(doc, res.skin, res.images, nodeCanvas, { canvasW: 400, canvasH: 300, binds });
  const o = r.outlines.find((q) => q.type === "spacer")!;
  const [ox, oy] = o.rect;
  const px = (x: number, y: number) => [...ctx2d(r.canvas as CanvasLike).getImageData(ox + x, oy + y, 1, 1).data];
  return { px, r };
}

const rect = (x: number, y: number, w: number, h: number, more: JsonObject = {}): JsonObject => ({
  type: 7, enabled: true, color: RED, fill: false, line_thickness: 1, order: 1, render: 0, rect: { x, y, w, h }, ...more,
});

describe("draw lists", () => {
  it("strokes a 1 px outline across the rect's edge, half on each side of it", async () => {
    const bare = await spacer({});
    const { px } = await spacer({ draw_list: [rect(4, 4, 20, 20)] });
    expect(px(4, 10)).toEqual(px(3, 10));
    expect(px(4, 10)).not.toEqual(bare.px(4, 10));
    expect(px(10, 10)).toEqual(bare.px(10, 10));
  });

  it("centres a 2 px outline on the rect's edge", async () => {
    const bare = await spacer({});
    const { px } = await spacer({ draw_list: [rect(4, 4, 20, 20, { line_thickness: 2 })] });
    expect(px(3, 10).slice(0, 3)).toEqual([200, 0, 0]);
    expect(px(5, 10)).toEqual(bare.px(5, 10));
  });

  it("draws a disabled element's draw list at half brightness", async () => {
    const { px } = await spacer({ enabled: false, draw_list: [rect(0, 0, 40, 40, { fill: true, color: { r: 200, g: 100, b: 51, a: 255 } })] });
    expect(px(10, 10)).toEqual([100, 50, 25, 255]);
  });

  it("draws nothing for a colour bound to a bind the script never set", async () => {
    const bare = await spacer({});
    const { px } = await spacer({ draw_list: [rect(0, 0, 40, 40, { fill: true, color: { bind: "c" } })] });
    expect(px(10, 10)).toEqual(bare.px(10, 10));
  });
});

describe("binds the script never set", () => {
  it("hide an element whose visible is bound to one", async () => {
    const bare = await spacer({});
    const { px } = await spacer({ visible: { bind: "v" }, draw_list: [rect(0, 0, 40, 40, { fill: true })] });
    expect(px(10, 10)).toEqual(bare.px(10, 10));
  });
});

describe("layout", () => {
  it("places a span's children at whole pixels, each where the last one ended", async () => {
    const kids = [10.5, 10.5, 10.5].map((width) => ({ type: "spacer", width, height: 10 }));
    const root = { type: "col", children: [{ type: "row", children: kids }] };
    const doc = loadDocument(JSON.stringify({ version: 1, title: "t", root, geometry: { x: -1, y: -1, w: 200, h: 100 } }), "t");
    const r = await renderView(doc, res.skin, res.images, nodeCanvas, { canvasW: 400, canvasH: 300 });
    const xs = r.outlines.filter((q) => q.type === "spacer").map((q) => q.rect);
    for (const [x, , w] of xs) {
      expect(Number.isInteger(x)).toBe(true);
      expect(w).toBe(10);
    }
  });
});

describe("images", () => {
  it("cuts a nine-slice middle larger than its rect, and does not shrink it", () => {
    const tex = newImage(12, 4);
    for (let x = 0; x < 12; x++) for (let y = 0; y < 4; y++) tex.data.set([x * 20, 0, 0, 255], (y * 12 + x) * 4);
    const out = nineSlice(tex, 8, 4, 2);
    const col = (x: number) => out.data[(1 * 8 + x) * 4];
    expect([2, 3, 4, 5].map(col)).toEqual([40, 60, 80, 100]);
    expect([6, 7].map(col)).toEqual([200, 220]);
  });

  it("shrinks an image as a GPU samples it, from the two texels nearest each pixel's centre", () => {
    const im = newImage(8, 1);
    [0, 0, 255, 255, 0, 0, 0, 0].forEach((v, x) => im.data.set([v, v, v, 255], x * 4));
    const out = resize(im, 2, 1, "gpu");
    expect(Math.abs(out.data[0]! - 128)).toBeLessThanOrEqual(1);
  });
});

/** res.skin with some keys replaced, as a theme would set them. */
function skinWith(over: Record<string, string | number>): Skin {
  const s = Object.create(res.skin) as Skin;
  s.get = (p, d) => (p in over ? over[p] : res.skin.get(p, d));
  return s;
}

/** One window of the given root and geometry, drawn on a 400 x 300 canvas; px reads a canvas pixel. */
async function windowOf(root: JsonObject, geometry: JsonObject, opts: { skin?: Skin; title?: string | null; binds?: JsonObject } = {}) {
  const doc = loadDocument(JSON.stringify({ version: 1, title: opts.title === undefined ? "t" : opts.title, root, geometry }), "t");
  const r = await renderView(doc, opts.skin ?? res.skin, res.images, nodeCanvas, { canvasW: 400, canvasH: 300, binds: opts.binds ?? {} });
  const px = (x: number, y: number) => [...ctx2d(r.canvas as CanvasLike).getImageData(x, y, 1, 1).data];
  return { px, r };
}

describe("window placement", () => {
  it("keeps the outer column and row of an odd-sized centred window, drawn from its half pixel", async () => {
    // A 121 px window on 400 x 300 starts at 139.5, 89.5: drawn from 139, 89.
    const g = { x: -1, y: -1, w: 121, h: 121 };
    const on = await windowOf({ type: "col", children: [] }, g, { skin: skinWith({ "window.header.normal": "#00FF00FF", "window.header.active": "#00FF00FF", "window.fixed_background": "#00FF00FF", "window.border_image": "#00FF00FF" }), title: null });
    expect(on.px(139, 150).slice(0, 3)).toEqual([0, 255, 0]);
    expect(on.px(200, 89).slice(0, 3)).toEqual([0, 255, 0]);
    expect(on.px(138, 150).slice(0, 3)).not.toEqual([0, 255, 0]);
    expect(on.px(200, 88).slice(0, 3)).not.toEqual([0, 255, 0]);
  });
});

describe("forced scrollbars", () => {
  it("leave a list that fits with no scrollbar drawn", async () => {
    const list = (scrollbars: number) => ({ type: "col", children: [{ type: "list", height: 200, row_count: 0, row_height: 25, scrollbars, row_template: [[{ type: "label", value: "x" }, 0, true]] }] });
    const g = { x: -1, y: -1, w: 200, h: 260 };
    const forced = await windowOf(list(2), g);
    const none = await windowOf(list(0), g);
    const a = ctx2d(forced.r.canvas as CanvasLike).getImageData(0, 0, 400, 300).data;
    const b = ctx2d(none.r.canvas as CanvasLike).getImageData(0, 0, 400, 300).data;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("text edits", () => {
  it("start their text at the skin's edit padding plus its border", async () => {
    const firstInk = async (skin: Skin) => {
      const ed = (value: string) => ({ type: "col", children: [{ type: "textedit", width: 160, height: 30, value, label: "", max: 10, multiline: false }] });
      const g = { x: 0, y: 0, w: 200, h: 100 };
      const blank = await windowOf(ed(""), g, { skin });
      const full = await windowOf(ed("WWW"), g, { skin });
      const e = full.r.outlines.find((q) => q.type === "textedit")!;
      const [ex, ey, , eh] = e.rect;
      for (let x = Math.ceil(ex); x < ex + 160; x++) {
        for (let y = Math.ceil(ey); y < ey + eh; y++) if (full.px(x, y).join() !== blank.px(x, y).join()) return x;
      }
      return -1;
    };
    const stock = await firstInk(res.skin);
    const wide = await firstInk(skinWith({ "edit.padding_x": 20 }));
    expect(stock).toBeGreaterThan(0);
    expect(wide - stock).toBe(10);
  });
});

describe("the title bar", () => {
  it("of a window just opened is drawn with window.header.active, as Nuklear draws a focused window", async () => {
    const skin = skinWith({ "window.header.normal": "#FF0000FF", "window.header.active": "#00FF00FF" });
    const { px } = await windowOf({ type: "col", children: [] }, { x: 0, y: 0, w: 200, h: 100 }, { skin, title: "" });
    expect(px(100, 2).slice(0, 3)).toEqual([0, 255, 0]);
  });
});

describe("the problems list", () => {
  it("names each visible, enabled or draw-list colour bind with no sample value", async () => {
    const hidden = await spacer({ visible: { bind: "v" } });
    const { r } = await spacer({ enabled: { bind: "e" }, draw_list: [rect(0, 0, 40, 40, { color: { bind: "c" } })] });
    const texts = [...hidden.r.problems, ...r.problems].map((p) => p.text).join("\n");
    for (const b of ["v", "e", "c"]) expect(texts).toContain(`bind \`${b}\` has no sample value`);
    const set = await spacer({ visible: { bind: "v" } }, { v: true });
    expect(set.r.problems.map((p) => p.text).join()).not.toContain("has no sample value");
  });
});
