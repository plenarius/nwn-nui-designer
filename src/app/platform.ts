/** The browser side of the core: files as ByteSources, a picked NWN folder as a FileTree, canvases, image decoding. */
import type { CanvasFactory, CanvasLike } from "../core/render/canvas.js";
import type { BitmapDecoder } from "../core/res/images.js";
import type { FileTree } from "../core/res/resman.js";
import { BlobSource, type ByteSource } from "../core/res/source.js";
import type { FallbackSkin } from "../core/skin/fallback.js";
import { DEFAULT_THEME, themeOf } from "../core/skin/themes.js";

/** The built-in skins' files (assets/skin/<theme>/): URLs Vite bundles, fetched when a skin is first needed. The OFL
 * texts come along for the skin editor (they travel with the fonts in an export). */
const skinUrls = import.meta.glob("../../assets/skin/*/*.{tml,tga,ttf,txt}", { query: "?url", import: "default", eager: true }) as Record<
  string,
  string
>;

export const browserCanvas: CanvasFactory = (w, h) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.floor(w));
  c.height = Math.max(1, Math.floor(h));
  return c as unknown as CanvasLike;
};

export const browserBitmapDecoder: BitmapDecoder = async (bytes, ext) => {
  try {
    const type = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { width: bmp.width, height: bmp.height, data: new Uint8ClampedArray(id.data) };
  } catch {
    return null;
  }
};

/** A built-in skin's files (a themes.ts id; "ink", the default); with texts, its OFL texts too. */
export async function fallbackSkin(theme: string = DEFAULT_THEME, texts = false): Promise<FallbackSkin> {
  const dir = `/assets/skin/${themeOf(theme).id}/`;
  const files = await Promise.all(
    Object.entries(skinUrls)
      .filter(([path]) => path.includes(dir) && (texts || !path.endsWith(".txt")))
      .map(async ([path, url]) => {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      return [path.slice(path.lastIndexOf("/") + 1), bytes] as const;
    }),
  );
  return Object.fromEntries(files);
}

/** Files by their path relative to the install's root (lower case). */
export class BrowserTree implements FileTree {
  private readonly files = new Map<string, File>();
  constructor(
    readonly label: string,
    entries: Iterable<[string, File]>,
  ) {
    for (const [p, f] of entries) this.files.set(p.toLowerCase().replace(/\\/g, "/"), f);
  }
  file(relPath: string): ByteSource | null {
    const f = this.files.get(relPath.toLowerCase().replace(/\\/g, "/"));
    return f ? new BlobSource(f.name, f) : null;
  }
  list(relDir: string): ByteSource[] {
    const d = relDir.toLowerCase().replace(/\/$/, "") + "/";
    const out: ByteSource[] = [];
    for (const [p, f] of this.files) {
      if (p.startsWith(d) && !p.slice(d.length).includes("/")) out.push(new BlobSource(f.name, f));
    }
    return out;
  }
  get size(): number {
    return this.files.size;
  }
}

/** The folders of an install the viewer reads (others are skipped: the install has thousands of files). */
const WANTED = [/^data\/[^/]+$/, /^data\/txpk\/[^/]+$/, /^ovr\/[^/]+$/];
const wanted = (p: string) => WANTED.some((r) => r.test(p.toLowerCase()));

interface DirHandle {
  name: string;
  values(): AsyncIterable<{ kind: "file" | "directory"; name: string; getFile?: () => Promise<File> } & DirHandle>;
}

/** A folder picked with the File System Access API (Chromium browsers). */
export async function treeFromDirectoryHandle(root: DirHandle): Promise<BrowserTree> {
  const out: [string, File][] = [];
  const walk = async (dir: DirHandle, prefix: string, depth: number) => {
    for await (const e of dir.values()) {
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.kind === "file") {
        if (wanted(p)) out.push([p, await e.getFile!()]);
      } else if (depth < 2 && /^(data|data\/txpk|ovr)$/i.test(p)) {
        await walk(e, p, depth + 1);
      }
    }
  };
  await walk(root, "", 0);
  return new BrowserTree(root.name, out);
}

/** A folder picked with <input webkitdirectory> (every browser): paths start with the folder's own name. */
export function treeFromFileList(files: FileList): BrowserTree {
  const out: [string, File][] = [];
  let label = "";
  for (const f of Array.from(files)) {
    const rel = (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name;
    const slash = rel.indexOf("/");
    if (!label) label = slash > 0 ? rel.slice(0, slash) : "folder";
    const p = slash > 0 ? rel.slice(slash + 1) : rel;
    if (wanted(p)) out.push([p, f]);
  }
  return new BrowserTree(label, out);
}

/** The desktop app (electron/preload.ts): its settings file is in the user's config folder, not the repository's. */
export const isDesktopApp = typeof window !== "undefined" && !!(window as unknown as { nuiDesigner?: { desktop?: boolean } }).nuiDesigner?.desktop;

export const hasDirectoryPicker = typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function pickDirectory(): Promise<BrowserTree | null> {
  try {
    const h = await (window as unknown as { showDirectoryPicker(o?: object): Promise<DirHandle> }).showDirectoryPicker({ id: "nwn-install", mode: "read" });
    return await treeFromDirectoryHandle(h);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}
