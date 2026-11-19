/**
 * The old scrollbar, its arrow buttons and the options slider, drawn from the skin's own NUI pieces so the two
 * GUIs' scrollbars match. Each is drawn at the stock texture's size and laid out where the stock models sample it
 * (read from the models' UVs for Layonara's set; theme-gui ibo3_retone.py):
 *
 * - gui_scrollbar (16 x 16, scrollbar_simple): the thumb's body is column 0, rows 2-13, laid across the thumb (row
 *   13 at its left edge); its caps are rows 0-1 and 14-15, columns 2-13. Drawn as nui_scrollv's cross profile, the
 *   caps closed by a dark rim.
 * - gui_chr_arrowbtn (32 x 16): right half the up arrow (pb_scrl_up; pb_scrl_down draws it flipped), left half a
 *   down arrow. A button body with a 1 px accent rule (nui_button_n) and the NUI arrow glyph (nui_cnt_up/down).
 * - gui_slider (16 x 16, clamped): the thumb is columns 0-11 (nui_slider), the track column 15, rows 6-10: rule,
 *   ink, ink, ink, rule. Everything else transparent.
 */
import { type RGBAImage, newImage } from "../res/image.js";
import type { ReskinPalette } from "./palette.js";

/** The NUI textures a redraw reads (top-down RGBA). */
export interface NuiPieces {
  nui_scrollv: RGBAImage;
  nui_button_n: RGBAImage;
  nui_cnt_up: RGBAImage;
  nui_cnt_down: RGBAImage;
  nui_slider: RGBAImage;
}

export const NUI_PIECES = ["nui_scrollv", "nui_button_n", "nui_cnt_up", "nui_cnt_down", "nui_slider"] as const;

/** Box-resampled copy at w x h. */
export function resize(im: RGBAImage, w: number, h: number): RGBAImage {
  const out = newImage(w, h);
  const fx = im.width / w;
  const fy = im.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * fy;
    const y1 = (y + 1) * fy;
    for (let x = 0; x < w; x++) {
      const x0 = x * fx;
      const x1 = (x + 1) * fx;
      const acc = [0, 0, 0, 0];
      let wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          const o = (Math.min(sy, im.height - 1) * im.width + Math.min(sx, im.width - 1)) * 4;
          for (let k = 0; k < 4; k++) acc[k]! += im.data[o + k]! * wx * wy;
          wsum += wx * wy;
        }
      }
      for (let k = 0; k < 4; k++) out.data[(y * w + x) * 4 + k] = Math.round(acc[k]! / wsum);
    }
  }
  return out;
}

const px = (im: RGBAImage, x: number, y: number) => Array.from(im.data.subarray((y * im.width + x) * 4, (y * im.width + x) * 4 + 4));
function set(im: RGBAImage, x: number, y: number, c: readonly number[], a = 255): void {
  const o = (y * im.width + x) * 4;
  im.data[o] = c[0]!;
  im.data[o + 1] = c[1]!;
  im.data[o + 2] = c[2]!;
  im.data[o + 3] = a;
}

export function drawScrollbar(n: NuiPieces, p: ReskinPalette): RGBAImage {
  const sv = n.nui_scrollv;
  const row = newImage(sv.width, 1);
  row.data.set(sv.data.subarray((sv.height >> 1) * sv.width * 4, ((sv.height >> 1) + 1) * sv.width * 4));
  const prof = resize(row, 12, 1); // left to right across the thumb
  const P = (i: number) => px(prof, i, 0);
  const mean = [0, 1, 2].map((k) => Array.from({ length: 12 }, (_, i) => P(i)[k]!).reduce((s, v) => s + v, 0) / 12);
  const rim = mean.map((v, k) => Math.round(v * 0.45 + p.ink[k]! * 0.55));
  const im = newImage(16, 16, [0, 0, 0, 255]);
  for (let y = 2; y < 14; y++) for (let x = 0; x < 16; x++) set(im, x, y, P(13 - y));
  for (let x = 0; x < 12; x++) {
    set(im, 2 + x, 0, rim);
    set(im, 2 + x, 1, P(x));
    set(im, 2 + x, 14, P(x));
    set(im, 2 + x, 15, rim);
  }
  for (const c of [0, 1, 14, 15]) {
    set(im, c, 0, rim);
    set(im, c, 15, rim);
    set(im, c, 1, c < 2 ? P(0) : P(11));
    set(im, c, 14, c < 2 ? P(0) : P(11));
  }
  return im;
}

function over(base: RGBAImage, top: RGBAImage, ox: number, oy: number): void {
  for (let y = 0; y < top.height; y++) {
    for (let x = 0; x < top.width; x++) {
      const s = (y * top.width + x) * 4;
      const d = ((oy + y) * base.width + ox + x) * 4;
      const a = top.data[s + 3]! / 255;
      for (let k = 0; k < 3; k++) base.data[d + k] = Math.round(top.data[s + k]! * a + base.data[d + k]! * (1 - a));
    }
  }
}

function buttonCell(n: NuiPieces, p: ReskinPalette, glyph: RGBAImage): RGBAImage {
  const bn = n.nui_button_n;
  // the body's vertical profile, from the middle column inside the rim
  const col = newImage(1, Math.max(1, bn.height - 4));
  for (let y = 0; y < col.height; y++) col.data.set(bn.data.subarray(((y + 2) * bn.width + (bn.width >> 1)) * 4, ((y + 2) * bn.width + (bn.width >> 1)) * 4 + 4), y * 4);
  const body = resize(col, 1, 14);
  const cell = newImage(16, 16, [0, 0, 0, 255]);
  for (let y = 0; y < 14; y++) for (let x = 1; x < 15; x++) set(cell, x, 1 + y, px(body, 0, y));
  for (let i = 0; i < 16; i++) {
    set(cell, i, 0, p.accent);
    set(cell, i, 15, p.accent);
    set(cell, 0, i, p.accent);
    set(cell, 15, i, p.accent);
  }
  over(cell, glyph.width === 16 && glyph.height === 16 ? glyph : resize(glyph, 16, 16), 0, 0);
  return cell;
}

export function drawArrowButton(n: NuiPieces, p: ReskinPalette): RGBAImage {
  const im = newImage(32, 16, [0, 0, 0, 255]);
  const down = buttonCell(n, p, n.nui_cnt_down);
  const up = buttonCell(n, p, n.nui_cnt_up);
  for (let y = 0; y < 16; y++) {
    im.data.set(down.data.subarray(y * 64, y * 64 + 64), y * 128);
    im.data.set(up.data.subarray(y * 64, y * 64 + 64), y * 128 + 64);
  }
  for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255;
  return im;
}

export function drawSlider(n: NuiPieces, p: ReskinPalette): RGBAImage {
  const th = resize(n.nui_slider, 12, 16);
  const im = newImage(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 12; x++) {
      const c = px(th, x, y);
      set(im, x, y, c, c[3]! < 128 ? 0 : 255); // crisp cut-out corners
    }
  }
  [p.accent, p.ink, p.ink, p.ink, p.accent].forEach((c, i) => {
    for (let x = 12; x < 16; x++) set(im, x, 6 + i, c);
  });
  return im;
}

export const REDRAWS: Record<string, (n: NuiPieces, p: ReskinPalette) => RGBAImage> = {
  gui_scrollbar: drawScrollbar,
  gui_chr_arrowbtn: drawArrowButton,
  gui_slider: drawSlider,
};
