// Phase 3, the skin and font editor's core: the generator against the committed open skin, the checker, the
// format-keeping nui_skin.tml editor, the TGA, ERF and zip writers (against Python's build_hak.py and nwn_erf when
// they are here), the export plan (no Beamdog file ever goes out), the round trips, and the font panel's numbers.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { coverage, estimateAtlas, compareWidths } from "../src/core/font/fontinfo.js";
import { parseFace } from "../src/core/font/font.js";
import { Erf, MemoryContainer } from "../src/core/res/containers.js";
import { writeErf } from "../src/core/res/erfwrite.js";
import { ResMan } from "../src/core/res/resman.js";
import { RES_TYPES } from "../src/core/res/restype.js";
import { MemorySource } from "../src/core/res/source.js";
import { decodeTga } from "../src/core/res/tga.js";
import { encodeTga32 } from "../src/core/res/tgawrite.js";
import { crc32, readStoredZip, writeZip } from "../src/core/res/zip.js";
import { checkSkin, getPath } from "../src/core/skin/check.js";
import { buildOpenSkin, openSkinHakDescription, openSkinHakEntries, styleFontKeys, type FontSource } from "../src/core/skin/gen/ship.js";
import { DEFAULT_THEME, THEMES, type ThemeId, themeOf } from "../src/core/skin/themes.js";

/** The description build_hak.py wrote into the Bronze hak (it had one theme). */
const PY_HAK_DESCRIPTION =
  "nwn-nui-designer open skin: nui_skin.tml and textures CC0 1.0, fonts Philosopher Bold and JetBrains Mono SIL OFL 1.1 (see the nuio_skin_lic and ofl_* text resources).";
import { BRONZE, CLEAN, IRON, cloneStyle, styleTextures } from "../src/core/skin/gen/style.js";
import { PyRandom } from "../src/core/skin/gen/mt.js";
import { GROUPS, SKIN_KEYS } from "../src/core/skin/keys.js";
import { NINE_SLICE_KEYS, sliceSpec } from "../src/core/render/slice.js";
import { checkProject, exportHak, fromGameSkin, planExport, putFile, setFonts, setValue, fontsOf } from "../src/core/skin/project.js";
import { artDepth } from "../src/core/skin/slice.js";
import { TmlDoc, writeTml } from "../src/core/skin/tmldoc.js";
import { type TomlValue, parseToml } from "../src/core/skin/toml.js";
import type { Resources } from "../src/core/session.js";
import { findGame, openResources } from "../src/node/setup.js";
import { ROOT, bronzeProject, drawSheet, openSkinFiles, roundTripSkins, skinRoundTrip } from "./skinround.js";
import { SHEET_H, SHEET_W } from "../src/core/skin/sheet.js";
import { color } from "../src/core/skin/skin.js";

const SKIN = join(ROOT, "assets", "skin", "bronze");
const INK = join(ROOT, "assets", "skin", "ink");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const has = (cmd: string, args: string[]) => {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

describe("the generator (TypeScript port of draw.py and candidates.py)", () => {
  it("uses Python's random.Random for the noise", () => {
    // python3 -c "import random; r = random.Random(11); print([r.random() for _ in range(3)])"
    const r = new PyRandom(11);
    expect([r.random(), r.random(), r.random()]).toEqual([0.4523795535098186, 0.559772386080496, 0.9242105840237294]);
  });

  // Its own timeout: every built-in theme's textures generated and compared.
  it("draws every built-in theme byte for byte as its committed textures (assets/skin/<theme>)", () => {
    for (const t of THEMES) {
      const tex = styleTextures(t.style);
      expect(tex.size, t.id).toBe(t.id === "bronze" ? 32 : 33);
      for (const [name, im] of tex) expect(sha(encodeTga32(im)), `${t.id}/${name}`).toBe(sha(new Uint8Array(readFileSync(join(ROOT, "assets", "skin", t.id, `${name}.tga`)))));
    }
  }, 30_000);

  it("draws the B and D presets as Python's generator did (Pillow 13.0; sha256 of every TGA in name order)", () => {
    // From tools/open-skin/candidates.py at e38d1ca, run with Pillow 13.0.0 (2026-11-16), before the Python generator
    // was removed.
    const digest = (s: typeof CLEAN) => {
      const h = createHash("sha256");
      for (const [, im] of [...styleTextures(s)].sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.update(encodeTga32(im));
      return h.digest("hex");
    };
    expect(digest(CLEAN)).toBe("ad7449cfb9abee7bddfdd85477b3f1b89f68ddeddc9fd1b3eabc1e97f1406601");
    expect(digest(IRON)).toBe("7e54cab4f009d5b591f3cf1550204909ea7f32ebf8d3ad0e8e67cd684a7b7b65");
  });

  it("rebuilds every file of every built-in skin (pnpm skin ship --check), with their fonts pinned", () => {
    const src = parseToml(readFileSync(join(ROOT, "tools", "open-skin", "sources.toml"), "utf8")).fonts as unknown as Record<string, FontSource>;
    for (const t of THEMES) {
      const dir = join(ROOT, "assets", "skin", t.id);
      const out = buildOpenSkin({ style: t.style, fonts: src, cc0: readFileSync(join(ROOT, "tools", "open-skin", "CC0-1.0.txt"), "utf8") });
      for (const [n, d] of Object.entries(out)) expect(sha(d), `${t.id}/${n}`).toBe(sha(new Uint8Array(readFileSync(join(dir, n)))));
      for (const f of readdirSync(dir)) if (!f.endsWith(".ttf") && !f.startsWith("OFL-")) expect(out[f], `${t.id}/${f}`).toBeDefined();
      for (const key of styleFontKeys(t.style)) expect(sha(new Uint8Array(readFileSync(join(dir, `${src[key]!.resref}.ttf`)))), `${t.id}: ${key}`).toBe(src[key]!.sha256);
    }
    expect(readFileSync(join(INK, "nui_skin.tml"), "utf8")).toContain('resref = "nuio_brawler"');
  });

  it("a tweaked style regenerates (green Bronze) and keeps the slice margins' discipline", () => {
    const s = cloneStyle(BRONZE);
    s.rings = [
      [10, 30, 12],
      [40, 120, 50],
      [120, 220, 130],
    ];
    s.active_body = { ...s.active_body, top: [30, 80, 40], bottom: [16, 44, 20] };
    const tex = styleTextures(s);
    const btn = tex.get("nui_button_n")!;
    expect(Array.from(btn.data.slice(0, 4))).not.toEqual(Array.from(styleTextures(BRONZE).get("nui_button_n")!.data.slice(0, 4)));
    expect(artDepth(btn)).toEqual([3, 3, 3, 3]);
    expect(Math.max(...artDepth(tex.get("nui_button_h")!))).toBeLessThanOrEqual(7);
  });
});

describe("the built-in themes (themes.ts)", () => {
  it("are the five skins, Ink and brass first and the default, each with its own folder, fonts and hak", () => {
    expect(THEMES.map((t) => [t.id, t.title, t.hak])).toEqual([
      ["ink", "Ink and brass", "nuid_ink_skin"],
      ["bronze", "Bronze", "nuid_bronze_skin"],
      ["brass", "Brass and soot", "nuid_brass_skin"],
      ["verdigris", "Verdigris and paper", "nuid_verdi_skin"],
      ["oxblood", "Oxblood and rivets", "nuid_oxbld_skin"],
    ]);
    expect(DEFAULT_THEME).toBe("ink");
    expect(themeOf("nonsense").id).toBe("ink");
    expect(new Set(THEMES.map((t) => t.style.key)).size).toBe(THEMES.length);
    for (const t of THEMES) {
      expect(t.hak.length, t.id).toBeLessThanOrEqual(16);
      expect(t.look.length, t.id).toBeGreaterThan(10);
      expect(existsSync(join(ROOT, "assets", "skin", t.id, "nui_skin.tml")), t.id).toBe(true);
      expect(existsSync(join(ROOT, "assets", "skin", t.id, "LICENSE")), t.id).toBe(true);
      expect(readFileSync(join(ROOT, "assets", "skin", t.id, "PROVENANCE.md"), "utf8"), t.id).toContain(`preset \`${t.style.key}\``);
    }
  });

  it("pack as the same hak every time (a fixed date, as with SOURCE_DATE_EPOCH), with every resref at most 16 characters", () => {
    const src = parseToml(readFileSync(join(ROOT, "tools", "open-skin", "sources.toml"), "utf8")).fonts as unknown as Record<string, FontSource>;
    const hak = (id: ThemeId) => {
      const t = themeOf(id);
      const description = openSkinHakDescription(styleFontKeys(t.style).map((k) => src[k]!), t.title);
      return writeErf(openSkinHakEntries(openSkinFiles(t.id)), { fileType: "HAK", description, date: new Date(1763424000 * 1000) });
    };
    // sha256 of `SOURCE_DATE_EPOCH=1763424000 pnpm skin hak --theme <id>`: Ink and Bronze as before the steampunk skins.
    const pinned: Record<string, string> = {
      ink: "570e271d1a5a1b8ee403343b77706e900be34e83c400121612d3d318eb49f3a8",
      bronze: "9459aa250bc8daa4d6a21d7e7b044645812fccfc6dbc33b192261af68b391f45",
      brass: "b89971347e0beb568e5c550f4533d58353a96189435cb3afd7fab907bd21268c",
      verdigris: "9c8fefca09e15d2847824b1608d55450b85a42fa503da508e747494f512fc9a5",
      oxblood: "3e82f1b4f5ede22703285442e439129d1f140e79d61bba759c72d7151ee8ac8b",
    };
    for (const t of THEMES) {
      const a = hak(t.id);
      expect(sha(a), t.id).toBe(sha(hak(t.id)));
      expect(sha(a), t.id).toBe(pinned[t.id]);
      for (const e of openSkinHakEntries(openSkinFiles(t.id))) expect(e.resref.length, `${t.id}: ${e.resref}`).toBeLessThanOrEqual(16);
    }
  });
});

describe("the widget-states sheet", () => {
  // Its own timeout: every built-in skin opened and its whole sheet drawn.
  it("has a disabled row for every built-in skin: the normal art at 50 % over the window's background", async () => {
    for (const t of THEMES) {
      const res = await openResources({ game: null, fallback: true, theme: t.id });
      const sheet = await drawSheet(res);
      expect([sheet.width, sheet.height]).toEqual([SHEET_W, SHEET_H]);
      const px = (x: number, y: number) => Array.from(sheet.data.slice((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 3));
      const bg = color(res.skin.get("window.fixed_background") as string).slice(0, 3);
      // Inside the normal button (370, 46) and the disabled one (16, 728), 6 px in from the top left: no text there.
      const normal = px(376, 52);
      const disabled = px(22, 734);
      for (let c = 0; c < 3; c++) expect(Math.abs(disabled[c]! - (normal[c]! + bg[c]!) / 2), `${t.id}: channel ${c}`).toBeLessThanOrEqual(3);
      expect(disabled, t.id).not.toEqual(normal);
    }
  }, 30_000);
});

describe("the key model", () => {
  it("lists every key of tools/open-skin/skin_keys.py, in the client's order, with the same types and margins", () => {
    if (!has("python3", ["--version"])) return;
    const py = JSON.parse(
      execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'tools/open-skin'); import skin_keys; print(json.dumps(skin_keys.KEYS))"], { cwd: ROOT, encoding: "utf8" }),
    ) as [string, string, number[] | null, string][];
    expect(SKIN_KEYS.map((k) => k.key)).toEqual(py.map((k) => k[0]));
    expect(SKIN_KEYS.map((k) => k.type)).toEqual(py.map((k) => k[1]));
    expect(SKIN_KEYS.map((k) => (k.margins ? [...k.margins] : null))).toEqual(py.map((k) => k[2]));
  });

  it("its 9-slice keys are exactly the renderer's (render/slice.ts), with the renderer's margins", () => {
    expect(SKIN_KEYS.filter((k) => k.type === "image9").map((k) => k.key).sort()).toEqual([...NINE_SLICE_KEYS].sort());
    for (const k of SKIN_KEYS.filter((x) => x.type === "image9")) expect(k.margins, k.key).toEqual(sliceSpec(k.key)!.margins);
  });

  it("puts every key in a widget group", () => {
    const ids = new Set(GROUPS.map((g) => g.id));
    for (const k of SKIN_KEYS) expect(ids.has(k.group), k.key).toBe(true);
    for (const g of GROUPS) expect(SKIN_KEYS.some((k) => k.group === g.id), g.id).toBe(true);
  });
});

describe("the skin checker", () => {
  const bronze = () => new TmlDoc(readFileSync(join(SKIN, "nui_skin.tml"), "utf8"));

  it("passes the open skin with its files: no errors, no warnings", () => {
    const rm = new ResMan();
    const c = new MemoryContainer("skin");
    for (const f of readdirSync(SKIN)) {
      const m = /^(.+)\.(tga|ttf)$/.exec(f);
      if (m) c.set(m[1]!, RES_TYPES[m[2]!]!, new Uint8Array(1));
    }
    rm.layers = [{ kind: "memory", container: c }];
    const doc = bronze();
    const f = checkSkin(doc.data(), { resman: rm }, { literal: (k) => doc.literal(k) });
    expect(f.filter((x) => x.severity !== "note")).toEqual([]);
  });

  it("finds what the client would get wrong", () => {
    const doc = bronze();
    doc.set("button.hover", undefined); // missing
    doc.set("text.color", "#FFFFFF"); // no alpha
    doc.set("edit.normal", "#000000FF"); // a colour where only an image works
    doc.set("checkbox.normal", "a_texture_name_too_long"); // resref > 16
    doc.set("scrollh.border_color", "#FFFFFFFF"); // never read
    doc.set("chart.color", "#FFFFFFFF"); // never read under [chart]
    const t = doc.text().replace("  pixel_snap = true\n  oversample_h = 1.0", "  oversample_h = 1.5").replace("padding_x = 0", "padding_x = 2.5");
    const d2 = new TmlDoc(t);
    const codes = checkSkin(d2.data(), null, { literal: (k) => d2.literal(k) }).map((f) => `${f.severity}:${f.code}:${f.key}`);
    expect(codes).toContain("error:missing:button.hover");
    expect(codes).toContain("error:colour-no-alpha:text.color");
    expect(codes).toContain("error:colour-in-image9:edit.normal");
    expect(codes).toContain("warning:not-int:window.padding_x");
    expect(codes).toContain("error:resref-long:checkbox.normal");
    expect(codes).toContain("note:unread:scrollh.border_color");
    expect(codes).toContain("note:unread:chart.color");
    expect(codes).toContain("error:font-snap:fonts[0]");
    expect(codes).toContain("note:font-value:fonts[0].oversample_h");
  });

  it("an int written as 3.0 is a float to cpptoml", () => {
    const doc = new TmlDoc("[window]\npadding_x = 3.0\n");
    expect(checkSkin(doc.data(), null, { literal: (k) => doc.literal(k) }).some((f) => f.code === "not-int")).toBe(true);
  });

  it("missing textures and fonts, two formats under one name, and a PNG the game's TGA beats", () => {
    const own = new MemoryContainer("my hak");
    own.set("nui_button_h", RES_TYPES.png!, new Uint8Array(1)); // beaten by the game's TGA
    own.set("nui_windowh", RES_TYPES.tga!, new Uint8Array(1));
    own.set("nui_windowh", RES_TYPES.dds!, new Uint8Array(1)); // two formats (own)
    const game = new MemoryContainer("data/nwn_base.key");
    for (const t of ["nui_button_h", "nui_button_n", "nui_button_a", "nui_close"]) game.set(t, RES_TYPES.tga!, new Uint8Array(1));
    const rm = new ResMan();
    rm.layers = [
      { kind: "hak", container: own },
      { kind: "key", container: game },
    ];
    const doc = bronze();
    const f = checkSkin(doc.data(), { resman: rm, isOwn: (l) => l.container === own });
    const by = (code: string) => f.filter((x) => x.code === code).map((x) => x.key);
    expect(by("beaten")).toEqual(["nui_button_h"]);
    expect(by("formats")).toEqual(expect.arrayContaining(["nui_button_h", "nui_windowh"]));
    expect(by("texture-missing")).toContain("nui_scrollv");
    expect(by("font-missing")).toEqual(["fonts[0].resref", "fonts[1].resref"]);
  });
});

describe("nui_skin.tml editing keeps the file", () => {
  const SRC = `# A hand-written skin.
background_color = "#000000FF" # charts

[[fonts]]
  name = "(default)"   # the UI font
  resref = "fnt_maintext"
  pixel_snap = true
  font_size = 17.0

# Our title font.
[[fonts]]
  name = "title"
  resref = "fnt_title"
  pixel_snap = true

[window]
fixed_background = "#000000FF"  # black
header.normal = "nui_windowh"

[button]
normal = "nui_button_n"
`;

  it("writes back exactly what it read", () => {
    expect(new TmlDoc(SRC).text()).toBe(SRC);
    const bronze = readFileSync(join(SKIN, "nui_skin.tml"), "utf8");
    expect(new TmlDoc(bronze).text()).toBe(bronze);
  });

  it("changes a value in its line, keeping the comment", () => {
    const d = new TmlDoc(SRC);
    d.set("window.fixed_background", "#102030FF");
    expect(d.text()).toContain('fixed_background = "#102030FF"  # black');
    expect(d.text().split("\n").length).toBe(SRC.split("\n").length);
  });

  it("adds a key next to its siblings, in their style, and removes one", () => {
    const d = new TmlDoc(SRC);
    d.set("window.header.hover", "nui_windowh");
    d.set("button.hover", "nui_button_h");
    d.set("edit.normal", "nui_windowh");
    d.set("text.color", "#FFFFFFFF");
    d.set("color", "#F0F0F0FF");
    const t = d.text();
    expect(t).toContain('header.normal = "nui_windowh"\nheader.hover = "nui_windowh"');
    expect(t).toContain('normal = "nui_button_n"\nhover = "nui_button_h"');
    expect(t).toContain('[edit]\nnormal = "nui_windowh"');
    expect(t).toContain('background_color = "#000000FF" # charts\ncolor = "#F0F0F0FF"');
    const v = d.data();
    expect(getPath(v, "window.header.hover")).toBe("nui_windowh");
    expect(getPath(v, "text.color")).toBe("#FFFFFFFF");
    d.set("button.hover", undefined);
    expect(d.text()).not.toContain("nui_button_h");
  });

  it("reorders, edits, adds and removes fonts, keeping each block's comments", () => {
    const d = new TmlDoc(SRC);
    const [a, b] = d.fonts();
    d.setFonts([
      { values: { ...b!, font_size: 22 }, source: 1 },
      { values: a!, source: 0 },
      { values: { name: "mono", resref: "jbmonoreg", pixel_snap: true, font_size: 17 } },
    ]);
    const t = d.text();
    expect(t.indexOf("# Our title font.")).toBeLessThan(t.indexOf('name = "(default)"'));
    expect(t).toContain('name = "(default)"   # the UI font');
    expect(t).toContain("  font_size = 22.0");
    const f = d.fonts().map((x) => x.name);
    expect(f).toEqual(["title", "(default)", "mono"]);
    d.setFonts([{ values: d.fonts()[1]!, source: 1 }]);
    expect(d.fonts().map((x) => x.name)).toEqual(["(default)"]);
    expect(d.text()).toContain("[window]");
  });

  it("writes a new file in the generator's layout (the committed nui_skin.tml)", () => {
    const bronze = readFileSync(join(SKIN, "nui_skin.tml"), "utf8");
    const doc = new TmlDoc(bronze);
    const flat: Record<string, TomlValue> = {};
    for (const k of SKIN_KEYS) {
      const v = getPath(doc.data(), k.key);
      if (v !== undefined) flat[k.key] = v;
    }
    expect(writeTml(flat, doc.fonts(), bronze.split("\n").slice(0, 3).join("\n"))).toBe(bronze);
  });
});

describe("writers", () => {
  it("TGA: 32-bit, bottom-left, Pillow's footer; reads back", () => {
    const im = { width: 3, height: 2, data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]) };
    const b = encodeTga32(im);
    expect(b[17]).toBe(8);
    expect(new TextDecoder().decode(b.slice(-18))).toBe("TRUEVISION-XFILE.\0");
    expect(Array.from(decodeTga(b).data)).toEqual(Array.from(im.data));
  });

  it("zip: stored entries with CRC-32, read back", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const e = [
      { name: "nui_skin.tml", data: new TextEncoder().encode("x = 1\n") },
      { name: "a.tga", data: new Uint8Array([1, 2, 3]) },
    ];
    expect(readStoredZip(writeZip(e)).map((x) => [x.name, Array.from(x.data)])).toEqual(e.map((x) => [x.name, Array.from(x.data)]));
  });

  it("ERF: reads back with the designer's reader", async () => {
    const hak = writeErf(openSkinHakEntries(openSkinFiles()), { description: PY_HAK_DESCRIPTION, date: new Date(Date.UTC(2026, 10, 16)) });
    const erf = await Erf.open(new MemorySource("x.hak", hak));
    expect(erf.fileType).toBe("HAK ");
    const files = openSkinFiles();
    expect([...erf.entries()].length).toBe(Object.keys(files).length);
    expect(Array.from((await erf.get("nui_button_n", RES_TYPES.tga!))!)).toEqual(Array.from(files["nui_button_n.tga"]!));
    expect(Array.from((await erf.get("nuio_skin_lic", RES_TYPES.txt!))!)).toEqual(Array.from(files.LICENSE!));
  });

  it("ERF: the same bytes as Python's build_hak.py for the open skin", () => {
    if (!has("python3", ["--version"]) || !has("git", ["-C", ROOT, "cat-file", "-e", "e38d1ca:tools/open-skin/build_hak.py"])) return;
    const dir = mkdtempSync(join(tmpdir(), "nuid-hak-"));
    try {
      // build_hak.py as it was when the Python tools were the reference (removed in phase 3).
      writeFileSync(join(dir, "build_hak.py"), execFileSync("git", ["-C", ROOT, "show", "e38d1ca:tools/open-skin/build_hak.py"]));
      execFileSync("python3", [join(dir, "build_hak.py"), "--skin", SKIN, "-o", join(dir, "py.hak")], { env: { ...process.env, SOURCE_DATE_EPOCH: "1763251200" } });
      const ts = writeErf(openSkinHakEntries(openSkinFiles()), { fileType: "HAK", description: PY_HAK_DESCRIPTION, date: new Date(1763251200 * 1000) });
      expect(sha(ts)).toBe(sha(new Uint8Array(readFileSync(join(dir, "py.hak")))));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ERF: neverwinter.nim's nwn_erf lists and extracts it byte for byte", () => {
    const tool = ["/opt/nwn-tools/neverwinter-2.3.2/nwn_erf", "nwn_erf"].find((t) => has(t, ["--help"]));
    if (!tool) return;
    const dir = mkdtempSync(join(tmpdir(), "nuid-erf-"));
    try {
      const p = bronzeProject();
      const hak = exportHak(planExport(p), p.name);
      writeFileSync(join(dir, "skin.hak"), hak);
      const listing = execFileSync(tool, ["-f", join(dir, "skin.hak"), "-t"], { encoding: "utf8" });
      expect(listing).toContain("nui_skin.tml");
      expect(listing).toContain("nui_button_n.tga");
      execFileSync(tool, ["-f", join(dir, "skin.hak"), "-x"], { cwd: dir });
      for (const i of planExport(p).items) expect(sha(new Uint8Array(readFileSync(join(dir, `${i.resref}.${i.ext}`)))), i.file).toBe(sha(i.data));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("export", () => {
  it("Bronze: the skin, its textures, its fonts with their OFL texts and a licence note", () => {
    const plan = planExport(bronzeProject());
    const files = plan.items.map((i) => i.file);
    expect(files).toContain("nui_skin.tml");
    expect(files).toContain("nui_button_n.tga");
    expect(files).toContain("nuio_philo_b.ttf");
    expect(files).toContain("ofl-nuio_philo_b.txt");
    expect(files).toContain("nuid_skin_lic.txt");
    expect(plan.note).toContain("CC0 1.0");
    expect(plan.note).toContain("SIL Open Font License");
    expect(plan.leftOut).toEqual([]);
    for (const i of plan.items) expect(i.resref.length, i.file).toBeLessThanOrEqual(16);
  });

  it("never bundles a file the user did not bring: the game's textures and fonts are left out and listed", async () => {
    const game = new MemoryContainer("data/nwn_base.key");
    game.set("nui_windowh", RES_TYPES.tga!, new Uint8Array([9]));
    game.set("fnt_maintext", RES_TYPES.ttf!, new Uint8Array([9]));
    const rm = new ResMan();
    rm.layers = [{ kind: "key", container: game }];
    let p = fromGameSkin('[[fonts]]\n  name = "(default)"\n  resref = "fnt_maintext"\n  pixel_snap = true\n\n[window]\nborder_image = "nui_windowh"\n[button]\nnormal = "my_button"\n', "the game");
    p = putFile(p, "my_button.tga", { data: new Uint8Array([1, 2]), licence: "user", from: "uploaded" });
    p = putFile(p, "unused.tga", { data: new Uint8Array([3]), licence: "user", from: "uploaded" });
    const plan = planExport(p, rm);
    expect(plan.items.map((i) => i.file).sort()).toEqual(["my_button.tga", "nui_skin.tml", "nuid_skin_lic.txt", "unused.tga"]);
    expect(plan.leftOut.map((l) => l.name).sort()).toEqual(["fnt_maintext.ttf", "nui_windowh"]);
    expect(plan.leftOut.find((l) => l.name === "nui_windowh")!.reason).toContain("the game's");
  });

  it("restyles a button and finds the problems through the project", () => {
    let p = bronzeProject();
    p = setValue(p, "button.hover", "#FF000080");
    expect(checkProject(p, null).some((f) => f.code === "colour-in-image9" && f.key === "button.hover")).toBe(true);
    p = setValue(p, "button.hover", "nui_button_a");
    expect(checkProject(p, null).filter((f) => f.severity === "error")).toEqual([]);
    p = setFonts(p, [...fontsOf(p), { values: { name: "big", resref: "nuio_philo_b", pixel_snap: true, font_size: 24 } }]);
    expect(fontsOf(p).map((f) => f.values.name)).toEqual(["(default)", "(monospace)", "big"]);
  });
});

describe("round trips (export as a hak, read back: same model, same pictures)", () => {
  let skins: Awaited<ReturnType<typeof roundTripSkins>> = [];
  beforeAll(async () => {
    skins = await roundTripSkins();
  }, 120_000);
  const window = () => {
    const gods = join(ROOT, "local", "dumps", "gods.json");
    return existsSync(gods) ? gods : join(ROOT, "fixtures", "widgets.jui");
  };

  for (const name of ["ink", "bronze", "game", "layonara"]) {
    it(name, async (ctx) => {
      const s = skins.find((x) => x.name === name);
      if (!s) return ctx.skip(); // local only: no game folder or no nwn-haks here
      const r = await skinRoundTrip(s.project, s.base, window());
      expect(r).toMatchObject({ tml: true, values: true, files: true, zip: true, window: true, sheet: true });
      if (name === "bronze" || name === "ink") expect(r.leftOut).toEqual([]);
      if (name === "game") expect(r.leftOut.length).toBeGreaterThan(20); // every texture and font is Beamdog's
    }, 120_000);
  }
});

describe("fonts", () => {
  const philo = parseFace(new Uint8Array(readFileSync(join(SKIN, "nuio_philo_b.ttf"))), "nuio_philo_b");
  const mono = parseFace(new Uint8Array(readFileSync(join(SKIN, "nuio_jbmono.ttf"))), "nuio_jbmono");

  it("covers the Western code page (U+0020-00FF, printable)", () => {
    const c = coverage(philo, "cp1252");
    expect(c.total).toBe(95 + 94);
    expect(c.missing).toEqual([]);
    expect(coverage(mono, "cp1250").missing.length).toBeGreaterThan(0);
  });

  it("estimates the atlas the client bakes", () => {
    const a = estimateAtlas([
      { face: philo, size: 17, oversampleH: 1, oversampleV: 1 },
      { face: mono, size: 17, oversampleH: 1, oversampleV: 1 },
    ]);
    expect(a.width).toBe(512);
    expect([128, 256]).toContain(a.height);
    const big = estimateAtlas([{ face: philo, size: 17, oversampleH: 3, oversampleV: 3 }]);
    expect(big.height * big.width).toBeGreaterThan(a.width * a.height / 2);
  });

  it("compares widths with the stock font under both text models", async () => {
    const game = findGame();
    if (!game) return;
    const res: Resources = await openResources({ game });
    const ttf = await res.resman.get("fnt_maintext", "ttf");
    if (!ttf) return;
    const stock = parseFace(ttf, "fnt_maintext");
    // docs/OPEN-SKIN.md: Philosopher Bold is within 4 % of stock under both models (Nuklear's is the client's).
    for (const model of ["nuklear", "nui-preview"] as const) {
      const c = compareWidths(philo, stock, 17, 0.5, 0.5, model);
      expect(Math.abs(c.ratio - 1), model).toBeLessThan(0.06);
    }
  });
});
