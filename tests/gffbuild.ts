/** Small GFF V3.2 and ERF files built in memory, for the hak order tests (no game data needed). */

export type Field = { label: string } & ({ str: string } | { dword: number } | { list: Field[][] });

/** A GFF V3.2 of fileType whose top-level struct has fields (CExoString, DWORD and lists of structs only). */
export function makeGff(fileType: string, fields: Field[]): Uint8Array {
  const structs: [type: number, data: number, count: number][] = [];
  const fieldRows: [type: number, label: number, data: number][] = [];
  const labels: string[] = [];
  const fieldData: number[] = [];
  const fieldIndices: number[] = [];
  const listIndices: number[] = [];
  const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const label = (l: string) => {
    let i = labels.indexOf(l);
    if (i < 0) i = labels.push(l) - 1;
    return i;
  };
  const addStruct = (type: number, fs: Field[]): number => {
    const index = structs.length;
    structs.push([type, 0, fs.length]);
    const ids = fs.map((f) => {
      const id = fieldRows.length;
      fieldRows.push([0, label(f.label), 0]);
      if ("str" in f) {
        fieldRows[id] = [10, label(f.label), fieldData.length];
        fieldData.push(...u32(f.str.length), ...[...f.str].map((c) => c.charCodeAt(0)));
      } else if ("dword" in f) fieldRows[id] = [4, label(f.label), f.dword];
      else {
        const items = f.list.map((s) => addStruct(8, s));
        fieldRows[id] = [15, label(f.label), listIndices.length * 4];
        listIndices.push(items.length, ...items);
      }
      return id;
    });
    if (ids.length === 1) structs[index]![1] = ids[0]!;
    else if (ids.length > 1) {
      structs[index]![1] = fieldIndices.length * 4;
      fieldIndices.push(...ids);
    }
    return index;
  };
  addStruct(0xffffffff, fields);
  const sections = [
    structs.flatMap(([a, b, c]) => [...u32(a), ...u32(b), ...u32(c)]),
    fieldRows.flatMap(([a, b, c]) => [...u32(a), ...u32(b), ...u32(c)]),
    labels.flatMap((l) => [...l].map((c) => c.charCodeAt(0)).concat(Array(16 - l.length).fill(0))),
    fieldData,
    fieldIndices.flatMap(u32),
    listIndices.flatMap(u32),
  ];
  const counts = [structs.length, fieldRows.length, labels.length, fieldData.length, fieldIndices.length * 4, listIndices.length * 4];
  const head: number[] = [...fileType, ..."V3.2"].map((c) => c.charCodeAt(0));
  let off = 56;
  sections.forEach((s, i) => {
    head.push(...u32(off), ...u32(counts[i]!));
    off += s.length;
  });
  return new Uint8Array([...head, ...sections.flat()]);
}

/** An ERF V1.0 ("MOD " by default) holding the given resources. */
export function makeErf(res: [string, number, Uint8Array][], type = "MOD "): Uint8Array {
  const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const name = (s: string, n: number) => [...s].map((c) => c.charCodeAt(0)).concat(Array(n - s.length).fill(0));
  const head = 160;
  const offRes = head + res.length * 24;
  let offData = offRes + res.length * 8;
  const keys: number[] = [];
  const list: number[] = [];
  const data: number[] = [];
  res.forEach(([n, t, d], i) => {
    keys.push(...name(n, 16), ...u32(i), t & 255, t >> 8, 0, 0);
    list.push(...u32(offData), ...u32(d.length));
    offData += d.length;
    data.push(...d);
  });
  const h = [...name(type, 4), ...name("V1.0", 4), ...u32(0), ...u32(0), ...u32(res.length), ...u32(head), ...u32(head), ...u32(offRes)];
  return new Uint8Array([...h, ...Array(head - h.length).fill(0), ...keys, ...list, ...data]);
}
