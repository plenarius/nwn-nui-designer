/**
 * NWN resource containers: KEY/BIF archives, ERF/HAK/MOD files and folders of loose files. Written from the file
 * formats (BioWare's published Aurora KEY/BIF and ERF specifications, as nui-preview's resman.py reads them);
 * no third-party code.
 */

import { type ByteSource, Reader, TruncatedError } from "./source.js";
import { resKey, splitResName } from "./restype.js";

export interface Container {
  /** What the container is, for the UI and for messages ("l64_icons.hak", "data/nwn_base.key"). */
  readonly label: string;
  has(resref: string, type: number): boolean;
  get(resref: string, type: number): Promise<Uint8Array | null>;
  /** Every resource in it, as [resref, type]. */
  entries(): Iterable<[string, number]>;
}

/** A HAK, ERF or MOD: its directory read once, each resource read when asked for. */
export class Erf implements Container {
  private readonly table = new Map<string, [offset: number, size: number]>();
  private readonly list: [string, number][] = [];
  fileType = "";
  version = "";

  private constructor(
    readonly label: string,
    private readonly src: ByteSource,
  ) {}

  static async open(src: ByteSource, label = src.name): Promise<Erf> {
    const erf = new Erf(label, src);
    if (src.size < 160) throw new Error(`${src.name}: not an ERF (${src.size} bytes, shorter than its header)`);
    const head = new Reader(await src.read(0, 160));
    erf.fileType = head.str(0, 4);
    erf.version = head.str(4, 4);
    if (erf.version !== "V1.0" && erf.version !== "V1.1") {
      throw new Error(`${src.name}: unsupported ERF version "${erf.version}"`);
    }
    const count = head.u32(16);
    const offKeys = head.u32(24);
    const offRes = head.u32(28);
    const nameLen = erf.version === "V1.1" ? 32 : 16;
    const keySize = nameLen + 8;
    if (offKeys + count * keySize > src.size || offRes + count * 8 > src.size) {
      throw new Error(`${src.name}: truncated or damaged ERF (its ${count} entries reach past the end of the file)`);
    }
    const keys = new Reader(await src.read(offKeys, count * keySize));
    const res = new Reader(await src.read(offRes, count * 8));
    for (let i = 0; i < count; i++) {
      const k = i * keySize;
      const name = keys.str(k, nameLen).toLowerCase();
      const type = keys.u16(k + nameLen + 4);
      const off = res.u32(i * 8);
      const size = res.u32(i * 8 + 4);
      // A resource reaching past the end is left out rather than read short.
      if (off + size > src.size) continue;
      const key = resKey(name, type);
      // The first entry of a name wins, as in nui-preview (a well-formed ERF has one).
      if (!erf.table.has(key)) {
        erf.table.set(key, [off, size]);
        erf.list.push([name, type]);
      }
    }
    return erf;
  }

  has(resref: string, type: number): boolean {
    return this.table.has(resKey(resref, type));
  }

  async get(resref: string, type: number): Promise<Uint8Array | null> {
    const e = this.table.get(resKey(resref, type));
    if (!e) return null;
    return this.src.read(e[0], e[1]);
  }

  entries(): Iterable<[string, number]> {
    return this.list;
  }
}

/** Finds the file a KEY names (relative to the game root, e.g. "data\\base_2da.bif"). */
export type FileResolver = (relPath: string) => ByteSource | null;

/** A KEY file and the BIFs it names. */
export class Key implements Container {
  private readonly table = new Map<string, [bif: number, index: number]>();
  private readonly list: [string, number][] = [];
  private readonly bifNames: string[] = [];
  private readonly bifTables = new Map<number, Promise<Map<number, [number, number]>>>();

  private constructor(
    readonly label: string,
    private readonly resolve: FileResolver,
  ) {}

  static async open(src: ByteSource, resolve: FileResolver, label = src.name): Promise<Key> {
    const key = new Key(label, resolve);
    const data = await src.read(0, src.size);
    const r = new Reader(data);
    if (data.length < 24 || r.str(0, 8) !== "KEY V1  ") throw new Error(`${src.name}: not a KEY V1 file`);
    try {
      key.readTables(r);
    } catch (e) {
      if (e instanceof TruncatedError) throw new Error(`${src.name}: truncated or damaged KEY file`);
      throw e;
    }
    return key;
  }

  /** The BIF names and the resource table (Key.open checks the signature first). */
  private readTables(r: Reader): void {
    const bifCount = r.u32(8);
    const keyCount = r.u32(12);
    const offFiles = r.u32(16);
    const offKeys = r.u32(20);
    for (let i = 0; i < bifCount; i++) {
      const o = offFiles + i * 12;
      const nameOff = r.u32(o + 4);
      const nameLen = r.u16(o + 8);
      this.bifNames.push(r.str(nameOff, nameLen).replace(/\\/g, "/"));
    }
    for (let i = 0; i < keyCount; i++) {
      const o = offKeys + i * 22;
      const name = r.str(o, 16).toLowerCase();
      const type = r.u16(o + 16);
      const id = r.u32(o + 18);
      const k = resKey(name, type);
      if (!this.table.has(k)) {
        this.table.set(k, [id >>> 20, id & 0xfffff]);
        this.list.push([name, type]);
      }
    }
  }

  /** The BIF files the KEY names, and whether each was found. */
  bifs(): { name: string; found: boolean }[] {
    return this.bifNames.map((name) => ({ name, found: this.resolve(name) !== null }));
  }

  private table_(bif: number): Promise<Map<number, [number, number]>> {
    let t = this.bifTables.get(bif);
    if (!t) {
      t = (async () => {
        const name = this.bifNames[bif];
        const src = name !== undefined ? this.resolve(name) : null;
        if (!src) throw new Error(`${this.label}: BIF ${name ?? bif} not found`);
        if (src.size < 20) throw new Error(`${src.name}: not a BIFF V1 file`);
        const head = new Reader(await src.read(0, 20));
        const sig = head.str(0, 8);
        if (sig !== "BIFFV1  ") throw new Error(`${src.name}: not a BIFF V1 file ("${sig}")`);
        const varCount = head.u32(8);
        const offVar = head.u32(16);
        if (offVar + varCount * 16 > src.size) throw new Error(`${src.name}: truncated or damaged BIF`);
        const raw = new Reader(await src.read(offVar, varCount * 16));
        const table = new Map<number, [number, number]>();
        for (let i = 0; i < varCount; i++) {
          table.set(raw.u32(i * 16) & 0xfffff, [raw.u32(i * 16 + 4), raw.u32(i * 16 + 8)]);
        }
        return table;
      })();
      this.bifTables.set(bif, t);
    }
    return t;
  }

  has(resref: string, type: number): boolean {
    return this.table.has(resKey(resref, type));
  }

  /** The BIF a resource is in ("data/aurora_gui.bif"), or null. */
  bifOf(resref: string, type: number): string | null {
    const e = this.table.get(resKey(resref, type));
    return e ? (this.bifNames[e[0]] ?? null) : null;
  }

  async get(resref: string, type: number): Promise<Uint8Array | null> {
    const e = this.table.get(resKey(resref, type));
    if (!e) return null;
    const [bif, idx] = e;
    const src = this.resolve(this.bifNames[bif] ?? "");
    if (!src) return null;
    const ent = (await this.table_(bif)).get(idx);
    if (!ent || ent[0] + ent[1] > src.size) return null;
    return src.read(ent[0], ent[1]);
  }

  entries(): Iterable<[string, number]> {
    return this.list;
  }
}

/** Loose files (a game's ovr/ or override folder, a development folder, files the user dropped in). */
export class Folder implements Container {
  private readonly table = new Map<string, ByteSource>();
  private readonly list: [string, number][] = [];

  constructor(
    readonly label: string,
    files: Iterable<ByteSource>,
  ) {
    for (const f of files) this.add(f);
  }

  add(f: ByteSource): boolean {
    const rn = splitResName(f.name);
    if (!rn) return false;
    const k = resKey(rn[0], rn[1]);
    if (this.table.has(k)) return false;
    this.table.set(k, f);
    this.list.push(rn);
    return true;
  }

  has(resref: string, type: number): boolean {
    return this.table.has(resKey(resref, type));
  }

  async get(resref: string, type: number): Promise<Uint8Array | null> {
    const f = this.table.get(resKey(resref, type));
    return f ? f.read(0, f.size) : null;
  }

  entries(): Iterable<[string, number]> {
    return this.list;
  }
}

/** Resources made in memory (the fallback skin, tests). */
export class MemoryContainer implements Container {
  private readonly table = new Map<string, Uint8Array>();
  constructor(readonly label: string) {}
  set(resref: string, type: number, data: Uint8Array): void {
    this.table.set(resKey(resref, type), data);
  }
  has(resref: string, type: number): boolean {
    return this.table.has(resKey(resref, type));
  }
  async get(resref: string, type: number): Promise<Uint8Array | null> {
    return this.table.get(resKey(resref, type)) ?? null;
  }
  *entries(): Iterable<[string, number]> {
    for (const k of this.table.keys()) {
      const dot = k.lastIndexOf(".");
      yield [k.slice(0, dot), Number(k.slice(dot + 1))];
    }
  }
}
