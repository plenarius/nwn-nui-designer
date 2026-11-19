// Damaged and hostile input: the readers say what is wrong in a sentence instead of crashing, hanging or allocating
// gigabytes; and regressions of bugs found by fuzzing and review (no game data needed).
import { describe, expect, it } from "vitest";
import { Erf, Key } from "../src/core/res/containers.js";
import { decodeDds } from "../src/core/res/dds.js";
import { writeErf } from "../src/core/res/erfwrite.js";
import { newImage } from "../src/core/res/image.js";
import { Images } from "../src/core/res/images.js";
import { MemoryContainer } from "../src/core/res/containers.js";
import { ResMan } from "../src/core/res/resman.js";
import { RES_TYPES, resType, splitResName } from "../src/core/res/restype.js";
import { MemorySource, Reader, TruncatedError } from "../src/core/res/source.js";
import { decodeTga, encodeTga } from "../src/core/res/tga.js";
import { readStoredZip, writeZip } from "../src/core/res/zip.js";
import { getPath } from "../src/core/skin/check.js";
import { parseToml } from "../src/core/skin/toml.js";
import { deleteElement, duplicateElement, nudge } from "../src/core/edit/ops.js";
import type { EditorDoc } from "../src/core/edit/project.js";
import { defaultExport } from "../src/core/edit/project.js";
import { kidsOf, walkElems } from "../src/core/edit/tree.js";
import type { JsonObject } from "../src/core/model/types.js";

const enc = new TextEncoder();

describe("Reader", () => {
  it("throws a TruncatedError past the end, for numbers and strings alike", () => {
    const r = new Reader(new Uint8Array([1, 2, 3]));
    expect(r.u16(1)).toBe(0x0302);
    expect(() => r.u32(0)).toThrow(TruncatedError);
    expect(() => r.str(2, 4)).toThrow(TruncatedError);
  });
});

describe("ERF", () => {
  const entries = [
    { resref: "nui_skin", type: "tml", data: enc.encode("a = 1\n") },
    { resref: "Nui_Button_N", type: "tga", data: encodeTga(newImage(2, 2, [1, 2, 3, 255])) },
  ];
  it("writes what it reads back, names lower case", async () => {
    const bytes = writeErf(entries, { description: "test", date: new Date(Date.UTC(2026, 0, 2)) });
    const erf = await Erf.open(new MemorySource("t.hak", bytes));
    expect(erf.fileType).toBe("HAK ");
    expect([...erf.entries()]).toEqual([
      ["nui_skin", RES_TYPES.tml],
      ["nui_button_n", RES_TYPES.tga],
    ]);
    expect(await erf.get("nui_button_n", RES_TYPES.tga!)).toEqual(entries[1]!.data);
    // The same input and date give the same bytes.
    expect(writeErf(entries, { description: "test", date: new Date(Date.UTC(2026, 0, 2)) })).toEqual(bytes);
  });
  it("refuses bad names and types", () => {
    expect(() => writeErf([{ resref: "a_name_of_17_chars", type: "tga", data: new Uint8Array() }])).toThrow(/1 to 16 characters/);
    expect(() => writeErf([{ resref: "a", type: "constructor", data: new Uint8Array() }])).toThrow(/not a resource type/);
    expect(() => writeErf([entries[0]!, entries[0]!])).toThrow(/twice/);
  });
  it("says a short or truncated file is damaged", async () => {
    await expect(Erf.open(new MemorySource("x.hak", new Uint8Array(40)))).rejects.toThrow(/x\.hak: not an ERF/);
    const bytes = writeErf(entries, { date: new Date(0) });
    // Claim far more entries than the file holds.
    new DataView(bytes.buffer).setUint32(16, 100000, true);
    await expect(Erf.open(new MemorySource("x.hak", bytes))).rejects.toThrow(/truncated or damaged ERF/);
  });
  it("leaves out a resource that reaches past the end", async () => {
    const bytes = writeErf(entries, { date: new Date(0) });
    const erf = await Erf.open(new MemorySource("x.hak", bytes.subarray(0, bytes.length - 3)));
    expect(erf.has("nui_skin", RES_TYPES.tml!)).toBe(true);
    expect(erf.has("nui_button_n", RES_TYPES.tga!)).toBe(false);
  });
});

describe("KEY", () => {
  it("says a truncated KEY is damaged, not a RangeError", async () => {
    const b = new Uint8Array(64);
    b.set(enc.encode("KEY V1  "));
    new DataView(b.buffer).setUint32(8, 3, true); // 3 BIFs
    new DataView(b.buffer).setUint32(16, 60, true); // whose table starts 4 bytes before the end
    await expect(Key.open(new MemorySource("x.key", b), () => null)).rejects.toThrow(/x\.key: truncated or damaged KEY/);
    await expect(Key.open(new MemorySource("y.key", new Uint8Array(8)), () => null)).rejects.toThrow(/not a KEY V1/);
  });
});

describe("images with damaged headers", () => {
  it("refuses a TGA that claims 65535 x 65535 instead of allocating 17 GB", () => {
    const g = new Uint8Array(18);
    g.set([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 32, 0]);
    expect(() => decodeTga(g)).toThrow(/TGA: bad size 65535x65535/);
  });
  it("refuses a TGA with an impossible pixel size", () => {
    const g = new Uint8Array(18 + 16);
    g.set([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 12, 0]);
    expect(() => decodeTga(g)).toThrow(/12 bits/);
  });
  it("refuses a standard DDS that claims 100000 px a side", () => {
    const d = new Uint8Array(200);
    const v = new DataView(d.buffer);
    v.setUint32(0, 0x20534444, true);
    v.setUint32(12, 100000, true);
    v.setUint32(16, 100000, true);
    v.setUint32(80, 4, true);
    d.set(enc.encode("DXT1"), 84);
    expect(() => decodeDds(d)).toThrow(/DDS: bad size/);
  });
  it("refuses an uncompressed DDS whose bits are not whole bytes", () => {
    const d = new Uint8Array(200);
    const v = new DataView(d.buffer);
    v.setUint32(0, 0x20534444, true);
    v.setUint32(12, 2, true);
    v.setUint32(16, 2, true);
    v.setUint32(80, 0x40, true);
    v.setUint32(88, 12, true);
    expect(() => decodeDds(d)).toThrow(/12 bits/);
  });
});

describe("zip", () => {
  it("round-trips its own zips", () => {
    const files = [
      { name: "a/nui_skin.tml", data: enc.encode("x = 1\n") },
      { name: "é.txt", data: new Uint8Array([0, 1, 2]) },
    ];
    expect(readStoredZip(writeZip(files, new Date(0)))).toEqual(files);
  });
  it("says a damaged zip is damaged", () => {
    const z = writeZip([{ name: "a.txt", data: new Uint8Array(100) }], new Date(0));
    expect(() => readStoredZip(z.subarray(0, 10))).toThrow(/not a zip file/);
    const cut = z.slice();
    // Point the central directory's entry at an offset past the end.
    new DataView(cut.buffer).setUint32(cut.length - 22 - 46 - 5 + 42, 1_000_000, true);
    expect(() => readStoredZip(cut)).toThrow(/truncated or damaged zip/);
  });
});

describe("names that are Object.prototype members", () => {
  it("are not resource types", () => {
    expect(resType("constructor")).toBeUndefined();
    expect(resType("TGA")).toBe(3);
    expect(splitResName("x.toString")).toBeNull();
  });
  it("are ordinary TOML keys", () => {
    const t = parseToml('constructor = 1\ntoString = "a"\n__proto__ = 2\n[hasOwnProperty]\nx = 3\n');
    expect(Object.keys(t)).toEqual(["constructor", "toString", "__proto__", "hasOwnProperty"]);
    expect(getPath(t, "hasOwnProperty.x")).toBe(3);
    expect(getPath(t, "__proto__")).toBe(2);
    expect(Object.getPrototypeOf(t)).toBe(Object.prototype);
    expect(getPath({}, "constructor")).toBeUndefined();
    expect(() => parseToml("a = 1\na = 2\n")).toThrow(/defined twice/);
  });
});

describe("Images", () => {
  /** A resource manager whose TGA reads are counted and can be held back. */
  function counted() {
    const c = new MemoryContainer("mem");
    c.set("img", RES_TYPES.tga!, encodeTga(newImage(1, 1, [9, 9, 9, 255])));
    const rm = new ResMan();
    rm.layers.push({ kind: "memory", container: c });
    let reads = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const get = c.get.bind(c);
    c.get = async (r, t) => {
      reads++;
      await gate;
      return get(r, t);
    };
    return { rm, reads: () => reads, release };
  }
  it("decodes an image once when two ask for it at the same time", async () => {
    const { rm, reads, release } = counted();
    const im = new Images(rm);
    const a = im.get("img");
    const b = im.get("IMG");
    release();
    const [x, y] = await Promise.all([a, b]);
    expect(x).toBe(y);
    expect(x?.width).toBe(1);
    expect(reads()).toBe(1);
  });
  it("does not let a load started before clear() fill the cache after it", async () => {
    const { rm, release } = counted();
    const im = new Images(rm);
    expect(im.peek("img")).toBeUndefined();
    const loading = im.loadPending();
    im.clear();
    release();
    await loading;
    expect(im.peek("img")).toBeUndefined(); // not loaded: asked for again
  });
});

describe("tree edits on windows with stray values", () => {
  const doc = (root: JsonObject): EditorDoc => ({ name: "t", window: { root }, binds: {}, panes: {}, notes: "", export: defaultExport("t") });
  // A column whose children hold a value that is not an element (hand-written JSON): the tree skips it.
  const col: JsonObject = { type: "col", children: [{ type: "label", value: "a" }, 7, { type: "label", value: "b" }] };
  it("selects a real sibling after a delete", () => {
    const r = deleteElement(doc(col), [1]);
    expect(kidsOf(r.doc.window.root as JsonObject).map((e) => e.value)).toEqual(["a"]);
    expect(r.select).toEqual([0]);
  });
  it("nudges only among real elements", () => {
    expect(nudge(doc(col), [1], 1)).toBeNull();
    expect(kidsOf(nudge(doc(col), [0], 1)!.doc.window.root as JsonObject).map((e) => e.value)).toEqual(["b", "a"]);
  });
  it("gives every id in a duplicated subtree a new, unused name", () => {
    const root: JsonObject = {
      type: "col",
      children: [{ type: "row", id: "r", children: [{ type: "button", id: "b" }, { type: "button", id: "b_2" }, { type: "button", id: "b" }] }],
    };
    const r = duplicateElement(doc(root), [0]);
    const ids: string[] = [];
    walkElems(r.doc.window, (e) => typeof e.id === "string" && ids.push(e.id));
    expect(ids).toEqual(["r", "b", "b_2", "b", "r_2", "b_3", "b_4", "b_5"]);
  });
});
