// The original GUI's previews and the frame check (src/core/oldgui/preview/): the renderer, layouts placed on their
// hooks, bars at a fill level, and the rules compared. Every model, layout, string table and texture is synthetic.
import { describe, expect, it } from "vitest";
import { readGuiLayout } from "../src/core/oldgui/guilayout.js";
import { type Mdl, readMdl } from "../src/core/oldgui/mdl.js";
import { checkFrames, distance, skeleton } from "../src/core/oldgui/preview/frames.js";
import { type Canvas, type Tex, canvas, renderModel } from "../src/core/oldgui/preview/render.js";
import { Screens } from "../src/core/oldgui/preview/screens.js";
import { type RGBAImage, newImage } from "../src/core/res/image.js";
import { Tlk } from "../src/core/res/tlk.js";
import { ResMan } from "../src/core/res/resman.js";
import { previewWorld } from "../src/node/oldguipreview.js";
import { findGame, isGameDir, openResources } from "../src/node/setup.js";
import { makeGff } from "./gffbuild.js";
import { type BNode, makeAsciiMdl, makeBinaryMdl } from "./mdlbuild.js";

/** A 1 x 0.2 unit quad (100 x 20 px) reading the whole texture. */
const QUAD: Pick<BNode, "verts" | "faces" | "tverts"> = {
  verts: [
    [0, 0, 0],
    [0, 0.2, 0],
    [1, 0, 0],
    [1, 0.2, 0],
  ],
  faces: [
    [0, 2, 1],
    [3, 1, 2],
  ],
  tverts: [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ],
};

/** Two texels: black on the left, white on the right. */
function halves(): RGBAImage {
  const im = newImage(2, 1, [0, 0, 0, 255]);
  im.data.set([255, 255, 255, 255], 4);
  return im;
}

const px = (cv: Canvas, x: number, y: number) => Array.from(cv.d.subarray((y * cv.w + x) * 4, (y * cv.w + x) * 4 + 3), Math.round);

function quadModel(name: string, extra: Partial<BNode> = {}): Mdl {
  const root: BNode = { name, kind: "dummy", children: [{ name: "plane1", kind: "trimesh", bitmap: "tex", ...QUAD, ...extra }] };
  return readMdl(makeBinaryMdl(name, root));
}

describe("renderer", () => {
  it("filter 0 draws each texel hard; filtered textures blend between texels", () => {
    const m = quadModel("m");
    const hard: Tex = { img: halves(), nearest: true, clamp: 0 };
    const soft: Tex = { img: halves(), nearest: false, clamp: 3 };
    const a = canvas(100, 20, [0, 0, 0]);
    renderModel(a, m, 0, 20, () => hard);
    expect(px(a, 45, 10)).toEqual([0, 0, 0]);
    expect(px(a, 55, 10)).toEqual([255, 255, 255]);
    const b = canvas(100, 20, [0, 0, 0]);
    renderModel(b, m, 0, 20, () => soft);
    const mid = px(b, 50, 10)[0]!;
    expect(mid).toBeGreaterThan(80);
    expect(mid).toBeLessThan(180);
  });

  it("draws a bar at a fill level between its percentage animation's first and last frame", () => {
    const empty: [number, number, number][] = [
      [0, 0, 0],
      [0, 0.2, 0],
      [0.01, 0, 0],
      [0.01, 0.2, 0],
    ];
    const root: BNode = { name: "bar", kind: "dummy", children: [{ name: "fill", kind: "animmesh", bitmap: "tex", ...QUAD }] };
    const anim = { name: "percentage", length: 1, root: { name: "bar", kind: "dummy" as const, children: [{ name: "fill", kind: "animmesh" as const, bitmap: "tex", ...QUAD, animverts: [empty, QUAD.verts!], animtverts: [QUAD.tverts!, QUAD.tverts!] }] } };
    const m = readMdl(makeBinaryMdl("bar", root, [anim]));
    const white: Tex = { img: newImage(4, 4, [255, 255, 255, 255]), nearest: true, clamp: 0 };
    const cv = canvas(100, 20, [0, 0, 0]);
    renderModel(cv, m, 0, 20, () => white, { anim: "percentage@0.4" });
    // 0.01 + 0.4 * (1 - 0.01) units: about 40 px filled
    expect(px(cv, 38, 10)).toEqual([255, 255, 255]);
    expect(px(cv, 43, 10)).toEqual([0, 0, 0]);
  });

  it("reads an ASCII model's orientation as a rotation (a strip turned on its side)", () => {
    const root: BNode = { name: "r", kind: "dummy", children: [{ name: "plane1", kind: "trimesh", bitmap: "tex", ...QUAD }] };
    const text = makeAsciiMdl("r", root).replace(/(node trimesh plane1[\s\S]*?)(\n\s*bitmap)/, "$1\n  orientation 0 0 1 1.5707963$2");
    const m = readMdl(new TextEncoder().encode(text));
    const q = m.nodes.find((n) => n.name === "plane1")!.orientation;
    expect(q[2]).toBeCloseTo(Math.SQRT1_2, 3);
    const white: Tex = { img: newImage(4, 4, [255, 255, 255, 255]), nearest: true, clamp: 0 };
    const cv = canvas(40, 120, [0, 0, 0]);
    renderModel(cv, m, 30, 110, () => white);
    // turned 90 degrees: 20 px wide and 100 px tall, to the left of the origin
    expect(px(cv, 20, 50)).toEqual([255, 255, 255]);
    expect(px(cv, 35, 50)).toEqual([0, 0, 0]);
  });
});

describe("screens", () => {
  it("places a layout's objects on their parents' hooks, and labels them from the string table", () => {
    const panel: BNode = { name: "pnl_t", kind: "dummy", children: [{ name: "plane1", kind: "trimesh", bitmap: "tex", ...QUAD }, { name: "okhook", kind: "dummy", position: [0.5, 0.1, 0] }] };
    const models = new Map<string, Mdl>([
      ["pnl_t", readMdl(makeBinaryMdl("pnl_t", panel))],
      ["ctl_t", quadModel("ctl_t")],
    ]);
    const gui = makeGff("GUI ", [
      { label: "Obj_Tag", str: "P" },
      { label: "Obj_ResRef", resref: "pnl_t" },
      {
        label: "Obj_ChildList",
        list: [
          [
            { label: "Obj_Tag", str: "OK" },
            { label: "Obj_ResRef", resref: "ctl_t" },
            { label: "Obj_Type", int: 9 },
            { label: "Obj_Parent_Hook", str: "okhook" },
            { label: "Obj_X", float: 0.25 },
            { label: "Obj_Caption", struct: [{ label: "Obj_StrRef", dword: 1 }] },
          ],
        ],
      },
    ]);
    const layout = readGuiLayout("t", gui);
    const sc = new Screens({ models: (n) => models.get(n) ?? null, layout: () => layout, layouts: () => ["t"], text: (s) => (s === 1 ? "OK" : "") }).fromGui("t");
    const btn = sc.items.find((i) => i.kind === "model" && i.name === "ctl_t");
    if (btn?.kind !== "model") throw new Error("no button");
    expect(btn.x).toBeCloseTo(0.75, 5);
    expect(btn.y).toBeCloseTo(0.1, 5);
    expect(btn.anim).toBe("down");
    expect(sc.items.find((i) => i.kind === "text")).toMatchObject({ s: "OK" });
  });

  it("reads a TLK's strings", () => {
    const text = "Hello";
    const b = new Uint8Array(20 + 2 * 40 + text.length);
    const v = new DataView(b.buffer);
    b.set(new TextEncoder().encode("TLK V3.0"), 0);
    v.setUint32(12, 2, true);
    v.setUint32(16, 100, true);
    v.setUint32(20 + 40, 1, true);
    v.setUint32(20 + 40 + 28, 0, true);
    v.setUint32(20 + 40 + 32, text.length, true);
    b.set(new TextEncoder().encode(text), 100);
    const t = new Tlk(b);
    expect([t.get(0), t.get(1), t.get(9)]).toEqual(["", "Hello", ""]);
  });
});

describe("frame check", () => {
  /** A dark canvas with light 1 px lines. */
  function lines(hs: [number, number, number][], vs: [number, number, number][] = []): Canvas {
    const cv = canvas(120, 80, [10, 10, 10]);
    const set = (x: number, y: number) => cv.d.set([200, 170, 110], (y * 120 + x) * 4);
    for (const [y, x0, x1] of hs) for (let x = x0; x < x1; x++) set(x, y);
    for (const [x, y0, y1] of vs) for (let y = y0; y < y1; y++) set(x, y);
    return cv;
  }
  const glow = [240, 204, 130];

  it("finds nothing when the theme draws the stock's lines", () => {
    const st = lines([[20, 10, 110]], [[10, 20, 70]]);
    const th = lines([[20, 10, 110]], [[10, 20, 70]]);
    // a fill change so the two differ, as a theme does
    for (let i = 0; i < th.w * th.h; i++) if (th.d[i * 4] === 10) th.d.set([30, 26, 22], i * 4);
    const f = checkFrames(st, th, glow);
    expect([f.missing.length, f.stray.length, f.ends.length, f.spurs.length]).toEqual([0, 0, 0, 0]);
  });

  it("finds a missing line, a stray line, a break and a stub", () => {
    const st = lines(
      [
        [20, 10, 110],
        [60, 10, 110],
      ],
      [[10, 20, 60]],
    );
    const th = lines(
      [
        [20, 10, 60],
        [40, 10, 110],
      ],
      [
        [10, 20, 60],
        [40, 21, 23],
      ],
    );
    for (let i = 0; i < th.w * th.h; i++) if (th.d[i * 4] === 10) th.d.set([30, 26, 22], i * 4);
    const f = checkFrames(st, th, glow);
    expect(f.missing.length).toBeGreaterThan(0); // the line at y 60, and the right half of y 20
    expect(f.stray.length).toBeGreaterThan(0); // the line at y 40
    expect(f.ends.some(([x, y]) => Math.abs(x - 59) <= 2 && y === 20)).toBe(true);
    expect(f.spurs.some(([x, y]) => Math.abs(x - 40) <= 2 && Math.abs(y - 22) <= 2)).toBe(true);
  });

  it("thins lines to one pixel and measures distances", () => {
    const m = new Uint8Array(10 * 10);
    for (let y = 3; y < 6; y++) for (let x = 1; x < 9; x++) m[y * 10 + x] = 1;
    const sk = skeleton(m, 10, 10);
    for (let x = 3; x < 7; x++) expect(sk[4 * 10 + x]).toBe(1);
    expect(sk[3 * 10 + 4]! + sk[5 * 10 + 4]!).toBe(0);
    const d = distance(sk, 10, 10);
    expect(d[4]).toBeCloseTo(4);
  });
});

describe("with the game", () => {
  const game = findGame();
  it.skipIf(!game || !isGameDir(game))(`draws every screen's scene, and the load bar fills from 0 to 40 to 100 % (${game ?? "no game"})`, async () => {
    const opened = await openResources({ game: game!, haks: [], overrides: [] });
    const resman = new ResMan();
    resman.layers = opened.resman.layers.filter((l) => l.kind !== "memory");
    const w = await previewWorld(resman, game!);
    const all = w.screens.all();
    expect(all.length).toBeGreaterThan(140);
    // a few layouts place only models the game does not have (a demo splash): they draw nothing
    const empty = all.filter((s) => !s.make().items.length).map((s) => s.key);
    expect(empty.length, empty.join(" ")).toBeLessThan(5);
    // the load bar's fill (the stock's blue): its width at each level
    const width = (key: string) => {
      const sc = all.find((s) => s.key === key)!.make();
      const { cv } = sc.draw(w.stock, sc.bounds(), 1, 1400, false);
      let n = 0;
      for (let y = 0; y < cv.h; y++) {
        let row = 0;
        for (let x = 0; x < cv.w; x++) {
          const o = (y * cv.w + x) * 4;
          if (cv.d[o + 2]! > 150 && cv.d[o + 2]! > cv.d[o]! + 60) row++;
        }
        n = Math.max(n, row);
      }
      return n;
    };
    const [a, b, c] = [width("load_bar_0"), width("load_bar_40"), width("load_bar_100")];
    expect(b).toBeGreaterThan(a + 50);
    expect(c).toBeGreaterThan(b + 50);
  }, 300_000);
});
