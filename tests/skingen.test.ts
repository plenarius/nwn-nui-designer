// The generator's steampunk primitives (pipes, rivets, streaked and grained fills) and the three candidate presets.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newImage } from "../src/core/res/image.js";
import { RIM_MARGIN, fill, pipe, pipeProfile, rivets, valueNoise } from "../src/core/skin/gen/draw.js";
import { type FontSource, buildOpenSkin, styleFontKeys } from "../src/core/skin/gen/ship.js";
import { BRASS, OXBLOOD, PRESETS, VERDIGRIS, styleTextures, styleValues } from "../src/core/skin/gen/style.js";
import { parseToml } from "../src/core/skin/toml.js";

const ROOT = join(import.meta.dirname, "..");
const px = (im: { width: number; data: Uint8ClampedArray }, x: number, y: number) => [...im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];
const lum = (c: number[]) => c[0]! + c[1]! + c[2]!;

describe("pipes", () => {
  it("light the tube from the top left: highlight on the outside of the top pipe, the inside of the bottom one", () => {
    const im = newImage(20, 20, [0, 0, 0, 255]);
    pipe(im, { color: [150, 110, 50], width: 3 });
    const top = [0, 1, 2].map((y) => lum(px(im, 10, y)));
    const bottom = [19, 18, 17].map((y) => lum(px(im, 10, y)));
    expect(top[0]! > top[2]!).toBe(true);
    expect(bottom[2]! > bottom[0]!).toBe(true);
    // Nothing drawn past the margin.
    expect(px(im, 10, 3)).toEqual([0, 0, 0, 255]);
    expect(px(im, 3, 10)).toEqual([0, 0, 0, 255]);
  });

  it("stay within the client's 3 px margin", () => {
    const im = newImage(20, 20);
    expect(() => pipe(im, { color: [1, 1, 1], width: 3, inset: 1 })).toThrow(/margin/);
    expect(() => pipe(im, { color: [1, 1, 1], width: 0 })).toThrow(/margin/);
    expect(() => rivets(im, [1, 1, 1], 4)).toThrow(/margin/);
    expect(RIM_MARGIN).toBe(3);
  });

  it("have a profile that falls from the lit side to the shadow side", () => {
    const p = pipeProfile(3, 0.5, 0.6);
    expect(p[0]! > 0 && p[2]! < 0).toBe(true);
    expect(pipeProfile(1, 0.5, 0.6)).toHaveLength(1);
  });
});

describe("rivets", () => {
  it("draw a stud in each corner, inside the margin, and nothing between", () => {
    const im = newImage(16, 16, [0, 0, 0, 255]);
    rivets(im, [200, 160, 80]);
    for (const [x, y] of [
      [1, 1],
      [14, 1],
      [1, 14],
      [14, 14],
    ]) expect(lum(px(im, x!, y!))).toBeGreaterThan(100);
    expect(px(im, 8, 1)).toEqual([0, 0, 0, 255]);
    expect(px(im, 3, 3)).toEqual([0, 0, 0, 255]);
  });
});

describe("fills", () => {
  it("streak 1 is the round noise the shipped skins use", () => {
    expect([...valueNoise(32, 32, 5, 8, 3, 1)]).toEqual([...valueNoise(32, 32, 5, 8, 3)]);
  });

  it("streak > 1 varies less along a row than down a column (brushed metal)", () => {
    const n = valueNoise(64, 64, 3, 8, 1, 8);
    let dx = 0;
    let dy = 0;
    for (let y = 0; y < 63; y++) for (let x = 0; x < 63; x++) {
      dx += Math.abs(n[y * 64 + x + 1]! - n[y * 64 + x]!);
      dy += Math.abs(n[(y + 1) * 64 + x]! - n[y * 64 + x]!);
    }
    expect(dx * 3).toBeLessThan(dy);
  });

  it("grain is seeded: the same spec draws the same pixels, another seed others", () => {
    const a = fill(16, 16, { top: [120, 100, 80], grain: 0.1, seed: 4 });
    const b = fill(16, 16, { top: [120, 100, 80], grain: 0.1, seed: 4 });
    const c = fill(16, 16, { top: [120, 100, 80], grain: 0.1, seed: 5 });
    expect([...a.data]).toEqual([...b.data]);
    expect([...a.data]).not.toEqual([...c.data]);
    expect(new Set(Array.from({ length: 256 }, (_, i) => a.data[i * 4])).size).toBeGreaterThan(3);
  });
});

describe("the steampunk candidates", () => {
  const src = parseToml(readFileSync(join(ROOT, "tools", "open-skin", "sources.toml"), "utf8")).fonts as unknown as Record<string, FontSource>;

  it("are presets with every font pinned in sources.toml, resrefs of 16 characters or less", () => {
    for (const s of [BRASS, VERDIGRIS, OXBLOOD]) {
      expect(PRESETS).toContain(s);
      for (const k of styleFontKeys(s)) {
        expect(src[k], `${s.key}: [fonts.${k}]`).toBeDefined();
        expect(src[k]!.resref.length).toBeLessThanOrEqual(16);
        expect(src[k]!.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it("write the text font at its size and the display font as a third [[fonts]] entry", () => {
    const out = buildOpenSkin({ style: VERDIGRIS, fonts: src, cc0: "" });
    const tml = parseToml(new TextDecoder().decode(out["nui_skin.tml"]!));
    const fonts = tml.fonts as unknown as { name: string; resref: string; font_size: number }[];
    expect(fonts.map((f) => [f.name, f.resref, f.font_size])).toEqual([
      ["(default)", "nuio_spectsb", 19],
      ["(monospace)", "nuio_jbmono", 17],
      ["display", "nuio_federnt", 22],
    ]);
    expect(new TextDecoder().decode(out.LICENSE!)).toContain("nuio_federnt.ttf");
  });

  it("draw every texture, and the light one keeps dark text on hover and pressed", () => {
    for (const s of [BRASS, VERDIGRIS, OXBLOOD]) expect(styleTextures(s).size).toBeGreaterThanOrEqual(33);
    const v = styleValues(VERDIGRIS);
    expect(v["button.text_hover"]).toBe("#120A04FF");
    expect(v["button.text_active"]).toBe("#120A04FF");
  });
});
