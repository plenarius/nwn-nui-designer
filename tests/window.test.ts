// The window's chrome and placement as JsonWindow::Initialize and the client's geometry code set them
// (docs/CLIENT-BEHAVIOUR.md#window-frame).
import { beforeAll, describe, expect, it } from "vitest";
import type { JsonObject, NuiDocument } from "../src/core/model/types.js";
import { windowChrome, windowPosition } from "../src/core/model/window.js";
import { canvasToImage } from "../src/core/render/canvas.js";
import { CHROME } from "../src/core/render/render.js";
import type { RGBAImage } from "../src/core/res/image.js";
import { renderView } from "../src/core/view.js";
import { nodeCanvas } from "../src/node/fs.js";
import { type Resources, openResources } from "../src/node/setup.js";

const MISSING = Symbol("missing");
type V = unknown;
/** A window with key set to v (or without it). */
function w(key: string, v: V | typeof MISSING, extra: JsonObject = {}): JsonObject {
  const o: JsonObject = { title: "T", ...extra };
  if (v === MISSING) delete o[key];
  else o[key] = v as never;
  return o;
}

describe("windowChrome", () => {
  it("collapsed: true shows the button and opens collapsed; false and missing hide it; null shows it expanded", () => {
    expect(windowChrome(w("collapsed", true))).toMatchObject({ collapse: true, collapsed: true });
    expect(windowChrome(w("collapsed", false))).toMatchObject({ collapse: false, collapsed: false });
    expect(windowChrome(w("collapsed", null))).toMatchObject({ collapse: true, collapsed: false });
    expect(windowChrome(w("collapsed", MISSING))).toMatchObject({ collapse: false, collapsed: false });
  });

  it("collapsed bound: the button shows; it starts collapsed when the sample is true", () => {
    const b = { bind: "c" };
    expect(windowChrome(w("collapsed", b))).toMatchObject({ collapse: true, collapsed: false });
    expect(windowChrome(w("collapsed", b), { c: true })).toMatchObject({ collapse: true, collapsed: true });
    expect(windowChrome(w("collapsed", b), { c: false })).toMatchObject({ collapse: true, collapsed: false });
    expect(windowChrome(w("collapsed", b), { c: null })).toMatchObject({ collapse: true, collapsed: false });
  });

  it("closable: true, null and missing show the close button, false hides it; a bind starts shown", () => {
    for (const v of [true, null, MISSING]) expect(windowChrome(w("closable", v)).close).toBe(true);
    expect(windowChrome(w("closable", false)).close).toBe(false);
    expect(windowChrome(w("closable", { bind: "x" })).close).toBe(true);
    expect(windowChrome(w("closable", { bind: "x" }), { x: false }).close).toBe(false);
  });

  it("border: true and missing draw it, false and null do not; a bind has none until its value arrives", () => {
    for (const v of [true, MISSING]) expect(windowChrome(w("border", v)).border).toBe(true);
    for (const v of [false, null]) expect(windowChrome(w("border", v)).border).toBe(false);
    expect(windowChrome(w("border", { bind: "b" })).border).toBe(false);
    expect(windowChrome(w("border", { bind: "b" }), { b: true }).border).toBe(true);
  });

  it("transparent only when true; accepts_input off only when false; resizable unless false", () => {
    expect(windowChrome(w("transparent", true)).transparent).toBe(true);
    for (const v of [false, null, MISSING, { bind: "t" }]) expect(windowChrome(w("transparent", v)).transparent).toBe(false);
    expect(windowChrome(w("transparent", { bind: "t" }), { t: true }).transparent).toBe(true);
    expect(windowChrome(w("accepts_input", false)).acceptsInput).toBe(false);
    for (const v of [true, null, MISSING, { bind: "a" }]) expect(windowChrome(w("accepts_input", v)).acceptsInput).toBe(true);
    for (const v of [true, null, MISSING]) expect(windowChrome(w("resizable", v)).resizable).toBe(true);
    expect(windowChrome(w("resizable", false)).resizable).toBe(false);
  });

  it("hides the title bar only when the title is empty and close and collapse are off", () => {
    const off = { closable: false, collapsed: false };
    for (const t of [false, "", null, MISSING]) expect(windowChrome(w("title", t, off)).header).toBe(false);
    expect(windowChrome({ ...off, title: false } as JsonObject).header).toBe(false);
    expect(windowChrome({ ...off, title: "x" }).header).toBe(true);
    expect(windowChrome({ title: false, closable: true, collapsed: false }).header).toBe(true);
    expect(windowChrome({ title: false, closable: false, collapsed: null }).header).toBe(true);
    // Missing keys: close shows (so the bar does), collapse does not.
    expect(windowChrome({})).toMatchObject({ header: true, close: true, collapse: false, title: null });
    // A bound title by its sample; with none it is empty.
    expect(windowChrome({ ...off, title: { bind: "t" } }).header).toBe(false);
    expect(windowChrome({ ...off, title: { bind: "t" } }, { t: "Hello" }).title).toBe("Hello");
  });
});

describe("windowPosition", () => {
  it("-1 centres, -2 is the mouse (the canvas centre), -3 centres on the mouse, below 0 clamps to 0", () => {
    expect(windowPosition(-1, 400, 1440)).toBe(520);
    expect(windowPosition(-2, 400, 1440)).toBe(720);
    expect(windowPosition(-3, 400, 1440)).toBe(520);
    expect(windowPosition(-1, 2000, 1440)).toBe(0);
    expect(windowPosition(-7, 400, 1440)).toBe(0);
    expect(windowPosition(30, 400, 1440)).toBe(30);
  });
});

describe("drawn chrome", () => {
  let res: Resources;
  beforeAll(async () => {
    res = await openResources({ game: null, theme: "bronze" });
  });
  const root: JsonObject = { type: "col", children: [] };
  function doc(extra: JsonObject, binds: JsonObject = {}): NuiDocument {
    return { name: "t", form: "t", window: { version: 1, title: "T", root, geometry: { x: 100, y: 100, w: 300, h: 200 }, ...extra }, binds: binds as never, panes: {} };
  }
  async function draw(d: NuiDocument) {
    const r = await renderView(d, res.skin, res.images, nodeCanvas, { canvasW: 600, canvasH: 500 });
    return { ...r, im: canvasToImage(r.canvas) };
  }
  /** Whether anything differs between two pictures inside x0..x1, y0..y1. */
  function differs(a: RGBAImage, b: RGBAImage, x0: number, y0: number, x1: number, y1: number): boolean {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * a.width + x) * 4;
        for (let c = 0; c < 4; c++) if (a.data[i + c] !== b.data[i + c]) return true;
      }
    }
    return false;
  }
  const buttonArea = (n: number): [number, number, number, number] => {
    // The n-th header button from the right (0: the close button's place).
    const right = 100 + 300 - CHROME.button_right - n * (CHROME.button + CHROME.button_gap);
    return [right - CHROME.button, 100, right, 100 + CHROME.header_h];
  };

  it("draws the collapse button only when collapsed is not false or missing", async () => {
    const shown = await draw(doc({ collapsed: null, closable: false }));
    const hidden = await draw(doc({ collapsed: false, closable: false }));
    const missing = await draw(doc({ closable: false }));
    const bound = await draw(doc({ collapsed: { bind: "c" }, closable: false }));
    const [x0, y0, x1, y1] = buttonArea(0);
    expect(differs(shown.im, hidden.im, x0, y0, x1, y1)).toBe(true);
    expect(differs(missing.im, hidden.im, 100, 100, 400, 300)).toBe(false);
    expect(differs(bound.im, shown.im, 100, 100, 400, 300)).toBe(false);
  });

  it("puts the collapse button left of the close button", async () => {
    const both = await draw(doc({ collapsed: null, closable: true }));
    const close = await draw(doc({ collapsed: false, closable: true }));
    const [x0, y0, x1, y1] = buttonArea(1);
    expect(differs(both.im, close.im, x0, y0, x1, y1)).toBe(true);
    const [c0, , c1] = buttonArea(0);
    expect(differs(both.im, close.im, c0, y0, c1, y1)).toBe(false);
  });

  it("drops the title bar only with no title, no close and no collapse", async () => {
    const bare = await draw(doc({ title: false, closable: false, collapsed: false }));
    const closeOnly = await draw(doc({ title: false, collapsed: false }));
    // The content starts 8 below the window's top without a bar, 33 + 8 with one.
    expect(bare.outlines.find((o) => o.type === "col")!.rect[1]).toBe(108);
    expect(closeOnly.outlines.find((o) => o.type === "col")!.rect[1]).toBe(100 + CHROME.header_h + 8);
  });

  it("a window that opens collapsed shows its title bar alone", async () => {
    const r = await draw(doc({ collapsed: true }));
    expect(r.windowRect).toEqual([100, 100, 300, CHROME.header_h]);
    expect(r.outlines.find((o) => o.type === "col")).toBeUndefined();
    const sample = await draw(doc({ collapsed: { bind: "c" } }, { c: true }));
    expect(sample.windowRect).toEqual([100, 100, 300, CHROME.header_h]);
  });

  it("draws the border with border true or missing, also on a transparent window; none for false, null or an unset bind", async () => {
    const on = await draw(doc({ border: true }));
    const missing = await draw(doc({}));
    const off = await draw(doc({ border: false }));
    const nul = await draw(doc({ border: null }));
    const unset = await draw(doc({ border: { bind: "b" } }));
    const sample = await draw(doc({ border: { bind: "b" } }, { b: true }));
    const y = 100 + CHROME.header_h + 50;
    expect(differs(on.im, off.im, 100, y, 104, y + 1)).toBe(true);
    expect(differs(missing.im, on.im, 100, 100, 400, 300)).toBe(false);
    expect(differs(nul.im, off.im, 100, 100, 400, 300)).toBe(false);
    expect(differs(unset.im, off.im, 100, 100, 400, 300)).toBe(false);
    expect(differs(sample.im, on.im, 100, 100, 400, 300)).toBe(false);
    const tOn = await draw(doc({ transparent: true, border: true }));
    const tOff = await draw(doc({ transparent: true, border: false }));
    expect(differs(tOn.im, tOff.im, 100, y, 104, y + 1)).toBe(true);
  });

  it("places geometry -1, -2 and -3 on the canvas centre", async () => {
    const at = async (x: number, y: number) => (await draw({ ...doc({}), window: { ...doc({}).window, geometry: { x, y, w: 300, h: 200 } } })).windowRect;
    expect(await at(-1, -1)).toEqual([150, 150, 300, 200]);
    expect(await at(-2, -2)).toEqual([300, 250, 300, 200]);
    expect(await at(-3, -3)).toEqual([150, 150, 300, 200]);
  });
});
