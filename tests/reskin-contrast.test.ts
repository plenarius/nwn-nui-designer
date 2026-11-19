// The reskin's contrast and row-order checks, from the first in-game test of pnpm reskin (2026-11-18): Bronze's
// original GUI lost its rules and dividers (the character record's row rules, the tab rows, the inventory's bevels).
// The stock draws them with one grey (#636563) at alpha 255 against the same grey at 64 and 102 and against black; the
// opaque alpha curve raised 64 and 102 to 228 and 235, and Bronze's near-black ink, title and button bodies took the
// grey to the same colour as the fill. Every texture here is synthetic: no game art.
import { describe, expect, it } from "vitest";
import { type RGBAImage, newImage } from "../src/core/res/image.js";
import { decodeTga } from "../src/core/res/tga.js";
import { encodeBiowareDds } from "../src/core/reskin/bc.js";
import { type ColourMap, TAB_STRIPS, alphaCurve, ladder, lum, swatchColour, frameColour } from "../src/core/reskin/colour.js";
import { type ReskinPalette, paletteFromStyle } from "../src/core/reskin/palette.js";
import { mapPicture, retoneDds, retoneTga } from "../src/core/reskin/retone.js";
import { decodeTexture, edgeContrast, validateTexture } from "../src/core/reskin/validate.js";
import { BRONZE, CLEAN, VERDIGRIS } from "../src/core/skin/gen/style.js";
import { THEMES } from "../src/core/skin/themes.js";

/** A strip laid out like gui_boxes_ingame's grey cells: fill at 102, rule at 255, fill at 64, black, a light rule. */
function ruleStrip(): RGBAImage {
  const cells: [number, number, number, number][] = [
    [99, 101, 99, 102],
    [99, 101, 99, 255],
    [0, 0, 0, 255],
    [99, 101, 99, 64],
    [99, 101, 99, 255],
    [0, 0, 0, 191],
    [255, 255, 255, 48],
    [0, 0, 0, 0],
  ];
  const im = newImage(32, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) im.data.set(cells[x >> 2]!, (y * 32 + x) * 4);
  return im;
}

/** #44's swatch mapping for a grey: the neutral ramp by raw luminance, with the skin's own (near-black) bodies. */
function mapping44(style: typeof BRONZE): ColourMap {
  const p = paletteFromStyle(style);
  return (r, g, b) => {
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    if (L > 180) return p.accent;
    const t = Math.min(1, L / 99);
    return [0, 1, 2].map((k) => p.ink[k]! + (p.raised[k]! - p.ink[k]!) * t) as [number, number, number];
  };
}

/** An uncompressed 24-bit TGA of a picture, bottom-up (origin bit clear) or top-down (bit 5 set). */
function tgaOf(im: RGBAImage, topDown: boolean): Uint8Array {
  const out = new Uint8Array(18 + im.width * im.height * 3);
  out[2] = 2;
  out[12] = im.width;
  out[14] = im.height;
  out[16] = 24;
  out[17] = topDown ? 0x20 : 0;
  for (let row = 0; row < im.height; row++) {
    const y = topDown ? row : im.height - 1 - row;
    for (let x = 0; x < im.width; x++) {
      const s = (y * im.width + x) * 4;
      const o = 18 + (row * im.width + x) * 3;
      out[o] = im.data[s + 2]!;
      out[o + 1] = im.data[s + 1]!;
      out[o + 2] = im.data[s]!;
    }
  }
  return out;
}

/** A frame with a different top and bottom: a rule along the top, a blue band at the bottom. */
function frame(): RGBAImage {
  const im = newImage(16, 16, [0, 0, 0, 255]);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const c = y === 1 ? [189, 146, 74, 255] : y >= 12 ? [30, 50, 90, 255] : x === 3 ? [99, 101, 99, 255] : [0, 0, 0, 255];
      im.data.set(c, (y * 16 + x) * 4);
    }
  }
  return im;
}

describe("rules and dividers stay visible", () => {
  const curve = alphaCurve("opaque");
  const stock = encodeBiowareDds(ruleStrip(), 4);

  it("the check fails #44's Bronze mapping: rule and fill flattened to one near-black", () => {
    const mapped = mapPicture(decodeTexture(stock, "dds"), mapping44(BRONZE), curve);
    const out = retoneDds(stock, mapping44(BRONZE), curve).bytes;
    const v = validateTexture(stock, out, "dds", { alpha: curve, alphaTolerance: 16, minCorr: 0.7, mapped });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/strong edges flattened/);
    expect(v.edges!.strongLost.join(" ")).toMatch(/#636563FF/);
  });

  it("Bronze and Ink and brass now keep every strong edge, and the rule stands off the fill", () => {
    for (const style of [BRONZE, CLEAN]) {
      const p = paletteFromStyle(style);
      const map = swatchColour(p, "gui_boxes_ingame", "opaque");
      const mapped = mapPicture(decodeTexture(stock, "dds"), map, curve);
      const out = retoneDds(stock, map, curve).bytes;
      const v = validateTexture(stock, out, "dds", { alpha: curve, alphaTolerance: 16, minCorr: 0.7, mapped });
      expect(v.problems, style.key).toEqual([]);
      expect(v.edges!.strongLost).toEqual([]);
      // the rule (#636563 at 255) and the fill (#636563 at 102) as they show over black: well apart
      const at = (x: number) => mapped.data.subarray(x * 4, x * 4 + 4);
      const shown = (c: Uint8ClampedArray) => (lum(Array.from(c.subarray(0, 3))) * c[3]!) / 255;
      expect(shown(at(4)) - shown(at(0)), style.key).toBeGreaterThan(40);
    }
  });

  it("the ladder lifts a near-black skin's steps and leaves Ink and brass's own", () => {
    const b = paletteFromStyle(BRONZE);
    const lb = ladder(b);
    expect(lum(lb.raised) - lum(b.ink)).toBeGreaterThanOrEqual(14);
    expect(lum(lb.rule) - lum(b.ink)).toBeGreaterThanOrEqual(64);
    const i = paletteFromStyle(CLEAN);
    expect(ladder(i).raised).toEqual(i.raised);
    expect(ladder(i).button).toEqual(i.button);
    // every built-in skin: the rule differs from ink, whichever way (Verdigris is light)
    for (const t of THEMES) {
      const p = paletteFromStyle(t.style);
      expect(Math.abs(lum(ladder(p).rule) - lum(p.ink)), t.id).toBeGreaterThanOrEqual(40);
    }
  });

  it("a translucent grey border stays apart from its black field (inventory cells)", () => {
    const im = newImage(8, 8, [0, 0, 0, 161]);
    for (let i = 0; i < 8; i++) im.data.set([99, 97, 99, 192], i * 4);
    const p = paletteFromStyle(BRONZE);
    const out = mapPicture(im, frameColour(p, "gui_inv_unhilite"), null);
    expect(edgeContrast(im, out).lost).toBe(0);
  });
});

describe("tab strip outlines stay clear of the background", () => {
  // The tab strips draw each tab's outline in the stock mid grey (#636563, opaque or at alpha 100-109) on black. As a
  // fill's grey it lands on the raised step; a skin whose raised colour is darker than its background (Oxblood's
  // #341012 title body on its #581A1C window) lost the outline. Synthetic palette and texture, no game art.
  const oxbloodLike: ReskinPalette = {
    ink: [0x58, 0x1a, 0x1c],
    raised: [0x34, 0x10, 0x12],
    button: [0x6a, 0x22, 0x22],
    activeLo: [0x4a, 0x37, 0x1b],
    active: [0x60, 0x48, 0x24],
    accent: [0xc0, 0x96, 0x5a],
    glow: [0xf0, 0xcc, 0x82],
    glowHi: [0xff, 0xe8, 0xb0],
    mark: [0xea, 0xce, 0x96],
    text: [0xf0, 0xe0, 0xc0],
    bodyAlpha: 255,
  };
  /** A tab: a black field with a one-texel grey outline at the given alpha. */
  const tab = (a: number): RGBAImage => {
    const im = newImage(16, 8, [0, 0, 0, 255]);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) if (!y || y === 7 || !x || x === 15) im.data.set([99, 101, 99, a], (y * 16 + x) * 4);
    return im;
  };

  it("an outline that would land near the background takes the rule step instead (an Oxblood-like skin)", () => {
    const p = oxbloodLike;
    expect(lum(p.raised)).toBeLessThan(lum(p.ink));
    const inkL = lum(p.ink);
    for (const a of [255, 100, 109]) {
      // as a frame's grey, the outline sits within a few steps of the background: the bug
      const asFrame = frameColour(p, "ctl_att")(99, 101, 99, a);
      expect(Math.abs(lum(asFrame) - inkL), `alpha ${a}`).toBeLessThan(64);
      for (const name of TAB_STRIPS) {
        const c = frameColour(p, name)(99, 101, 99, a);
        expect(c, `${name} alpha ${a}`).toEqual(ladder(p).rule);
        expect(Math.abs(lum(c) - inkL)).toBeGreaterThanOrEqual(64);
      }
    }
    // the black field and the other textures are untouched
    expect(frameColour(p, "gui_ig_chartabs")(0, 0, 0, 255)).toEqual(frameColour(p, "ctl_att")(0, 0, 0, 255));
    const out = mapPicture(tab(255), frameColour(p, "gui_ig_jourtabs"), null);
    expect(edgeContrast(tab(255), out).lost).toBe(0);
  });

  it("an outline already clear of the background keeps the frame's colour (Brass); Bronze's gets lighter", () => {
    const brass = paletteFromStyle(THEMES.find((t) => t.id === "brass")!.style);
    expect(frameColour(brass, "gui_ig_chartabs")(99, 101, 99, 255)).toEqual(frameColour(brass, "ctl_att")(99, 101, 99, 255));
    const bronze = paletteFromStyle(BRONZE);
    expect(frameColour(bronze, "gui_pre_playtabs")(99, 101, 99, 255)).toEqual([0x50, 0x42, 0x2a]);
  });
});

describe("TGA row order", () => {
  for (const topDown of [false, true]) {
    it(`a recoloured TGA keeps the stock descriptor and reads back the right way up (${topDown ? "top-down" : "bottom-up"} stock)`, () => {
      const pic = frame();
      const stock = tgaOf(pic, topDown);
      const p = paletteFromStyle(BRONZE);
      const out = retoneTga(stock, frameColour(p, "ctl_att")).bytes;
      expect(out[17]).toBe(stock[17]); // origin bit and alpha bits as the stock file
      expect(out.subarray(0, 18)).toEqual(stock.subarray(0, 18));
      // read back through the reader the resource path uses: the rule on row 1, the blue band at the bottom
      const back = decodeTga(out);
      const want = mapPicture(decodeTga(stock), frameColour(p, "ctl_att"), null);
      expect(Array.from(back.data.subarray(0, back.data.length).filter((_, i) => i % 4 !== 3))).toEqual(
        Array.from(want.data.filter((_, i) => i % 4 !== 3)).map((v) => Math.min(255, Math.max(0, Math.round(v)))),
      );
      expect(validateTexture(stock, out, "tga").problems).toEqual([]);
    });
  }

  it("the check catches a TGA whose rows run the wrong way (origin bit flipped)", () => {
    const stock = tgaOf(frame(), false);
    const wrong = tgaOf(frame(), false);
    wrong[17] = 0x20; // same bytes, read top-down: upside down
    const v = validateTexture(stock, wrong, "tga");
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/header|upside down/);
    // and with the header put back but the rows reversed
    const rows = tgaOf(frame(), true);
    rows[17] = 0;
    const v2 = validateTexture(stock, rows, "tga");
    expect(v2.upsideDown).toBe(true);
  });

  it("a light skin inverts the luminance on purpose: judged on the mapped picture it passes, and a flip is still caught", () => {
    const stock = tgaOf(frame(), false);
    const map = frameColour(paletteFromStyle(VERDIGRIS), "ctl_att");
    const out = retoneTga(stock, map).bytes;
    const mapped = mapPicture(decodeTga(stock), map, null);
    // against the stock picture the paper field reads as a layout change (what flagged 83 of Verdigris's textures)
    expect(validateTexture(stock, out, "tga").lumaCorr!).toBeLessThan(0);
    const v = validateTexture(stock, out, "tga", { mapped });
    expect(v.problems).toEqual([]);
    expect(v.mappedCorr!).toBeGreaterThan(0.99);
    // the same file with its rows reversed still fails
    const flipped = tgaOf(decodeTga(out), true);
    flipped[17] = 0;
    const w = validateTexture(stock, flipped, "tga", { mapped });
    expect(w.upsideDown).toBe(true);
    expect(w.ok).toBe(false);
  });
});
