/**
 * What the renderer draws with: RGBA layers composited at whole pixels (skin textures, text, images, all made
 * pixel-exact in software as nui-preview makes them with Pillow) and a few shapes (window background, draw lists),
 * on a Canvas 2D context.
 */
import type { RGBAImage } from "../res/image.js";
import { type CanvasFactory, type CanvasLike, ctx2d, imageToCanvas } from "./canvas.js";
import { type RGBA, alphaCompositeInPlace } from "./text.js";

export type Point = [number, number];

export interface Surface {
  readonly width: number;
  readonly height: number;
  /** Composites im (straight alpha) at (x, y), whole pixels, source-over. */
  image(im: RGBAImage, x: number, y: number): void;
  /** Fills the pixels x0..x1, y0..y1 (inclusive, as PIL's rectangle). */
  fillRect(x0: number, y0: number, x1: number, y1: number, c: RGBA): void;
  /** Outlines the pixels x0..x1, y0..y1 with a border `width` pixels thick, inside (as PIL's rectangle). */
  strokeRect(x0: number, y0: number, x1: number, y1: number, c: RGBA, width: number): void;
  /** Shapes (draw lists), clipped to clip (x0, y0, x1, y1). */
  polyline(pts: Point[], c: RGBA, width: number, clip: readonly number[], closed?: boolean): void;
  polygon(pts: Point[], c: RGBA, clip: readonly number[]): void;
  ellipse(x0: number, y0: number, x1: number, y1: number, c: RGBA, fill: boolean, width: number, clip: readonly number[]): void;
  arc(cx: number, cy: number, r: number, a0: number, a1: number, c: RGBA, fill: boolean, width: number, clip: readonly number[]): void;
  bezier(a: Point, c0: Point, c1: Point, b: Point, c: RGBA, width: number, clip: readonly number[]): void;
}

/** Whether any pixel of im is neither fully transparent nor fully opaque (drawImage is exact for the others). */
export function hasPartialAlpha(im: RGBAImage): boolean {
  const a = im.data;
  for (let i = 3; i < a.length; i += 4) if (a[i] !== 0 && a[i] !== 255) return true;
  return false;
}

function css(c: RGBA): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
}

export class CanvasSurface implements Surface {
  readonly canvas: CanvasLike;
  private readonly ctx;
  private readonly layerCache = new WeakMap<RGBAImage, CanvasLike>();
  private readonly partialCache = new WeakMap<RGBAImage, boolean>();

  constructor(
    readonly make: CanvasFactory,
    readonly width: number,
    readonly height: number,
    canvas?: CanvasLike,
  ) {
    this.canvas = canvas ?? make(width, height);
    this.ctx = ctx2d(this.canvas);
    this.ctx.imageSmoothingEnabled = false;
  }

  image(im: RGBAImage, x: number, y: number): void {
    if (im.width <= 0 || im.height <= 0) return;
    let partial = this.partialCache.get(im);
    if (partial === undefined) {
      partial = hasPartialAlpha(im);
      this.partialCache.set(im, partial);
    }
    if (partial) {
      this.blend(im, Math.round(x), Math.round(y));
      return;
    }
    let c = this.layerCache.get(im);
    if (!c) {
      c = imageToCanvas(this.make, im);
      this.layerCache.set(im, c);
    }
    this.ctx.drawImage(c, Math.round(x), Math.round(y));
  }

  /**
   * Source-over in software, for an image with partly transparent pixels (glyph edges, disabled widgets at half
   * alpha). A canvas keeps premultiplied 8-bit pixels, so drawImage rounds twice and comes out one level darker in
   * about a third of such pixels; this rounds once, as Pillow's alpha_composite does (and as the client's blending
   * in floating point does): DESIGN.md, "Rendering".
   */
  private blend(im: RGBAImage, x: number, y: number): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.canvas.width, x + im.width);
    const y1 = Math.min(this.canvas.height, y + im.height);
    if (x1 <= x0 || y1 <= y0) return;
    const dst = this.ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    alphaCompositeInPlace(dst, im, x - x0, y - y0);
    this.ctx.putImageData(dst, x0, y0);
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    x0 = Math.trunc(x0);
    y0 = Math.trunc(y0);
    x1 = Math.trunc(x1);
    y1 = Math.trunc(y1);
    if (x1 < x0 || y1 < y0) return;
    this.ctx.fillStyle = css(c);
    this.ctx.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  strokeRect(x0: number, y0: number, x1: number, y1: number, c: RGBA, width: number): void {
    x0 = Math.trunc(x0);
    y0 = Math.trunc(y0);
    x1 = Math.trunc(x1);
    y1 = Math.trunc(y1);
    const w = Math.max(1, Math.round(width));
    if (x1 < x0 || y1 < y0) return;
    if (x1 - x0 + 1 <= 2 * w || y1 - y0 + 1 <= 2 * w) {
      this.fillRect(x0, y0, x1, y1, c);
      return;
    }
    this.ctx.fillStyle = css(c);
    this.ctx.fillRect(x0, y0, x1 - x0 + 1, w);
    this.ctx.fillRect(x0, y1 - w + 1, x1 - x0 + 1, w);
    this.ctx.fillRect(x0, y0 + w, w, y1 - y0 + 1 - 2 * w);
    this.ctx.fillRect(x1 - w + 1, y0 + w, w, y1 - y0 + 1 - 2 * w);
  }

  private clipTo(clip: readonly number[]): void {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(clip[0]!, clip[1]!, clip[2]! - clip[0]!, clip[3]! - clip[1]!);
    this.ctx.clip();
  }

  polyline(pts: Point[], c: RGBA, width: number, clip: readonly number[], closed = false): void {
    if (pts.length < 2) return;
    this.clipTo(clip);
    const ctx = this.ctx;
    ctx.strokeStyle = css(c);
    ctx.lineWidth = Math.max(1, width);
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.beginPath();
    // Pixel centres, as PIL draws a line through the pixels it names.
    ctx.moveTo(pts[0]![0] + 0.5, pts[0]![1] + 0.5);
    for (const p of pts.slice(1)) ctx.lineTo(p[0] + 0.5, p[1] + 0.5);
    if (closed) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  polygon(pts: Point[], c: RGBA, clip: readonly number[]): void {
    if (pts.length < 3) return;
    this.clipTo(clip);
    const ctx = this.ctx;
    ctx.fillStyle = css(c);
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ellipse(x0: number, y0: number, x1: number, y1: number, c: RGBA, fill: boolean, width: number, clip: readonly number[]): void {
    if (x1 < x0 || y1 < y0) return;
    this.clipTo(clip);
    const ctx = this.ctx;
    const w = Math.max(1, width);
    ctx.beginPath();
    if (fill) {
      ctx.ellipse((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, (x1 - x0 + 1) / 2, (y1 - y0 + 1) / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = css(c);
      ctx.fill();
    } else {
      ctx.ellipse((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, Math.max(0, (x1 - x0 + 1 - w) / 2), Math.max(0, (y1 - y0 + 1 - w) / 2), 0, 0, Math.PI * 2);
      ctx.strokeStyle = css(c);
      ctx.lineWidth = w;
      ctx.stroke();
    }
    ctx.restore();
  }

  arc(cx: number, cy: number, r: number, a0: number, a1: number, c: RGBA, fill: boolean, width: number, clip: readonly number[]): void {
    this.clipTo(clip);
    const ctx = this.ctx;
    ctx.beginPath();
    if (fill) {
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, Math.max(0, r), a0, a1);
      ctx.closePath();
      ctx.fillStyle = css(c);
      ctx.fill();
    } else {
      ctx.arc(cx, cy, Math.max(0, r), a0, a1);
      ctx.strokeStyle = css(c);
      ctx.lineWidth = Math.max(1, width);
      ctx.stroke();
    }
    ctx.restore();
  }

  bezier(a: Point, c0: Point, c1: Point, b: Point, c: RGBA, width: number, clip: readonly number[]): void {
    this.clipTo(clip);
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.bezierCurveTo(c0[0], c0[1], c1[0], c1[1], b[0], b[1]);
    ctx.strokeStyle = css(c);
    ctx.lineWidth = Math.max(1, width);
    ctx.stroke();
    ctx.restore();
  }
}
