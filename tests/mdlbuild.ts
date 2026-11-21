/** Small binary and ASCII GUI models built in memory, for the original-GUI tests (no game data needed). */

export interface BNode {
  name: string;
  kind: "dummy" | "trimesh" | "animmesh";
  position?: [number, number, number];
  bitmap?: string;
  render?: boolean;
  verts?: [number, number, number][];
  tverts?: [number, number][];
  faces?: [number, number, number][];
  /** An animmesh's frames: vertices and texture vertices per frame. */
  animverts?: [number, number, number][][];
  animtverts?: [number, number][][];
  children?: BNode[];
}

export interface BAnim {
  name: string;
  length: number;
  root: BNode;
}

class Buf {
  bytes: number[] = [];
  get length(): number {
    return this.bytes.length;
  }
  zero(n: number): number {
    const at = this.bytes.length;
    for (let i = 0; i < n; i++) this.bytes.push(0);
    return at;
  }
  u32(at: number, v: number): void {
    for (let i = 0; i < 4; i++) this.bytes[at + i] = (v >>> (i * 8)) & 255;
  }
  u16(at: number, v: number): void {
    this.bytes[at] = v & 255;
    this.bytes[at + 1] = (v >> 8) & 255;
  }
  u8(at: number, v: number): void {
    this.bytes[at] = v & 255;
  }
  f32(at: number, v: number): void {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, v, true);
    for (let i = 0; i < 4; i++) this.bytes[at + i] = dv.getUint8(i);
  }
  str(at: number, s: string): void {
    for (let i = 0; i < s.length; i++) this.bytes[at + i] = s.charCodeAt(i);
  }
  floats(vs: number[]): number {
    const at = this.zero(vs.length * 4);
    vs.forEach((v, i) => this.f32(at + i * 4, v));
    return at;
  }
}

const NONE = 0xffffffff;

/** A binary model: a header, the node tree and the animations, laid out as the game's compiled models are. */
export function makeBinaryMdl(name: string, root: BNode, anims: BAnim[] = []): Uint8Array {
  const m = new Buf();
  const raw = new Buf();
  const head = m.zero(232);
  m.str(head + 8, name);
  m.str(head + 168, "NULL");

  const node = (n: BNode): number => {
    const mesh = n.kind !== "dummy";
    const anim = n.kind === "animmesh";
    const at = m.zero(112 + (mesh ? 512 : 0) + (anim ? 56 : 0));
    m.str(at + 32, n.name);
    m.u32(at + 108, n.kind === "dummy" ? 1 : n.kind === "trimesh" ? 0x21 : 0xa1);
    if (n.position) {
      const keys = m.zero(12);
      m.u32(keys, 8);
      m.u16(keys + 4, 1);
      m.u16(keys + 6, 0);
      m.u16(keys + 8, 1);
      m.u8(keys + 10, 3);
      const data = m.floats([0, ...n.position]);
      m.u32(at + 84, keys);
      m.u32(at + 88, 1);
      m.u32(at + 96, data);
      m.u32(at + 100, 4);
    }
    if (mesh) {
      const h = at + 112;
      const verts = n.verts ?? [];
      const faces = n.faces ?? [];
      const fo = m.zero(faces.length * 32);
      faces.forEach((f, i) => f.forEach((v, k) => m.u16(fo + i * 32 + 26 + k * 2, v)));
      m.u32(h + 8, fo);
      m.u32(h + 12, faces.length);
      m.u32(h + 108, n.render === false ? 0 : 1);
      m.str(h + 120, n.bitmap ?? "NULL");
      for (const o of [444, 452, 456, 460, 464, 468, 472, 476, 480, 484, 488, 492, 496]) m.u32(h + o, NONE);
      if (verts.length) m.u32(h + 444, raw.floats(verts.flat()));
      m.u16(h + 448, verts.length);
      if (n.tverts?.length) m.u32(h + 452, raw.floats(n.tverts.flat()));
      if (anim) {
        const a = h + 512;
        m.f32(a, 1);
        const vf = n.animverts ?? [];
        const tf = n.animtverts ?? [];
        // vertex after vertex: each vertex in every frame, then the next
        if (vf.length) m.u32(a + 40, m.floats(verts.flatMap((_, v) => vf.flatMap((f) => f[v]!))));
        if (tf.length) m.u32(a + 44, m.floats(verts.flatMap((_, v) => tf.flatMap((f) => f[v]!))));
        m.u32(a + 48, vf.length);
        m.u32(a + 52, tf.length);
      }
    }
    const kids = (n.children ?? []).map(node);
    if (kids.length) {
      const arr = m.zero(kids.length * 4);
      kids.forEach((k, i) => m.u32(arr + i * 4, k));
      m.u32(at + 72, arr);
      m.u32(at + 76, kids.length);
    }
    return at;
  };

  const count = (n: BNode): number => 1 + (n.children ?? []).reduce((a, c) => a + count(c), 0);
  m.u32(head + 72, node(root));
  m.u32(head + 76, count(root));
  const animAt = anims.map((an) => {
    const at = m.zero(196);
    m.str(at + 8, an.name);
    m.f32(at + 112, an.length);
    m.u32(at + 72, node(an.root));
    return at;
  });
  if (animAt.length) {
    const arr = m.zero(animAt.length * 4);
    animAt.forEach((a, i) => m.u32(arr + i * 4, a));
    m.u32(head + 120, arr);
    m.u32(head + 124, animAt.length);
  }
  const out = new Buf();
  out.zero(12);
  out.u32(4, m.length);
  out.u32(8, raw.length);
  return new Uint8Array([...out.bytes, ...m.bytes, ...raw.bytes]);
}

/** The same model as ASCII, as a decompiler writes it. */
export function makeAsciiMdl(name: string, root: BNode, anims: BAnim[] = []): string {
  const out: string[] = [`newmodel ${name}`, `setsupermodel ${name} NULL`, `beginmodelgeom ${name}`];
  const geom = (n: BNode, parent: string) => {
    out.push(`node ${n.kind} ${n.name}`, `  parent ${parent}`);
    if (n.position) out.push(`  position ${n.position.join(" ")}`);
    if (n.kind !== "dummy") {
      out.push(`  bitmap ${n.bitmap ?? "NULL"}`, `  render ${n.render === false ? 0 : 1}`);
      out.push(`  verts ${n.verts?.length ?? 0}`, ...(n.verts ?? []).map((v) => `    ${v.join(" ")}`));
      out.push(`  faces ${n.faces?.length ?? 0}`, ...(n.faces ?? []).map((f) => `    ${f.join(" ")} 1 ${f.join(" ")} 0`));
      out.push(`  tverts ${n.tverts?.length ?? 0}`, ...(n.tverts ?? []).map((t) => `    ${t.join(" ")} 0`));
    }
    out.push("endnode");
    for (const c of n.children ?? []) geom(c, n.name);
  };
  geom(root, "NULL");
  out.push(`endmodelgeom ${name}`);
  for (const an of anims) {
    out.push(`newanim ${an.name} ${name}`, `  length ${an.length}`);
    const walk = (n: BNode, parent: string) => {
      out.push(`  node ${n.kind} ${n.name}`, `    parent ${parent}`);
      if (n.position) out.push("    positionkey", `      0 ${n.position.join(" ")}`, "    endlist");
      if (n.animverts?.length) out.push(`    animverts ${n.animverts.flat().length}`, ...n.animverts.flat().map((v) => `      ${v.join(" ")}`));
      if (n.animtverts?.length) out.push(`    animtverts ${n.animtverts.flat().length}`, ...n.animtverts.flat().map((t) => `      ${t.join(" ")} 0`));
      out.push("  endnode");
      for (const c of n.children ?? []) walk(c, n.name);
    };
    walk(an.root, "NULL");
    out.push(`doneanim ${an.name} ${name}`);
  }
  return `${out.join("\n")}\n`;
}
