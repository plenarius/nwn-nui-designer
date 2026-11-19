/** A file on disk as the core's ByteSource (no canvas import, so the dev server's local API can use it). */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { ByteSource } from "../core/res/source.js";

export class NodeFileSource implements ByteSource {
  readonly name: string;
  readonly size: number;
  constructor(readonly path: string) {
    this.name = basename(path);
    this.size = statSync(path).size;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    const fd = openSync(this.path, "r");
    try {
      const buf = Buffer.alloc(Math.max(0, Math.min(length, this.size - offset)));
      let got = 0;
      while (got < buf.length) {
        const n = readSync(fd, buf, got, buf.length - got, offset + got);
        if (n <= 0) break;
        got += n;
      }
      return new Uint8Array(buf.buffer, buf.byteOffset, got);
    } finally {
      closeSync(fd);
    }
  }
}
