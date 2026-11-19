/**
 * Every key the NWN:EE 8193.37-17 client reads from nui_skin.tml, in the order Nui__ReloadSkin reads them: its value
 * type, the client's default when the key is missing, and for 9-slice images the slice margins the client hard-codes.
 *
 * Source: docs/CLIENT-BEHAVIOUR.md#skin-keys (from the client's decompile); tools/open-skin/skin_keys.py is the
 * research copy of this list.
 * This describes the client's interface; it contains no Beamdog file content.
 *
 * Types:
 * - "image9": a texture resref drawn as a 9-slice with fixed margins. Missing: the image "" (the not-found
 *   placeholder). A "#colour" here is read as a resref and fails.
 * - "imgcol": "#RRGGBBAA" for a flat colour, anything else a texture stretched to the widget. Missing: #00000000.
 * - "colour": "#RRGGBBAA". Missing: #00000000 (transparent).
 * - "int": a whole number. Missing: 0.
 */

import { type Margins, type Region, type Tile, sliceSpec } from "../render/slice.js";

export type KeyType = "image9" | "imgcol" | "colour" | "int";
export type { Margins };

export type GroupId =
  | "window"
  | "header"
  | "button"
  | "checkbox"
  | "option"
  | "combo"
  | "edit"
  | "scrollbars"
  | "slider"
  | "progress"
  | "tab"
  | "list"
  | "selectable"
  | "property"
  | "context"
  | "chart";

export interface SkinKey {
  /** The dotted path ("button.hover"; top-level keys have no dot). */
  key: string;
  type: KeyType;
  /** 9-slice margins (image9 only): the renderer's (render/slice.ts sliceSpec), the one table of them. */
  margins?: Margins;
  /** Scrollbar thumbs: only this part of the texture is used, repeated along the bar (sliceSpec). */
  region?: Region | null;
  tile?: Tile;
  group: GroupId;
  note: string;
  /** False for keys the client never reads (listed so the checker can say so). */
  read: boolean;
}

export const GROUPS: { id: GroupId; title: string; summary: string }[] = [
  { id: "window", title: "Window", summary: "Window body, border, text colour, padding, scrollbar size, resize grip" },
  { id: "header", title: "Title bar", summary: "Title bar art, title text, close and collapse buttons" },
  { id: "button", title: "Button", summary: "NuiButton and the frame of NuiButtonImage" },
  { id: "checkbox", title: "Checkbox", summary: "NuiCheck: box and tick" },
  { id: "option", title: "Option", summary: "NuiOptions radio buttons" },
  { id: "combo", title: "Combo", summary: "NuiCombo box and drop-down arrow" },
  { id: "edit", title: "Text edit", summary: "NuiTextEdit" },
  { id: "scrollbars", title: "Scrollbars", summary: "Tracks, thumbs and arrow buttons" },
  { id: "slider", title: "Slider", summary: "NuiSlider knob and bar" },
  { id: "progress", title: "Progress", summary: "NuiProgress track and fill" },
  { id: "tab", title: "Tree and tab", summary: "Nuklear tree and tab headers (not exposed by nw_inc_nui)" },
  { id: "list", title: "List and group", summary: "Group and list borders; their frame is window.border_image, their rows the selectables" },
  { id: "selectable", title: "Selectable", summary: "NuiButtonSelect and toggles, all six states" },
  { id: "property", title: "Property", summary: "Nuklear's number widget (not exposed by nw_inc_nui)" },
  { id: "context", title: "Context menu", summary: "Right-click menu entries and popups" },
  { id: "chart", title: "Chart", summary: "NuiChart (read at the top level, not under [chart])" },
];

export const SKIN_KEYS: SkinKey[] = [];

function k(key: string, type: KeyType, group: GroupId, note = "", extra: Partial<SkinKey> = {}): void {
  const spec = type === "image9" ? sliceSpec(key) : null;
  if (type === "image9" && !spec) throw new Error(`${key}: a 9-slice key render/slice.ts does not know`);
  const { margins: _m, ...rest } = extra;
  SKIN_KEYS.push({ key, type, group, note, read: true, ...rest, ...(spec ? { margins: spec.margins, region: spec.region, tile: spec.tile } : {}) });
}

k("text.color", "colour", "window", "default text colour (labels, text)");
k("border.border_image", "image9", "window", "only its slice margin is used: border thickness = margin + 1 = 4 px");
k("window.fixed_background", "imgcol", "window", "window body background (a texture is stretched)");
k("window.background", "colour", "window", "Nuklear's window background colour");
k("window.border_image", "image9", "window", "window border; also groups, lists and bordered text");
k("window.border_color", "colour", "window", "window border colour");
k("window.popup_border_color", "colour", "context", "popup border colour");
k("window.combo_border_color", "colour", "combo", "open combo list border colour");
k("window.contextual_border_color", "colour", "context", "context menu border colour");
k("window.menu_border_color", "colour", "context", "menu border colour");
k("window.group_border_color", "colour", "list", "group and list border colour");
k("window.tooltip_border_color", "colour", "window", "tooltip border colour (tooltips use the window style)");
k("window.scaler", "imgcol", "window", "resize grip");
k("window.padding_x", "int", "window", "window inner padding");
k("window.padding_y", "int", "window");
k("window.scrollbar_size_x", "int", "scrollbars", "scrollbar thickness, times the GUI scale");
k("window.scrollbar_size_y", "int", "scrollbars");
for (const s of ["normal", "hover", "active"]) k(`window.header.${s}`, "image9", "header", "title bar");
for (const s of ["label_normal", "label_hover", "label_active"]) k(`window.header.${s}`, "colour", "header", "title text");
for (const b of ["close_button", "minimize_button"]) {
  for (const s of ["normal", "hover", "active"]) k(`window.header.${b}.${s}`, "imgcol", "header", b === "close_button" ? "close button" : "collapse button");
  k(`window.header.${b}.padding_x`, "int", "header");
  k(`window.header.${b}.padding_y`, "int", "header");
}
for (const c of ["background_color", "color", "border_color", "selected_color"]) {
  k(c, "colour", "chart", "NuiChart, read at the top level (the stock file puts it under [chart], where it is never read)");
}
k("chart.border", "int", "chart", "chart border");
for (const sb of ["scrollv", "scrollh"] as const) {
  const v = sb === "scrollv";
  for (const s of ["normal", "hover", "active"]) k(`${sb}.${s}`, "image9", "scrollbars", `${v ? "vertical" : "horizontal"} scrollbar track`);
  for (const s of ["cursor_normal", "cursor_hover", "cursor_active"]) {
    k(`${sb}.${s}`, "image9", "scrollbars", "scrollbar thumb: only the texture's middle strip, repeated along the bar; drawn 10 px across, 4 px in");
  }
  for (const b of ["dec_button", "inc_button"]) {
    for (const s of ["normal", "hover", "active"]) k(`${sb}.${b}.${s}`, "imgcol", "scrollbars", b === "dec_button" ? (v ? "up arrow" : "left arrow") : v ? "down arrow" : "right arrow");
  }
  if (v) k("scrollv.border_color", "colour", "scrollbars", "scrollh.border_color is not read");
  k(`${sb}.padding_x`, "int", "scrollbars");
  k(`${sb}.padding_y`, "int", "scrollbars");
}
for (const sec of ["checkbox", "option"] as const) {
  for (const s of ["normal", "hover", "active", "cursor_normal", "cursor_hover"]) {
    k(`${sec}.${s}`, "imgcol", sec, s.startsWith("cursor") ? (sec === "checkbox" ? "the tick" : "the dot") : sec === "checkbox" ? "the box" : "the ring");
  }
}
k("button.normal", "image9", "button", "");
k("button.hover", "image9", "button", "");
k("button.active", "image9", "button", "pressed");
for (const s of ["text_background", "text_normal", "text_hover", "text_active"]) k(`button.${s}`, "colour", "button", "label colour");
k("button.border", "int", "button", "divided by 100, so practically 0");
for (const s of ["normal", "active", "hover"]) k(`contextual_button.${s}`, "imgcol", "context", "right-click menu entry");
k("contextual_button.padding_x", "int", "context");
k("contextual_button.padding_y", "int", "context");
k("tab.background", "image9", "tab", "tree and tab headers");
for (const b of ["tab_minimize_button", "tab_maximize_button", "node_minimize_button", "node_maximize_button"]) {
  for (const s of ["normal", "active", "hover"]) k(`tab.${b}.${s}`, "imgcol", "tab", b.includes("minimize") ? "collapse icon" : "expand icon");
}
for (const s of ["cursor_normal", "cursor_hover", "cursor_active"]) k(`slider.${s}`, "imgcol", "slider", "slider knob");
k("slider.bar_filled", "colour", "slider", "filled part of the bar");
for (const s of ["normal", "pressed", "normal_active", "pressed_active", "hover_active"]) {
  k(`selectable.${s}`, "image9", "selectable", s.includes("active") ? "selected" : "");
}
k("selectable.hover", "image9", "selectable", "");
k("selectable.padding_x", "int", "selectable");
k("selectable.padding_y", "int", "selectable");
k("progress.normal", "image9", "progress", "track");
k("progress.hover", "image9", "progress", "track");
k("progress.active", "image9", "progress", "track");
for (const s of ["cursor_normal", "cursor_hover", "cursor_active"]) k(`progress.${s}`, "imgcol", "progress", "the fill");
k("property.normal", "imgcol", "property");
k("property.active", "imgcol", "property");
k("property.hover", "imgcol", "property", "never read: the client asks for \"property.hover \" (with a trailing space)", { read: false });
for (const b of ["dec_button", "inc_button", "edit"]) {
  for (const s of ["normal", "hover", "active"]) k(`property.${b}.${s}`, "imgcol", "property");
}
k("combo.normal", "image9", "combo", "");
k("combo.hover", "image9", "combo", "");
k("combo.active", "image9", "combo", "");
k("combo.content_padding_x", "int", "combo");
k("combo.content_padding_y", "int", "combo");
for (const s of ["normal", "active", "hover"]) k(`combo.button.${s}`, "imgcol", "combo", "drop-down arrow");
for (const s of ["normal", "hover", "active"]) k(`edit.${s}`, "image9", "edit", "");
k("edit.border_color", "colour", "edit");
k("edit.text_normal", "colour", "edit", "typed text");
k("edit.padding_x", "int", "edit");
k("edit.padding_y", "int", "edit");

export const KEY_BY_NAME = new Map(SKIN_KEYS.map((x) => [x.key, x]));

/** What the client uses when a key is missing. */
export function clientDefault(t: KeyType): string | number {
  return t === "image9" ? "" : t === "int" ? 0 : "#00000000";
}

/** Keys the stock file has that the client never reads (so the checker calls them out by name). */
export const KNOWN_UNREAD: Record<string, string> = {
  "scrollh.border_color": "the client reads scrollv.border_color only",
  "chart.background_color": "chart colours are read at the top level, not under [chart]",
  "chart.color": "chart colours are read at the top level, not under [chart]",
  "chart.border_color": "chart colours are read at the top level, not under [chart]",
  "chart.selected_color": "chart colours are read at the top level, not under [chart]",
};

// --- [[fonts]] --------------------------------------------------------------------------------------------------------

export interface FontKey {
  key: string;
  type: "string" | "float" | "bool";
  def: string | number | boolean;
  note: string;
}

/** The [[fonts]] keys and NkConfig::Font::Font()'s defaults. */
export const FONT_KEYS: FontKey[] = [
  { key: "name", type: "string", def: "(default)", note: "the name scripts use (NuiStyleFont); the first font is the UI default" },
  { key: "resref", type: "string", def: "fnt_maintext", note: "the .ttf resource, at most 16 characters" },
  { key: "pixel_height", type: "float", def: 0, note: "read but not used by the client" },
  { key: "pixel_snap", type: "bool", def: true, note: "required: an entry without it is skipped" },
  { key: "oversample_h", type: "float", def: 1, note: "truncated to a whole number" },
  { key: "oversample_v", type: "float", def: 1, note: "truncated to a whole number" },
  { key: "font_size", type: "float", def: 17, note: "pixel height at UI scale 1.0 (16 if 0 or less)" },
  { key: "spacing_h", type: "float", def: 0.5, note: "extra space after each glyph" },
  { key: "spacing_v", type: "float", def: 0, note: "extra line spacing" },
];

/** The glyphs the client bakes, by code page (nk_sdl_refresh_config). */
export const CODE_PAGES: { id: string; title: string; ranges: [number, number][] }[] = [
  { id: "cp1252", title: "Western (cp1252, English and most Latin languages)", ranges: [[0x20, 0xff]] },
  {
    id: "cp1250",
    title: "Central European (cp1250)",
    ranges: [
      [0x20, 0x2ff],
      [0x2000, 0x21ff],
    ],
  },
  {
    // nuklear.h nk_font_cyrillic_glyph_ranges.
    id: "cp1251",
    title: "Cyrillic (cp1251)",
    ranges: [
      [0x20, 0xff],
      [0x400, 0x52f],
      [0x2de0, 0x2dff],
      [0xa640, 0xa69f],
    ],
  },
];

/** The texture resrefs a skin's values name (image9 and imgcol keys that are not colours), lower case. */
export function texturesOf(get: (key: string) => unknown): Set<string> {
  const out = new Set<string>();
  for (const sk of SKIN_KEYS) {
    if (sk.type !== "image9" && sk.type !== "imgcol") continue;
    const v = get(sk.key);
    if (typeof v === "string" && v && !v.startsWith("#")) out.add(v.toLowerCase());
  }
  return out;
}

/** The keys that name a texture, by texture (lower case). */
export function keysByTexture(get: (key: string) => unknown): Map<string, SkinKey[]> {
  const out = new Map<string, SkinKey[]>();
  for (const sk of SKIN_KEYS) {
    if (sk.type !== "image9" && sk.type !== "imgcol") continue;
    const v = get(sk.key);
    if (typeof v !== "string" || !v || v.startsWith("#")) continue;
    const t = v.toLowerCase();
    if (!out.has(t)) out.set(t, []);
    out.get(t)!.push(sk);
  }
  return out;
}
