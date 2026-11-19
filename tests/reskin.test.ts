// pnpm reskin's core (src/core/reskin/): the palette from a skin, the recolours, the DDS and TGA it writes, the hak,
// the manifest and the checks. Every texture here is synthetic, made in the test: no game art.
import { describe, expect, it } from "vitest";
import { Erf, MemoryContainer } from "../src/core/res/containers.js";
import { decodeDds } from "../src/core/res/dds.js";
import { type RGBAImage, newImage } from "../src/core/res/image.js";
import { ResMan } from "../src/core/res/resman.js";
import { RES_TYPES } from "../src/core/res/restype.js";
import { MemorySource } from "../src/core/res/source.js";
import { decodeTga } from "../src/core/res/tga.js";
import { BIOWARE_DDS_HEADER, blockCount, decodeAlphaBlock, encodeBiowareDds, mipLevels, readBiowareHeader } from "../src/core/reskin/bc.js";
import { alphaCurve, darkBrass, lsh, swatchColour } from "../src/core/reskin/colour.js";
import { hex, paletteFromStyle } from "../src/core/reskin/palette.js";
import { NUI_PIECES, type NuiPieces } from "../src/core/reskin/redraw.js";
import { reportMarkdown, reskin, reskinHak } from "../src/core/reskin/reskin.js";
import { retoneDds, retoneTga } from "../src/core/reskin/retone.js";
import { AUTO, MANUAL } from "../src/core/reskin/textures.js";
import { validateTexture } from "../src/core/reskin/validate.js";
import { BRONZE, CLEAN, styleTextures } from "../src/core/skin/gen/style.js";

/** A synthetic swatch strip: columns of grey cells at the stock GUI's alphas, a gold cell, a red signal cell. */
function strip(w = 32, h = 8): RGBAImage {
  const im = newImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = Math.floor(x / 4);
      const c: [number, number, number, number][] = [
        [0, 0, 0, 0],
        [99, 101, 99, 102],
        [99, 101, 99, 64],
        [255, 255, 255, 48],
        [189, 146, 74, 255],
        [200, 30, 30, 255],
        [0, 0, 0, 255],
        [107, 105, 107, 255],
      ];
      im.data.set(c[cell % c.length]!, (y * w + x) * 4);
    }
  }
  return im;
}

/** An uncompressed 24-bit TGA, rows bottom to top (as the stock GUI's), of a frame: black field, gold rule. */
function frameTga(w = 16, h = 8): Uint8Array {
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
      const [r, g, b] = edge ? [189, 146, 74] : y < 4 ? [30, 50, 90] : [0, 0, 0];
      out[o] = b;
      out[o + 1] = g;
      out[o + 2] = r;
    }
  }
  return out;
}

const nui = (): NuiPieces => {
  const t = styleTextures(CLEAN);
  return Object.fromEntries(NUI_PIECES.map((n) => [n, t.get(n)!])) as unknown as NuiPieces;
};

describe("palette", () => {
  it("Ink and brass gives the colours of Layonara's hand-made set", () => {
    const p = paletteFromStyle(CLEAN);
    expect(hex(p.ink)).toBe("#141312");
    expect(hex(p.raised)).toBe("#24211D");
    expect(hex(p.button)).toBe("#2C2823");
    expect(hex(p.activeLo)).toBe("#4A371B");
    expect(hex(p.active)).toBe("#604824");
    expect(hex(p.accent)).toBe("#A88A58");
    expect(hex(p.glow)).toBe("#F0CC82");
    expect(hex(p.mark)).toBe("#EACE96");
    expect(p.bodyAlpha).toBe(255);
    // the pressed amber is of the accent's hue: the gold ramps go through it
    expect(darkBrass(p)).toEqual(p.active);
  });

  it("a pressed colour of another hue stays out of the gold ramps (Bronze's steel blue)", () => {
    const p = paletteFromStyle(BRONZE);
    const [, , h] = lsh(...darkBrass(p));
    expect(h).toBeGreaterThan(20);
    expect(h).toBeLessThan(50);
  });
});

describe("DDS", () => {
  it("writes the BioWare header and mip chain, the first stored row the bottom of the picture", () => {
    const im = newImage(8, 8, [0, 0, 255, 255]);
    for (let i = 0; i < 4 * 8; i++) im.data.set([255, 0, 0, 255], i * 4); // top half red
    const dds = encodeBiowareDds(im, 3);
    const h = readBiowareHeader(dds)!;
    expect(h).toMatchObject({ width: 8, height: 8, bpp: 3, size0: blockCount(8, 8) * 8 });
    expect(dds.length).toBe(BIOWARE_DDS_HEADER + mipLevels(8, 8).reduce((s, [w, hh]) => s + blockCount(w, hh) * 8, 0));
    // the first block stored is the picture's bottom-left 4 x 4: blue
    const c0 = dds[20]! | (dds[21]! << 8);
    expect(c0 & 31).toBe(31);
    expect(c0 >> 11).toBe(0);
    // decodeDds turns it the right way up
    const back = decodeDds(dds);
    expect(Array.from(back.data.subarray(0, 3))).toEqual([255, 0, 0]);
    expect(Array.from(back.data.subarray(63 * 4, 63 * 4 + 3))).toEqual([0, 0, 255]);
  });

  it("swatch retone keeps every DXT5 alpha block byte for byte, and the curve keeps 0 at 0", () => {
    const stock = encodeBiowareDds(strip(), 4);
    const p = paletteFromStyle(CLEAN);
    const kept = retoneDds(stock, swatchColour(p, "gui_boxes", "keep"), null).bytes;
    expect(kept.length).toBe(stock.length);
    for (let o = BIOWARE_DDS_HEADER; o < stock.length; o += 16) expect(kept.subarray(o, o + 8)).toEqual(stock.subarray(o, o + 8));
    expect(validateTexture(stock, kept, "dds", { minCorr: 0.7 }).problems).toEqual([]); // as reskin() checks swatches
    // the colours did change: the grey fill went to the skin's ramp
    expect(kept.subarray(20)).not.toEqual(stock.subarray(20));

    const curve = alphaCurve("opaque");
    const raised = retoneDds(stock, swatchColour(p, "gui_boxes", "opaque"), curve).bytes;
    const v = validateTexture(stock, raised, "dds", { alpha: curve, alphaTolerance: 16, minCorr: 0.7 });
    expect(v.problems).toEqual([]);
    expect(v.alphaZeroKept).toBe(true);
    const a = decodeAlphaBlock(raised.subarray(20 + 16, 28 + 16)); // second block: the 102-alpha fill
    expect(Math.min(...a)).toBeGreaterThan(200);
    // the header's mean alpha follows the new alpha
    expect(readBiowareHeader(raised)!.alphaMean).toBeGreaterThan(readBiowareHeader(stock)!.alphaMean);
  });
});

describe("TGA", () => {
  it("keeps the header and pixel order, and a protected picture byte for byte", () => {
    const stock = frameTga();
    const p = paletteFromStyle(CLEAN);
    const out = retoneTga(stock, (r, g, b) => [255 - r, 255 - g, 255 - b], [4, 2, 8, 6]).bytes;
    expect(out.subarray(0, 18)).toEqual(stock.subarray(0, 18));
    const a = decodeTga(stock);
    const b = decodeTga(out);
    const at = (im: RGBAImage, x: number, y: number) => Array.from(im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 3));
    expect(at(b, 5, 3)).toEqual(at(a, 5, 3)); // protected (top-down coordinates)
    expect(at(b, 10, 3)).not.toEqual(at(a, 10, 3));
    expect(p.ink).toBeDefined();
  });
});

describe("validation", () => {
  const stock = encodeBiowareDds(strip(), 4);
  it("catches a size change", () => {
    const other = encodeBiowareDds(strip(16, 8), 4);
    const v = validateTexture(stock, other, "dds");
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/size|header|length/);
  });
  it("catches an alpha change", () => {
    const im = strip();
    for (let i = 3; i < im.data.length; i += 4) im.data[i] = im.data[i] === 0 ? 255 : im.data[i]!;
    const v = validateTexture(stock, encodeBiowareDds(im, 4), "dds");
    expect(v.alphaZeroKept).toBe(false);
    expect(v.problems.join(" ")).toMatch(/alpha 0 moved/);
  });
  it("catches a DDS stored the wrong way up", () => {
    const drawn = newImage(16, 16, [10, 10, 10, 255]);
    for (let i = 0; i < 16 * 4; i++) drawn.data.set([250, 250, 250, 255], i * 4);
    const flipped = newImage(16, 16);
    for (let y = 0; y < 16; y++) flipped.data.set(drawn.data.subarray((15 - y) * 64, (16 - y) * 64), y * 64);
    const wrong = encodeBiowareDds(flipped, 3);
    const v = validateTexture(encodeBiowareDds(drawn, 3), wrong, "dds", { drawn });
    expect(v.problems.join(" ")).toMatch(/upside down/);
  });
});

describe("reskin", () => {
  async function fakeGame(): Promise<ResMan> {
    const c = new MemoryContainer("synthetic game");
    c.set("gui_boxes", RES_TYPES.dds!, encodeBiowareDds(strip(), 4));
    c.set("gui_boxes", RES_TYPES.tga!, frameTga()); // a TGA twin: the DDS wins within a layer
    c.set("gui_boxes", RES_TYPES.txi!, new TextEncoder().encode("mipmap 0\n"));
    c.set("ctl_att", RES_TYPES.tga!, frameTga(32, 16));
    c.set("gui_scrollbar", RES_TYPES.dds!, encodeBiowareDds(newImage(16, 16, [90, 60, 30, 255]), 3));
    c.set("gui_slider", RES_TYPES.dds!, encodeBiowareDds(newImage(16, 16, [90, 60, 30, 0]), 4));
    c.set("gui_banner", RES_TYPES.tga!, frameTga());
    const rm = new ResMan();
    rm.layers = [{ kind: "key", container: c }];
    return rm;
  }

  it("writes the stock names with their txi, a manifest, and a hak that reads back", async () => {
    const rm = await fakeGame();
    const p = paletteFromStyle(CLEAN);
    const res = await reskin(rm, { palette: p, nui: nui(), skin: { id: "ink", title: "Ink and brass", from: "test" }, alpha: "opaque", format: "tga", previews: true });
    expect(Object.keys(res.files).sort()).toEqual(["ctl_att.tga", "gui_boxes.dds", "gui_boxes.txi", "gui_scrollbar.dds", "gui_slider.dds"]);
    const m = res.manifest;
    expect(m.textures.map((t) => [t.name, t.action, t.format])).toEqual([
      ["gui_boxes", "recoloured", "dds dxt5"],
      ["ctl_att", "recoloured", "tga 24-bit"],
      ["gui_scrollbar", "redrawn", "dds dxt1"],
      ["gui_slider", "redrawn", "dds dxt5"],
    ]);
    for (const t of m.textures) expect(t.validation.problems, t.name).toEqual([]);
    expect(m.textures[0]!.txi).toBe(true);
    expect(m.textures[0]!.source).toBe("key: synthetic game");
    expect(m.palette.ink).toBe("#141312");
    // everything the reskin handles but the game lacks is listed, and the manual list is complete
    expect(m.skipped.length).toBe(AUTO.length - 4);
    expect(m.manual.length).toBe(MANUAL.length);
    expect(m.manual.find((t) => t.name === "gui_banner")).toMatchObject({ found: true, class: "picture" });
    expect(res.previews.map((pv) => pv.name)).toEqual(["gui_boxes", "ctl_att", "gui_scrollbar", "gui_slider"]);
    expect(reportMarkdown(m)).toMatch(/gui_banner/);

    const hak = reskinHak(res.files, "Ink and brass", new Date(Date.UTC(2026, 10, 18)));
    const erf = await Erf.open(new MemorySource("gui_ink.hak", hak));
    expect(erf.fileType).toBe("HAK ");
    for (const [n, d] of Object.entries(res.files)) {
      const [ref, ext] = n.split(".");
      expect(await erf.get(ref!, RES_TYPES[ext!]!)).toEqual(d);
    }
  });

  it("auto writes a stock TGA as a DDS when it compresses well, one format per name, and says so", async () => {
    const rm = await fakeGame();
    const p = paletteFromStyle(CLEAN);
    const res = await reskin(rm, { palette: p, nui: nui(), skin: { id: "ink", title: "Ink and brass", from: "test" }, alpha: "opaque" });
    expect(Object.keys(res.files).sort()).toEqual(["ctl_att.dds", "gui_boxes.dds", "gui_boxes.txi", "gui_scrollbar.dds", "gui_slider.dds"]);
    const t = res.manifest.textures.find((x) => x.name === "ctl_att")!;
    expect(t).toMatchObject({ format: "tga 24-bit", output: "dds dxt1", file: "ctl_att.dds" });
    expect(t.compression!.format).toBe("dxt1");
    expect(t.compression!.kept).toBeUndefined();
    expect(t.bytes).toBeLessThan(t.tgaBytes!);
    expect(t.validation.problems).toEqual([]);
    expect(res.manifest.outputFormat).toBe("auto");
    expect(reportMarkdown(res.manifest)).toMatch(/## Formats[\s\S]*ctl_att/);
    // dds forces it, tga keeps it
    const tga = await reskin(rm, { palette: p, nui: nui(), skin: res.manifest.skin, alpha: "opaque", format: "tga", only: ["ctl_att"] });
    expect(Object.keys(tga.files)).toEqual(["ctl_att.tga"]);
    expect(tga.manifest.textures[0]!.compression).toBeUndefined();
  });

  it("names and lists stay within the client's rules", () => {
    const names = [...AUTO.map((t) => t.name), ...MANUAL.map((t) => t.name)];
    for (const n of names) expect(n.length, n).toBeLessThanOrEqual(16);
    expect(new Set(names).size).toBe(names.length);
  });
});
