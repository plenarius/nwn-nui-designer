/**
 * A minimal ZIP writer (stored, no compression; PKWARE's APPNOTE): enough to hand someone a folder of loose files for
 * their override or development folder. Textures and fonts barely compress, and this keeps the code small.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** "/"-separated path inside the zip. */
  name: string;
  data: Uint8Array;
}

/** DOS date and time of d, from its UTC fields (so the same instant gives the same bytes anywhere; seconds halved). */
function dosTime(d: Date): [time: number, date: number] {
  const y = Math.max(1980, d.getUTCFullYear());
  return [(d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1), ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()];
}

export function writeZip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const [time, date] = dosTime(when);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    parts.push(local, e.data);
    central.push(c);
    offset += local.length + e.data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Reads a stored (uncompressed) zip back: for tests and for loading the designer's own exports. */
export function readStoredZip(zip: Uint8Array): ZipEntry[] {
  try {
    return readStored(zip);
  } catch (e) {
    if (e instanceof RangeError) throw new Error("truncated or damaged zip file");
    throw e;
  }
}

function readStored(zip: Uint8Array): ZipEntry[] {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let e = zip.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("not a zip file");
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("bad zip directory");
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true);
    const xl = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nl));
    if (method !== 0) throw new Error(`${name}: compressed entries are not supported`);
    const lnl = dv.getUint16(off + 26, true);
    const lxl = dv.getUint16(off + 28, true);
    if (off + 30 + lnl + lxl + size > zip.length) throw new Error(`${name}: truncated or damaged zip file`);
    out.push({ name, data: zip.slice(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size) });
    p += 46 + nl + xl + cl;
  }
  return out;
}
