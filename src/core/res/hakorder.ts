/**
 * A module's hak order, from any of the three forms a module builder has: nasher's module.ifo.json (also
 * neverwinter.nim's nwn_gff JSON), a binary module.ifo (GFF V3.2) from a module folder, or a packed .mod (an ERF that
 * holds module.ifo). The form is told by the file's first bytes, not its name.
 *
 * The order is the module's `Mod_HakList`, first entry first (the first hak wins, as in the client), each name in
 * lower case. A module saved before the list existed has one `Mod_Hak` string instead; it is used only when there is
 * no list. An empty list is an empty order, not an error.
 */
import { Erf } from "./containers.js";
import { GffError, type GffStruct, readGff } from "./gff.js";
import { RES_TYPES } from "./restype.js";
import { type ByteSource, TruncatedError } from "./source.js";

export type HakOrderFormat = "json" | "ifo" | "mod";

export interface HakOrder {
  /** The haks, best first, in lower case without ".hak". */
  haks: string[];
  format: HakOrderFormat;
  /** The field the order came from; null when the module has neither (no haks). */
  field: "Mod_HakList" | "Mod_Hak" | null;
}

/** A module.ifo larger than this is not one (a .mod is read by its directory, never whole). */
const MAX_IFO = 16 << 20;

const name = (h: string) => h.trim().toLowerCase().replace(/\.hak$/, "");

/** The hak order of a JSON module.ifo (nasher's module.ifo.json); throws when the fields are not shaped as GFF JSON. */
export function hakOrderFromJson(json: unknown): Omit<HakOrder, "format"> {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("not a module.ifo in JSON (no top-level object)");
  const d = json as Record<string, unknown>;
  const fieldValue = (f: unknown) => (f && typeof f === "object" ? (f as { value?: unknown }).value : undefined);
  if ("Mod_HakList" in d) {
    const list = fieldValue(d.Mod_HakList);
    if (!Array.isArray(list)) throw new Error("Mod_HakList is not a list");
    return {
      field: "Mod_HakList",
      haks: list.map((h, i) => {
        const v = h && typeof h === "object" ? fieldValue((h as Record<string, unknown>).Mod_Hak) : undefined;
        if (typeof v !== "string") throw new Error(`Mod_HakList entry ${i + 1} has no Mod_Hak string`);
        return name(v);
      }),
    };
  }
  const one = fieldValue(d.Mod_Hak);
  if (typeof one === "string") return { field: "Mod_Hak", haks: one.trim() ? [name(one)] : [] };
  return { field: null, haks: [] };
}

/** The hak order of a module.ifo's top-level struct. */
function hakOrderFromGff(root: GffStruct): Omit<HakOrder, "format"> {
  if (root.has("Mod_HakList")) {
    const list = root.get("Mod_HakList");
    if (!Array.isArray(list)) throw new GffError("Mod_HakList is not a list");
    return {
      field: "Mod_HakList",
      haks: list.map((s, i) => {
        const v = s.get("Mod_Hak");
        if (typeof v !== "string") throw new GffError(`Mod_HakList entry ${i + 1} has no Mod_Hak string`);
        return name(v);
      }),
    };
  }
  const one = root.get("Mod_Hak");
  if (typeof one === "string") return { field: "Mod_Hak", haks: one.trim() ? [name(one)] : [] };
  return { field: null, haks: [] };
}

function fromIfoBytes(bytes: Uint8Array): Omit<HakOrder, "format"> {
  const gff = readGff(bytes);
  if (gff.fileType !== "IFO ") throw new GffError(`a GFF of type "${gff.fileType.trim()}", not a module.ifo`);
  return hakOrderFromGff(gff.root());
}

const ascii = (b: Uint8Array) => String.fromCharCode(...b);

/**
 * The hak order in src: a module.ifo.json, a binary module.ifo or a .mod, told apart by content. Throws an Error
 * whose message says what is wrong (not a module file, truncated, damaged), never a crash on a damaged file.
 */
export async function readHakOrder(src: ByteSource): Promise<HakOrder> {
  try {
    const head = ascii(await src.read(0, Math.min(8, src.size)));
    if (/^(MOD |ERF |SAV |NWM )V1\.[01]$/.test(head)) {
      const erf = await Erf.open(src);
      const ifo = await erf.get("module", RES_TYPES.ifo!);
      if (!ifo) throw new Error(`a ${head.slice(0, 3).trim()} file without a module.ifo in it`);
      return { ...fromIfoBytes(ifo), format: "mod" };
    }
    if (src.size > MAX_IFO) throw new Error(`not a module.ifo (${src.size} bytes, and not a .mod)`);
    const bytes = await src.read(0, src.size);
    if (/^.{4}V3\.2$/.test(head)) return { ...fromIfoBytes(bytes), format: "ifo" };
    if (/^[A-Z0-9 ]{4}V\d/.test(head)) throw new Error(`a ${head.slice(0, 4).trim()} file, not a module.ifo, its JSON or a .mod`);
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
    if (!text.trimStart().startsWith("{")) throw new Error("not a module.ifo (GFF), its JSON (module.ifo.json) or a .mod");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`not valid JSON (${e instanceof Error ? e.message : String(e)})`);
    }
    return { ...hakOrderFromJson(json), format: "json" };
  } catch (e) {
    if (e instanceof TruncatedError || e instanceof RangeError) throw new Error("truncated or damaged file");
    throw e;
  }
}
