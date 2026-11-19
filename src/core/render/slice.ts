/**
 * How the client draws a skin texture over a widget: a 9-slice whose margins are fixed per skin key (hard-coded in
 * Nui::ReloadSkin's calls to nk_styleimg9, nwmain-linux 8193.37-17; a skin cannot change them), and for the
 * scrollbar thumbs only a part of the texture, repeated along the bar. docs/CLIENT-BEHAVIOUR.md#nine-slice-margins-and-scrollbar-thumbs
 * and nwn-module tools/nui-preview/skin.py (PR #1115) are the references.
 *
 * The API phase 3's skin editor uses (keep it small and stable):
 *   sliceSpec(key)               the margins, region and tiling of a skin key (null for keys that are not 9-slices)
 *   skinSlice(tex, key, w, h)    the texture over w x h as the client draws it for that key
 *   nineSlice(tex, w, h, margins, tile)   the 9-slice itself
 */
import { pyRound } from "../font/font.js";
import { type RGBAImage, crop, newImage, paste } from "../res/image.js";
import { resize } from "./resample.js";

/** Left, top, right, bottom, in the texture's pixels. */
export type Margins = readonly [left: number, top: number, right: number, bottom: number];
/** x, y, w, h in the texture's pixels. */
export type Region = readonly [x: number, y: number, w: number, h: number];
/** Whether the middle repeats at its own size across x, along y (instead of stretching). */
export type Tile = readonly [x: boolean, y: boolean];

export interface SliceSpec {
  margins: Margins;
  /** The part of the texture the key uses; null for the whole texture. */
  region: Region | null;
  tile: Tile;
}

export const SLICE_DEFAULT: Margins = [3, 3, 3, 3];
const M7: Margins = [7, 7, 7, 7];
const M0: Margins = [0, 0, 0, 0];
/** Which side the 5 belongs to is not known from the decompile; (5, 3, 3, 3) as docs/CLIENT-BEHAVIOUR.md#nine-slice-margins-and-scrollbar-thumbs gives it. */
const MTAB: Margins = [5, 3, 3, 3];
const NO_TILE: Tile = [false, false];

const SPECS = new Map<string, SliceSpec>();
function k(key: string, margins: Margins, region: Region | null = null, tile: Tile = NO_TILE): void {
  SPECS.set(key, { margins, region, tile });
}

k("border.border_image", SLICE_DEFAULT);
k("window.border_image", SLICE_DEFAULT);
for (const s of ["normal", "hover", "active"]) k(`window.header.${s}`, SLICE_DEFAULT);
// The thumbs are the only keys that pass nk_styleimg9 a part of their texture and a tiling flag (read from the
// disassembly, 0x1206b5e..0x1206c0d and 0x1207417..0x12074c7): scrollv's take nk_rect(3, 0, 10, 16) repeated along
// y, scrollh's nk_rect(0, 3, 16, 10) repeated along x; stretched across the bar.
for (const [bar, region, tile] of [
  ["scrollv", [3, 0, 10, 16], [false, true]],
  ["scrollh", [0, 3, 16, 10], [true, false]],
] as const) {
  for (const s of ["normal", "hover", "active"]) k(`${bar}.${s}`, SLICE_DEFAULT);
  for (const s of ["cursor_normal", "cursor_hover", "cursor_active"]) k(`${bar}.${s}`, M0, region, tile);
}
k("button.normal", SLICE_DEFAULT);
k("button.hover", M7);
k("button.active", SLICE_DEFAULT);
k("tab.background", MTAB);
for (const s of ["normal", "pressed", "normal_active", "pressed_active", "hover_active"]) k(`selectable.${s}`, SLICE_DEFAULT);
k("selectable.hover", M7);
k("progress.normal", SLICE_DEFAULT);
k("progress.hover", M7);
k("progress.active", M7);
k("combo.normal", SLICE_DEFAULT);
k("combo.hover", M7);
k("combo.active", SLICE_DEFAULT);
for (const s of ["normal", "hover", "active"]) k(`edit.${s}`, SLICE_DEFAULT);

/** The 9-slice skin keys, in no particular order. */
export const NINE_SLICE_KEYS: readonly string[] = [...SPECS.keys()];

/** How the client slices a skin key's texture, or null if the key is not a 9-slice (it is stretched, or a colour). */
export function sliceSpec(key: string): SliceSpec | null {
  return SPECS.get(key) ?? null;
}

/** piece over w x h: stretched, or repeated at its own size along an axis that tiles (stretched across the other). */
function fillPiece(piece: RGBAImage, w: number, h: number, tile: Tile): RGBAImage {
  const p = resize(piece, tile[0] ? piece.width : w, tile[1] ? piece.height : h, "bilinear");
  if (!tile[0] && !tile[1]) return p;
  const out = newImage(w, h);
  for (let y = 0; y < h; y += p.height) for (let x = 0; x < w; x += p.width) paste(out, p, x, y);
  return out;
}

/**
 * The texture over w x h as Nuklear draws an nk_nine_slice: its corners (margins: left, top, right, bottom texture
 * pixels, or one number for all four) as they are, its edges stretched along them, its middle stretched both ways,
 * or repeated at its own size along an axis that tiles. All margins zero: the whole texture is the middle. A margin is
 * cut to half the texture or the rect where they are smaller.
 */
export function nineSlice(tex: RGBAImage, w: number, h: number, margins: Margins | number = SLICE_DEFAULT, tile: Tile = NO_TILE): RGBAImage {
  w = Math.max(1, pyRound(w));
  h = Math.max(1, pyRound(h));
  const tw = tex.width;
  const th = tex.height;
  let [ml, mt, mr, mb] = typeof margins === "number" ? [margins, margins, margins, margins] : margins;
  if (!(ml || mt || mr || mb)) return fillPiece(tex, w, h, tile);
  ml = Math.min(ml, Math.trunc(tw / 2), Math.trunc(w / 2));
  mr = Math.min(mr, Math.trunc(tw / 2), Math.trunc(w / 2));
  mt = Math.min(mt, Math.trunc(th / 2), Math.trunc(h / 2));
  mb = Math.min(mb, Math.trunc(th / 2), Math.trunc(h / 2));
  const out = newImage(w, h);
  const xsSrc = [0, ml, tw - mr, tw];
  const ysSrc = [0, mt, th - mb, th];
  const xsDst = [0, ml, w - mr, w];
  const ysDst = [0, mt, h - mb, h];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const sx0 = xsSrc[c]!;
      const sx1 = xsSrc[c + 1]!;
      const sy0 = ysSrc[r]!;
      const sy1 = ysSrc[r + 1]!;
      const dx0 = xsDst[c]!;
      const dx1 = xsDst[c + 1]!;
      const dy0 = ysDst[r]!;
      const dy1 = ysDst[r + 1]!;
      if (sx1 <= sx0 || sy1 <= sy0 || dx1 <= dx0 || dy1 <= dy0) continue;
      const t = r === 1 && c === 1 ? tile : NO_TILE;
      paste(out, fillPiece(crop(tex, sx0, sy0, sx1, sy1), dx1 - dx0, dy1 - dy0, t), dx0, dy0);
    }
  }
  return out;
}

/**
 * A skin key's texture over w x h as the client draws it: the part of the texture the key uses, nine-sliced with the
 * key's margins and tiling. A key that is not a 9-slice is stretched (as the client draws "image or colour" keys).
 */
export function skinSlice(tex: RGBAImage, key: string, w: number, h: number): RGBAImage {
  const spec = sliceSpec(key);
  if (!spec) return resize(tex, Math.max(1, pyRound(w)), Math.max(1, pyRound(h)), "bilinear");
  let t = tex;
  if (spec.region) {
    const [x, y, rw, rh] = spec.region;
    t = crop(tex, x, y, Math.min(tex.width, x + rw), Math.min(tex.height, y + rh));
  }
  return nineSlice(t, w, h, spec.margins, spec.tile);
}
