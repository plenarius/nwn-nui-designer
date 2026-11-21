/**
 * A small GFF V3.2 reader: the fields of a struct, followed into lists and structs on demand. Written from BioWare's
 * published GFF specification; it reads only what a caller asks for (a module.ifo's hak list), and every offset is
 * checked, so a damaged file throws a GffError instead of reading past its end.
 */
import { Reader, TruncatedError } from "./source.js";

export class GffError extends Error {}

/** The field types this reader returns values for (others read as undefined). */
const T_BYTE = 0;
const T_CHAR = 1;
const T_WORD = 2;
const T_SHORT = 3;
const T_DWORD = 4;
const T_INT = 5;
const T_FLOAT = 8;
const T_CEXOSTRING = 10;
const T_RESREF = 11;
const T_STRUCT = 14;
const T_LIST = 15;

export type GffValue = string | number | GffStruct | GffStruct[] | undefined;

export class Gff {
  readonly fileType: string;
  readonly version: string;
  private readonly r: Reader;
  private readonly h: number[];

  /** Reads the header; throws a GffError unless bytes are a GFF V3.2 whose tables lie inside the file. */
  constructor(bytes: Uint8Array) {
    if (bytes.length < 56) throw new GffError(`not a GFF (${bytes.length} bytes, shorter than its header)`);
    this.r = new Reader(bytes);
    this.fileType = this.r.str(0, 4);
    this.version = this.r.str(4, 4);
    if (this.version !== "V3.2") throw new GffError(`not a GFF V3.2 (version "${this.version}")`);
    // structs, fields, labels, field data, field indices, list indices: [offset, count] pairs.
    this.h = Array.from({ length: 12 }, (_, i) => this.r.u32(8 + i * 4));
    const sizes = [12 * this.h[1]!, 12 * this.h[3]!, 16 * this.h[5]!, this.h[7]!, this.h[9]!, this.h[11]!];
    sizes.forEach((size, i) => {
      if (this.h[i * 2]! + size > bytes.length) throw new GffError("truncated or damaged GFF (a table reaches past the end of the file)");
    });
    if (this.h[1]! < 1) throw new GffError("damaged GFF (no top-level struct)");
  }

  /** The top-level struct. */
  root(): GffStruct {
    return this.struct(0);
  }

  struct(index: number): GffStruct {
    if (index >= this.h[1]!) throw new GffError(`damaged GFF (struct ${index} of ${this.h[1]})`);
    const o = this.h[0]! + index * 12;
    const dataOrOffset = this.r.u32(o + 4);
    const count = this.r.u32(o + 8);
    let fields: number[];
    if (count === 0) fields = [];
    else if (count === 1) fields = [dataOrOffset];
    else {
      if (dataOrOffset + count * 4 > this.h[9]!) throw new GffError("damaged GFF (a struct's field indices reach past their table)");
      fields = Array.from({ length: count }, (_, i) => this.r.u32(this.h[8]! + dataOrOffset + i * 4));
    }
    return new GffStruct(this, this.r.u32(o), fields);
  }

  /** A field's label, type and raw data word. */
  field(index: number): { label: string; type: number; data: number } {
    if (index >= this.h[3]!) throw new GffError(`damaged GFF (field ${index} of ${this.h[3]})`);
    const o = this.h[2]! + index * 12;
    const label = this.r.u32(o + 4);
    if (label >= this.h[5]!) throw new GffError(`damaged GFF (label ${label} of ${this.h[5]})`);
    return { type: this.r.u32(o), label: this.r.str(this.h[4]! + label * 16, 16), data: this.r.u32(o + 8) };
  }

  /** A field's value: strings for CExoString and ResRef, numbers for the small integer types and FLOAT, a struct, a
   * list of structs; undefined for other types. */
  value(f: { type: number; data: number }): GffValue {
    switch (f.type) {
      case T_BYTE:
        return f.data & 0xff;
      case T_CHAR:
        return ((f.data & 0xff) << 24) >> 24;
      case T_WORD:
        return f.data & 0xffff;
      case T_SHORT:
        return ((f.data & 0xffff) << 16) >> 16;
      case T_DWORD:
        return f.data >>> 0;
      case T_INT:
        return f.data | 0;
      case T_FLOAT: {
        const dv = new DataView(new ArrayBuffer(4));
        dv.setUint32(0, f.data >>> 0, true);
        return dv.getFloat32(0, true);
      }
    }
    const fd = this.h[6]!;
    const fdEnd = fd + this.h[7]!;
    const inData = (o: number, len: number) => {
      if (o + len > fdEnd) throw new GffError("damaged GFF (a field's data reaches past its table)");
    };
    switch (f.type) {
      case T_CEXOSTRING: {
        const o = fd + f.data;
        inData(o, 4);
        const len = this.r.u32(o);
        inData(o + 4, len);
        return latin1(this.r.bytes.subarray(o + 4, o + 4 + len));
      }
      case T_RESREF: {
        const o = fd + f.data;
        inData(o, 1);
        const len = this.r.u8(o);
        inData(o + 1, len);
        return latin1(this.r.bytes.subarray(o + 1, o + 1 + len));
      }
      case T_STRUCT:
        return this.struct(f.data);
      case T_LIST: {
        if (f.data + 4 > this.h[11]!) throw new GffError("damaged GFF (a list reaches past its table)");
        const o = this.h[10]! + f.data;
        const n = this.r.u32(o);
        if (f.data + 4 + n * 4 > this.h[11]!) throw new GffError("damaged GFF (a list reaches past its table)");
        return Array.from({ length: n }, (_, i) => this.struct(this.r.u32(o + 4 + i * 4)));
      }
      default:
        return undefined;
    }
  }
}

export class GffStruct {
  constructor(
    private readonly gff: Gff,
    readonly type: number,
    private readonly fields: number[],
  ) {}

  /** Whether the struct has a field named label (case matters, as in the game). */
  has(label: string): boolean {
    return this.fields.some((i) => this.gff.field(i).label === label);
  }

  /** Every field, in order: its label, GFF type and value (as value() reads it). */
  entries(): { label: string; type: number; value: GffValue }[] {
    return this.fields.map((i) => {
      const f = this.gff.field(i);
      return { label: f.label, type: f.type, value: this.gff.value(f) };
    });
  }

  /** The value of the field named label, or undefined when the struct has none. */
  get(label: string): GffValue {
    for (const i of this.fields) {
      const f = this.gff.field(i);
      if (f.label === label) return this.gff.value(f);
    }
    return undefined;
  }
}

function latin1(b: Uint8Array): string {
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

/** Opens bytes as a GFF; a short or damaged file throws a GffError (never a TruncatedError or a RangeError). */
export function readGff(bytes: Uint8Array): Gff {
  try {
    return new Gff(bytes);
  } catch (e) {
    if (e instanceof TruncatedError) throw new GffError("truncated or damaged GFF");
    throw e;
  }
}
