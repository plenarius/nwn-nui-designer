/**
 * A TLK V3.0 reader (the game's dialog.tlk): string by string reference. Written from BioWare's published TLK
 * layout: a 20-byte header (type, version, language, count, offset of the strings), then 40 bytes per entry (flags,
 * sound, offset and size of its text). Every offset is checked.
 */
import { Reader } from "./source.js";

export class Tlk {
  private readonly r: Reader;
  readonly count: number;
  private readonly base: number;

  constructor(private readonly bytes: Uint8Array) {
    this.r = new Reader(bytes);
    if (bytes.length < 20 || this.r.str(0, 4) !== "TLK " || this.r.str(4, 4) !== "V3.0") throw new Error("not a TLK V3.0");
    this.count = this.r.u32(12);
    this.base = this.r.u32(16);
    if (20 + this.count * 40 > bytes.length) throw new Error("damaged TLK (its entries reach past the end)");
  }

  /** The text of a string reference ("" when it has none or is out of range). */
  get(strref: number): string {
    if (strref < 0 || strref >= this.count) return "";
    const e = 20 + strref * 40;
    if (!(this.r.u32(e) & 1)) return "";
    const off = this.base + this.r.u32(e + 28);
    const size = this.r.u32(e + 32);
    if (off + size > this.bytes.length) return "";
    return new TextDecoder("windows-1252").decode(this.bytes.subarray(off, off + size));
  }
}
