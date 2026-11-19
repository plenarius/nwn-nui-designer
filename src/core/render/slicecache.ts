/**
 * Skin slices and resized textures kept across redraws (DESIGN.md, "Rendering").
 *
 * One cache per Skin (a WeakMap on the Skin object), so a new skin (another skin file, the skin editor's next
 * version, new resources) starts empty and never sees another skin's slices, and a dropped skin's slices go with it.
 * Each entry also remembers the texture object it was made from and is used only while the skin's Images still hand
 * out that same object: a hak set, override or game resource change clears Images and decodes new objects, so the
 * old slice is made again. A slice depends only on the texture's pixels, the skin key (slice.ts) and the size, so
 * a cached one is pixel-identical to a new one.
 *
 * Bounded by pixel bytes, least recently used out first. A window drag makes one border slice per size (gods'
 * 844 x 684 border is 2.3 MB, a full 1440 x 900 window 5.2 MB); 32 MB holds every slice of a redraw of the largest
 * window plus about half a dozen recent sizes of its border, and a few skins alive at once (game, built-in, the
 * skin being edited) stay under 100 MB.
 */
import type { RGBAImage } from "../res/image.js";

/** Bytes of pixels one Skin's cache keeps at most. */
export const SLICE_CACHE_BYTES = 32 * 1024 * 1024;

interface Entry {
  src: RGBAImage;
  im: RGBAImage;
  bytes: number;
}

export class SliceCache {
  private readonly entries = new Map<string, Entry>();
  private total = 0;

  constructor(readonly maxBytes = SLICE_CACHE_BYTES) {}

  /** Pixel bytes held now. */
  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  /** The image for key made from src, made with make() when not cached (or cached from another texture object). */
  get(key: string, src: RGBAImage, make: () => RGBAImage): RGBAImage {
    const e = this.entries.get(key);
    if (e) {
      this.entries.delete(key);
      if (e.src === src) {
        this.entries.set(key, e); // most recently used last
        return e.im;
      }
      this.total -= e.bytes;
    }
    const im = make();
    const bytes = im.data.byteLength;
    if (bytes > this.maxBytes) return im;
    this.entries.set(key, { src, im, bytes });
    this.total += bytes;
    for (const [k, old] of this.entries) {
      if (this.total <= this.maxBytes) break;
      this.entries.delete(k);
      this.total -= old.bytes;
    }
    return im;
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }
}

const perSkin = new WeakMap<object, SliceCache>();

/** The slice cache of this skin (made on first use). */
export function sliceCacheOf(skin: object): SliceCache {
  let c = perSkin.get(skin);
  if (!c) {
    c = new SliceCache();
    perSkin.set(skin, c);
  }
  return c;
}
