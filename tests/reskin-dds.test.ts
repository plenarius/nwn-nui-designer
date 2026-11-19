// pnpm reskin's TGA -> DDS compression (src/core/reskin/compress.ts): BioWare DDS written by encodeBiowareDds and read
// back by the repository's own DDS decoder. Every picture is synthetic.
import { describe, expect, it } from "vitest";
import { decodeDds, decodeStored } from "../src/core/res/dds.js";
import { type RGBAImage, newImage } from "../src/core/res/image.js";
import { BIOWARE_DDS_HEADER, blockCount, mipLevels, readBiowareHeader } from "../src/core/reskin/bc.js";
import { AUTO_LIMITS, compressToDds, keepTgaReason } from "../src/core/reskin/compress.js";

/** A panel like the stock frames: a smooth dark gradient, a 1 px gold rule, a 2 px light rule. */
function panel(w = 64, h = 32): RGBAImage {
  const im = newImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c = [10 + Math.round((x / w) * 30), 9 + Math.round((y / h) * 20), 8, 255];
      if (y === 4) c = [189, 146, 74, 255];
      if (y === 20 || y === 21) c = [240, 204, 130, 255];
      im.data.set(c, (y * w + x) * 4);
    }
  }
  return im;
}

/** A cut-out button: transparent outside a disc, an anti-aliased rim, opaque inside. */
function cutout(n = 32): RGBAImage {
  const im = newImage(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5);
      const a = d < n / 2 - 3 ? 255 : d > n / 2 - 1 ? 0 : Math.round(((n / 2 - 1 - d) / 2) * 255);
      im.data.set([168, 138, 88, a], (y * n + x) * 4);
    }
  }
  return im;
}

function maxDiff(a: RGBAImage, b: RGBAImage, ch: number[]): number {
  let m = 0;
  for (let i = 0; i < a.width * a.height; i++) for (const k of ch) m = Math.max(m, Math.abs(a.data[i * 4 + k]! - b.data[i * 4 + k]!));
  return m;
}

describe("TGA to DDS", () => {
  it("an opaque picture becomes DXT1 with the BioWare header and every mip level", () => {
    const im = panel();
    const c = compressToDds(im);
    const h = readBiowareHeader(c.bytes)!;
    expect(h).toEqual({ width: 64, height: 32, bpp: 3, size0: blockCount(64, 32) * 8, alphaMean: 1 });
    // header bytes: width, height, 3, size0, 1.0f
    expect(Array.from(c.bytes.subarray(0, 20))).toEqual([64, 0, 0, 0, 32, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0x80, 0x3f]); // size0 1024
    const levels = mipLevels(64, 32);
    expect(levels.at(-1)).toEqual([1, 1]);
    expect(c.bytes.length).toBe(BIOWARE_DDS_HEADER + levels.reduce((s, [w, hh]) => s + blockCount(w, hh) * 8, 0));
  });

  it("decodes back within the stated tolerance (mean 4, edges 12) and is kept as DDS by auto", () => {
    const im = panel();
    const c = compressToDds(im);
    expect(c.error.mean).toBeLessThanOrEqual(AUTO_LIMITS.mean);
    expect(c.error.edgeMean).toBeLessThanOrEqual(AUTO_LIMITS.edgeMean);
    expect(c.error.edgeTexels).toBeGreaterThan(0);
    expect(maxDiff(im, c.decoded, [0, 1, 2])).toBeLessThanOrEqual(40);
    expect(c.error.flipped).toBe(false);
    expect(keepTgaReason(c.error)).toBeNull();
  });

  it("stores rows bottom first: the first stored block is the picture's bottom, decodeDds turns it back", () => {
    const im = newImage(8, 8, [0, 0, 255, 255]);
    for (let i = 0; i < 8 * 2; i++) im.data.set([255, 0, 0, 255], i * 4); // top two rows red
    const c = compressToDds(im);
    const stored = decodeStored(c.bytes);
    expect(Array.from(stored.data.subarray(0, 3))).toEqual([0, 0, 255]); // first stored row: the bottom, blue
    expect(Array.from(stored.data.subarray(7 * 32, 7 * 32 + 3))).toEqual([255, 0, 0]);
    const shown = decodeDds(c.bytes);
    expect(Array.from(shown.data.subarray(0, 3))).toEqual([255, 0, 0]);
    expect(c.error.flipped).toBe(false);
  });

  it("a picture with alpha becomes DXT5: alpha 0 and 255 exact, the rim within one DXT5 step", () => {
    const im = cutout();
    const c = compressToDds(im);
    const h = readBiowareHeader(c.bytes)!;
    expect(h.bpp).toBe(4);
    expect(h.size0).toBe(blockCount(32, 32) * 16);
    let sum = 0;
    for (let i = 3; i < im.data.length; i += 4) sum += im.data[i]!;
    expect(h.alphaMean).toBeCloseTo(sum / (32 * 32) / 255, 5);
    expect(c.error.alphaEndsKept).toBe(true);
    for (let i = 0; i < 32 * 32; i++) {
      const a = im.data[i * 4 + 3]!;
      if (a === 0 || a === 255) expect(c.decoded.data[i * 4 + 3]).toBe(a);
    }
    expect(c.error.alphaMax).toBeLessThanOrEqual(AUTO_LIMITS.alphaMax);
    expect(c.bytes.length).toBe(BIOWARE_DDS_HEADER + mipLevels(32, 32).reduce((s, [w, hh]) => s + blockCount(w, hh) * 16, 0));
  });

  it("auto keeps a TGA that DXT cannot hold: 16 colours in one 4 x 4 block (as gui_rgbc)", () => {
    const im = newImage(4, 4);
    for (let i = 0; i < 16; i++) im.data.set([(i * 97) % 256, (i * 53 + 80) % 256, (i * 151 + 30) % 256, 255], i * 4);
    const c = compressToDds(im);
    expect(keepTgaReason(c.error)).toMatch(/mean error/);
  });
});
