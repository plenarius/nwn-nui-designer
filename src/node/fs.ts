/** Node file access for the core: files as ByteSources, a game install as a FileTree, the canvas factory. */
import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { NodeFileSource } from "./filesource.js";

export { NodeFileSource };
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { CanvasFactory, CanvasLike } from "../core/render/canvas.js";
import type { ByteSource } from "../core/res/source.js";
import type { FileTree } from "../core/res/resman.js";
import type { BitmapDecoder } from "../core/res/images.js";

/**
 * Throws if the file cannot be opened and read. It reads one byte, never the whole file: a hak can be far larger than
 * the longest string (or buffer) Node will make (l64_creatures.hak is 562 MB), and the archive readers only read the
 * parts they need.
 */
export function checkReadable(path: string): void {
  const fd = openSync(path, "r");
  try {
    readSync(fd, Buffer.alloc(1), 0, 1, 0);
  } finally {
    closeSync(fd);
  }
}

/** A folder on disk, looked up without regard to case. */
export class NodeTree implements FileTree {
  private readonly listings = new Map<string, Map<string, string>>();
  constructor(readonly root: string) {}
  get label(): string {
    return this.root;
  }
  /** name (lower case) -> real path, for the folder at the real path dir. */
  private listing(dir: string): Map<string, string> {
    let m = this.listings.get(dir);
    if (!m) {
      m = new Map();
      try {
        for (const e of readdirSync(dir)) m.set(e.toLowerCase(), join(dir, e));
      } catch {
        /* not a folder */
      }
      this.listings.set(dir, m);
    }
    return m;
  }
  /** The real path of a relative one, matching each part without regard to case. */
  private resolve(rel: string): string | null {
    let cur = this.root;
    for (const part of rel.replace(/\\/g, "/").split("/").filter(Boolean)) {
      const next = this.listing(cur).get(part.toLowerCase());
      if (!next) return null;
      cur = next;
    }
    return cur;
  }
  file(relPath: string): ByteSource | null {
    const p = this.resolve(relPath);
    if (!p) return null;
    try {
      if (!statSync(p).isFile()) return null;
      return new NodeFileSource(p);
    } catch {
      return null;
    }
  }
  list(relDir: string): ByteSource[] {
    const d = this.resolve(relDir);
    if (!d) return [];
    const out: ByteSource[] = [];
    for (const p of this.listing(d).values()) {
      try {
        if (statSync(p).isFile()) out.push(new NodeFileSource(p));
      } catch {
        /* skip */
      }
    }
    return out;
  }
}

export const nodeCanvas: CanvasFactory = (w, h) => createCanvas(Math.max(1, w), Math.max(1, h)) as unknown as CanvasLike;

export const nodeBitmapDecoder: BitmapDecoder = async (bytes) => {
  try {
    const im = await loadImage(Buffer.from(bytes));
    const c = createCanvas(im.width, im.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(im, 0, 0);
    const id = ctx.getImageData(0, 0, im.width, im.height);
    return { width: im.width, height: im.height, data: new Uint8ClampedArray(id.data) };
  } catch {
    return null;
  }
};

export async function savePng(c: CanvasLike, path: string): Promise<void> {
  const { writeFileSync } = await import("node:fs");
  const buf = (c as unknown as { encode(f: "png"): Promise<Buffer> }).encode("png");
  writeFileSync(path, await buf);
}

/** The files of a folder that are NWN resources (for an override layer). */
export function folderSources(dir: string): ByteSource[] {
  return readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile())
    .map((p) => new NodeFileSource(p));
}
