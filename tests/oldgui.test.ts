// The original GUI's inventory and checks (src/core/oldgui/). Every model, layout and texture here is synthetic, made
// in the test: no game art.
import { describe, expect, it } from "vitest";
import { MemoryContainer } from "../src/core/res/containers.js";
import { type RGBAImage, newImage } from "../src/core/res/image.js";
import { ResMan } from "../src/core/res/resman.js";
import { RES_TYPES } from "../src/core/res/restype.js";
import { encodeTga } from "../src/core/res/tga.js";
import { type Cell, cellsFor, coverSpan, readSpan, stateControls, uvEntries } from "../src/core/oldgui/cells.js";
import { checkCategories, checkCoverage, checkFillBars, checkFlat, checkFonts, checkStateIcons, flatSkips, lightFills } from "../src/core/oldgui/checks.js";
import { clientNames, collectOldGui, formatPattern } from "../src/core/oldgui/collect.js";
import { readGuiLayout } from "../src/core/oldgui/guilayout.js";
import { buildInventory, inventoryTsv, readInventoryTsv } from "../src/core/oldgui/inventory.js";
import { readMdl } from "../src/core/oldgui/mdl.js";
import { builtinRole } from "../src/core/oldgui/roles.js";
import { decodeGuiTexture } from "../src/core/oldgui/texture.js";
import { oldGuiStyle, redrawOldGui } from "../src/core/oldgui/draw/index.js";
import { alphaCurve } from "../src/core/reskin/colour.js";
import { paletteFromStyle } from "../src/core/reskin/palette.js";
import { chooseSkin } from "../src/node/openskin.js";
import { readTxi, txiSummary } from "../src/core/oldgui/txi.js";
import { findGame, isGameDir, openResources } from "../src/node/setup.js";
import { findClient } from "../src/node/oldguiclient.js";
import { readFileSync } from "node:fs";
import { makeGff } from "./gffbuild.js";
import { type BAnim, type BNode, makeAsciiMdl, makeBinaryMdl } from "./mdlbuild.js";

const QUAD = { verts: [[-0.5, 0.1, 0], [-0.5, -0.1, 0], [0.5, 0.1, 0], [0.5, -0.1, 0]] as [number, number, number][], faces: [[0, 1, 2], [3, 2, 1]] as [number, number, number][] };
/** A button: its geometry reads the top half of a 64x32 atlas (normal), its hilite animation the bottom half. */
const UP: [number, number][] = [[0, 1], [0, 0.5], [1, 1], [1, 0.5]];
const HI: [number, number][] = [[0, 0.5], [0, 0], [1, 0.5], [1, 0]];

function button(name: string, tex: string): { root: BNode; anims: BAnim[] } {
  const plane: BNode = { name: "plane1", kind: "animmesh", bitmap: tex, position: [0.5, 0.1, 0], ...QUAD, tverts: UP };
  const anim = (n: string, tv: [number, number][]): BAnim => ({
    name: n,
    length: 1,
    root: { name, kind: "dummy", children: [{ ...plane, animverts: [QUAD.verts], animtverts: [tv] }] },
  });
  return { root: { name, kind: "dummy", children: [plane] }, anims: [anim("up", UP), anim("hilite", HI)] };
}

/** A bar whose percentage animation runs over two frames that differ (the bar grows). */
function bar(): { root: BNode; anims: BAnim[] } {
  const strip: BNode = { name: "fill", kind: "animmesh", bitmap: "gui_loadstatus", ...QUAD, tverts: [[0, 0.2], [0, 0], [1, 0.2], [1, 0]] };
  const empty: [number, number, number][] = [[-0.5, 0.1, 0], [-0.5, -0.1, 0], [-0.49, 0.1, 0], [-0.49, -0.1, 0]];
  return {
    root: { name: "ctl_loadstatus", kind: "dummy", children: [strip] },
    anims: [{ name: "percentage", length: 1, root: { name: "ctl_loadstatus", kind: "dummy", children: [{ ...strip, animverts: [empty, QUAD.verts], animtverts: [strip.tverts!, strip.tverts!] }] } }],
  };
}

describe("models", () => {
  it("reads a binary model and the same model in ASCII alike", () => {
    const { root, anims } = button("ctl_btn_test", "ctl_btn_64x24");
    const b = readMdl(makeBinaryMdl("ctl_btn_test", root, anims));
    const a = readMdl(new TextEncoder().encode(makeAsciiMdl("ctl_btn_test", root, anims)));
    for (const m of [a, b]) {
      expect(m.name).toBe("ctl_btn_test");
      const n = m.nodes.find((x) => x.name === "plane1")!;
      expect(n.bitmap).toBe("ctl_btn_64x24");
      expect(n.kind).toBe("animmesh");
      expect(n.tverts.map((t) => t.map((v) => +v.toFixed(3)))).toEqual(UP);
      expect(n.faces.map((f) => f.slice(0, 3))).toEqual(QUAD.faces);
      expect(n.position.map((v) => +v.toFixed(3))).toEqual([0.5, 0.1, 0]);
      expect(m.anims.get("hilite")!.nodes.get("plane1")!.animtverts!.map((t) => t.map((v) => +v.toFixed(3)))).toEqual(HI);
    }
  });

  it("reads an animation's frames frame after frame (the binary stores them vertex after vertex)", () => {
    const { root, anims } = bar();
    const m = readMdl(makeBinaryMdl("ctl_loadstatus", root, anims));
    const v = m.anims.get("percentage")!.nodes.get("fill")!.animverts!;
    expect(v.length).toBe(8);
    expect(v[2]![0]).toBeCloseTo(-0.49);
    expect(v[6]![0]).toBeCloseTo(0.5);
  });

  it("refuses what is not a model", () => {
    expect(() => readMdl(new TextEncoder().encode("hello"))).toThrow(/not a model/);
    expect(() => readMdl(new Uint8Array([0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0]))).toThrow(/damaged|truncated/);
  });
});

describe("cells", () => {
  it("gives each state's cell and how much it is stretched", () => {
    const { root, anims } = button("ctl_btn_test", "ctl_btn_64x24");
    const es = uvEntries(readMdl(makeBinaryMdl("ctl_btn_test", root, anims))).get("ctl_btn_64x24")!;
    expect(es.map((e) => e.anim).sort()).toEqual(["", "hilite", "up"]);
    const cells = cellsFor(es, 64, 32);
    // the quad is 100 x 20 px; each half of the atlas is 64 x 16 texels
    expect(cells.map((c) => c.slice(0, 6))).toEqual([
      [0, 0, 64, 16, 1.56, 1.25],
      [0, 16, 64, 32, 1.56, 1.25],
    ]);
    expect(stateControls(cells).get("ctl_btn_test/plane1")).toBe(2);
  });

  it("counts a rotated strip's stretch along its own axes", () => {
    // a 2 x 100 px quad drawing a 64 x 2 texel strip turned on its side: u runs down the screen
    const node = { name: "p", kind: "trimesh", bitmap: "t", render: true, transparencyHint: 0, position: [0, 0, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number], alpha: 1, parent: null, verts: [[0, 0, 0], [0.02, 0, 0], [0, 1, 0], [0.02, 1, 0]] as [number, number, number][], tverts: [[0, 0], [0, 1 / 16], [1, 0], [1, 1 / 16]] as [number, number][], faces: [[0, 1, 2, 0, 1, 2], [3, 2, 1, 3, 2, 1]] as [number, number, number, number, number, number][] };
    const es = uvEntries({ name: "m", supermodel: null, nodes: [node], anims: new Map(), binary: false }).get("t")!;
    const [c] = cellsFor(es, 64, 32);
    expect(c![4]).toBeCloseTo(100 / 64, 2);
    expect(c![5]).toBeCloseTo(1, 2);
  });

  it("reads half a texel past a stretched span's ends, wrapping only past the edge", () => {
    expect(readSpan(4, 8, 16)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(readSpan(0, 4, 16)).toEqual([0, 1, 2, 3, 4]);
    expect(readSpan(-1, 3, 16)).toEqual([0, 1, 2, 3, 14, 15]);
    expect(coverSpan(4, 8, 16)).toEqual([4, 5, 6, 7]);
  });
});

describe("layouts and txi", () => {
  it("reads a .gui's models, hooks and caption fonts", () => {
    const gui = makeGff("GUI ", [
      { label: "Obj_Tag", str: "PNL_TEST" },
      { label: "Obj_ResRef", resref: "pnl_test" },
      { label: "Obj_Type", int: 3 },
      {
        label: "Obj_ChildList",
        list: [
          [
            { label: "Obj_Tag", str: "OkButton" },
            { label: "Obj_ResRef", resref: "CTL_BTN_TEST" },
            { label: "Obj_Parent", str: "PNL_TEST" },
            { label: "Obj_Parent_Hook", str: "PNL_HOOK_OK" },
            { label: "Obj_X", float: 1.5 },
            { label: "Obj_Caption", struct: [{ label: "AurString_Font", resref: "fnt_test14" }, { label: "Obj_StrRef", dword: 67 }] },
          ],
        ],
      },
    ]);
    const l = readGuiLayout("test", gui);
    expect(l.objects.map((o) => [o.tag, o.model, o.parent, o.hook])).toEqual([
      ["PNL_TEST", "pnl_test", "", ""],
      ["OkButton", "ctl_btn_test", "PNL_TEST", "PNL_HOOK_OK"],
    ]);
    expect(l.objects[1]!.font).toBe("fnt_test14");
    expect(l.objects[1]!.x).toBeCloseTo(1.5);
    expect(l.objects[1]!.strref).toBe(67);
  });

  it("reads the txi keys the old GUI depends on", () => {
    const t = readTxi("mipmap 0\nfilter 0\nclamp 3\nenvmaptexture CM_Test\n");
    expect([t.filter, t.mipmap, t.clamp, t.refs]).toEqual([false, false, 3, ["cm_test"]]);
    expect(txiSummary(t)).toBe("filter 0, mipmap 0, clamp 3");
    expect(txiSummary(readTxi("downsamplemax 0\n"))).toBe("");
  });

  it("turns the client's name formats into patterns", () => {
    expect(formatPattern("ctl_inv_sto_tab%d")!.test("ctl_inv_sto_tab12")).toBe(true);
    expect(formatPattern("gui_mp_custom%02du")!.test("gui_mp_custom07u")).toBe(true);
    expect(formatPattern("gui_mp_custom%02du")!.test("gui_mp_custom7u")).toBe(false);
    expect(formatPattern("%s")).toBeNull();
    const bin = new TextEncoder().encode("\0GUI_BOXES\0#?GUI_ICON_%dX%dS\0xy\0a long sentence, not a name\0");
    const c = clientNames(bin);
    expect([...c.names]).toEqual(["gui_boxes"]);
    expect([...c.formats]).toEqual(["gui_icon_%dx%ds"]);
  });
});

/** A synthetic game: a button model, a bar model, a layout, a few textures and a client name. */
async function fakeGame(): Promise<ResMan> {
  const game = new MemoryContainer("data/nwn_base.key");
  const add = (n: string, ext: string, d: Uint8Array) => game.set(n, RES_TYPES[ext]!, d);
  const b = button("ctl_btn_test", "ctl_btn_64x24");
  add("ctl_btn_test", "mdl", makeBinaryMdl("ctl_btn_test", b.root, b.anims));
  const i = button("ctl_btn_icon", "gui_inv_test_ic");
  add("ctl_btn_icon", "mdl", makeBinaryMdl("ctl_btn_icon", i.root, i.anims));
  const l = bar();
  add("ctl_loadstatus", "mdl", makeBinaryMdl("ctl_loadstatus", l.root, l.anims));
  add("test", "gui", makeGff("GUI ", [{ label: "Obj_Tag", str: "P" }, { label: "Obj_ResRef", resref: "ctl_btn_test" }, { label: "Obj_Caption", struct: [{ label: "AurString_Font", resref: "fnt_test14" }] }]));
  add("ctl_btn_64x24", "tga", encodeTga(newImage(64, 32, [40, 40, 40, 255])));
  add("gui_inv_test_ic", "tga", encodeTga(newImage(64, 32, [40, 40, 40, 255])));
  add("gui_loadstatus", "tga", encodeTga(newImage(64, 32, [40, 40, 40, 255])));
  add("gui_loadstatus", "txi", new TextEncoder().encode("filter 0\nmipmap 0\n"));
  add("fnt_test14", "tga", encodeTga(newImage(16, 16)));
  add("ctl_builtin", "tga", encodeTga(newImage(8, 8)));
  add("gui_nobody", "tga", encodeTga(newImage(8, 8)));
  const r = new ResMan();
  r.layers = [{ kind: "game-ovr", container: game }];
  return r;
}

describe("inventory", () => {
  it("collects models, layouts, client names and txi links, and gives every texture a role", async () => {
    const c = await collectOldGui(await fakeGame(), { clientStrings: ["ctl_builtin"] });
    expect([...c.models.keys()].sort()).toEqual(["ctl_btn_icon", "ctl_btn_test", "ctl_loadstatus"]);
    const inv = buildInventory(c, { textures: { ctl_builtin: { group: "chrome", treatment: "flat", role: "a test cell" } } });
    const row = (n: string) => inv.rows.find((r) => r.resref === n)!;
    expect(row("ctl_btn_64x24")).toMatchObject({ group: "chrome", kind: "button", treatment: "redraw", drawn: true, size: "64x32", layouts: [], models: ["ctl_btn_test"] });
    expect(row("gui_loadstatus")).toMatchObject({ kind: "bar", txi: "filter 0, mipmap 0" });
    expect(row("fnt_test14")).toMatchObject({ group: "font", treatment: "hold", layouts: ["test"] });
    expect(row("ctl_builtin")).toMatchObject({ treatment: "flat", client: true, own: true });
    expect(row("gui_inv_test_ic")).toMatchObject({ group: "uncategorised", drawn: true, stateControls: ["ctl_btn_icon/plane1"] });
    expect(inv.rows.some((r) => r.resref === "gui_nobody")).toBe(false);
    expect(inv.cells.textures.ctl_btn_64x24!.size).toEqual([64, 32]);
    // the TSV reads back as it was written
    expect(readInventoryTsv(inventoryTsv(inv.rows))).toEqual(inv.rows);
  });

  it("knows the stock GUI's roles", () => {
    expect(builtinRole("gui_scrollbar")).toMatchObject({ kind: "scrollbar", treatment: "redraw" });
    expect(builtinRole("gui_boxes_ingame")).toMatchObject({ kind: "cells", treatment: "redraw" });
    expect(builtinRole("gui_mp_defaultu")).toMatchObject({ group: "cursor", treatment: "hold" });
    expect(builtinRole("isk_lore")).toMatchObject({ group: "icon" });
    expect(builtinRole("not_a_gui_texture")).toBeNull();
  });
});

describe("checks", () => {
  it("fail on an uncategorised texture, a missing or recoloured chrome texture, and an icon atlas holding a control's states", async () => {
    const c = await collectOldGui(await fakeGame(), { clientStrings: ["ctl_builtin"] });
    const inv = buildInventory(c);
    expect(checkCategories(inv.rows).map((f) => f.texture).sort()).toEqual(["ctl_builtin", "gui_inv_test_ic"]);
    const none = checkCoverage(inv.rows, new Map());
    expect(none.map((f) => f.texture)).toEqual(["ctl_btn_64x24", "gui_loadstatus"]);
    const recol = checkCoverage(inv.rows, new Map([["ctl_btn_64x24", { name: "ctl_btn_64x24", ext: "dds", made: "recoloured" as const }]]));
    expect(recol.find((f) => f.texture === "ctl_btn_64x24")!.message).toMatch(/only recoloured/);
    const redrawn = checkCoverage(inv.rows, new Map([["ctl_btn_64x24", { name: "ctl_btn_64x24", ext: "dds", made: "redrawn" as const }], ["gui_loadstatus", { name: "gui_loadstatus", ext: "tga", made: "" as const }]]));
    expect(redrawn).toEqual([]);
    // the icon atlas a control reads per state, once it is kept as an icon
    const own = buildInventory(c, { textures: { gui_inv_test_ic: { group: "icon", treatment: "icon" } } });
    expect(checkStateIcons(own.rows, own.cells).map((f) => f.texture)).toEqual(["gui_inv_test_ic"]);
    const said = buildInventory(c, { textures: { gui_inv_test_ic: { group: "icon", treatment: "icon", stateIcon: "icons only" } } });
    expect(checkStateIcons(said.rows, said.cells)).toEqual([]);
  });

  it("fail on a filled bar with no fill-level previews", async () => {
    const inv = buildInventory(await collectOldGui(await fakeGame()));
    expect(checkFillBars(inv.rows, inv.cells)).toEqual([]);
    const f = checkFillBars(inv.rows, inv.cells, []);
    expect(f.map((x) => x.texture)).toEqual(["gui_loadstatus"]);
    expect(checkFillBars(inv.rows, inv.cells, [{ model: "ctl_loadstatus", texture: "gui_loadstatus", screen: "x", what: "x", levels: [0, 1] }])[0]!.message).toMatch(/three levels/);
  });

  /** A 32 x 32 panel: a 1 px rule round a face filled by fill(x, y). */
  function panel(fill: (x: number, y: number) => [number, number, number]): RGBAImage {
    const im = newImage(32, 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const edge = x === 0 || y === 0 || x === 31 || y === 31;
        im.data.set(edge ? [146, 118, 74, 255] : [...fill(x, y), 255], (y * 32 + x) * 4);
      }
    }
    return im;
  }

  it("pass a flat face and single rules, and fail a gradient, a pale face and a stretched fade", () => {
    const flat = panel(() => [20, 19, 18]);
    expect(checkFlat("t", flat, [], [])).toEqual([]);
    const ramp = panel((_, y) => [20 + y, 19 + y, 18 + y]);
    expect(checkFlat("t", ramp, [], [])[0]!.message).toMatch(/gradient/);
    const pale = panel(() => [200, 190, 160]);
    expect(checkFlat("t", pale, [], [])[0]!.message).toMatch(/pale face/);
    // allowed when the skin fills that light on purpose
    expect(checkFlat("t", pale, [], [], { allowed: [[200, 190, 160]] })).toEqual([]);
    // a 1:1 frame is fine; the same texture stretched 20 times across reads its side rules along every row
    const one: Cell = [0, 0, 32, 32, 1, 1, "m/n/-"];
    const wide: Cell = [0, 0, 32, 32, 20, 1, "m/n/-"];
    expect(checkFlat("t", flat, [one], [])).toEqual([]);
    expect(checkFlat("t", flat, [wide], []).some((f) => /stretched fade/.test(f.message))).toBe(true);
  });

  it("skips pictures, icons and known exceptions, with the reason", () => {
    expect(flatSkips("ctl_btn_jnl_inv").rects.length).toBeGreaterThan(0);
    expect(flatSkips("gui_textbubble").whole).toMatch(/speech bubble/);
    expect(flatSkips("ctl_btn_64x24")).toEqual({ rects: [], whole: null, notes: [] });
  });

  it("allow the skin's own light fills", () => {
    const fills = lightFills({ ink: [20, 19, 18], accent: [168, 138, 88], activeLo: [74, 55, 27], active: [96, 72, 36], glow: [240, 204, 130], glowHi: [248, 230, 190], mark: [234, 206, 150] });
    expect(fills).toContainEqual([146, 120, 78]);
  });

  it("fail on the old GUI's fonts replaced only in part", () => {
    const ttf = new Uint8Array([0, 1, 0, 0]);
    expect(checkFonts(new Map())).toEqual([]);
    expect(checkFonts(new Map([["fnt_maintext", ttf], ["fnt_default", ttf], ["fnt_default_hr", ttf]]))).toEqual([]);
    expect(checkFonts(new Map([["fnt_maintext", ttf]])).map((f) => f.texture)).toEqual(["fnt_default", "fnt_default_hr"]);
  });

  it("read a GUI texture bottom row first, whatever the TGA's origin flag says", () => {
    const im = newImage(1, 2);
    im.data.set([255, 0, 0, 255, 0, 0, 255, 255]);
    const tga = encodeTga(im);
    const toggled = new Uint8Array(tga);
    toggled[17] = toggled[17]! ^ 0x20;
    // the same stored rows: the client shows the same picture
    expect([...decodeGuiTexture(toggled, "tga").data]).toEqual([...decodeGuiTexture(tga, "tga").data]);
  });
});


describe("with the game", () => {
  const game = findGame();
  it.skipIf(!game || !isGameDir(game))(`reads every GUI model and gives every drawn texture a role (${game ?? "no game"})`, async () => {
    const opened = await openResources({ game: game!, haks: [], overrides: [] });
    const resman = new ResMan();
    resman.layers = opened.resman.layers.filter((l) => l.kind !== "memory");
    const exe = findClient(game!);
    const names = exe ? clientNames(new Uint8Array(readFileSync(exe))) : { names: new Set<string>(), formats: new Set<string>() };
    const c = await collectOldGui(resman, { clientStrings: names.names, clientFormats: names.formats });
    expect([...c.models.values()].filter((m) => m.error)).toEqual([]);
    expect(c.layouts.size).toBeGreaterThan(50);
    const inv = buildInventory(c);
    expect(checkCategories(inv.rows)).toEqual([]);
    expect(checkStateIcons(inv.rows, inv.cells)).toEqual([]);
    expect(checkFillBars(inv.rows, inv.cells)).toEqual([]);
    expect(inv.rows.filter((r) => r.drawn && r.treatment === "redraw").length).toBeGreaterThan(100);

    // every chrome texture redrawn from the game's own (Ink and brass): each passes the flatness check as drawn
    const pal = paletteFromStyle(chooseSkin("ink").style);
    const style = oldGuiStyle(pal);
    const failed: string[] = [];
    let n = 0;
    for (const r of inv.rows.filter((x) => x.drawn && x.treatment === "redraw")) {
      const f = await resman.getAny(r.resref, ["dds", "tga"]);
      if (!f) continue;
      const out = redrawOldGui({ name: r.resref, stock: decodeGuiTexture(f[0], f[1]), uv: c.uv.get(r.resref) ?? [], style, alpha: alphaCurve("opaque") });
      expect(out, r.resref).not.toBeNull();
      n++;
      const sk = flatSkips(r.resref);
      if (sk.whole) continue;
      const bad = checkFlat(r.resref, out!, inv.cells.textures[r.resref]?.cells ?? [], sk.rects, { allowed: lightFills(pal), ink: pal.ink }).filter((x) => x.fail);
      failed.push(...bad.map((b) => `${b.texture}: ${b.message}`));
    }
    expect(n).toBeGreaterThan(140);
    expect(failed).toEqual([]);
  }, 300_000);
});
