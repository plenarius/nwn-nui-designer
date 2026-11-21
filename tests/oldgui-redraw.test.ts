// The old GUI's redraw (src/core/oldgui/draw/): flat faces, one rule, states from the models' animations, stretched
// cells flat, bars that fill, anti-aliased radial pieces, faces DXT1 stores exactly. Every texture here is synthetic.
import { describe, expect, it } from "vitest";
import { type UvEntry, cellsFor } from "../src/core/oldgui/cells.js";
import { checkCoverage, checkFlat, lightFills } from "../src/core/oldgui/checks.js";
import { exact565, faceWeights, oldGuiStyle, redrawOldGui, snap565 } from "../src/core/oldgui/draw/index.js";
import { fromImage, toImage } from "../src/core/oldgui/draw/raster.js";
import { flattenStretched } from "../src/core/oldgui/draw/redraw.js";
import type { InventoryRow } from "../src/core/oldgui/inventory.js";
import { decodeDds } from "../src/core/res/dds.js";
import { type RGBAImage, newImage } from "../src/core/res/image.js";
import { encodeBiowareDds } from "../src/core/reskin/bc.js";
import { alphaCurve } from "../src/core/reskin/colour.js";
import { paletteFromStyle } from "../src/core/reskin/palette.js";
import { BRONZE, CLEAN } from "../src/core/skin/gen/style.js";

const pal = paletteFromStyle(CLEAN);
const s = oldGuiStyle(pal);
const opaque = alphaCurve("opaque");

const px = (im: RGBAImage, x: number, y: number) => Array.from(im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4));
const rgb = (im: RGBAImage, x: number, y: number) => px(im, x, y).slice(0, 3);

/** A UV entry for a texel rect (display order, y down) of a w x h texture, drawn at `scale` px per texel. */
function uv(model: string, anim: string, r: [number, number, number, number], w: number, h: number, scale: [number, number] = [1, 1]): UvEntry {
  const [x0, y0, x1, y1] = r;
  return { model, node: "plane1", anim, rect: [x0 / w, 1 - y1 / h, x1 / w, 1 - y0 / h], size: [((x1 - x0) * scale[0]) / 100, ((y1 - y0) * scale[1]) / 100], render: true, uvScale: null };
}

/** A stock-like button atlas: a normal frame on top (bevelled light rules on black), a pressed one below (blue cloud). */
function atlas(): RGBAImage {
  const im = newImage(64, 32, [0, 0, 0, 255]);
  for (const [top, blue] of [
    [0, false],
    [16, true],
  ] as const) {
    for (let y = top; y < top + 16; y++) {
      for (let x = 0; x < 64; x++) {
        const edge = y === top + 1 || y === top + 14 || x === 1 || x === 62;
        const bevel = y === top + 2 || y === top + 13 || x === 2 || x === 61;
        const c = edge ? [230, 200, 150] : bevel ? [120, 90, 50] : blue && y > top + 2 && y < top + 13 && x > 2 && x < 61 ? [40, 60, 110 + ((x * 7) % 30)] : [0, 0, 0];
        im.data.set([c[0]!, c[1]!, c[2]!, 255], (y * 64 + x) * 4);
      }
    }
  }
  return im;
}

describe("colours", () => {
  it("snaps every face colour to one DXT1 stores exactly, keeping its hue", () => {
    for (const c of [s.btn, s.panel, s.press, s.line, s.out, s.track, s.tline, s.dbtn]) expect(exact565(c), c.join(",")).toBe(true);
    // a dark warm grey stays warm, a neutral one neutral: never the green cast of the plain nearest colour
    const ink = snap565([20, 19, 18]);
    expect(ink[1]).toBeLessThanOrEqual(ink[0]);
    expect(snap565([8, 8, 8])).toEqual([8, 8, 8]);
    const warm = snap565([44, 40, 35]);
    expect(warm[0]).toBeGreaterThanOrEqual(warm[1]);
    expect(warm[1]).toBeGreaterThanOrEqual(warm[2]);
  });

  it("a dark skin's palette gives a flat face, a rule, a hover glow and a pressed fill", () => {
    const b = oldGuiStyle(paletteFromStyle(BRONZE));
    expect(b.states.hilite.glow).toEqual(b.glow);
    expect(b.states.pressed.face).toEqual(b.press);
    expect(b.states.disabled.line).toEqual(b.dline);
  });
});

describe("button atlases", () => {
  const stock = atlas();
  const entries = [uv("ctl_btn_t", "", [0, 0, 64, 16], 64, 32), uv("ctl_btn_t", "up", [0, 0, 64, 16], 64, 32), uv("ctl_btn_t", "down", [0, 16, 64, 32], 64, 32)];
  const out = redrawOldGui({ name: "ctl_btn_64x24", stock, uv: entries, style: s, alpha: opaque })!;

  it("draws each frame a model reads as a button in its state: edge, one rule, flat face", () => {
    expect(rgb(out, 0, 5)).toEqual(s.out);
    expect(rgb(out, 1, 5)).toEqual(s.line);
    expect(rgb(out, 30, 8)).toEqual(s.btn);
    // the pressed frame (the stock's blue cloud and its down animation) takes the pressed fill
    expect(rgb(out, 30, 24)).toEqual(s.press);
    expect(rgb(out, 1, 24)).toEqual(s.line);
  });

  it("passes the flatness check where the stock fails it", () => {
    const cells = cellsFor(entries, 64, 32);
    const o = { allowed: lightFills(pal), ink: pal.ink };
    expect(checkFlat("ctl_btn_64x24", out, cells, [], o).filter((f) => f.fail)).toEqual([]);
    expect(checkFlat("ctl_btn_64x24", stock, cells, [], o).filter((f) => f.fail).length).toBeGreaterThan(0);
  });
});

describe("stretched cells", () => {
  it("every line a stretched cell reads is one colour along the stretch", () => {
    const im = newImage(8, 4, [0, 0, 0, 255]);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) im.data.set([10 + x * 3, 10 + x * 3, 10, 255], (y * 8 + x) * 4);
    const p = fromImage(im);
    // drawn at 20 px per texel across, 1:1 down
    flattenStretched(p, [[0, 0, 8, 4, 20, 1, "m/n/-"]], s);
    const out = toImage(p);
    for (let y = 0; y < 4; y++) for (let x = 1; x < 8; x++) expect(px(out, x, y)).toEqual(px(out, 0, y));
  });

  it("a colour strip's ramps become flat levels, its signal colours stay", () => {
    const im = newImage(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        // columns 0-7: a grey ramp at a translucent fill's alpha; 8-11 an opaque light rule column; 12-15 red
        const c = x < 8 ? [40 + y * 6, 40 + y * 6, 40 + y * 6, 102] : x < 12 ? [200, 200, 200, 255] : [220, 20, 20, 255];
        im.data.set(c, (y * 16 + x) * 4);
      }
    }
    const entries = [uv("pnl_t", "", [0, 0, 8, 16], 16, 16, [40, 1]), uv("pnl_t", "", [8, 0, 12, 16], 16, 16, [1, 1])];
    const out = redrawOldGui({ name: "gui_boxes", stock: im, uv: entries, style: s, alpha: opaque })!;
    expect(rgb(out, 3, 3)).toEqual(s.panel);
    expect(rgb(out, 9, 3)).toEqual(s.line);
    expect(rgb(out, 13, 3)).toEqual([220, 20, 20]);
    expect(checkFlat("gui_boxes", out, cellsFor(entries, 16, 16), [], { allowed: lightFills(pal), ink: pal.ink }).filter((f) => f.fail)).toEqual([]);
  });
});

describe("hand-drawn pieces", () => {
  const draw = (name: string, w: number, h: number, fill: [number, number, number, number] = [0, 0, 0, 255]) => redrawOldGui({ name, stock: newImage(w, h, fill), uv: [], style: s, alpha: opaque })!;

  it("the load bar's fill is one band along the whole width, so it shows at every fill level", () => {
    const out = draw("gui_loadstatus", 256, 128);
    for (const x of [0, 6, 27, 128, 229, 249, 255]) {
      expect(rgb(out, x, 112)).toEqual(s.line);
      expect(rgb(out, x, 125)).toEqual(s.line);
      expect(rgb(out, x, 111)).toEqual(s.panel);
    }
    // the frame's three strips carry their rules on the same rows
    for (const top of [0, 35, 70]) expect(rgb(out, 100, top + 2)).toEqual(s.line);
  });

  it("the rest bar is a band across its 14 texel cell", () => {
    const out = draw("gui_resting", 128, 64);
    expect(rgb(out, 0, 62)).toEqual(s.panel);
    expect(rgb(out, 2, 62)).toEqual(s.line);
    expect(rgb(out, 13, 62)).toEqual(s.line);
  });

  it("a text tab is outlined on top and both sides and open at the bottom", () => {
    const out = draw("gui_pre_playtabs", 128, 8, [0, 0, 0, 0]);
    expect(rgb(out, 60, 1)).toEqual(s.line);
    expect(rgb(out, 5, 6)).toEqual(s.line);
    expect(rgb(out, 122, 6)).toEqual(s.line);
    expect(rgb(out, 60, 6)).toEqual(s.panel);
    expect(px(out, 60, 7)[3]).toBe(255);
  });

  it("radial circles have anti-aliased alpha and a rim, opaque inside", () => {
    const out = draw("gui_rad_ring", 32, 32);
    const alphas = new Set<number>();
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) alphas.add(px(out, x, y)[3]!);
    expect([...alphas].some((a) => a > 16 && a < 240)).toBe(true);
    expect(px(out, 16, 16)).toEqual([...s.btn, 255]);
    expect(px(out, 0, 0)[3]).toBe(0);
    expect(rgb(out, 16, 5)).toEqual(s.line);
  });
});

describe("DXT", () => {
  it("face weights keep a face within DXT rounding, its hue kept, where its block also holds an edge and a rule", () => {
    const im = newImage(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) im.data.set([...(x === 0 ? s.out : x === 1 ? s.line : s.btn), 255], (y * 16 + x) * 4);
    const dec = decodeDds(encodeBiowareDds(im, 3, faceWeights(im)));
    for (let y = 1; y < 15; y++) {
      const c = rgb(dec, 3, y);
      expect(Math.max(...c.map((v, k) => Math.abs(v - s.btn[k]!)))).toBeLessThanOrEqual(6);
      expect(c[0]).toBeGreaterThanOrEqual(c[1]!);
      expect(c[1]).toBeGreaterThanOrEqual(c[2]!);
      // the rest of the face is exact
      expect(rgb(dec, 8, y)).toEqual(s.btn);
    }
  });
});

describe("coverage", () => {
  it("a redrawn file covers its chrome; a recoloured one does not", () => {
    const row = { resref: "ctl_btn_64x24", drawn: true, treatment: "redraw", role: "button atlas" } as InventoryRow;
    expect(checkCoverage([row], new Map([["ctl_btn_64x24", { name: "ctl_btn_64x24", ext: "dds", made: "redrawn" as const }]]))).toEqual([]);
    expect(checkCoverage([row], new Map([["ctl_btn_64x24", { name: "ctl_btn_64x24", ext: "dds", made: "recoloured" as const }]]))[0]!.fail).toBe(true);
  });
});
