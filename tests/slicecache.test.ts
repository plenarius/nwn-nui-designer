// The skin slice cache kept across redraws (src/core/render/slicecache.ts, DESIGN.md, "Rendering").
import { beforeAll, describe, expect, it } from "vitest";
import type { JsonObject, NuiDocument } from "../src/core/model/types.js";
import { canvasToImage } from "../src/core/render/canvas.js";
import { nineSlice } from "../src/core/render/slice.js";
import { SliceCache, sliceCacheOf } from "../src/core/render/slicecache.js";
import { type RGBAImage, newImage } from "../src/core/res/image.js";
import { renderView } from "../src/core/view.js";
import { nodeCanvas } from "../src/node/fs.js";
import { type Resources, openResources } from "../src/node/setup.js";

function tex(w: number, h: number, seed: number): RGBAImage {
  const im = newImage(w, h);
  for (let i = 0; i < im.data.length; i++) im.data[i] = (i * 37 + seed * 101) & 255;
  return im;
}

const doc: NuiDocument = {
  name: "t",
  form: "t",
  window: {
    version: 1,
    title: "Cached",
    root: {
      type: "col",
      children: [
        { type: "button", label: "One", height: 30 },
        { type: "check", label: "Two", value: true, height: 30 },
        { type: "combo", elements: [["a", 0]], value: 0, height: 30 },
        { type: "progress", value: 0.5, height: 20 },
      ],
    },
    geometry: { x: 60, y: 60, w: 320, h: 260 },
    border: true,
    closable: true,
  } as JsonObject,
  binds: {},
  panes: {},
};

async function draw(res: Resources): Promise<RGBAImage> {
  const r = await renderView(doc, res.skin, res.images, nodeCanvas, { canvasW: 480, canvasH: 400 });
  return canvasToImage(r.canvas);
}

describe("SliceCache", () => {
  it("returns the same pixels as a new slice, and makes it once", () => {
    const c = new SliceCache();
    const t = tex(32, 32, 1);
    let made = 0;
    const make = () => (made++, nineSlice(t, 90, 70, 8));
    const a = c.get("k|90x70", t, make);
    const b = c.get("k|90x70", t, make);
    expect(made).toBe(1);
    expect(b).toBe(a);
    expect(Array.from(b.data)).toEqual(Array.from(nineSlice(t, 90, 70, 8).data));
  });

  it("makes the slice again when the texture object changed (new haks, overrides, game resources)", () => {
    const c = new SliceCache();
    const t1 = tex(16, 16, 1);
    const t2 = tex(16, 16, 2);
    const a = c.get("k", t1, () => nineSlice(t1, 40, 40, 4));
    const b = c.get("k", t2, () => nineSlice(t2, 40, 40, 4));
    expect(b).not.toBe(a);
    expect(Array.from(b.data)).toEqual(Array.from(nineSlice(t2, 40, 40, 4).data));
    expect(c.size).toBe(1);
    expect(c.bytes).toBe(40 * 40 * 4);
  });

  it("stays within its byte cap, dropping the least recently used", () => {
    const cap = 10 * 20 * 20 * 4;
    const c = new SliceCache(cap);
    const t = tex(8, 8, 3);
    for (let i = 0; i < 50; i++) {
      c.get(`s${i}`, t, () => newImage(20, 20));
      c.get("s0", t, () => newImage(20, 20)); // kept warm
      expect(c.bytes).toBeLessThanOrEqual(cap);
    }
    expect(c.size).toBe(10);
    let made = 0;
    c.get("s0", t, () => (made++, newImage(20, 20)));
    expect(made).toBe(0);
    c.get("s1", t, () => (made++, newImage(20, 20)));
    expect(made).toBe(1);
    // An image larger than the cap is returned, not kept.
    c.get("big", t, () => newImage(200, 200));
    expect(c.bytes).toBeLessThanOrEqual(cap);
  });
});

describe("slice cache across redraws", () => {
  let a: Resources;
  let b: Resources;
  beforeAll(async () => {
    a = await openResources({ game: null, theme: "bronze" });
    b = await openResources({ game: null, theme: "bronze" });
  });

  it("draws the same pixels from a warm cache as from an empty one", async () => {
    sliceCacheOf(a.skin).clear();
    const cold = await draw(a);
    const filled = sliceCacheOf(a.skin).size;
    expect(filled).toBeGreaterThan(0);
    const warm = await draw(a);
    expect(sliceCacheOf(a.skin).size).toBe(filled);
    expect(warm.width).toBe(cold.width);
    expect(Buffer.from(warm.data).equals(Buffer.from(cold.data))).toBe(true);
    expect(sliceCacheOf(a.skin).bytes).toBeLessThanOrEqual(sliceCacheOf(a.skin).maxBytes);
  });

  it("is not shared between two skins", async () => {
    expect(b.skin).not.toBe(a.skin);
    expect(sliceCacheOf(b.skin)).not.toBe(sliceCacheOf(a.skin));
    await draw(a);
    sliceCacheOf(b.skin).clear();
    const before = sliceCacheOf(a.skin).size;
    const im = await draw(b);
    expect(sliceCacheOf(b.skin).size).toBeGreaterThan(0);
    expect(sliceCacheOf(a.skin).size).toBe(before);
    const other = await draw(a);
    expect(Buffer.from(im.data).equals(Buffer.from(other.data))).toBe(true);
  });
});
