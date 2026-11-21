// Facts from docs/CLIENT-BEHAVIOUR.md marked [compared], each on a small window built for it, with the fallback skin
// (no game data).
import { beforeAll, describe, expect, it } from "vitest";
import { loadDocument } from "../src/core/model/input.js";
import type { JsonObject } from "../src/core/model/types.js";
import { type CanvasLike, ctx2d } from "../src/core/render/canvas.js";
import { resize } from "../src/core/render/resample.js";
import { nineSlice } from "../src/core/render/slice.js";
import { newImage } from "../src/core/res/image.js";
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
