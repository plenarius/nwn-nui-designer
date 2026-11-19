/** Images in the skin editor: uploads converted to 32-bit TGA, and RGBA images shown on canvases. */
import type { RGBAImage } from "../../core/res/image.js";
import { decodeTga } from "../../core/res/tga.js";
import { encodeTga32 } from "../../core/res/tgawrite.js";
import { browserBitmapDecoder } from "../platform.js";

/** A PNG, JPEG or TGA file decoded and written as a 32-bit TGA (what the client reads best: dds > jpg > tga > png). */
export async function uploadAsTga(f: File): Promise<{ image: RGBAImage; tga: Uint8Array }> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const ext = f.name.toLowerCase().replace(/^.*\./, "");
  let image: RGBAImage | null;
  if (ext === "tga") image = decodeTga(bytes);
  else if (ext === "png" || ext === "jpg" || ext === "jpeg") image = await browserBitmapDecoder(bytes, ext === "png" ? "png" : "jpg");
  else throw new Error(`${f.name}: upload a PNG, JPEG or TGA`);
  if (!image) throw new Error(`${f.name}: the browser could not decode it`);
  if (image.width > 4096 || image.height > 4096) throw new Error(`${f.name}: ${image.width} x ${image.height} is too big for a skin texture`);
  return { image, tga: encodeTga32(image) };
}

/** A resref from a file name: lower case, letters, digits and _ only, at most 16 characters. */
export function resrefFrom(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 16);
}

/** Draws an RGBA image on a canvas element at scale s (nearest neighbour). */
export function drawOn(c: HTMLCanvasElement | null, im: RGBAImage | null, s = 1): void {
  if (!c) return;
  const ctx = c.getContext("2d")!;
  if (!im) {
    c.width = c.height = 1;
    ctx.clearRect(0, 0, 1, 1);
    return;
  }
  c.width = Math.max(1, Math.round(im.width * s));
  c.height = Math.max(1, Math.round(im.height * s));
  const tmp = document.createElement("canvas");
  tmp.width = im.width;
  tmp.height = im.height;
  tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(im.data), im.width, im.height), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(tmp, 0, 0, c.width, c.height);
}
