/**
 * The part of Canvas 2D the renderer uses, so the same code draws on a browser canvas (HTMLCanvasElement or
 * OffscreenCanvas) and on @napi-rs/canvas in Node (the golden checks and the CLI).
 */
import type { RGBAImage } from "../res/image.js";

export interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface Ctx2D {
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(rule?: "nonzero" | "evenodd"): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  font: string;
  textBaseline: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drawImage(image: any, dx: number, dy: number, dw?: number, dh?: number): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drawImage(image: any, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(x: number, y: number, w: number, h: number): ImageDataLike;
  putImageData(data: ImageDataLike, x: number, y: number): void;
  createImageData(w: number, h: number): ImageDataLike;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: "2d", opts?: { willReadFrequently?: boolean }): Ctx2D | null;
}

/** Makes an offscreen canvas of w x h. */
export type CanvasFactory = (w: number, h: number) => CanvasLike;

export function ctx2d(c: CanvasLike): Ctx2D {
  // The surface reads back what is under each partly transparent layer (surface.ts, blend): a browser keeps such a
  // canvas in memory instead of on the GPU.
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2D context");
  return ctx;
}

/** An RGBAImage as a canvas (to drawImage it with source-over compositing). */
export function imageToCanvas(make: CanvasFactory, im: RGBAImage): CanvasLike {
  const c = make(Math.max(1, im.width), Math.max(1, im.height));
  if (im.width > 0 && im.height > 0) {
    const ctx = ctx2d(c);
    const id = ctx.createImageData(im.width, im.height);
    id.data.set(im.data);
    ctx.putImageData(id, 0, 0);
  }
  return c;
}

/** A canvas's pixels as an RGBAImage. */
export function canvasToImage(c: CanvasLike): RGBAImage {
  const id = ctx2d(c).getImageData(0, 0, c.width, c.height);
  return { width: id.width, height: id.height, data: new Uint8ClampedArray(id.data) };
}
