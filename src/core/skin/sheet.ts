/**
 * The widget-states sheet: every widget a skin styles, in every state the skin has art for (normal, hover, pressed,
 * selected, checked, ...), drawn with the skin's textures (each 9-slice key with its own margins: slice.ts) and fonts.
 * A port of tools/open-skin/widget_sheet.py, with the title bar, thumb, slider and button states added.
 *
 * Its last row is the disabled widgets (enabled = false), each piece at the window editor's 50 % (DISABLED_ALPHA).
 *
 * Scrollbar thumbs sit as the client draws them (10 px across, 4 px in from the track's edge). The windows are drawn at rest (docs/GAPS.md, "Not drawn"); this is where hover and pressed art is judged. The
 * widgets are placed by hand here: Nuklear's own spacing is not reproduced.
 */
import { NuiFont } from "../font/font.js";
import type { CanvasFactory } from "../render/canvas.js";
import { resize } from "../render/resample.js";
import { DISABLED_ALPHA } from "../render/render.js";
import { type RGBA, alphaCompositeInPlace, textLayer } from "../render/text.js";
import { type RGBAImage, newImage } from "../res/image.js";
import type { Images } from "../res/images.js";
import { KEY_BY_NAME, SKIN_KEYS } from "./keys.js";
import { type Skin, color } from "./skin.js";
import { sliceForKey } from "./slice.js";

export const SHEET_W = 1000;
export const SHEET_H = 900;
const BG: RGBA = [52, 48, 44, 255];
const LABEL: RGBA = [230, 200, 140, 255];

/** Loads every texture the skin names, so drawing can be synchronous. */
export async function preloadSkinImages(skin: Skin, images: Images): Promise<void> {
  const names = new Set<string>();
  for (const k of SKIN_KEYS) {
    const v = skin.get(k.key);
    if ((k.type === "image9" || k.type === "imgcol") && typeof v === "string" && v && !v.startsWith("#")) names.add(v.toLowerCase());
  }
  await Promise.all([...names].map((n) => images.get(n)));
}

/** What a key draws over a w x h widget: a 9-slice, a stretched image or a flat colour; magenta when the texture is
 * missing, null when it draws nothing. Textures must be loaded (preloadSkinImages). */
export function keyImage(skin: Skin, images: Images, key: string, w: number, h: number): RGBAImage | null {
  const v = skin.get(key);
  w = Math.max(1, Math.trunc(w));
  h = Math.max(1, Math.trunc(h));
  if (typeof v !== "string") return null;
  if (v.startsWith("#")) {
    const c = color(v, [0, 0, 0, 0]);
    return c[3] ? newImage(w, h, c) : null;
  }
  const t = images.peek(v);
  if (!t) return newImage(w, h, [255, 0, 255, 255]);
  return KEY_BY_NAME.get(key)?.type === "image9" ? sliceForKey(key, t, w, h) : resize(t, w, h, "bilinear");
}

export interface SheetOptions {
  makeCanvas: CanvasFactory;
  title?: string;
}

/** Draws the sheet (SHEET_W x SHEET_H). The skin's textures must be loaded (preloadSkinImages). */
export function widgetSheet(skin: Skin, images: Images, o: SheetOptions): RGBAImage {
  const W = SHEET_W;
  const H = SHEET_H;
  const img = newImage(W, H, BG);
  const font = skin.defaultFont;
  const mono = skin.fontList[1] ?? font;
  const small = new NuiFont("label", mono.face, 11, mono.model, 0, o.makeCanvas);
  const text = color(skin.get("text.color", "#FFFFFFFF"));
  const col = (key: string, def: RGBA = [255, 255, 255, 255]) => {
    const v = skin.get(key);
    return typeof v === "string" && /^#[0-9a-f]{8}$/i.test(v) ? color(v) : def;
  };

  // Below 1 while the disabled row draws: every piece is pasted at that alpha, as the renderer does.
  let fadeBy = 1;
  const put = (key: string, x: number, y: number, w: number, h: number) => {
    const im = keyImage(skin, images, key, w, h);
    if (im) alphaCompositeInPlace(img, fade(im, fadeBy), Math.trunc(x), Math.trunc(y));
  };
  const txt = (s: string, x: number, y: number, fill: RGBA = text, f: NuiFont = font, clip: [number, number, number, number] = [0, 0, W, H]) => {
    const l = textLayer(f, s, x, y, fill, clip);
    if (l) alphaCompositeInPlace(img, fade(l.im, fadeBy), l.x, l.y);
  };
  const centred = (s: string, x: number, y: number, w: number, h: number, fill: RGBA = text) =>
    txt(s, x + (w - font.width(s)) / 2, y + (h - font.line) / 2, fill, font, [x, y, x + w, y + h]);
  const label = (s: string, x: number, y: number) => txt(s, x, y, LABEL, small, [0, 0, W, H]);
  // Text that sits on no widget of its own (checkbox and radio labels, the font samples) sits on the window's
  // background in the client, so it gets that behind it here: a light skin's dark text would vanish on the sheet's grey.
  const winBg = col("window.fixed_background", [0, 0, 0, 0]);
  const onWindow = (x: number, y: number, w: number, h: number) => {
    if (winBg[3]) fillRect(img, x, y, w, h, winBg);
  };

  label(o.title ?? "widget states", 16, 8);

  // Window: title bar (33 high), body, a bordered group with list rows and a scrollbar.
  const x0 = 16;
  const y0 = 30;
  const ww = 330;
  const wh = 210;
  put("window.header.normal", x0, y0, ww, 33);
  txt("Window title", x0 + 7, y0 + 8, col("window.header.label_normal"), font, [x0, y0, x0 + ww - 60, y0 + 33]);
  ["close_button", "minimize_button"].forEach((b, i) => put(`window.header.${b}.normal`, x0 + ww - 25 - i * 26, y0 + 8, 16, 16));
  put("window.fixed_background", x0, y0 + 34, ww, wh - 34);
  put("window.border_image", x0, y0 + 34, ww, wh - 34);
  txt("Body text in the default font.", x0 + 12, y0 + 46);
  put("window.border_image", x0 + 10, y0 + 74, ww - 20, wh - 84);
  txt("A group or list frame", x0 + 20, y0 + 84);
  put("scrollv.normal", x0 + ww - 32, y0 + 78, 18, wh - 92);
  put("scrollv.dec_button.normal", x0 + ww - 32, y0 + 78, 18, 18);
  put("scrollv.inc_button.normal", x0 + ww - 32, y0 + wh - 32, 18, 18);
  put("scrollv.cursor_normal", x0 + ww - 28, y0 + 98, 10, 40);
  ["Row one", "Row two", "Row three"].forEach((s, i) => {
    put(i === 1 ? "selectable.normal_active" : "selectable.normal", x0 + 18, y0 + 108 + i * 30, ww - 62, 26);
    centred(s, x0 + 18, y0 + 108 + i * 30, ww - 62, 26);
  });
  label("window, title bar, group, list rows, scrollbar", x0, y0 + wh + 4);

  // Buttons.
  const bx = 370;
  let by = 30;
  label("button: normal / hover / pressed (active)", bx, by);
  (
    [
      ["normal", "Normal"],
      ["hover", "Hover"],
      ["active", "Pressed"],
    ] as const
  ).forEach(([k, s], i) => {
    put(`button.${k}`, bx + i * 205, by + 16, 195, 32);
    centred(s, bx + i * 205, by + 16, 195, 32, col(`button.text_${k}`));
  });
  by += 62;
  label("selectable: normal / hover / pressed / selected / selected+hover / selected+pressed", bx, by);
  (
    [
      ["normal", "Normal"],
      ["hover", "Hover"],
      ["pressed", "Pressed"],
      ["normal_active", "Selected"],
      ["hover_active", "Sel+hover"],
      ["pressed_active", "Sel+press"],
    ] as const
  ).forEach(([k, s], i) => {
    const cx = bx + (i % 3) * 205;
    const cy = by + 16 + Math.trunc(i / 3) * 38;
    put(`selectable.${k}`, cx, cy, 195, 32);
    centred(s, cx, cy, 195, 32);
  });
  by += 100;
  for (const [sec, word, cur] of [
    ["checkbox", "Check", [4, 4, 14]],
    ["option", "Radio", [5, 5, 12]],
  ] as const) {
    onWindow(bx, by + 14, 600, 30);
    label(`${sec === "checkbox" ? "checkbox" : "option (radio)"}: normal / hover / active / ${sec === "checkbox" ? "checked / checked+hover" : "chosen / chosen+hover"}`, bx, by);
    (
      [
        ["normal", null],
        ["hover", null],
        ["active", null],
        ["normal", "cursor_normal"],
        ["hover", "cursor_hover"],
      ] as const
    ).forEach(([k, c], i) => {
      const cx = bx + i * 120;
      put(`${sec}.${k}`, cx, by + 18, 22, 22);
      if (c) put(`${sec}.${c}`, cx + cur[0], by + 18 + cur[1], cur[2], cur[2]);
      txt(word, cx + 28, by + 20);
    });
    by += 50;
  }
  label("combo: normal / hover / active", bx, by);
  ["normal", "hover", "active"].forEach((k, i) => {
    const cx = bx + i * 205;
    put(`combo.${k}`, cx, by + 16, 195, 32);
    put(`combo.button.${k}`, cx + 195 - 28, by + 21, 22, 22);
    txt("Option two", cx + 10, by + 23, text, font, [cx, by + 16, cx + 165, by + 48]);
  });
  by += 60;
  label("text edit: normal / hover / active", bx, by);
  ["normal", "hover", "active"].forEach((k, i) => {
    const cx = bx + i * 205;
    put(`edit.${k}`, cx, by + 16, 195, 32);
    txt(i === 0 ? "Search recipes" : "Typed text", cx + 10, by + 23, i === 0 ? [128, 128, 128, 255] : col("edit.text_normal"), font, [cx, by + 16, cx + 190, by + 48]);
  });
  by += 60;
  label("progress: normal 40% / hover 70% / active 100%", bx, by);
  (
    [
      ["normal", 0.4],
      ["hover", 0.7],
      ["active", 1],
    ] as const
  ).forEach(([k, f], i) => {
    const cx = bx + i * 205;
    put(`progress.${k}`, cx, by + 16, 195, 24);
    put(`progress.cursor_${k}`, cx + 2, by + 18, Math.trunc(191 * f), 20);
  });
  by += 56;
  label("title bar: normal / hover / active, with its close and collapse buttons", bx, by);
  ["normal", "hover", "active"].forEach((k, i) => {
    const cx = bx + i * 205;
    put(`window.header.${k}`, cx, by + 16, 195, 33);
    txt("Title", cx + 7, by + 24, col(`window.header.label_${k}`), font, [cx, by + 16, cx + 140, by + 49]);
    put(`window.header.close_button.${k}`, cx + 195 - 25, by + 24, 16, 16);
    put(`window.header.minimize_button.${k}`, cx + 195 - 51, by + 24, 16, 16);
  });
  by += 64;
  label("scrollbar thumbs: normal / hover / active (vertical, horizontal)", bx, by);
  ["normal", "hover", "active"].forEach((k, i) => {
    const cx = bx + i * 205;
    put(`scrollv.${k}`, cx, by + 16, 18, 90);
    put(`scrollv.cursor_${k}`, cx + 4, by + 30, 10, 50);
    put(`scrollh.${k}`, cx + 26, by + 16, 160, 18);
    put(`scrollh.cursor_${k}`, cx + 50, by + 20, 80, 10);
    put(`scrollh.dec_button.${k}`, cx + 26, by + 44, 18, 18);
    put(`scrollh.inc_button.${k}`, cx + 50, by + 44, 18, 18);
    put(`scrollv.dec_button.${k}`, cx + 74, by + 44, 18, 18);
    put(`scrollv.inc_button.${k}`, cx + 98, by + 44, 18, 18);
  });
  by += 116;
  label("slider knob: normal / hover / active; tree buttons: normal / hover / active", bx, by);
  ["cursor_normal", "cursor_hover", "cursor_active"].forEach((k, i) => {
    const cx = bx + i * 205;
    fillRect(img, cx + 6, by + 33, 120, 2, [70, 60, 50, 255]);
    fillRect(img, cx + 6, by + 33, 50, 2, col("slider.bar_filled", [173, 142, 96, 255]));
    put(`slider.${k}`, cx + 50, by + 24, 12, 18);
    const st = ["normal", "hover", "active"][i]!;
    put(`tab.tab_minimize_button.${st}`, cx + 140, by + 26, 16, 16);
    put(`tab.tab_maximize_button.${st}`, cx + 162, by + 26, 16, 16);
  });

  // Lower left: scrollbars, slider, tree header, context menu, property, fonts.
  const lx = 16;
  let ly = 270;
  label("scrollbars: track, arrows, thumb", lx, ly);
  put("scrollv.normal", lx, ly + 16, 18, 150);
  put("scrollv.dec_button.normal", lx, ly + 16, 18, 18);
  put("scrollv.inc_button.normal", lx, ly + 148, 18, 18);
  put("scrollv.cursor_normal", lx + 4, ly + 40, 10, 60);
  put("scrollh.normal", lx + 30, ly + 16, 300, 18);
  put("scrollh.dec_button.normal", lx + 30, ly + 16, 18, 18);
  put("scrollh.inc_button.normal", lx + 312, ly + 16, 18, 18);
  put("scrollh.cursor_normal", lx + 60, ly + 20, 100, 10);
  label("slider: bar_filled and knob", lx + 30, ly + 44);
  fillRect(img, lx + 36, ly + 71, 284, 2, [70, 60, 50, 255]);
  fillRect(img, lx + 36, ly + 71, 114, 2, col("slider.bar_filled", [173, 142, 96, 255]));
  put("slider.cursor_normal", lx + 144, ly + 63, 12, 18);
  label("tree header (tab.background) with its buttons", lx + 30, ly + 90);
  put("tab.background", lx + 30, ly + 106, 300, 28);
  put("tab.tab_minimize_button.normal", lx + 38, ly + 112, 16, 16);
  txt("Tree node (open)", lx + 62, ly + 111);
  put("tab.background", lx + 30, ly + 138, 300, 28);
  put("tab.tab_maximize_button.normal", lx + 38, ly + 144, 16, 16);
  txt("Tree node (closed)", lx + 62, ly + 143);
  ly += 186;
  label("context menu: normal/hover/active", lx, ly);
  ["normal", "hover", "active"].forEach((k, i) => {
    put(`contextual_button.${k}`, lx, ly + 16 + i * 26, 200, 24);
    txt(["Examine", "Pick up", "Use"][i]!, lx + 8, ly + 20 + i * 26);
  });
  label("property", lx + 236, ly);
  put("property.normal", lx + 220, ly + 16, 120, 24);
  put("property.dec_button.normal", lx + 220, ly + 16, 24, 24);
  put("property.inc_button.normal", lx + 316, ly + 16, 24, 24);
  txt("12", lx + 272, ly + 19);
  put("window.scaler", lx + 220, ly + 60, 14, 14);
  label("scaler", lx + 240, ly + 60);

  // Disabled: the same art at half alpha over the window's background.
  ly = 708;
  label("disabled (enabled = false): button, checkbox, radio, combo, text edit, progress, each at 50 % as the window editor draws them", lx, ly);
  onWindow(lx - 6, ly + 14, W - 2 * lx + 12, 44);
  fadeBy = DISABLED_ALPHA;
  {
    const y = ly + 20;
    let x = lx;
    put("button.normal", x, y, 150, 32);
    txt("Disabled", x + (150 - font.width("Disabled")) / 2, y + (32 - font.line) / 2, col("button.text_normal"), font, [x, y, x + 150, y + 32]);
    x += 164;
    for (const [sec, word, cur] of [
      ["checkbox", "Check", [4, 4, 14]],
      ["option", "Radio", [5, 5, 12]],
    ] as const) {
      put(`${sec}.normal`, x, y + 5, 22, 22);
      put(`${sec}.cursor_normal`, x + cur[0], y + 5 + cur[1], cur[2], cur[2]);
      txt(word, x + 28, y + 7);
      x += 109;
    }
    put("combo.normal", x, y, 170, 32);
    put("combo.button.normal", x + 170 - 28, y + 5, 22, 22);
    txt("Option two", x + 10, y + 7, text, font, [x, y, x + 140, y + 32]);
    x += 184;
    put("edit.normal", x, y, 170, 32);
    txt("Typed text", x + 10, y + 7, col("edit.text_normal"), font, [x, y, x + 165, y + 32]);
    x += 184;
    put("progress.normal", x, y + 4, 150, 24);
    put("progress.cursor_normal", x + 2, y + 6, Math.trunc(146 * 0.4), 20);
  }
  fadeBy = 1;

  ly = 772;
  label(`fonts: ${font.name} and ${mono.name}`, lx, ly);
  onWindow(lx - 6, ly + 14, W - 2 * lx + 12, 92);
  txt("The quick brown fox jumps over the lazy dog. 0123456789", lx, ly + 16);
  txt("Wood Crafting, level 1 - 28 / 250 XP (222 to level 2)", lx, ly + 37);
  txt("Àéîõü ÇÑß æø ¿¡ «» ©®°±²³µ¶ ×÷", lx, ly + 58);
  txt('int nResult = GetLocalInt(oPC, "x"); // mono', lx, ly + 82, text, mono);
  label(`${font.name} (${font.face.resref}, ${font.size} px), ${mono.name} (${mono.face.resref})`, 16, H - 18);
  return img;
}

/** The image with its alpha scaled by a (the same image when a is 1). */
function fade(im: RGBAImage, a: number): RGBAImage {
  if (a >= 1) return im;
  const out = { width: im.width, height: im.height, data: new Uint8ClampedArray(im.data) };
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = Math.round(out.data[i]! * a);
  return out;
}

function fillRect(im: RGBAImage, x: number, y: number, w: number, h: number, c: RGBA): void {
  alphaCompositeInPlace(im, newImage(w, h, c), x, y);
}
