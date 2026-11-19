// The resource readers on files built in memory (no game data needed).
import { describe, expect, it } from "vitest";
import { Erf, Folder, Key } from "../src/core/res/containers.js";
import { decodeDds, decodeStored } from "../src/core/res/dds.js";
import { RES_TYPES } from "../src/core/res/restype.js";
import { MemorySource } from "../src/core/res/source.js";
import { decodeTga } from "../src/core/res/tga.js";
import { encodeTga } from "../src/core/res/tga.js";
import { getPath } from "../src/core/skin/check.js";
import { parseToml } from "../src/core/skin/toml.js";

function bytes(...parts: (number[] | Uint8Array | string)[]): Uint8Array {
  const arr: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const c of p) arr.push(c.charCodeAt(0));
    else arr.push(...p);
  }
  return new Uint8Array(arr);
}
const u16 = (v: number) => [v & 255, (v >> 8) & 255];
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const name = (s: string, n: number) => [...s].map((c) => c.charCodeAt(0)).concat(Array(n - s.length).fill(0));

/** An ERF V1.0 holding the given resources. */
function makeErf(type: string, res: [string, number, Uint8Array][]): Uint8Array {
  const head = 160;
  const offKeys = head;
  const offRes = offKeys + res.length * 24;
  let offData = offRes + res.length * 8;
  const keys: number[] = [];
  const list: number[] = [];
  const data: number[] = [];
  res.forEach(([n, t, d], i) => {
    keys.push(...name(n, 16), ...u32(i), ...u16(t), 0, 0);
    list.push(...u32(offData), ...u32(d.length));
    offData += d.length;
    data.push(...d);
  });
  const h = [...name(type, 4), ...name("V1.0", 4), ...u32(0), ...u32(0), ...u32(res.length), ...u32(head), ...u32(offKeys), ...u32(offRes)];
  return bytes(h, Array(head - h.length).fill(0), keys, list, data);
}

describe("ERF", () => {
  it("lists and reads resources", async () => {
    const erf = await Erf.open(new MemorySource("t.hak", makeErf("HAK ", [["nui_skin", RES_TYPES.tml!, bytes("[text]\n")], ["Fnt_X", RES_TYPES.ttf!, bytes([1, 2, 3])]])));
    expect(erf.has("nui_skin", RES_TYPES.tml!)).toBe(true);
    expect(erf.has("fnt_x", RES_TYPES.ttf!)).toBe(true);
    expect([...(await erf.get("fnt_x", RES_TYPES.ttf!))!]).toEqual([1, 2, 3]);
    expect(await erf.get("missing", 3)).toBeNull();
  });
  it("refuses other versions", async () => {
    const b = makeErf("HAK ", []);
    b.set(bytes("E1.0"), 4);
    await expect(Erf.open(new MemorySource("x.hak", b))).rejects.toThrow(/unsupported ERF version/);
  });
});

describe("KEY/BIF", () => {
  it("finds a resource through its BIF", async () => {
    const payload = bytes("hello");
    const bif = bytes("BIFFV1  ", u32(1), u32(0), u32(20), u32(0 | 7), u32(36), u32(payload.length), u32(RES_TYPES.txt!), payload);
    const bifName = "data\\test.bif";
    const fileTable = 64;
    const nameOff = fileTable + 12;
    const keyTable = nameOff + bifName.length + 1;
    const key = bytes(
      "KEY V1  ",
      u32(1),
      u32(1),
      u32(fileTable),
      u32(keyTable),
      Array(fileTable - 24).fill(0),
      u32(bif.length),
      u32(nameOff),
      u16(bifName.length + 1),
      u16(0),
      bifName,
      [0],
      name("greeting", 16),
      u16(RES_TYPES.txt!),
      u32((0 << 20) | 7),
    );
    const k = await Key.open(new MemorySource("t.key", key), (p) => (p === "data/test.bif" ? new MemorySource("test.bif", bif) : null));
    expect(k.bifs()).toEqual([{ name: "data/test.bif", found: true }]);
    expect(new TextDecoder().decode((await k.get("greeting", RES_TYPES.txt!))!)).toBe("hello");
  });
});

describe("Folder", () => {
  it("maps file names to resources, first one wins", async () => {
    const f = new Folder("ovr", [new MemorySource("NUI_SKIN.TML", bytes("a")), new MemorySource("nui_skin.tml", bytes("b")), new MemorySource("readme", bytes("c"))]);
    expect(new TextDecoder().decode((await f.get("nui_skin", RES_TYPES.tml!))!)).toBe("a");
    expect([...f.entries()]).toEqual([["nui_skin", RES_TYPES.tml]]);
  });
});

describe("TGA", () => {
  const im = { width: 2, height: 2, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 10, 20, 30, 0]) };
  it("round-trips a 32-bit top-left image", () => {
    const back = decodeTga(encodeTga(im));
    expect([...back.data]).toEqual([...im.data]);
  });
  it("reads run-length encoded, bottom-left 24-bit images", () => {
    // 3x2, bottom row first: a run of 3 red, then 3 raw pixels.
    const b = bytes([0, 0, 10], Array(9).fill(0), u16(3), u16(2), [24, 0], [0x82, 0, 0, 255], [0x02, 255, 0, 0, 0, 255, 0, 1, 2, 3]);
    const t = decodeTga(b);
    expect(t.width).toBe(3);
    // Top row is the file's second row.
    expect(Array.from(t.data.slice(0, 12))).toEqual([0, 0, 255, 255, 0, 255, 0, 255, 3, 2, 1, 255]);
    expect(Array.from(t.data.slice(12, 16))).toEqual([255, 0, 0, 255]);
  });
});

describe("DDS", () => {
  it("decodes a BioWare DXT1 block", () => {
    // One 4x4 block: colour0 white, colour1 black, all indices 0 except the first pixel (1).
    const block = [...u16(0xffff), ...u16(0x0000), 1, 0, 0, 0];
    const b = bytes(u32(4), u32(4), u32(3), u32(8), u32(0), block);
    const im = decodeStored(b);
    expect(Array.from(im.data.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(im.data.slice(4, 8))).toEqual([255, 255, 255, 255]);
  });
  // NUI draws a DDS bottom row first (checked in game with NuiImage, 2026-11-17): po_trollocbear_l.dds, stored bottom
  // row first, shows upright; po_uweyewheartl.dds, stored top row first, shows upside down.
  const red = [...u16(0xf800), ...u16(0), 0, 0, 0, 0];
  const blue = [...u16(0x001f), ...u16(0), 0, 0, 0, 0];
  const at = (im: { width: number; data: Uint8ClampedArray }, x: number, y: number) =>
    Array.from(im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4));
  it("draws a BioWare DDS bottom row first", () => {
    // 4 x 8: the first stored block row red, the second blue.
    const im = decodeDds(bytes(u32(4), u32(8), u32(3), u32(16), u32(0), red, blue));
    expect([im.width, im.height]).toEqual([4, 8]);
    for (const y of [0, 3]) expect(at(im, 1, y)).toEqual([0, 0, 255, 255]);
    for (const y of [4, 7]) expect(at(im, 2, y)).toEqual([255, 0, 0, 255]);
    // As stored, the red rows come first.
    expect(at(decodeStored(bytes(u32(4), u32(8), u32(3), u32(16), u32(0), red, blue)), 0, 0)).toEqual([255, 0, 0, 255]);
  });
  it("draws a standard DDS bottom row first", () => {
    const head = new Uint8Array(128);
    const v = new DataView(head.buffer);
    v.setUint32(0, 0x20534444, true);
    v.setUint32(12, 8, true);
    v.setUint32(16, 4, true);
    v.setUint32(80, 4, true);
    head.set(bytes("DXT1"), 84);
    const im = decodeDds(bytes(head, red, blue));
    expect(at(im, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(at(im, 0, 7)).toEqual([255, 0, 0, 255]);
  });
  it("flips an odd number of rows around the middle one", () => {
    // Uncompressed 1 x 3, 32-bit BGRA: red, green, blue as stored.
    const head = new Uint8Array(128);
    const v = new DataView(head.buffer);
    v.setUint32(0, 0x20534444, true);
    v.setUint32(12, 3, true);
    v.setUint32(16, 1, true);
    v.setUint32(80, 0x40 | 0x1, true);
    v.setUint32(88, 32, true);
    v.setUint32(92, 0x00ff0000, true);
    v.setUint32(96, 0x0000ff00, true);
    v.setUint32(100, 0x000000ff, true);
    v.setUint32(104, 0xff000000, true);
    const im = decodeDds(bytes(head, [0, 0, 255, 255], [0, 255, 0, 255], [255, 0, 0, 255]));
    expect([at(im, 0, 0), at(im, 0, 1), at(im, 0, 2)]).toEqual([
      [0, 0, 255, 255],
      [0, 255, 0, 255],
      [255, 0, 0, 255],
    ]);
  });
  it("decodes a standard DXT5 block's alpha", () => {
    const head = new Uint8Array(128);
    const v = new DataView(head.buffer);
    v.setUint32(0, 0x20534444, true);
    v.setUint32(12, 4, true);
    v.setUint32(16, 4, true);
    v.setUint32(80, 4, true);
    head.set(bytes("DXT5"), 84);
    // alpha0 200, alpha1 100, all indices 0 (200); colour block all colour0 (red).
    const block = [200, 100, 0, 0, 0, 0, 0, 0, ...u16(0xf800), ...u16(0), 0, 0, 0, 0];
    const im = decodeDds(bytes(head, block));
    expect(Array.from(im.data.slice(0, 4))).toEqual([255, 0, 0, 200]);
  });
});

describe("TOML", () => {
  it("reads the shapes nui_skin.tml uses", () => {
    const t = parseToml(`# comment
[text]
color = "#FFFFFFFF" # trailing
[[fonts]]
  name = "(default)"
  font_size = 17.0
  pixel_snap = true
[[fonts]]
  name = 'lit\\eral'
  font_size = 1_7
[window]
padding_x = 0
  [window.header]
  normal = "nui_windowh"
    [window.header.close_button]
    padding_x = -5
[property]
hover  = "#000000FF"
arr = [1, 2, [3, "x"],]
inline = { a = 1, b.c = "d" }
multi = """
line one
line two"""
`);
    expect(t.text).toEqual({ color: "#FFFFFFFF" });
    expect(t.fonts).toEqual([
      { name: "(default)", font_size: 17, pixel_snap: true },
      { name: "lit\\eral", font_size: 17 },
    ]);
    expect(getPath(t, "window.header.close_button.padding_x")).toBe(-5);
    expect(getPath(t, "property.arr")).toEqual([1, 2, [3, "x"]]);
    expect(getPath(t, "property.inline")).toEqual({ a: 1, b: { c: "d" } });
    expect(getPath(t, "property.multi")).toBe("line one\nline two");
  });
  it("reports syntax errors with a line", () => {
    expect(() => parseToml("[a]\nb = \n")).toThrow(/line 2/);
    expect(() => parseToml("[a]\n[a]\n")).toThrow(/defined twice/);
  });
});
