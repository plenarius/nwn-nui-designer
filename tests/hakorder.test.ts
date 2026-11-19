// The hak order from a module.ifo.json, a binary module.ifo (GFF V3.2) and a .mod (ERF), built in memory.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readHakOrder } from "../src/core/res/hakorder.js";
import { RES_TYPES } from "../src/core/res/restype.js";
import { MemorySource } from "../src/core/res/source.js";
import { HakOrderError, readHakOrderFile } from "../src/node/hakorder.js";
import { moduleHakPaths } from "../src/node/setup.js";
import { type Field, makeErf, makeGff } from "./gffbuild.js";

const hakList = (...names: string[]): Field => ({ label: "Mod_HakList", list: names.map((n) => [{ label: "Mod_Hak", str: n }]) });
const IFO = makeGff("IFO ", [{ label: "Mod_Creator_ID", dword: 2 }, { label: "Mod_Hak", str: "ignored" }, hakList("Top_Hak", "middle", "BOTTOM.hak"), { label: "Mod_Tag", str: "MODULE" }]);
const order = (b: Uint8Array, name = "x") => readHakOrder(new MemorySource(name, b));
const text = (s: string) => new TextEncoder().encode(s);

describe("hak order from a binary module.ifo", () => {
  it("reads Mod_HakList in order, in lower case, and prefers it to Mod_Hak", async () => {
    expect(await order(IFO)).toEqual({ haks: ["top_hak", "middle", "bottom"], format: "ifo", field: "Mod_HakList" });
  });
  it("falls back to the old single Mod_Hak field", async () => {
    expect(await order(makeGff("IFO ", [{ label: "Mod_Tag", str: "M" }, { label: "Mod_Hak", str: "Old_One" }]))).toEqual({ haks: ["old_one"], format: "ifo", field: "Mod_Hak" });
    expect(await order(makeGff("IFO ", [{ label: "Mod_Hak", str: "" }]))).toEqual({ haks: [], format: "ifo", field: "Mod_Hak" });
  });
  it("reads an empty list as no haks", async () => {
    expect(await order(makeGff("IFO ", [hakList(), { label: "Mod_Hak", str: "not used" }]))).toEqual({ haks: [], format: "ifo", field: "Mod_HakList" });
    expect(await order(makeGff("IFO ", [{ label: "Mod_Tag", str: "M" }]))).toEqual({ haks: [], format: "ifo", field: null });
  });
  it("refuses another GFF type", async () => {
    await expect(order(makeGff("ARE ", [hakList("a")]))).rejects.toThrow(/a GFF of type "ARE", not a module\.ifo/);
  });
  it("says a truncated or damaged file is one, at every cut", async () => {
    for (let cut = 1; cut < IFO.length; cut++) {
      await expect(order(IFO.subarray(0, cut)), `cut at ${cut}`).rejects.toThrow(/truncated|damaged|not a GFF|not a module/);
    }
    const bad = IFO.slice();
    new DataView(bad.buffer).setUint32(12, 999, true); // struct count past the table's room
    await expect(order(bad)).rejects.toThrow(/damaged/);
    const badList = IFO.slice();
    // Point every list at a far offset: the list reaches past its table.
    const dv = new DataView(badList.buffer);
    const fieldOff = dv.getUint32(16, true);
    for (let i = 0; i < dv.getUint32(20, true); i++) if (dv.getUint32(fieldOff + i * 12, true) === 15) dv.setUint32(fieldOff + i * 12 + 8, 1 << 20, true);
    await expect(order(badList)).rejects.toThrow(/damaged GFF \(a list reaches past its table\)/);
  });
});

describe("hak order from a .mod", () => {
  it("finds module.ifo among the module's resources", async () => {
    const mod = makeErf([["area001", RES_TYPES.are!, makeGff("ARE ", [])], ["module", RES_TYPES.ifo!, IFO]]);
    expect(await order(mod, "m.mod")).toEqual({ haks: ["top_hak", "middle", "bottom"], format: "mod", field: "Mod_HakList" });
  });
  it("says when there is no module.ifo, or the file is cut short", async () => {
    await expect(order(makeErf([["area001", RES_TYPES.are!, makeGff("ARE ", [])]]))).rejects.toThrow(/a MOD file without a module\.ifo in it/);
    const mod = makeErf([["module", RES_TYPES.ifo!, IFO]]);
    await expect(order(mod.subarray(0, 100))).rejects.toThrow(/not an ERF/);
    await expect(order(mod.subarray(0, 170))).rejects.toThrow(/truncated or damaged ERF/);
    // The ifo's bytes cut off: the ERF drops the entry, so there is no module.ifo.
    await expect(order(mod.subarray(0, mod.length - 10))).rejects.toThrow(/without a module\.ifo/);
  });
});

describe("hak order from a module.ifo.json", () => {
  const json = (o: unknown) => text(JSON.stringify(o));
  const nasher = { __data_type: "IFO ", Mod_Hak: { type: "cexostring", value: "" }, Mod_HakList: { type: "list", value: [{ __struct_id: 8, Mod_Hak: { type: "cexostring", value: "Top_Hak" } }, { __struct_id: 8, Mod_Hak: { type: "cexostring", value: "middle" } }] } };
  it("reads nasher's file the same way as the binary one", async () => {
    expect(await order(json(nasher))).toEqual({ haks: ["top_hak", "middle"], format: "json", field: "Mod_HakList" });
    expect(await order(text(`﻿  ${JSON.stringify(nasher)}`))).toMatchObject({ haks: ["top_hak", "middle"] });
  });
  it("falls back to Mod_Hak, and an empty list is no haks", async () => {
    expect(await order(json({ Mod_Hak: { type: "cexostring", value: "Old" } }))).toEqual({ haks: ["old"], format: "json", field: "Mod_Hak" });
    expect(await order(json({ ...nasher, Mod_HakList: { type: "list", value: [] } }))).toEqual({ haks: [], format: "json", field: "Mod_HakList" });
  });
  it("says what is wrong with a broken file", async () => {
    await expect(order(text('{"Mod_HakList": '))).rejects.toThrow(/not valid JSON/);
    await expect(order(json({ Mod_HakList: { value: [{}] } }))).rejects.toThrow(/entry 1 has no Mod_Hak string/);
    await expect(order(text("hello"))).rejects.toThrow(/not a module\.ifo \(GFF\), its JSON/);
    await expect(order(new Uint8Array(0))).rejects.toThrow(/not a module\.ifo/);
    await expect(order(text("KEY V1  0000000000000000"))).rejects.toThrow(/a KEY file, not a module\.ifo/);
  });
});

describe("hak order files on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "nuid-ifo-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it("tells the three forms apart by content, not the extension", async () => {
    // A .mod named .ifo, a binary ifo named .json: content decides.
    writeFileSync(join(dir, "packed.ifo"), makeErf([["module", RES_TYPES.ifo!, IFO]]));
    writeFileSync(join(dir, "binary.json"), IFO);
    expect((await readHakOrderFile(join(dir, "packed.ifo"))).format).toBe("mod");
    expect((await readHakOrderFile(join(dir, "binary.json"))).format).toBe("ifo");
  });
  it("finds the haks in the hak folder in the module's order, from a .mod", async () => {
    const hakDir = join(dir, "hak");
    rmSync(hakDir, { recursive: true, force: true });
    mkdirSync(hakDir);
    writeFileSync(join(hakDir, "Middle.HAK"), "");
    writeFileSync(join(hakDir, "top_hak.hak"), "");
    writeFileSync(join(dir, "m.mod"), makeErf([["module", RES_TYPES.ifo!, IFO]]));
    expect(await moduleHakPaths(hakDir, join(dir, "m.mod"))).toEqual({ haks: [join(hakDir, "top_hak.hak"), join(hakDir, "Middle.HAK")], missing: ["bottom"] });
  });
  it("throws a HakOrderError naming the file", async () => {
    await expect(readHakOrderFile(join(dir, "none.ifo"))).rejects.toThrow(HakOrderError);
    await expect(readHakOrderFile(join(dir, "none.ifo"))).rejects.toThrow(/none\.ifo: no such file/);
    writeFileSync(join(dir, "cut.ifo"), IFO.subarray(0, 60));
    await expect(readHakOrderFile(join(dir, "cut.ifo"))).rejects.toThrow(/cut\.ifo: truncated or damaged GFF/);
  });
});
