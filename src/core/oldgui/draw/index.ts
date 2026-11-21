/**
 * Redraws one chrome texture of the original GUI in the skin's style: the hand-drawn pieces (hand.ts) first, then by
 * its role (roles.ts): colour-cell strips, button atlases, shapes and panels. Every cell a model stretches is then
 * made flat along the stretch. docs/RESKIN-EVERYTHING.md explains each rule.
 */
import type { RGBAImage } from "../../res/image.js";
import { type UvEntry, cellsFor } from "../cells.js";
import { BUTTON_ATLAS, PANEL, PICTURES, SHAPE, SMALL, SWATCH } from "../roles.js";
import { HAND, ICON_GROUNDS, iconGround } from "./hand.js";
import { fromImage, toImage } from "./raster.js";
import { flattenStretched, redrawAtlas, redrawShape, redrawSwatch, redrawTrace, rowsAfterFlatten } from "./redraw.js";
import type { OldGuiStyle } from "./style.js";

export { type OldGuiStyle, FACE_WEIGHT, exact565, faceWeights, oldGuiStyle, snap565, warm565, warm565Image } from "./style.js";
export { ICON_GROUNDS } from "./hand.js";

/** Every texture this redraws (the chrome the inventory marks "redraw"). */
export const REDRAWN: readonly string[] = [...new Set([...BUTTON_ATLAS, ...PANEL, ...SHAPE, ...SMALL, ...SWATCH, ...Object.keys(HAND)])];

/** Drawn stretched by design: the speech bubble's corner is a quarter disc its models stretch into the bubble's ends. */
const NO_FLATTEN = new Set(["gui_textbubble"]);
/** Soft drop shadows: one flat shade with a hard edge where the stock's soft edge is half way. */
const HARD_SHADOW = new Set(["gui_pre_bkgnd5"]);

export interface RedrawInput {
  name: string;
  /** The stock texture in display order (row 0 at the top), as decodeGuiTexture returns it. */
  stock: RGBAImage;
  /** Every UV rectangle the models sample from it. */
  uv: readonly UvEntry[];
  style: OldGuiStyle;
  /** Stock alpha to the theme's (the opaque curve for an opaque skin). */
  alpha: (a: number) => number;
}

/** The redrawn texture, or null when this texture is not one it redraws. */
export function redrawOldGui(o: RedrawInput): RGBAImage | null {
  const { name, uv, style: s, alpha } = o;
  const st = fromImage(o.stock);
  let img;
  const hand = HAND[name];
  if (hand) img = hand(st, s, { uv, alpha });
  else if (SWATCH.includes(name)) img = redrawSwatch(name, st, uv, s, alpha);
  else if (BUTTON_ATLAS.includes(name)) img = redrawAtlas(st, uv, s, alpha);
  else if (SHAPE.includes(name)) img = redrawShape(st, s);
  else if (PANEL.includes(name)) img = redrawTrace(st, s, alpha, PICTURES[name]);
  else return null;
  if (HARD_SHADOW.has(name)) {
    let mx = 0;
    for (let i = 0; i < img.w * img.h; i++) mx = Math.max(mx, img.d[i * 4 + 3]!);
    for (let i = 0; i < img.w * img.h; i++) img.d[i * 4 + 3] = img.d[i * 4 + 3]! >= Math.floor(mx / 2) ? mx : 0;
  }
  for (let i = 0; i < img.d.length; i++) img.d[i] = Math.round(Math.min(255, Math.max(0, img.d[i]!)));
  if (!NO_FLATTEN.has(name)) flattenStretched(img, cellsFor(uv, img.w, img.h), s, PICTURES[name]);
  rowsAfterFlatten(name, img);
  if (name === "ctl_btn_jnl_inv") iconGround(img, s);
  return toImage(img);
}

/** An icon atlas a tab carries, its dark ground recoloured to the tabs' ink (the art and its shading stay). */
export function recolourIconGround(stock: RGBAImage, s: OldGuiStyle): RGBAImage {
  const p = fromImage(stock);
  iconGround(p, s);
  return toImage(p);
}

export const isIconGround = (name: string): boolean => ICON_GROUNDS.includes(name);
