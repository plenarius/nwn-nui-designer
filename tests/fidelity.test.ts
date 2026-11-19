// Drawing as the client draws (nwn-module tools/nui-preview after PR #1115): the skin's 9-slice margins per key, the
// scrollbar thumbs' repeated middle strip, clipping to lists and groups, the draw lists, toggles, and no second mode.
import { beforeAll, describe, expect, it } from "vitest";
import type { JsonObject, NuiDocument } from "../src/core/model/types.js";
import { canvasToImage } from "../src/core/render/canvas.js";
import * as R from "../src/core/render/render.js";
import { type Outline, Renderer } from "../src/core/render/render.js";
import { NINE_SLICE_KEYS, nineSlice, skinSlice, sliceSpec } from "../src/core/render/slice.js";
import { CanvasSurface } from "../src/core/render/surface.js";
import { type RGBAImage, crop, newImage } from "../src/core/res/image.js";
import { renderView } from "../src/core/view.js";
import { nodeCanvas } from "../src/node/fs.js";
import { type Resources, openResources } from "../src/node/setup.js";

let res: Resources;
beforeAll(async () => {
  // Bronze, the built-in skin these measurements were written against (Ink and brass is the default since phase 3).
  res = await openResources({ game: null, theme: "bronze" });
});

/** A window at (100, 100), w x h, no title, holding root. */
function doc(root: JsonObject, binds: Record<string, unknown> = {}, w = 400, h = 300): NuiDocument {
  return {
    name: "t",
    form: "t",
    window: { version: 1, title: false, root, geometry: { x: 100, y: 100, w, h }, border: true, closable: false } as JsonObject,
    binds: binds as NuiDocument["binds"],
    panes: {},
  };
}

async function draw(d: NuiDocument) {
  const r = await renderView(d, res.skin, res.images, nodeCanvas, { canvasW: 700, canvasH: 600 });
  return { ...r, im: canvasToImage(r.canvas) };
}

function at(im: RGBAImage, x: number, y: number): [number, number, number, number] {
  const i = (y * im.width + x) * 4;
  return [im.data[i]!, im.data[i + 1]!, im.data[i + 2]!, im.data[i + 3]!];
}

function find(outlines: Outline[], type: string, n = 0): Outline {
  const o = outlines.filter((x) => x.type === type)[n];
  if (!o) throw new Error(`no ${type}`);
  return o;
}

/** The pixels of img over the window background (opaque black) at rect r, as a flat RGB list. */
function overBlack(img: RGBAImage): number[] {
  const out: number[] = [];
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3]!;
    for (let c = 0; c < 3; c++) out.push(Math.round((img.data[i + c]! * a) / 255));
  }
  return out;
}

/** Below y0 (to the window's frame), x0..x0 + w: the same pixels in both pictures. */
function sameBelow(a: RGBAImage, b: RGBAImage, x0: number, y0: number, w: number): void {
  let differ = 0;
  for (let yy = y0; yy < 100 + 300 - 4; yy++) {
    for (let xx = x0; xx < x0 + w; xx++) if (at(a, xx, yy).join() !== at(b, xx, yy).join()) differ++;
  }
  expect(differ).toBe(0);
}

function rgb(im: RGBAImage): number[] {
  const out: number[] = [];
  for (let i = 0; i < im.data.length; i += 4) out.push(im.data[i]!, im.data[i + 1]!, im.data[i + 2]!);
  return out;
}

/** A w x h texture whose pixel (x, y) has red x * 16, green y * 16: where each output pixel came from. */
function coords(w: number, h: number): RGBAImage {
  const t = newImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      t.data[i] = x * 16;
      t.data[i + 1] = y * 16;
      t.data[i + 3] = 255;
    }
  }
  return t;
}

function tex(name: string): RGBAImage {
  const t = res.images.peek(name);
  if (!t) throw new Error(`no texture ${name}`);
  return t;
}

describe("nine-slice margins per key", () => {
  it("knows the client's margins", () => {
    expect(sliceSpec("button.normal")!.margins).toEqual([3, 3, 3, 3]);
    expect(sliceSpec("window.border_image")!.margins).toEqual([3, 3, 3, 3]);
    for (const k of ["button.hover", "selectable.hover", "progress.hover", "progress.active", "combo.hover"]) {
      expect(sliceSpec(k)!.margins, k).toEqual([7, 7, 7, 7]);
    }
    expect(sliceSpec("tab.background")!.margins).toEqual([5, 3, 3, 3]);
    expect(sliceSpec("scrollv.cursor_normal")).toEqual({ margins: [0, 0, 0, 0], region: [3, 0, 10, 16], tile: [false, true] });
    expect(sliceSpec("scrollh.cursor_hover")).toEqual({ margins: [0, 0, 0, 0], region: [0, 3, 16, 10], tile: [true, false] });
    expect(sliceSpec("checkbox.normal")).toBeNull();
    expect(NINE_SLICE_KEYS).toHaveLength(36);
  });

  it("keeps 3 px corners and stretches the rest", () => {
    const t = coords(16, 16);
    const s = nineSlice(t, 40, 30, [3, 3, 3, 3]);
    // The corners are the texture's own 3 x 3 pixels.
    for (const [x, y] of [[0, 0], [2, 2], [39, 29], [37, 27]] as const) {
      const sx = x < 3 ? x : 16 - (40 - x);
      const sy = y < 3 ? y : 16 - (30 - y);
      expect(at(s, x, y).slice(0, 2), `${x},${y}`).toEqual([sx * 16, sy * 16]);
    }
    // Past the 3 px corner the edge is stretched (with 8 px, x = 5 was still the corner's own pixel 5).
    expect(at(s, 5, 0)[0]).toBeLessThan(5 * 16);
    expect(at(s, 5, 0)[0]).toBeGreaterThanOrEqual(3 * 16);
  });

  it("draws every frame with its key's margins", async () => {
    const root: JsonObject = {
      type: "col",
      children: [
        { type: "button", label: "a", width: 120, height: 40 },
        { type: "button", label: "", width: 120, height: 40, encouraged: true },
        { type: "button_select", label: "", width: 120, height: 40, value: true },
        { type: "progress", value: 0, width: 120, height: 30 },
        { type: "textedit", label: "", value: "", length: 10, multiline: false, width: 120, height: 40 },
        { type: "combo", elements: [], value: 0, width: 120, height: 40 },
      ],
    };
    const r = await draw(doc(root));
    const check = (type: string, key: string, def: string, n = 0) => {
      const o = find(r.outlines, type, n);
      const [x, y, w, h] = o.rect.map(Math.round) as [number, number, number, number];
      const name = (res.skin.get(key) as string) ?? def;
      const want = overBlack(skinSlice(tex(name), key, w, h));
      // The frame's rim (the top 2 rows; text and arrows sit in the middle).
      const got = rgb(crop(r.im, x, y, x + w, y + 2));
      expect(got, key).toEqual(want.slice(0, w * 2 * 3));
      // A row 5 px down: inside the 7 px hover margin, the edge of a 3 px one.
      const got5 = rgb(crop(r.im, x, y + 5, x + 6, y + 6));
      expect(got5, `${key} row 5`).toEqual(want.slice(5 * w * 3, 5 * w * 3 + 18));
    };
    check("button", "button.normal", "nui_button_n");
    check("button", "button.hover", "nui_button_h", 1);
    check("button_select", "selectable.normal_active", "nui_button_a");
    check("progress", "progress.normal", "nui_button_n");
    check("textedit", "edit.normal", "nui_windowh");
    check("combo", "combo.normal", "nui_button_n");
  });
});

describe("scrollbar thumbs", () => {
  it("repeat the middle strip along the bar instead of stretching the texture", () => {
    const t = coords(16, 16);
    const v = skinSlice(t, "scrollv.cursor_normal", 10, 40);
    for (let y = 0; y < 40; y++) {
      // Columns 3..12 of the texture, at their own size across (10 wide), rows repeating every 16.
      expect(at(v, 0, y).slice(0, 2), `v ${y}`).toEqual([3 * 16, (y % 16) * 16]);
      expect(at(v, 9, y)[0]).toBe(12 * 16);
    }
    const h = skinSlice(t, "scrollh.cursor_normal", 40, 10);
    for (let x = 0; x < 40; x++) {
      expect(at(h, x, 0).slice(0, 2), `h ${x}`).toEqual([(x % 16) * 16, 3 * 16]);
      expect(at(h, x, 9)[1]).toBe(12 * 16);
    }
  });

  it("are drawn that way on a list", async () => {
    const root: JsonObject = {
      type: "list",
      row_template: [[{ type: "label", value: "x" }, 0, true]],
      row_count: 40,
      row_height: 20,
      height: 200,
      width: 200,
      border: true,
      scrollbars: 2,
    };
    const r = await draw(doc(root));
    const l = find(r.outlines, "list");
    const [x, y, w, h] = l.rect;
    // R.scrollbar's geometry: the bar inside the list's inset, the thumb below the up button, padding_x - 1 in.
    const bx = x + w - R.LIST_INSET_X - R.SCROLLBAR;
    const by = y + R.LIST_INSET_Y;
    // nk_do_scrollbarv's cursor: inset by padding_x across, padding_y along.
    const px = res.skin.numOf("scrollv.padding_x", 4);
    const py = res.skin.numOf("scrollv.padding_y", 2);
    const track = h - 2 * R.LIST_INSET_Y - 2 * R.SCROLLBAR;
    const ch = Math.max(8, track * Math.min(1, (h - 2 * R.LIST_INSET_Y) / (40 * (20 + R.LIST_SPACING))) - 2 * py);
    const name = res.skin.get("scrollv.cursor_normal") as string;
    const want = skinSlice(tex(name), "scrollv.cursor_normal", R.SCROLLBAR - 2 * px, ch);
    expect(want.width).toBe(10);
    const gx = Math.round(bx + px);
    const gy = Math.round(by + R.SCROLLBAR + py);
    const got = crop(r.im, gx, gy, gx + want.width, gy + want.height);
    // Where the thumb is opaque, it is exactly the repeated strip.
    for (let i = 0; i < want.data.length; i += 4) {
      if (want.data[i + 3] !== 255) continue;
      expect([got.data[i], got.data[i + 1], got.data[i + 2]]).toEqual([want.data[i], want.data[i + 1], want.data[i + 2]]);
    }
  });
});

describe("clipping to lists and groups", () => {
  it("draws nothing of a list's rows below the list (the gods window's placeholder squares)", async () => {
    const root: JsonObject = {
      type: "col",
      children: [
        {
          type: "list",
          row_template: [
            [{ type: "image", value: "no_such_tex" }, 30, false],
            [{ type: "slider", value: 5, min: 0, max: 10 }, 0, true],
            [{ type: "color_picker", value: { r: 255, g: 0, b: 255, a: 255 } }, 0, true],
            [{ type: "chart", value: [] }, 0, true],
          ],
          row_count: 5,
          row_height: 37,
          height: 100,
          border: true,
        },
        { type: "spacer" },
      ],
    };
    const r = await draw(doc(root));
    expect(r.problems.some((p) => p.kind === "missing image")).toBe(true);
    // The same window with no rows: what must show below the list.
    const list = (root.children as JsonObject[])[0]!;
    const empty = await draw(doc({ ...root, children: [{ ...list, row_count: 0 }, { type: "spacer" }] }));
    const [x, y, w, h] = find(r.outlines, "list").rect.map(Math.round) as [number, number, number, number];
    sameBelow(r.im, empty.im, x, y + h, w);
  });

  it("clips a group's overflowing children to the group", async () => {
    const root: JsonObject = {
      type: "col",
      children: [
        {
          type: "group",
          scrollbars: 0,
          height: 60,
          children: [
            {
              type: "col",
              children: [
                { type: "label", value: "a", height: 30 },
                { type: "image", value: "no_such_tex", height: 40 },
                { type: "slider", value: 5, min: 0, max: 10, height: 30 },
                { type: "color_picker", value: { r: 255, g: 0, b: 255, a: 255 }, height: 30 },
                { type: "chart", value: [], height: 30 },
                { type: "check", label: "c", value: true, height: 30 },
                { type: "button", label: "b", height: 30 },
              ],
            },
          ],
        },
        { type: "spacer" },
      ],
    };
    const r = await draw(doc(root));
    const group = (root.children as JsonObject[])[0]!;
    const empty = await draw(doc({ ...root, children: [{ ...group, children: [{ type: "spacer" }] }, { type: "spacer" }] }));
    const [x, y, w, h] = find(r.outlines, "group").rect.map(Math.round) as [number, number, number, number];
    sameBelow(r.im, empty.im, x, y + h, w);
  });
});

describe("one drawing mode", () => {
  it("has no nui-preview compatibility mode", () => {
    const s = new CanvasSurface(nodeCanvas, 10, 10);
    const rend = new Renderer(res.skin, res.images, {}, s);
    expect("mode" in rend).toBe(false);
  });
});

describe("draw lists", () => {
  const item = (o: JsonObject): JsonObject => ({ enabled: true, render: 0, order: 1, ...o });

  it("draws a circle of radius w / 2 around the rect's centre (h only moves the centre), blended", async () => {
    const root: JsonObject = {
      type: "spacer",
      draw_list: [item({ type: 2, color: { r: 255, g: 0, b: 0, a: 128 }, fill: true, rect: { x: 10, y: 10, w: 20, h: 40 } })],
    };
    const r = await draw(doc(root));
    const bg = await draw(doc({ type: "spacer" }));
    const o = find(r.outlines, "spacer").rect.map(Math.round);
    const cx = o[0]! + 10 + 10;
    const cy = o[1]! + 10 + 20;
    // Its centre is half red over what is behind it (blended, not replacing it).
    const under = at(bg.im, cx, cy);
    const got = at(r.im, cx, cy);
    expect(Math.abs(got[0] - (128 + under[0] / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(got[1] - under[1] / 2)).toBeLessThanOrEqual(1);
    // 20 across and 20 down: nothing 12 px above or below the centre.
    let rows = 0;
    for (let yy = cy - 25; yy <= cy + 25; yy++) if (at(r.im, cx, yy)[0] > 70) rows++;
    expect(rows).toBeGreaterThanOrEqual(19);
    expect(rows).toBeLessThanOrEqual(20);
  });

  it("draws text on one line, not clipped to its rect, clamped as nk_text_clamp does", async () => {
    const root: JsonObject = {
      type: "spacer",
      draw_list: [item({ type: 4, color: { r: 255, g: 255, b: 255, a: 255 }, text: "Wide text over a small rect", rect: { x: 0, y: 0, w: 30, h: 20 } })],
    };
    const r = await draw(doc(root));
    const o = find(r.outlines, "spacer").rect.map(Math.round);
    // nk_text_clamp keeps the glyph that crosses the rect's edge, drawn whole: ink past x + 30.
    let ink = 0;
    for (let yy = o[1]!; yy < o[1]! + 20; yy++) for (let xx = o[0]! + 31; xx < o[0]! + 45; xx++) if (at(r.im, xx, yy)[0] > 128) ink++;
    expect(ink).toBeGreaterThan(0);
    // ... and nothing far past it (not the whole string).
    let far = 0;
    for (let yy = o[1]!; yy < o[1]! + 20; yy++) for (let xx = o[0]! + 70; xx < o[0]! + 200; xx++) if (at(r.im, xx, yy)[0] > 128) far++;
    expect(far).toBe(0);
    expect(r.problems.some((p) => p.kind === "clipped text" && p.text.startsWith("draw-list text"))).toBe(true);
  });

  it("draws an array-bound item once per entry of its row's longest array", async () => {
    const red = { r: 255, g: 0, b: 0, a: 255 };
    const root: JsonObject = {
      type: "list",
      row_template: [
        [
          {
            type: "spacer",
            draw_list: [item({ type: 7, fill: true, arrayBinds: true, color: red, rect: { bind: "rects" } })],
          },
          0,
          true,
        ],
      ],
      row_count: 2,
      row_height: 30,
      height: 100,
      width: 300,
      border: false,
      scrollbars: 0,
    };
    const rects = [
      [{ x: 0, y: 0, w: 5, h: 5 }, { x: 20, y: 0, w: 5, h: 5 }],
      [{ x: 40, y: 0, w: 5, h: 5 }],
    ];
    const r = await draw(doc(root, { rects }));
    const s0 = find(r.outlines, "spacer", 0).rect.map(Math.round);
    const s1 = find(r.outlines, "spacer", 1).rect.map(Math.round);
    const red0 = (o: number[], dx: number) => at(r.im, o[0]! + dx + 2, o[1]! + 2)[0] === 255;
    expect([red0(s0, 0), red0(s0, 20), red0(s0, 40)]).toEqual([true, true, false]);
    expect([red0(s1, 0), red0(s1, 20), red0(s1, 40)]).toEqual([false, false, true]);
  });
});

describe("toggles", () => {
  it("draws a tabbar (NuiToggles) as a row of buttons, each in its 150 x 35 entry, the chosen one pressed", async () => {
    const root: JsonObject = { type: "tabbar", elements: ["One", "Two"], value: 1, width: 308, height: 39 };
    const r = await draw(doc(root));
    expect(r.problems.filter((p) => p.kind === "not drawn" || p.kind === "overflow")).toEqual([]);
    const [x, y] = find(r.outlines, "tabbar").rect;
    const active = typeof res.skin.get("button.normal_active") === "string" && res.skin.get("button.normal_active") ? "button.normal_active" : "button.active";
    for (const [i, key] of [[0, "button.normal"], [1, active]] as const) {
      // SelectList::MakeButtons: entries of margin 2, 150 wide, 35 high.
      const want = overBlack(skinSlice(tex(res.skin.get(key) as string), key, 150, 35));
      const cx = Math.round(x + 2 + i * 154);
      const got = rgb(crop(r.im, cx, Math.round(y) + 2, cx + 150, Math.round(y) + 4));
      expect(got, key).toEqual(want.slice(0, 150 * 2 * 3));
    }
  });
});

describe("window title", () => {
  it("draws a non-ASCII title as the client does, and says so", async () => {
    const d = doc({ type: "label", value: "x" });
    d.window.title = "Aëlwyn";
    const r = await draw(d);
    expect(r.problems.some((p) => p.kind === "non-ASCII text" && p.path === "/title")).toBe(true);
  });
});

describe("measured on the in-game deity window (1.8x Retina screenshot; DESIGN.md)", () => {
  it("sizes fonts as Nuklear's baker does by default", () => {
    expect(res.skin.defaultFont.model).toBe("nuklear");
  });

  it("starts the body right under the title bar: content at title 33 + inset 8", async () => {
    const d = doc({ type: "label", value: "x" });
    d.window.title = "T";
    const r = await draw(d);
    // The root sits at the content's corner (no 1 px gap under the title bar).
    expect(find(r.outlines, "label").rect.slice(0, 2)).toEqual([100 + 8, 100 + 33 + 8]);
  });

  it("wraps a text box 18 px short of its width and starts its first line 2 px down", async () => {
    const f = res.skin.defaultFont;
    // Words until the line is just over 480 px (the client keeps lines up to 480 in a 500 px box).
    const words = "the most widely known and influential deities of the world are filled with shrines and temples".split(" ");
    let s = "";
    for (const w of words) {
      const t = s ? `${s} ${w}` : w;
      if (f.width(t) > 482) break;
      s = t;
    }
    expect(f.width(s)).toBeGreaterThan(470);
    const root: JsonObject = { type: "text", value: s, border: false, scrollbars: 0, width: 500, height: 60 };
    const r = await draw(doc(root, {}, 560, 200));
    expect(r.problems.filter((p) => p.kind === "clipped text")).toEqual([]);
    // One line: nothing drawn on the second line's row.
    const [x, y] = find(r.outlines, "text").rect.map(Math.round) as [number, number];
    let ink = 0;
    for (let yy = y + 2 + 21; yy < y + 2 + 21 + 17; yy++) for (let xx = x; xx < x + 500; xx++) if (at(r.im, xx, yy)[0] > 128) ink++;
    expect(ink).toBe(0);
    // The first line's glyphs start 2 px below the box (its top row of ink within the first 2 + 17).
    let first = -1;
    for (let yy = y; yy < y + 20 && first < 0; yy++) for (let xx = x; xx < x + 500; xx++) if (at(r.im, xx, yy)[0] > 128) first = yy;
    expect(first - y).toBeGreaterThanOrEqual(2);
  });
});
