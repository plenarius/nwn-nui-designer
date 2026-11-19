/**
 * Writes ERF V1.0 containers (.hak, .erf, .mod) as BioWare's published Aurora ERF specification describes them: a
 * 160-byte header, localized description strings, the key list (16-character resrefs), the resource list, the data.
 * A port of tools/open-skin/build_hak.py's write_erf (removed in phase 3; in git at e38d1ca), so the same resources, description and date give the same
 * bytes. containers.ts reads them back.
 */
import { resType } from "./restype.js";

export interface ErfEntry {
  resref: string;
  /** An extension ("tga") or a resource type number. */
  type: string | number;
  data: Uint8Array;
}

export interface ErfOptions {
  /** "HAK ", "ERF " or "MOD " (padded to 4). */
  fileType?: "HAK" | "ERF" | "MOD";
  /** One English description (written as cp1252; characters outside it become "?"). */
  description?: string;
  /** The build date the header records (year and day of the year, UTC). */
  date?: Date;
}

/** cp1252 bytes of a string ("?" for what cp1252 cannot hold). */
export function cp1252(s: string): Uint8Array {
  const extra: Record<number, number> = {
    0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88,
    0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
    0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b,
    0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f,
  };
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else out.push(extra[c] ?? 0x3f);
  }
  return Uint8Array.from(out);
}

export function writeErf(entries: ErfEntry[], o: ErfOptions = {}): Uint8Array {
  const seen = new Set<string>();
  const list = entries.map((e) => {
    const type = typeof e.type === "number" ? e.type : resType(e.type);
    if (type === undefined) throw new Error(`${e.resref}.${e.type}: not a resource type NWN knows`);
    const name = e.resref.toLowerCase();
    if (!name || name.length > 16) throw new Error(`"${e.resref}": a resref has 1 to 16 characters`);
    if (!/^[\x20-\x7e]+$/.test(name)) throw new Error(`"${e.resref}": a resref is plain ASCII`);
    const k = `${name}.${type}`;
    if (seen.has(k)) throw new Error(`${name} (type ${type}) is in the list twice`);
    seen.add(k);
    return { name, type, data: e.data };
  });
  const desc = o.description ? cp1252(o.description) : new Uint8Array(0);
  const locLen = o.description !== undefined ? 8 + desc.length : 0;
  const n = list.length;
  const offLoc = 160;
  const offKeys = offLoc + locLen;
  const offList = offKeys + 24 * n;
  const offData = offList + 8 * n;
  const total = offData + list.reduce((s, e) => s + e.data.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  const ft = (o.fileType ?? "HAK").padEnd(4, " ");
  for (let i = 0; i < 4; i++) out[i] = ft.charCodeAt(i);
  out.set([0x56, 0x31, 0x2e, 0x30], 4); // "V1.0"
  const when = o.date ?? new Date();
  const year = when.getUTCFullYear();
  const dayOfYear = Math.floor((Date.UTC(year, when.getUTCMonth(), when.getUTCDate()) - Date.UTC(year, 0, 1)) / 86400000);
  dv.setUint32(8, o.description !== undefined ? 1 : 0, true); // language count
  dv.setUint32(12, locLen, true);
  dv.setUint32(16, n, true);
  dv.setUint32(20, offLoc, true);
  dv.setUint32(24, offKeys, true);
  dv.setUint32(28, offList, true);
  dv.setUint32(32, year - 1900, true);
  dv.setUint32(36, dayOfYear, true);
  dv.setUint32(40, 0xffffffff, true); // description StrRef: none
  if (o.description !== undefined) {
    dv.setUint32(offLoc, 0, true); // language 0: English
    dv.setUint32(offLoc + 4, desc.length, true);
    out.set(desc, offLoc + 8);
  }
  let pos = offData;
  list.forEach((e, i) => {
    const k = offKeys + 24 * i;
    for (let c = 0; c < e.name.length; c++) out[k + c] = e.name.charCodeAt(c);
    dv.setUint32(k + 16, i, true);
    dv.setUint16(k + 20, e.type, true);
    dv.setUint32(offList + 8 * i, pos, true);
    dv.setUint32(offList + 8 * i + 4, e.data.length, true);
    out.set(e.data, pos);
    pos += e.data.length;
  });
  return out;
}
