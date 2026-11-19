/**
 * Draws a document: the screen behind the window, the window, and (optionally) the overlay of element outlines and
 * numbered problems. Images load asynchronously, drawing is synchronous: it draws, loads what it asked for, and
 * draws again until nothing new is asked for.
 */
import { pyRound } from "./font/font.js";
import { profileBinds } from "./model/binds.js";
import type { JsonObject, NuiDocument } from "./model/types.js";
import type { Images } from "./res/images.js";
import { type CanvasFactory, type CanvasLike, ctx2d } from "./render/canvas.js";
import { type Outline, type Problem, Renderer } from "./render/render.js";
import { CanvasSurface } from "./render/surface.js";
import { textLayer } from "./render/text.js";
import type { Skin } from "./skin/skin.js";

export interface ViewOptions {
  /** The screen the window is centred on (as the client places a window whose geometry is -1, -1). */
  canvasW?: number;
  canvasH?: number;
  overlay?: boolean;
  /** Keep only the window and a 12 px margin on every side (padded with the background past the screen's edge). */
  crop?: boolean;
  /** Scale the finished picture (the layout stays at NUI scale 1; see DESIGN.md). */
  scale?: number;
  /** Extra bind values laid over the document's. */
  binds?: Record<string, unknown>;
  /** A combo (the window's element object) whose open list is drawn on top, past the window if need be; a crop keeps it. */
  openCombo?: JsonObject | null;
}

export interface ViewResult {
  canvas: CanvasLike;
  problems: Problem[];
  outlines: Outline[];
  /** The window's rect on the uncropped, unscaled canvas. */
  windowRect: [number, number, number, number];
  /** Where (0, 0) of the result is on the uncropped canvas, and its scale. */
  origin: [number, number];
  scale: number;
}

/** A common laptop resolution, at NUI scale 1.0 (nui-preview's default). */
export const DEFAULT_CANVAS: [number, number] = [1440, 900];

/** A dim scene behind the window (a gradient, so the window's edges show), as nui-preview draws it. */
export function drawBackground(c: CanvasLike): void {
  const ctx = ctx2d(c);
  const h = c.height;
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1);
    ctx.fillStyle = `rgb(${Math.trunc(58 - 20 * t)},${Math.trunc(52 - 18 * t)},${Math.trunc(46 - 16 * t)})`;
    ctx.fillRect(0, y, c.width, 1);
  }
}

/** Screen sizes (and so canvases) kept per canvas factory, least recently used out first. */
const KEPT_SIZES = 4;

/** What renderView keeps across redraws per canvas factory: each size's background, and spare screen canvases. */
interface Kept {
  background: Map<string, CanvasLike>;
  spare: Map<string, CanvasLike[]>;
}
const kept = new WeakMap<CanvasFactory, Kept>();

function keptOf(make: CanvasFactory): Kept {
  let k = kept.get(make);
  if (!k) kept.set(make, (k = { background: new Map(), spare: new Map() }));
  return k;
}

/** Puts key last in m (most recently used) and drops the least recently used past KEPT_SIZES. */
function touch<V>(m: Map<string, V>, key: string, v: V): void {
  m.delete(key);
  m.set(key, v);
  while (m.size > KEPT_SIZES) m.delete(m.keys().next().value!);
}

/** The background of a w x h screen, drawn once per size (drawBackground) and copied from then on. */
function background(make: CanvasFactory, w: number, h: number): CanvasLike {
  const m = keptOf(make).background;
  const key = `${w} ${h}`;
  let c = m.get(key);
  if (!c) {
    c = make(w, h);
    drawBackground(c);
  }
  touch(m, key, c);
  return c;
}

/**
 * A w x h screen canvas with the background on it: a spare one from an earlier redraw when there is one (handed back
 * with release), else a new one. The background is opaque, so copying it over a used canvas leaves exactly what
 * drawing it on a new one does.
 */
function screen(make: CanvasFactory, w: number, h: number, c?: CanvasLike): CanvasLike {
  c ??= keptOf(make).spare.get(`${w} ${h}`)?.pop() ?? make(w, h);
  const ctx = ctx2d(c);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(background(make, w, h), 0, 0);
  return c;
}

/** Hands a screen canvas the caller no longer uses back for the next redraw of that size (two kept per size). */
function release(make: CanvasFactory, c: CanvasLike, w: number, h: number): void {
  const m = keptOf(make).spare;
  const key = `${w} ${h}`;
  const list = m.get(key) ?? [];
  if (list.length < 2) list.push(c);
  touch(m, key, list);
}

/** Every element's rect (spans grey, widgets blue), and each problem's rect in red with its number. */
export function drawOverlay(surface: CanvasSurface, skin: Skin, outlines: Outline[], problems: Problem[]): void {
  for (const o of outlines) {
    const [x, y, w, h] = o.rect;
    if (w < 1 || h < 1 || !o.visible) continue;
    const c = o.isSpan ? ([150, 150, 150, 120] as const) : ([90, 170, 255, 170] as const);
    surface.strokeRect(x, y, x + w - 1, y + h - 1, c, 1);
  }
  const font = skin.defaultFont;
  problems.forEach((p, i) => {
    const [x, y, w, h] = p.rect;
    surface.strokeRect(x, y, x + w - 1, y + h - 1, [255, 40, 40, 255], 2);
    const label = String(i + 1);
    const lw = Math.max(18, Math.ceil(font.width(label)) + 6);
    surface.fillRect(x, y, x + lw, y + 15, [255, 40, 40, 230]);
    const l = textLayer(font, label, x + 3, y + (16 - font.line) / 2, [255, 255, 255, 255], [x, y, x + lw + 1, y + 16], 0);
    if (l) surface.image(l.im, l.x, l.y);
  });
}

/** The margin a cropped picture keeps around the window, on every side. */
export const CROP_MARGIN = 12;

/**
 * The part of the screen a crop keeps: the window and CROP_MARGIN on every side, as [x, y, width, height]. It may
 * run past the screen's edges (renderView fills that with the background), so the margin is always the same.
 */
export function cropRect(rect: [number, number, number, number]): [number, number, number, number] {
  const m = CROP_MARGIN;
  const [wx, wy, ww, wh] = rect;
  return [wx - m, wy - m, Math.max(1, ww + 2 * m), Math.max(1, wh + 2 * m)];
}

export async function renderView(
  doc: NuiDocument,
  skin: Skin,
  images: Images,
  make: CanvasFactory,
  opts: ViewOptions = {},
): Promise<ViewResult> {
  const cw = opts.canvasW ?? DEFAULT_CANVAS[0];
  const ch = opts.canvasH ?? DEFAULT_CANVAS[1];
  // The framework profile's binds (a window's `profiles` key) are set on every open: under the dump's own values.
  const binds = { ...profileBinds(doc.window), ...doc.binds, ...(opts.binds as Record<string, never> | undefined) };
  let canvas!: CanvasLike;
  let rend!: Renderer;
  let rect: [number, number, number, number] = [0, 0, 0, 0];
  let surface!: CanvasSurface;
  for (let pass = 0; pass < 6; pass++) {
    canvas = screen(make, cw, ch, canvas);
    surface = new CanvasSurface(make, cw, ch, canvas);
    rend = new Renderer(skin, images, binds, surface);
    rend.openCombo = opts.openCombo ?? null;
    rect = rend.window(doc.window, cw, ch, doc.panes);
    if (!images.hasPending()) break;
    await images.loadPending();
  }
  if (opts.overlay) drawOverlay(surface, skin, rend.outlines, rend.problems);
  let out = canvas;
  let origin: [number, number] = [0, 0];
  if (opts.crop) {
    // An open combo list reaches past the window: the crop keeps it.
    let [ux0, uy0, ux1, uy1] = [rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]];
    for (const [px, py, pw, ph] of rend.popups) {
      ux0 = Math.min(ux0, Math.floor(px));
      uy0 = Math.min(uy0, Math.floor(py));
      ux1 = Math.max(ux1, Math.ceil(px + pw));
      uy1 = Math.max(uy1, Math.ceil(py + ph));
    }
    const [x0, y0, w, h] = cropRect([ux0, uy0, ux1 - ux0, uy1 - uy0]);
    out = make(w, h);
    const ctx = ctx2d(out);
    // Where the margin runs past the screen's edge, the background goes on: each row's colour (it is a vertical
    // gradient) carried left and right, the top and bottom rows' carried up and down. The window stays where it is.
    if (x0 < 0 || y0 < 0 || x0 + w > cw || y0 + h > ch) {
      const bg = background(make, cw, ch);
      ctx.imageSmoothingEnabled = false;
      const top = Math.min(h, Math.max(0, -y0));
      const bottom = Math.min(h, Math.max(0, y0 + h - ch));
      const sy0 = Math.max(0, y0);
      const sy1 = Math.min(ch, y0 + h);
      if (sy1 > sy0) ctx.drawImage(bg, 0, sy0, 1, sy1 - sy0, 0, sy0 - y0, w, sy1 - sy0);
      if (top > 0) ctx.drawImage(bg, 0, 0, 1, 1, 0, 0, w, top);
      if (bottom > 0) ctx.drawImage(bg, 0, ch - 1, 1, 1, 0, h - bottom, w, bottom);
    }
    ctx.drawImage(canvas, -x0, -y0);
    origin = [x0, y0];
  }
  const scale = opts.scale ?? 1;
  if (scale !== 1) {
    const s = make(Math.max(1, pyRound(out.width * scale)), Math.max(1, pyRound(out.height * scale)));
    const c = ctx2d(s);
    c.imageSmoothingEnabled = true;
    c.drawImage(out, 0, 0, s.width, s.height);
    out = s;
  }
  // The screen canvas is kept for the next redraw unless it is what this one hands out.
  if (out !== canvas) release(make, canvas, cw, ch);
  return { canvas: out, problems: rend.problems, outlines: rend.outlines, windowRect: rect, origin, scale };
}

/** A surface that draws nothing: the dry renderer of layoutView never calls it, it only needs the screen's size. */
class NoSurface {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  image(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  polyline(): void {}
  polygon(): void {}
  ellipse(): void {}
  arc(): void {}
  bezier(): void {}
}

export interface LayoutResult {
  problems: Problem[];
  outlines: Outline[];
  windowRect: [number, number, number, number];
}

/**
 * The window laid out and checked as renderView does, drawing nothing (the renderer's dry mode): the same outlines
 * and problems, synchronously, with no canvas. The editor's align and distribute tools measure their edits with it.
 */
export function layoutView(doc: NuiDocument, skin: Skin, images: Images, opts: Pick<ViewOptions, "canvasW" | "canvasH" | "binds"> = {}): LayoutResult {
  const cw = opts.canvasW ?? DEFAULT_CANVAS[0];
  const ch = opts.canvasH ?? DEFAULT_CANVAS[1];
  const binds = { ...profileBinds(doc.window), ...doc.binds, ...(opts.binds as Record<string, never> | undefined) };
  const rend = new Renderer(skin, images, binds, new NoSurface(cw, ch));
  rend.dry = true;
  const windowRect = rend.window(doc.window, cw, ch, doc.panes);
  return { problems: rend.problems, outlines: rend.outlines, windowRect };
}
