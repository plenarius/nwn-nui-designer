// pnpm export-theme's core (src/core/reskin/theme.ts): the light-skin check, the prefix, the two outputs, the
// manifest, the report and the hak. The game here is synthetic, made in the test (no game art); the NUI skins are the
// repository's own built-in ones (CC0, assets/skin/).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Erf, MemoryContainer } from "../src/core/res/containers.js";
import { type RGBAImage, newImage } from "../src/core/res/image.js";
import { ResMan } from "../src/core/res/resman.js";
import { RES_TYPES } from "../src/core/res/restype.js";
import { MemorySource } from "../src/core/res/source.js";
import { encodeBiowareDds } from "../src/core/reskin/bc.js";
import {
  LIGHT_WARNING,
  ThemeError,
  exportTheme,
  lightCheck,
  normalisePrefix,
  prefixName,
  prefixProblems,
  themePackage,
} from "../src/core/reskin/theme.js";
import { FontExportError, fontLicence, oldGuiFonts, skinTextFont } from "../src/core/reskin/oldguifonts.js";
import { AUTO, MANUAL } from "../src/core/reskin/textures.js";
import { type SkinProject, fromOpenSkin, splitFile } from "../src/core/skin/project.js";
import { THEMES } from "../src/core/skin/themes.js";

const skinDir = (id: string) => join(import.meta.dirname, "..", "assets", "skin", id);

function builtIn(id: string): SkinProject {
  const t = THEMES.find((x) => x.id === id)!;
  const files: Record<string, Uint8Array> = {};
  for (const f of readdirSync(skinDir(id))) files[f] = new Uint8Array(readFileSync(join(skinDir(id), f)));
  return fromOpenSkin(files, t.style, t.title, t.hak);
}

/** A frame: black field, a gold rule round it, a lighter band; as a 24-bit TGA, rows bottom to top. */
function frameTga(w = 32, h = 16): Uint8Array {
  const out = new Uint8Array(18 + w * h * 3);
  out[2] = 2;
  out[12] = w;
  out[14] = h;
  out[16] = 24;
  for (let row = 0; row < h; row++) {
    const y = h - 1 - row;
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const o = 18 + (row * w + x) * 3;
      const [r, g, b] = edge ? [189, 146, 74] : y < 4 ? [99, 101, 99] : [0, 0, 0];
      out[o] = b;
      out[o + 1] = g;
      out[o + 2] = r;
    }
  }
  return out;
}

function strip(): RGBAImage {
  const im = newImage(32, 8);
  const cells: [number, number, number, number][] = [[0, 0, 0, 0], [99, 101, 99, 102], [99, 101, 99, 255], [189, 146, 74, 255]];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) im.data.set(cells[Math.floor(x / 8)]!, (y * 32 + x) * 4);
  return im;
}

function fakeGame(extra: (c: MemoryContainer) => void = () => {}): ResMan {
  const c = new MemoryContainer("synthetic game");
  c.set("gui_boxes", RES_TYPES.dds!, encodeBiowareDds(strip(), 4));
  c.set("gui_boxes", RES_TYPES.txi!, new TextEncoder().encode("mipmap 0\n"));
  c.set("ctl_att", RES_TYPES.tga!, frameTga());
  c.set("pnl_opt_gen", RES_TYPES.tga!, frameTga());
  c.set("ctl_opt_gen", RES_TYPES.tga!, frameTga());
  c.set("gui_slider", RES_TYPES.dds!, encodeBiowareDds(newImage(16, 16, [90, 60, 30, 0]), 4));
  c.set("gui_banner", RES_TYPES.tga!, frameTga());
  extra(c);
  const rm = new ResMan();
  rm.layers = [{ kind: "key", container: c }];
  return rm;
}

describe("light skin", () => {
  it("Verdigris and paper is light; Bronze and the other dark skins are not", () => {
    const by = Object.fromEntries(THEMES.map((t) => [t.id, lightCheck(t.style)]));
    expect(by.verdigris!.light).toBe(true);
    expect(by.verdigris!.luma).toBeGreaterThan(200);
    for (const id of ["bronze", "ink", "brass", "oxblood", "winter"]) expect(by[id]!.light, id).toBe(false);
  });

  // Its own timeout: two whole themes exported.
  it("the report warns for Verdigris, and not for Bronze", async () => {
    const opts = { resman: fakeGame(), format: "tga" as const, only: ["ctl_att"] };
    const v = await exportTheme({ ...opts, project: builtIn("verdigris") });
    expect(v.light.light).toBe(true);
    expect(v.report).toContain(LIGHT_WARNING);
    expect(v.report).toMatch(/hard-code a light text colour/);
    // the original GUI still passes its checks: a light skin inverts the luminance, which is meant
    for (const t of v.reskin.manifest.textures) expect(t.validation.problems, t.name).toEqual([]);
    const all = await exportTheme({ resman: fakeGame(), format: "tga", project: builtIn("verdigris") });
    for (const t of all.reskin.manifest.textures) expect(t.validation.problems, t.name).toEqual([]);
    const b = await exportTheme({ ...opts, project: builtIn("bronze") });
    expect(b.light.light).toBe(false);
    expect(b.report).not.toMatch(/WARNING/);
  }, 30_000);
});

describe("prefix", () => {
  it("takes 1 or 2 letters and digits, and keeps every name's length", () => {
    expect(normalisePrefix("BZ_")).toBe("bz");
    expect(normalisePrefix("b")).toBe("b");
    expect(normalisePrefix("brz")).toBeNull();
    expect(normalisePrefix("2b")).toBeNull();
    expect(prefixName("gui_boxes_chrgen", "bz")).toBe("bzg_boxes_chrgen");
    expect(prefixName("ctl_con_prtl_inf", "bz")).toBe("bzc_con_prtl_inf");
    expect(prefixName("pnl_con_prtl_inf", "bz")).toBe("bzp_con_prtl_inf");
    expect(prefixName("nui_skin", "bz")).toBe("bzn_skin");
    expect(prefixName("nuio_jbmono", "bz")).toBe("bzo_jbmono");
    expect(prefixName("edit_box_150x24", "bz")).toBe("bze_box_150x24");
  });

  it("every built-in theme and every original-GUI texture fit, and no two names meet", async () => {
    for (const t of THEMES) {
      const names = [...AUTO.map((x) => x.name), ...readdirSync(skinDir(t.id)).map((f) => splitFile(f)[0]).filter((n) => n.includes("_") && !n.startsWith("ofl-")), "nui_skin", "nuid_skin_lic"];
      expect(await prefixProblems("bz", names), t.id).toEqual([]);
      for (const n of names) expect(prefixName(n, "bz").length, n).toBeLessThanOrEqual(Math.max(16, n.length));
    }
  });

  it("refuses a prefix that is too long, that makes the game's own names, or that a name in the game already has", async () => {
    expect((await prefixProblems("brz", ["gui_boxes"]))[0]).toMatch(/1 or 2 letters/);
    // gu + inv's letter i: gui_stacksplit, a stock-looking name
    expect((await prefixProblems("gu", ["inv_stacksplit"]))[0]).toMatch(/gui_/);
    expect((await prefixProblems("zz", ["gui_boxes"], fakeGame((c) => c.set("zzg_boxes", RES_TYPES.tga!, frameTga()))))[0]).toMatch(/already has zzg_boxes/);
    // two names made one (a part with no letter of its own: its first letter)
    expect((await prefixProblems("zz", ["abc_x", "axe_x"])).join()).toMatch(/both become zza_x/);
  });
});

describe("export", () => {
  it("fails clearly without a game, and without a generator style", async () => {
    await expect(exportTheme({ project: builtIn("bronze"), resman: new ResMan() })).rejects.toThrow(ThemeError);
    await expect(exportTheme({ project: builtIn("bronze"), resman: new ResMan() })).rejects.toThrow(/no game/);
    await expect(exportTheme({ project: { ...builtIn("bronze"), style: null }, resman: fakeGame() })).rejects.toThrow(/generator style/);
  });

  it("output A: the NUI skin and the original GUI under the stock names, in a hak that reads back", async () => {
    const r = await exportTheme({ project: builtIn("bronze"), resman: fakeGame(), format: "tga" });
    const names = Object.keys(r.stock);
    for (const n of ["nui_skin.tml", "nui_windowh.tga", "nuio_philo_b.ttf", "ofl_nuio_philo_b.txt", "nuid_skin_lic.txt", "gui_boxes.dds", "gui_boxes.txi", "ctl_att.tga", "pnl_opt_gen.tga", "ctl_opt_gen.tga", "gui_slider.dds", "nui_slider.tga"]) {
      expect(names, n).toContain(n);
    }
    expect(r.reskin.manifest.textures.map((t) => t.name).sort()).toEqual(["ctl_att", "ctl_opt_gen", "gui_boxes", "gui_slider", "pnl_opt_gen"]);
    // the licence note says what is derived from the game
    const note = new TextDecoder().decode(r.stock["nuid_skin_lic.txt"]);
    expect(note).not.toMatch(/nothing in this export is Beamdog's/);
    expect(note).toMatch(/derived from\s+Beamdog's art[\s\S]*ctl_att\.tga/);
    // the report: what is left stock, by class
    expect(r.report).toMatch(/## Left stock/);
    expect(r.report).toMatch(/\| Cursors \| 30/);
    expect(r.report).toMatch(/\| Bitmap fonts \| 3/);
    expect(r.reskin.manifest.manual.length).toBe(MANUAL.length);

    const pkg = themePackage(r, { hak: "bz_theme", date: new Date(Date.UTC(2026, 10, 18)) });
    expect(Object.keys(pkg).filter((p) => !p.startsWith("stock/")).sort()).toEqual(["bz_theme.hak", "report.md", "reskin-manifest.json"]);
    const erf = await Erf.open(new MemorySource("bz_theme.hak", pkg["bz_theme.hak"]!));
    for (const [n, d] of Object.entries(r.stock)) {
      const [ref, ext] = splitFile(n);
      expect(await erf.get(ref, RES_TYPES[ext]!), n).toEqual(d);
    }
  });

  it("output B: the same files under the prefix, the skin naming its renamed files, and the manifest", async () => {
    const r = await exportTheme({ project: builtIn("bronze"), resman: fakeGame(), format: "tga", prefix: "bz" });
    const b = r.prefixed!;
    expect(Object.keys(b.files).length).toBe(Object.keys(r.stock).length);
    for (const n of Object.keys(b.files)) {
      expect(n.startsWith("bz") || n.startsWith("ofl_bz"), n).toBe(true);
      expect(splitFile(n)[0].length, n).toBeLessThanOrEqual(16);
    }
    const m = b.manifest;
    expect(m.skin).toEqual({ stock: "nui_skin", resref: "bzn_skin", restype: 2076 });
    expect(m.textures).toEqual({ ctl_att: "bzc_att", ctl_opt_gen: "bzc_opt_gen", gui_boxes: "bzg_boxes", gui_slider: "bzg_slider", pnl_opt_gen: "bzp_opt_gen" });
    expect(m.skinFiles.nui_slider).toBe("bzn_slider");
    expect(m.skinFiles.nuio_philo_b).toBe("bzo_philo_b");
    // the prefixed skin names only the prefixed files, and its fonts too
    const tml = new TextDecoder().decode(b.files["bzn_skin.tml"]);
    expect(tml).not.toMatch(/"nuio?_[a-z_]+"/);
    expect(tml).toContain('resref = "bzo_philo_b"');
    expect(tml).toContain('"bzn_windowh"');
    for (const ref of tml.matchAll(/"(bz[a-z]_[a-z0-9_]+)"/g)) expect(Object.keys(b.files).some((f) => splitFile(f)[0] === ref[1]), ref[1]).toBe(true);
    // the bytes are the stock output's
    expect(b.files["bzg_boxes.dds"]).toEqual(r.stock["gui_boxes.dds"]);
    expect(b.files["bzg_boxes.txi"]).toEqual(r.stock["gui_boxes.txi"]);
    expect(b.files["ofl_bzo_philo_b.txt"]).toEqual(r.stock["ofl_nuio_philo_b.txt"]);
    expect(r.report).toMatch(/Output B.*bzn_skin/);

    const pkg = themePackage(r, { hak: "bz_theme", prefixHak: "bz_theme_p" });
    expect(JSON.parse(new TextDecoder().decode(pkg["prefixed.json"]))).toEqual(m);
    expect(Object.keys(pkg).filter((p) => p.startsWith("prefixed/")).length).toBe(Object.keys(b.files).length);
    expect(pkg["bz_theme_p.hak"]).toBeDefined();
    expect(() => themePackage(r, { hak: "same", prefixHak: "same" })).toThrow(/different names/);
  });

  it("runs the original-GUI checks on output A and reports them", async () => {
    const r = await exportTheme({ project: builtIn("bronze"), resman: fakeGame(), format: "tga" });
    expect(Object.keys(r.checks.counts)).toEqual(["categories", "state icons", "fill bars", "coverage", "flatness", "fonts"]);
    // the synthetic game has no models, so its inventory knows none of the textures: coverage says so
    expect(r.checks.findings.find((f) => f.check === "coverage")?.message).toMatch(/the inventory has no such texture/);
    expect(r.report).toMatch(/## Original GUI checks[\s\S]*coverage: \d+ checked/);
  });

  it("the skin's font as the original GUI's three fonts, in output A only, its licence travelling with it", async () => {
    const r = await exportTheme({ project: builtIn("bronze"), resman: fakeGame(), format: "tga", prefix: "bz", oldGuiFonts: true });
    expect(r.fonts!.source).toBe(skinTextFont(builtIn("bronze").tml));
    const src = r.stock[`${r.fonts!.source}.ttf`]!;
    for (const n of ["fnt_maintext.ttf", "fnt_default.ttf", "fnt_default_hr.ttf"]) expect(r.stock[n], n).toEqual(src);
    expect(Object.keys(r.prefixed!.files).some((n) => n.includes("fnt_"))).toBe(false);
    expect(new TextDecoder().decode(r.stock["nuid_skin_lic.txt"])).toMatch(/fnt_maintext\.ttf, fnt_default\.ttf, fnt_default_hr\.ttf are copies/);
    expect(r.report).toMatch(/Old GUI fonts/);
    expect(r.checks.counts.fonts!.failed).toBe(0);
  });

  it("refuses the font option for a font whose licence is not known to allow shipping it", async () => {
    const p = builtIn("bronze");
    const font = skinTextFont(p.tml)!;
    const mine = { ...p, files: { ...p.files, [`${font}.ttf`]: { ...p.files[`${font}.ttf`]!, licence: "user" as const, data: new Uint8Array(64) } } };
    expect(() => oldGuiFonts(mine)).toThrow(FontExportError);
    await expect(exportTheme({ project: mine, resman: fakeGame(), oldGuiFonts: true })).rejects.toThrow(/old GUI fonts/);
    expect(fontLicence(p.files[`${font}.ttf`]!, font).ok).toBe(true);
  });

  it("a bad prefix stops the export before any work", async () => {
    await expect(exportTheme({ project: builtIn("bronze"), resman: fakeGame(), prefix: "gui" })).rejects.toThrow(/prefix/);
  });
});
