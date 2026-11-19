/**
 * NUI images by resref, decoded and cached.
 *
 * The lookup is the 8193.37-17 client's (nk_loadimg, docs/CLIENT-BEHAVIOUR.md#images): it probes wbm, gif, png, tga,
 * jpg and dds across all resource layers and keeps the last type that exists anywhere, so dds > jpg > tga > png > gif
 * > wbm whichever hak or archive each is in; that type then comes from the best layer that has it.
 */
import { decodeDds } from "./dds.js";
import type { RGBAImage } from "./image.js";
import type { ResMan } from "./resman.js";
import { decodeTga } from "./tga.js";
import { errorText } from "../errors.js";

/** Decodes PNG, JPEG and GIF (the first frame), which the platform does better than we would: createImageBitmap in
 * the browser, @napi-rs/canvas in Node. */
export type BitmapDecoder = (bytes: Uint8Array, ext: "png" | "jpg" | "gif") => Promise<RGBAImage | null>;

/** Client probe order: the last existing wins. */
export const CLIENT_PROBE = ["wbm", "gif", "png", "tga", "jpg", "dds"] as const;

export interface ImageInfo {
  resref: string;
  /** The type that was used, or null if there is none. */
  ext: string | null;
  /** Where it came from. */
  layer: string | null;
  /** Why it could not be drawn (a WebM, a decode error). */
  error?: string;
}

export class Images {
  private readonly cache = new Map<string, RGBAImage | null>();
  private readonly info = new Map<string, ImageInfo>();
  private readonly pending = new Set<string>();
  /** Loads in flight, so two callers asking for one image decode it once. */
  private readonly loading = new Map<string, Promise<void>>();
  /** Bumped by clear(): a load started before it does not fill the new cache. */
  private generation = 0;

  constructor(
    readonly resman: ResMan,
    readonly decodeBitmap: BitmapDecoder | null = null,
  ) {}

  /** Forgets everything (after the resources change). */
  clear(): void {
    this.cache.clear();
    this.info.clear();
    this.pending.clear();
    this.loading.clear();
    this.generation++;
  }

  /**
   * The image if it is loaded, null if it does not exist (or cannot be drawn), undefined if it has not been loaded
   * yet: it is then queued, and load() fetches it. Drawing is synchronous; the renderer draws, loads what it asked
   * for and draws again.
   */
  peek(resref: string): RGBAImage | null | undefined {
    const r = (resref || "").toLowerCase();
    if (!r) return null;
    if (this.cache.has(r)) return this.cache.get(r);
    this.pending.add(r);
    return undefined;
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  async loadPending(): Promise<void> {
    const todo = [...this.pending];
    this.pending.clear();
    await Promise.all(todo.map((r) => this.load(r)));
  }

  async get(resref: string): Promise<RGBAImage | null> {
    const r = (resref || "").toLowerCase();
    if (!r) return null;
    if (!this.cache.has(r)) await this.load(r);
    return this.cache.get(r) ?? null;
  }

  describe(resref: string): ImageInfo | undefined {
    return this.info.get(resref.toLowerCase());
  }

  /** Which type the client would pick for resref (see the class comment), or null. */
  clientType(resref: string): string | null {
    let found: string | null = null;
    for (const ext of CLIENT_PROBE) if (this.resman.has(resref, ext)) found = ext;
    return found;
  }

  private load(r: string): Promise<void> {
    if (this.cache.has(r)) return Promise.resolve();
    let p = this.loading.get(r);
    if (!p) {
      const gen = this.generation;
      p = this.fetch(r).then(([im, info]) => {
        if (gen !== this.generation) return;
        this.cache.set(r, im);
        this.info.set(r, info);
        this.loading.delete(r);
      });
      this.loading.set(r, p);
    }
    return p;
  }

  private async fetch(r: string): Promise<[RGBAImage | null, ImageInfo]> {
    let im: RGBAImage | null = null;
    const info: ImageInfo = { resref: r, ext: null, layer: null };
    try {
      let data: Uint8Array | null = null;
      const ext = this.clientType(r);
      if (ext) data = await this.resman.get(r, ext);
      if (data && ext) {
        info.ext = ext;
        info.layer = this.resman.where(r, ext)?.container.label ?? null;
        im = await this.decode(data, ext);
        if (!im) info.error = `cannot draw a .${ext}`;
      }
    } catch (e) {
      info.error = errorText(e);
      im = null;
    }
    return [im, info];
  }

  private async decode(data: Uint8Array, ext: string): Promise<RGBAImage | null> {
    if (ext === "tga") return decodeTga(data);
    if (ext === "dds") return decodeDds(data);
    if ((ext === "png" || ext === "jpg" || ext === "gif") && this.decodeBitmap) return this.decodeBitmap(data, ext);
    // WebM is a movie: not drawn (see DESIGN.md).
    return null;
  }
}
