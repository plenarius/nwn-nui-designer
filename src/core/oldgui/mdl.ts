/**
 * A reader for the original GUI's panel models: binary MDL (as the game ships them) and ASCII MDL (as a hak may hold
 * them). It reads what the GUI needs and nothing more: the node tree, each mesh's texture, vertices, texture
 * vertices, faces and render flag, and each animation's per-node texture vertices (the frames a button's states
 * read), vertices and controller keys. Written from the published layout of BioWare's model format; no third-party
 * code.
 */
import { Reader, TruncatedError } from "../res/source.js";

export class MdlError extends Error {}

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** An axis and angle (radians) as a unit quaternion [x, y, z, w]. */
export function axisAngleQuat(x: number, y: number, z: number, a: number): Quat {
  const n = Math.hypot(x, y, z);
  if (n < 1e-12 || Math.abs(a) < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(a / 2) / n;
  return [x * s, y * s, z * s, Math.cos(a / 2)];
}

/** [v0, v1, v2, t0, t1, t2]: a triangle's vertex indices and its texture-vertex indices. */
export type Face = [number, number, number, number, number, number];

export interface MdlNode {
  name: string;
  parent: string | null;
  /** "dummy", "trimesh", "animmesh", "danglymesh", "skin", "aabb", "light", "emitter", "reference", "camera". */
  kind: string;
  position: Vec3;
  /** Rotation as a unit quaternion [x, y, z, w] (ASCII models give an axis and angle; both are read to this). */
  orientation: Quat;
  /** The mesh's opacity (1 when it has no alpha). */
  alpha: number;
  /** Lower case; null for a node with no texture (or "null"). */
  bitmap: string | null;
  render: boolean;
  transparencyHint: number;
  verts: Vec3[];
  tverts: Vec2[];
  faces: Face[];
}

export interface AnimNode {
  name: string;
  /** Texture vertices per frame, concatenated (an animmesh's animtverts); its geometry's tverts when it has none. */
  animtverts?: Vec2[];
  /** Vertices per frame, concatenated (animverts). */
  animverts?: Vec3[];
  /** Texture vertices of the animation's own copy of the mesh, when it carries one. */
  tverts?: Vec2[];
  verts?: Vec3[];
  bitmap?: string;
  sampleperiod?: number;
  /** Controller keys by name ("positionkey", "alphakey", ...): rows of [time, ...values]; orientationkey rows are
   * [time, x, y, z, w] quaternions in both formats. */
  keys: Record<string, number[][]>;
}

export interface MdlAnim {
  name: string;
  length: number;
  nodes: Map<string, AnimNode>;
}

export interface Mdl {
  name: string;
  supermodel: string | null;
  /** In file order. */
  nodes: MdlNode[];
  anims: Map<string, MdlAnim>;
  binary: boolean;
}

/** Reads a model; throws an MdlError for anything that is not one. */
export function readMdl(bytes: Uint8Array): Mdl {
  if (bytes.length >= 12 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0) {
    try {
      return readBinary(bytes);
    } catch (e) {
      if (e instanceof TruncatedError || e instanceof RangeError) throw new MdlError(`truncated or damaged binary model (${e.message})`);
      throw e;
    }
  }
  return readAscii(latin1(bytes));
}

// ---------------------------------------------------------------------------------------------------------------
// binary

const NF_MESH = 0x20;
const NF_SKIN = 0x40;
const NF_ANIM = 0x80;
const NF_DANGLY = 0x100;
const NF_AABB = 0x200;

const NODE_HEADER = 112;
const MESH_HEADER = 512;

/** Controller types: the ones every node has, and the mesh ones (types above 100 depend on the node's kind). */
const CONTROLLERS: Record<number, string> = { 8: "position", 20: "orientation", 36: "scale" };
const MESH_CONTROLLERS: Record<number, string> = { 100: "selfillumcolor", 128: "alpha", 132: "alpha" };

function kindOf(flags: number): string {
  if (flags & NF_AABB) return "aabb";
  if (flags & NF_DANGLY) return "danglymesh";
  if (flags & NF_ANIM) return "animmesh";
  if (flags & NF_SKIN) return "skin";
  if (flags & NF_MESH) return "trimesh";
  if (flags & 0x4) return "emitter";
  if (flags & 0x2) return "light";
  if (flags & 0x8) return "camera";
  if (flags & 0x10) return "reference";
  return "dummy";
}

function readBinary(bytes: Uint8Array): Mdl {
  const file = new Reader(bytes);
  const modelSize = file.u32(4);
  const rawSize = file.u32(8);
  if (12 + modelSize > bytes.length) throw new MdlError("damaged binary model (its model data reaches past the end)");
  const r = new Reader(bytes.subarray(12, 12 + modelSize));
  const raw = new Reader(bytes.subarray(12 + modelSize, Math.min(bytes.length, 12 + modelSize + rawSize)));
  const name = r.str(8, 64).toLowerCase();
  const root = r.u32(72);
  const [animOff, animCount] = [r.u32(120), r.u32(124)];
  const superName = r.str(168, 64).toLowerCase();
  const nodes: MdlNode[] = [];
  const geomTverts = new Map<string, Vec2[]>();
  const guard = new Set<number>();

  const array = (o: number): [number, number] => [r.u32(o), r.u32(o + 4)];

  const controllers = (o: number, mesh: boolean): Record<string, number[][]> => {
    const [ko, kc] = array(o + 84);
    const [doff] = array(o + 96);
    const out: Record<string, number[][]> = {};
    for (let i = 0; i < kc; i++) {
      const k = ko + i * 12;
      const type = r.u32(k);
      const rows = r.u16(k + 4);
      const timeAt = r.u16(k + 6);
      const dataAt = r.u16(k + 8);
      let cols = r.u8(k + 10);
      const bezier = (cols & 16) !== 0;
      cols &= 15;
      const nm = CONTROLLERS[type] ?? (mesh ? MESH_CONTROLLERS[type] : undefined) ?? `controller${type}`;
      const keys: number[][] = [];
      const width = bezier ? cols * 3 : cols;
      for (let j = 0; j < rows; j++) {
        const row = [r.f32(doff + (timeAt + j) * 4)];
        for (let c = 0; c < cols; c++) row.push(r.f32(doff + (dataAt + j * width + c) * 4));
        keys.push(row);
      }
      out[`${nm}key`] = keys;
    }
    return out;
  };

  const mesh = (o: number) => {
    const m = o + NODE_HEADER;
    const [fo, fc] = array(m + 8);
    const render = r.u32(m + 108);
    const transparencyHint = r.u32(m + 112);
    const bitmap = r.str(m + 120, 64).toLowerCase();
    const vertOff = r.u32(m + 444);
    const vertCount = r.u16(m + 448);
    const tvOff = r.u32(m + 452);
    const verts: Vec3[] = [];
    const tverts: Vec2[] = [];
    if (vertOff !== 0xffffffff && vertCount) {
      for (let i = 0; i < vertCount; i++) verts.push([raw.f32(vertOff + i * 12), raw.f32(vertOff + i * 12 + 4), raw.f32(vertOff + i * 12 + 8)]);
    }
    if (tvOff !== 0xffffffff && vertCount) {
      for (let i = 0; i < vertCount; i++) tverts.push([raw.f32(tvOff + i * 8), raw.f32(tvOff + i * 8 + 4)]);
    }
    const faces: Face[] = [];
    for (let i = 0; i < fc; i++) {
      const f = fo + i * 32;
      const a = r.u16(f + 26);
      const b = r.u16(f + 28);
      const c = r.u16(f + 30);
      faces.push([a, b, c, a, b, c]);
    }
    return { render: render !== 0, transparencyHint, bitmap: bitmap && bitmap !== "null" ? bitmap : null, verts, tverts, faces };
  };

  /** An animmesh's frames, frame after frame (as ASCII lists them). The binary stores them vertex after vertex: each
   * vertex's position in every frame, then the next vertex's. */
  const animMesh = (o: number): { animverts: Vec3[]; animtverts: Vec2[]; sampleperiod: number } => {
    const a = o + NODE_HEADER + MESH_HEADER;
    const sampleperiod = r.f32(a);
    const vertSets = r.u32(a + 40);
    const texSets = r.u32(a + 44);
    const vertSetCount = r.u32(a + 48);
    const texSetCount = r.u32(a + 52);
    const n = r.u16(o + NODE_HEADER + 448);
    const animverts: Vec3[] = [];
    const animtverts: Vec2[] = [];
    if (vertSets && vertSets !== 0xffffffff) {
      for (let f = 0; f < vertSetCount; f++) {
        for (let v = 0; v < n; v++) {
          const at = vertSets + (v * vertSetCount + f) * 12;
          animverts.push([r.f32(at), r.f32(at + 4), r.f32(at + 8)]);
        }
      }
    }
    if (texSets && texSets !== 0xffffffff) {
      for (let f = 0; f < texSetCount; f++) {
        for (let v = 0; v < n; v++) {
          const at = texSets + (v * texSetCount + f) * 8;
          animtverts.push([r.f32(at), r.f32(at + 4)]);
        }
      }
    }
    return { animverts, animtverts, sampleperiod };
  };

  const walk = (o: number, parent: string | null, into: (o: number, name: string, parent: string | null, flags: number) => void) => {
    if (guard.has(o)) throw new MdlError("damaged binary model (a node is its own ancestor)");
    guard.add(o);
    const flags = r.u32(o + 108);
    const nm = r.str(o + 32, 32).toLowerCase();
    into(o, nm, parent, flags);
    const [co, cc] = array(o + 72);
    for (let i = 0; i < cc; i++) walk(r.u32(co + i * 4), nm, into);
  };

  walk(root, null, (o, nm, parent, flags) => {
    const keys = controllers(o, (flags & NF_MESH) !== 0);
    const pos = keys.positionkey?.[0];
    const ori = keys.orientationkey?.[0];
    const node: MdlNode = {
      name: nm,
      parent,
      kind: kindOf(flags),
      position: pos ? [pos[1] ?? 0, pos[2] ?? 0, pos[3] ?? 0] : [0, 0, 0],
      orientation: ori && ori.length >= 5 ? [ori[1]!, ori[2]!, ori[3]!, ori[4]!] : [0, 0, 0, 1],
      alpha: keys.alphakey?.[0]?.[1] ?? 1,
      bitmap: null,
      render: true,
      transparencyHint: 0,
      verts: [],
      tverts: [],
      faces: [],
    };
    if (flags & NF_MESH) {
      Object.assign(node, mesh(o));
      geomTverts.set(nm, node.tverts);
    }
    nodes.push(node);
  });

  const anims = new Map<string, MdlAnim>();
  for (let i = 0; i < animCount; i++) {
    const a = r.u32(animOff + i * 4);
    const an: MdlAnim = { name: r.str(a + 8, 64).toLowerCase(), length: r.f32(a + 112), nodes: new Map() };
    guard.clear();
    const aroot = r.u32(a + 72);
    walk(aroot, null, (o, nm, _parent, flags) => {
      const isMesh = (flags & NF_MESH) !== 0;
      const n: AnimNode = { name: nm, keys: controllers(o, isMesh) };
      if (isMesh) {
        const m = mesh(o);
        if (m.verts.length) n.verts = m.verts;
        if (m.tverts.length) n.tverts = m.tverts;
        if (m.bitmap) n.bitmap = m.bitmap;
        if (flags & NF_ANIM) {
          const f = animMesh(o);
          n.sampleperiod = f.sampleperiod;
          if (f.animverts.length) n.animverts = f.animverts;
          if (f.animtverts.length) n.animtverts = f.animtverts;
        }
      }
      an.nodes.set(nm, n);
    });
    anims.set(an.name, an);
  }
  return { name, supermodel: superName && superName !== "null" ? superName : null, nodes, anims, binary: true };
}

// ---------------------------------------------------------------------------------------------------------------
// ASCII

function readAscii(text: string): Mdl {
  const lines = text.split(/\r?\n/);
  let model: Mdl | null = null;
  let anim: MdlAnim | null = null;
  let node: MdlNode | null = null;
  let anode: AnimNode | null = null;
  let i = 0;
  const num = (s: string | undefined) => {
    const v = Number(s);
    return Number.isFinite(v) ? v : 0;
  };
  const block = (count: number): string[][] => {
    const out: string[][] = [];
    for (let k = 0; k < count && i + 1 < lines.length; k++) {
      i++;
      out.push(lines[i]!.trim().split(/\s+/));
    }
    return out;
  };
  /** A key list: "positionkey N" then N rows, or "positionkey" then rows up to "endlist". */
  const keyRows = (t: string[]): number[][] => {
    if (t.length >= 2 && /^\d+$/.test(t[1]!)) {
      const rows = block(Number(t[1])).map((r) => r.map(num));
      // a counted list may still end with endlist
      if (lines[i + 1]?.trim().toLowerCase() === "endlist") i++;
      return rows;
    }
    const rows: number[][] = [];
    while (i + 1 < lines.length) {
      i++;
      const s = lines[i]!.trim();
      if (!s || s.toLowerCase() === "endlist") break;
      rows.push(s.split(/\s+/).map(num));
    }
    return rows;
  };
  for (; i < lines.length; i++) {
    const t = lines[i]!.trim().split(/\s+/);
    const k = (t[0] ?? "").toLowerCase();
    if (!k || k.startsWith("#")) continue;
    if (k === "newmodel") {
      model = { name: (t[1] ?? "").toLowerCase(), supermodel: null, nodes: [], anims: new Map(), binary: false };
      continue;
    }
    if (!model) continue;
    if (k === "setsupermodel") {
      const s = (t[2] ?? "").toLowerCase();
      model.supermodel = s && s !== "null" ? s : null;
    } else if (k === "newanim") {
      anim = { name: (t[1] ?? "").toLowerCase(), length: 0, nodes: new Map() };
      model.anims.set(anim.name, anim);
    } else if (k === "doneanim") {
      anim = null;
    } else if (k === "length" && anim && !anode) {
      anim.length = num(t[1]);
    } else if (k === "node") {
      const nm = (t[2] ?? "").toLowerCase();
      if (anim) {
        anode = { name: nm, keys: {} };
        anim.nodes.set(nm, anode);
      } else {
        node = {
          name: nm,
          parent: null,
          kind: (t[1] ?? "").toLowerCase(),
          position: [0, 0, 0],
          orientation: [0, 0, 0, 1],
          alpha: 1,
          bitmap: null,
          render: true,
          transparencyHint: 0,
          verts: [],
          tverts: [],
          faces: [],
        };
        model.nodes.push(node);
      }
    } else if (k === "endnode") {
      node = null;
      anode = null;
    } else if (anode) {
      if (k === "animtverts" || k === "tverts") {
        const v = block(num(t[1])).map((r): Vec2 => [num(r[0]), num(r[1])]);
        anode[k] = v;
      } else if (k === "animverts" || k === "verts") {
        const v = block(num(t[1])).map((r): Vec3 => [num(r[0]), num(r[1]), num(r[2])]);
        anode[k] = v;
      } else if (k === "faces" || k === "normals" || k === "colors" || k === "tangents") {
        block(num(t[1]));
      } else if (k.endsWith("key")) {
        const rows = keyRows(t);
        // ASCII orientation keys are an axis and an angle: read as quaternions, as the binary stores them
        anode.keys[k] = k === "orientationkey" ? rows.map((r) => [r[0] ?? 0, ...axisAngleQuat(r[1] ?? 0, r[2] ?? 0, r[3] ?? 0, r[4] ?? 0)]) : rows;
      } else if (k === "sampleperiod") {
        anode.sampleperiod = num(t[1]);
      } else if (k === "bitmap" || k === "texture0") {
        anode.bitmap = (t[1] ?? "").toLowerCase();
      }
    } else if (node) {
      if (k === "parent") {
        const p = (t[1] ?? "").toLowerCase();
        node.parent = p && p !== "null" ? p : null;
      } else if (k === "position") node.position = [num(t[1]), num(t[2]), num(t[3])];
      else if (k === "orientation") node.orientation = axisAngleQuat(num(t[1]), num(t[2]), num(t[3]), num(t[4]));
      else if (k === "alpha") node.alpha = num(t[1]);
      else if (k === "bitmap" || k === "texture0") {
        const b = (t[1] ?? "").toLowerCase();
        node.bitmap = b && b !== "null" ? b : null;
      } else if (k === "render") node.render = num(t[1]) !== 0;
      else if (k === "transparencyhint") node.transparencyHint = num(t[1]);
      else if (k === "verts") node.verts = block(num(t[1])).map((r): Vec3 => [num(r[0]), num(r[1]), num(r[2])]);
      else if (k === "tverts") node.tverts = block(num(t[1])).map((r): Vec2 => [num(r[0]), num(r[1])]);
      else if (k === "faces") {
        node.faces = block(num(t[1])).map((r): Face => [num(r[0]), num(r[1]), num(r[2]), num(r[4]), num(r[5]), num(r[6])]);
      } else if (/^(normals|colors|tangents|texindices\d|tverts\d|animtverts|animverts|weights|constraints|aabb)$/.test(k) && /^\d+$/.test(t[1] ?? "")) {
        block(num(t[1]));
      } else if (k.endsWith("key") && t.length <= 2) {
        keyRows(t);
      }
    }
  }
  if (!model) throw new MdlError("not a model (no newmodel line, and not a binary model)");
  return model;
}

function latin1(b: Uint8Array): string {
  let s = "";
  const step = 0x8000;
  for (let o = 0; o < b.length; o += step) s += String.fromCharCode(...b.subarray(o, o + step));
  return s;
}

/** The textures a model draws: its meshes' and its animations' (lower case, first use first). */
export function modelTextures(m: Mdl): string[] {
  const out: string[] = [];
  const add = (t: string | null | undefined) => {
    if (t && t !== "null" && !out.includes(t)) out.push(t);
  };
  for (const n of m.nodes) add(n.bitmap);
  for (const a of m.anims.values()) for (const n of a.nodes.values()) add(n.bitmap);
  return out;
}
