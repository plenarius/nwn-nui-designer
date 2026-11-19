/**
 * Random access to a file's bytes, the same way in the browser (a File or Blob, sliced) and in Node (a file handle).
 * The containers read only their directories up front and each resource when it is asked for, so a 1 GB hak costs
 * a few KB until something in it is drawn.
 */
export interface ByteSource {
  /** The file name (no folder), e.g. "l64_icons.hak". */
  readonly name: string;
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** Bytes already in memory (tests, pasted data, generated resources). */
export class MemorySource implements ByteSource {
  constructor(
    readonly name: string,
    private readonly bytes: Uint8Array,
  ) {}
  get size(): number {
    return this.bytes.length;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    return this.bytes.subarray(offset, offset + length);
  }
}

/** A browser Blob or File. */
export class BlobSource implements ByteSource {
  constructor(
    readonly name: string,
    private readonly blob: Blob,
  ) {}
  get size(): number {
    return this.blob.size;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    const buf = await this.blob.slice(offset, offset + length).arrayBuffer();
    return new Uint8Array(buf);
  }
}

export async function readAll(src: ByteSource): Promise<Uint8Array> {
  return src.read(0, src.size);
}

/** A file shorter than its own header or tables say. */
export class TruncatedError extends Error {}

/** Little-endian reads on a byte array. Reading past the end throws a TruncatedError. */
export class Reader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  /** Throws unless bytes o .. o + len - 1 are there. */
  need(o: number, len: number): void {
    if (o < 0 || len < 0 || o + len > this.bytes.length) {
      throw new TruncatedError(`truncated: needs bytes ${o}..${o + len} of ${this.bytes.length}`);
    }
  }
  u8(o: number): number {
    this.need(o, 1);
    return this.view.getUint8(o);
  }
  u16(o: number): number {
    this.need(o, 2);
    return this.view.getUint16(o, true);
  }
  u32(o: number): number {
    this.need(o, 4);
    return this.view.getUint32(o, true);
  }
  f32(o: number): number {
    this.need(o, 4);
    return this.view.getFloat32(o, true);
  }
  /** A NUL-padded latin-1 string of at most len bytes. */
  str(o: number, len: number): string {
    this.need(o, len);
    let s = "";
    for (let i = 0; i < len; i++) {
      const c = this.bytes[o + i]!;
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
}
