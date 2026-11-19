/**
 * The canvas zoom. The window is drawn at game size (one canvas pixel per game pixel, times the UI scale) and the
 * browser scales the canvas element to `zoom` CSS pixels per canvas pixel, so the screen shows `zoom ×
 * devicePixelRatio` device pixels per canvas pixel. When that is a whole number the pixels are copied (crisp); any
 * other ratio has to be resampled, and smooth resampling reads better there than uneven nearest-neighbour pixels.
 */

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
/** The zoom buttons' and keys' steps: whole numbers from 100 %, so a step in from 100 % stays crisp. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4];

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

/** The next step up from `z` (or the last). */
export const zoomIn = (z: number) => ZOOM_STEPS.find((s) => s > z + 1e-6) ?? MAX_ZOOM;
/** The next step down from `z` (or the first). */
export const zoomOut = (z: number) => ZOOM_STEPS.findLast((s) => s < z - 1e-6) ?? MIN_ZOOM;

/** Device pixels per canvas pixel, if that is a whole number (within rounding), else null. */
export function wholeRatio(zoom: number, dpr = 1): number | null {
  const r = zoom * dpr;
  const n = Math.round(r);
  return n >= 1 && Math.abs(r - n) < 0.01 ? n : null;
}

/** The canvas's CSS image-rendering at this zoom: pixel copies at a whole ratio, smooth otherwise. */
export const zoomRendering = (zoom: number, dpr = 1): "pixelated" | "auto" => (wholeRatio(zoom, dpr) ? "pixelated" : "auto");

/**
 * The zoom that fits: `raw` (the largest zoom that fits the stage), up to 2. At one device pixel per canvas pixel or
 * more it rounds down to a whole ratio, so a fitted window is crisp; below that it stays as it is.
 */
export function fitZoom(raw: number, dpr = 1): number {
  const z = Math.min(2, raw);
  if (z * dpr < 1) return clampZoom(z);
  return clampZoom(Math.floor(z * dpr + 0.01) / dpr);
}
