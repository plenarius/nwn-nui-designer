// The whole pipeline in Node with the fallback skin (no game data): inputs, binds, wrap, problems, rendering.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { collectBinds } from "../src/core/model/binds.js";
import { InputError, loadDocument } from "../src/core/model/input.js";
import { wrap } from "../src/core/render/text.js";
import { checkRequiredSizes } from "../src/core/render/check.js";
import { foldUnsolvable } from "../src/core/render/render.js";
import { CanvasSurface } from "../src/core/render/surface.js";
import { type CanvasLike, ctx2d } from "../src/core/render/canvas.js";
import { CROP_MARGIN, renderView } from "../src/core/view.js";
import { nodeCanvas } from "../src/node/fs.js";
import { type Resources, openResources } from "../src/node/setup.js";

const fixture = (n: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", n), "utf8");
let res: Resources;
beforeAll(async () => {
  res = await openResources({ game: null });
});

describe("inputs", () => {
  it("reads a .jui, a dump, a quoted JsonDump and a bare layout", () => {
    const jui = loadDocument(fixture("layout.jui"), "layout");
    expect(jui.name).toBe("layout");
    expect(jui.window.title).toBe("Layout");
    const dump = loadDocument(fixture("binds.json"));
    expect(dump.binds.rows).toBe(4);
    expect(Object.keys(dump.panes)).toEqual(["pane"]);
    const quoted = loadDocument(JSON.stringify(fixture("layout.jui")));
    expect(quoted.window.root).toEqual(jui.window.root);
    const bare = loadDocument('{"type":"label","value":"hi"}', "bare");
    expect(bare.window.geometry).toEqual({ x: -1, y: -1, w: 600, h: 400 });
    expect(() => loadDocument("[1]")).toThrow(InputError);
    expect(() => loadDocument("{nope")).toThrow(InputError);
  });

  it("lists the binds a window uses", () => {
    const b = collectBinds(loadDocument(fixture("binds.json")));
    const names = b.map((x) => x.name);
    expect(names).toContain("geometry");
    expect(names).toContain("names");
    expect(b.find((x) => x.name === "names")!.perRow).toBe(true);
    expect(b.find((x) => x.name === "title_text")!.perRow).toBe(false);
  });
});

describe("text", () => {
  it("wraps at spaces, keeps newlines, cuts long words", () => {
    const f = res.skin.defaultFont;
    const lines = wrap("one two three four five six seven\n\nAveryveryverylongwordthatdoesnotfit", f, 80);
    expect(lines.length).toBeGreaterThan(4);
    expect(lines).toContain("");
    for (const l of lines) expect(f.width(l)).toBeLessThanOrEqual(80);
    expect(lines.join("").replace(/ /g, "")).toBe("onetwothreefourfivesixsevenAveryveryverylongwordthatdoesnotfit");
  });
});

describe("fallback skin", () => {
  it("is the open skin in assets/skin, with both fonts and every texture it names", async () => {
    expect(res.usingFallback).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(res.skin.missingFonts).toEqual([]);
    expect([...res.skin.fonts.keys()]).toEqual(["(default)", "(monospace)"]);
    expect(res.skin.get("button.normal")).toBe("nui_button_n");
    const names = new Set<string>();
    const walk = (v: unknown) => {
      if (typeof v === "string" && /^nuio?_/.test(v)) names.add(v);
      else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
    };
    walk({ ...res.skin.data, fonts: [] });
    expect(names.size).toBeGreaterThan(25);
    for (const n of names) expect(await res.resman.get(n, "tga"), n).not.toBeNull();
  });
});

describe("render", () => {
  // Its own timeout: seven whole windows drawn, the first with the skin's textures and glyphs not yet cached.
  it("draws every fixture and reports the problems of problems.jui", async () => {
    for (const f of ["widgets.jui", "layout.jui", "drawlist.jui", "drawlist-client.json", "binds.json", "problems.jui", "unsolvable.jui"]) {
      const r = await renderView(loadDocument(fixture(f), f), res.skin, res.images, nodeCanvas, { crop: true });
      expect(r.canvas.width).toBeGreaterThan(100);
      if (f !== "unsolvable.jui") expect(r.outlines.length).toBeGreaterThan(0);
      if (f === "problems.jui") {
        const kinds = new Set(r.problems.map((p) => p.kind));
        for (const k of ["clipped text", "non-ASCII text", "missing image", "empty", "overflow", "clipped content"]) expect(kinds).toContain(k);
      }
      if (f === "unsolvable.jui") {
        // nui_i_check's static finding (the row), then the solver's: named by the element whose required constraint
        // was refused (the button taller than its row), as nui-preview names it, not the window's root.
        expect(r.problems.map((p) => `${p.kind} ${p.path}`)).toEqual(["unsolvable size /col[0]/row", "unsolvable layout /col[0]/row[0]/button"]);
        // The editor lists them as one entry (DESIGN.md, Problems and house style).
        const shown = foldUnsolvable(r.problems);
        expect(shown.map((p) => `${p.kind} ${p.path}`)).toEqual(["unsolvable size /col[0]/row"]);
        expect(shown[0]!.text).toMatch(/the layout is refused at \/col\[0\]\/row\[0\]\/button$/);
      }
      if (f === "binds.json") {
        // The swapped-in pane is drawn instead of the group's own child.
        expect(r.outlines.some((o) => o.path.includes("group 'pane'/col"))).toBe(true);
      }
    }
  }, 30_000);

  it("finds required sizes the client refuses (nui_i_check)", () => {
    const p = checkRequiredSizes({ type: "row", height: 30, children: [{ type: "button", height: 30 }] });
    expect(p).toHaveLength(1);
    expect(p[0]!.text).toMatch(/height 30.0, but its children need 34.0/);
    expect(checkRequiredSizes({ type: "row", height: 34, children: [{ type: "button", height: 30 }] })).toHaveLength(0);
  });
});

describe("compositing", () => {
  // A canvas stores premultiplied 8-bit pixels, so drawImage of a half-transparent layer rounds twice (one level
  // darker in about a third of pixels); the surface rounds once, as Pillow's alpha_composite and the client's
  // floating-point blending do (DESIGN.md, Rendering).
  // Its own timeout: six full 256 x 256 composites, every pixel checked.
  it("blends partly transparent layers exactly: round((s*a + d*(255-a)) / 255)", () => {
    const surface = new CanvasSurface(nodeCanvas, 256, 256);
    const dst = new Uint8ClampedArray(256 * 256 * 4);
    for (let d = 0; d < 256; d++) for (let s = 0; s < 256; s++) dst.set([d, d, d, 255], (d * 256 + s) * 4);
    for (const a of [1, 30, 64, 127, 200, 254]) {
      surface.image({ width: 256, height: 256, data: dst }, 0, 0);
      const src = new Uint8ClampedArray(256 * 256 * 4);
      for (let d = 0; d < 256; d++) for (let s = 0; s < 256; s++) src.set([s, 255 - s, s >> 1, a], (d * 256 + s) * 4);
      surface.image({ width: 256, height: 256, data: src }, 0, 0);
      const out = surface.canvas.getContext("2d")!.getImageData(0, 0, 256, 256).data;
      let wrong = 0;
      for (let d = 0; d < 256; d++) {
        for (let s = 0; s < 256; s++) {
          const i = (d * 256 + s) * 4;
          for (const [c, v] of [s, 255 - s, s >> 1].entries()) if (out[i + c] !== Math.round((v * a + d * (255 - a)) / 255)) wrong++;
        }
      }
      expect(wrong, `alpha ${a}`).toBe(0);
    }
  }, 30_000);
});

describe("foldUnsolvable (DESIGN.md, Problems and house style)", () => {
  const P = (kind: string, path: string) => ({ kind, path, text: kind, rect: [0, 0, 0, 0] as [number, number, number, number] });
  it("keeps a solver problem that no static one explains", () => {
    const ps = [P("unsolvable size", "/col[0]/row"), P("unsolvable layout", "/col[1]/button")];
    expect(foldUnsolvable(ps).map((p) => p.kind)).toEqual(["unsolvable size", "unsolvable layout"]);
  });
  it("folds a list row's solver problem into the static finding on that list's cell", () => {
    const ps = [P("unsolvable size", "/col[0]/list/cell 0 button"), P("unsolvable layout", "/col[0]/list/row 0/button")];
    const out = foldUnsolvable(ps);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toMatch(/refused at \/col\[0\]\/list\/row 0\/button$/);
  });
  it("changes nothing without a static finding", () => {
    const ps = [P("unsolvable layout", "/col[0]/row[0]/button"), P("clipped text", "/col[0]/label")];
    expect(foldUnsolvable(ps)).toEqual(ps);
  });
});

describe("crop", () => {
  const W = 1440;
  const H = 900;
  const px = (c: CanvasLike, x: number, y: number) => [...ctx2d(c).getImageData(x, y, 1, 1).data];
  const at = (x: number, y: number) => {
    const d = loadDocument(fixture("layout.jui"), "layout");
    d.window = { ...d.window, geometry: { x, y, w: 300, h: 200 } };
    return d;
  };

  // Its own timeout: seven full-screen renders.
  it("keeps the same margin on every side, padding past the screen's edge with the background", async () => {
    const full = (await renderView(at(-1, -1), res.skin, res.images, nodeCanvas, { canvasW: W, canvasH: H })).canvas;
    for (const [x, y] of [[0, 0], [2, 0], [W - 300, H - 200], [W - 305, 3], [5, H - 202], [-1, -1]] as const) {
      const r = await renderView(at(x, y), res.skin, res.images, nodeCanvas, { canvasW: W, canvasH: H, crop: true });
      const [wx, wy, ww, wh] = r.windowRect;
      expect([r.canvas.width, r.canvas.height], `${x},${y}`).toEqual([ww + 2 * CROP_MARGIN, wh + 2 * CROP_MARGIN]);
      expect(r.origin, `${x},${y}`).toEqual([wx - CROP_MARGIN, wy - CROP_MARGIN]);
      // The four corners of the margin are the background: each row's colour, the top and bottom rows' past the screen.
      const bgRow = (sy: number) => px(full, 0, Math.min(H - 1, Math.max(0, sy)));
      for (const [cx, cy] of [[0, 0], [r.canvas.width - 1, 0], [0, r.canvas.height - 1], [r.canvas.width - 1, r.canvas.height - 1]] as const) {
        expect(px(r.canvas, cx, cy), `${x},${y} corner ${cx},${cy}`).toEqual(bgRow(r.origin[1] + cy));
      }
    }
  }, 30_000);

  it("leaves a window with room on every side as it was", async () => {
    const r = await renderView(at(-1, -1), res.skin, res.images, nodeCanvas, { canvasW: W, canvasH: H, crop: true });
    const full = (await renderView(at(-1, -1), res.skin, res.images, nodeCanvas, { canvasW: W, canvasH: H })).canvas;
    const [wx, wy, ww, wh] = r.windowRect;
    const m = CROP_MARGIN;
    const want = ctx2d(full).getImageData(wx - m, wy - m, ww + 2 * m, wh + 2 * m).data;
    expect(Buffer.from(ctx2d(r.canvas).getImageData(0, 0, r.canvas.width, r.canvas.height).data).equals(Buffer.from(want))).toBe(true);
  });
});
