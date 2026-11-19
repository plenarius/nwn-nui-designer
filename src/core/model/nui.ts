/**
 * The JSON builders of nw_inc_nui.nss (8193.37-17), one for one: what NuiWindow, NuiRow, NuiLabel, ... make. The
 * fixtures are written with them, and phase 2's NWScript export maps back onto them.
 */
import type { JsonObject, JsonValue } from "./types.js";

export const NUI_SCROLLBARS_NONE = 0;
export const NUI_SCROLLBARS_X = 1;
export const NUI_SCROLLBARS_Y = 2;
export const NUI_SCROLLBARS_BOTH = 3;
export const NUI_SCROLLBARS_AUTO = 4;
export const NUI_ASPECT_FIT = 0;
export const NUI_ASPECT_FILL = 1;
export const NUI_ASPECT_FIT100 = 2;
export const NUI_ASPECT_EXACT = 3;
export const NUI_ASPECT_EXACTSCALED = 4;
export const NUI_ASPECT_STRETCH = 5;
export const NUI_HALIGN_CENTER = 0;
export const NUI_HALIGN_LEFT = 1;
export const NUI_HALIGN_RIGHT = 2;
export const NUI_VALIGN_MIDDLE = 0;
export const NUI_VALIGN_TOP = 1;
export const NUI_VALIGN_BOTTOM = 2;
export const NUI_DIRECTION_HORIZONTAL = 0;
export const NUI_DIRECTION_VERTICAL = 1;
export const NUI_DRAW_LIST_ITEM_TYPE_POLYLINE = 0;
export const NUI_DRAW_LIST_ITEM_TYPE_CURVE = 1;
export const NUI_DRAW_LIST_ITEM_TYPE_CIRCLE = 2;
export const NUI_DRAW_LIST_ITEM_TYPE_ARC = 3;
export const NUI_DRAW_LIST_ITEM_TYPE_TEXT = 4;
export const NUI_DRAW_LIST_ITEM_TYPE_IMAGE = 5;
export const NUI_DRAW_LIST_ITEM_TYPE_LINE = 6;
export const NUI_DRAW_LIST_ITEM_TYPE_RECT = 7;
export const NUI_DRAW_LIST_ITEM_ORDER_BEFORE = -1;
export const NUI_DRAW_LIST_ITEM_ORDER_AFTER = 1;
export const NUI_DRAW_LIST_ITEM_RENDER_ALWAYS = 0;
export const NUI_DRAW_LIST_ITEM_RENDER_MOUSE_OFF = 1;
export const NUI_DRAW_LIST_ITEM_RENDER_MOUSE_HOVER = 2;
export const NUI_DRAW_LIST_ITEM_RENDER_MOUSE_LEFT = 3;
export const NUI_DRAW_LIST_ITEM_RENDER_MOUSE_RIGHT = 4;
export const NUI_DRAW_LIST_ITEM_RENDER_MOUSE_MIDDLE = 5;
export const NUI_CHART_TYPE_LINES = 0;
export const NUI_CHART_TYPE_COLUMN = 1;

type J = JsonValue;

export function NuiWindow(root: J, title: J, geometry: J, resizable: J = false, collapsed: J = null, closable: J = true, transparent: J = false, border: J = true, acceptsInput: J = true, sizeConstraint: J = null, edgeConstraint: J = null, font: J = ""): JsonObject {
  return { version: 1, title, root, geometry, resizable, collapsed, closable, transparent, border, accepts_input: acceptsInput, size_constraint: sizeConstraint, edge_constraint: edgeConstraint, font };
}
export function NuiElement(type: string, label: J, value: J): JsonObject {
  return { type, label, value };
}
export function NuiBind(id: string, numberFlags = 0, numberPrecision = 0, textFlags = 0): JsonObject {
  return { bind: id, number_flags: numberFlags, number_precision: numberPrecision, text_flags: textFlags };
}
export const NuiId = (e: JsonObject, id: string): JsonObject => ({ ...e, id });
export const NuiStrRef = (strref: number): JsonObject => ({ strref });
export const NuiCol = (children: J[]): JsonObject => ({ ...NuiElement("col", null, null), children });
export const NuiRow = (children: J[]): JsonObject => ({ ...NuiElement("row", null, null), children });
export const NuiGroup = (child: J, border = true, scroll = NUI_SCROLLBARS_AUTO): JsonObject => ({ ...NuiElement("group", null, null), children: [child], border, scrollbars: scroll });
export const NuiWidth = (e: JsonObject, w: number): JsonObject => ({ ...e, width: w });
export const NuiHeight = (e: JsonObject, h: number): JsonObject => ({ ...e, height: h });
export const NuiAspect = (e: JsonObject, a: number): JsonObject => ({ ...e, aspect: a });
export const NuiMargin = (e: JsonObject, m: number): JsonObject => ({ ...e, margin: m });
export const NuiPadding = (e: JsonObject, p: number): JsonObject => ({ ...e, padding: p });
export const NuiEnabled = (e: JsonObject, v: J): JsonObject => ({ ...e, enabled: v });
export const NuiVisible = (e: JsonObject, v: J): JsonObject => ({ ...e, visible: v });
export const NuiTooltip = (e: JsonObject, v: J): JsonObject => ({ ...e, tooltip: v });
export const NuiDisabledTooltip = (e: JsonObject, v: J): JsonObject => ({ ...e, disabled_tooltip: v });
export const NuiEncouraged = (e: JsonObject, v: J): JsonObject => ({ ...e, encouraged: v });
export const NuiVec = (x: number, y: number): JsonObject => ({ x, y });
export const NuiRect = (x: number, y: number, w: number, h: number): JsonObject => ({ x, y, w, h });
export const NuiColor = (r: number, g: number, b: number, a = 255): JsonObject => ({ r, g, b, a });
export const NuiStyleForegroundColor = (e: JsonObject, c: J): JsonObject => ({ ...e, foreground_color: c });
export const NuiStyleFont = (e: JsonObject, f: J): JsonObject => ({ ...e, font: f });
export const NuiSpacer = (): JsonObject => NuiElement("spacer", null, null);
export const NuiLabel = (value: J, halign: J, valign: J): JsonObject => ({ ...NuiElement("label", null, value), text_halign: halign, text_valign: valign });
export const NuiText = (value: J, border = true, scroll = NUI_SCROLLBARS_AUTO): JsonObject => ({ ...NuiElement("text", null, value), border, scrollbars: scroll });
export const NuiButton = (label: J): JsonObject => NuiElement("button", label, null);
export const NuiButtonImage = (resref: J): JsonObject => NuiElement("button_image", resref, null);
export const NuiButtonSelect = (label: J, value: J): JsonObject => NuiElement("button_select", label, value);
export const NuiCheck = (label: J, value: J): JsonObject => NuiElement("check", label, value);
export const NuiImage = (resref: J, aspect: J, halign: J, valign: J): JsonObject => ({ ...NuiElement("image", null, resref), image_aspect: aspect, image_halign: halign, image_valign: valign });
export const NuiImageRegion = (e: JsonObject, region: J): JsonObject => ({ ...e, image_region: region });
export const NuiCombo = (elements: J, selected: J): JsonObject => ({ ...NuiElement("combo", null, selected), elements });
export const NuiComboEntry = (label: string, value: number): J => [label, value];
export const NuiSliderFloat = (value: J, min: J, max: J, step: J): JsonObject => ({ ...NuiElement("sliderf", null, value), min, max, step });
export const NuiSlider = (value: J, min: J, max: J, step: J): JsonObject => ({ ...NuiElement("slider", null, value), min, max, step });
export const NuiProgress = (value: J): JsonObject => NuiElement("progress", null, value);
export const NuiTextEdit = (placeholder: J, value: J, maxLength: number, multiline: boolean, wordwrap = true): JsonObject => ({ ...NuiElement("textedit", placeholder, value), max: maxLength, multiline, wordwrap });
export const NuiList = (template: J, rowCount: J, rowHeight = 25, border = true, scroll = NUI_SCROLLBARS_Y): JsonObject => ({ ...NuiElement("list", null, null), row_template: template, row_count: rowCount, row_height: rowHeight, border, scrollbars: scroll });
export const NuiListTemplateCell = (e: JsonObject, width: number, variable: boolean): J => [e, width, variable];
export const NuiColorPicker = (color: J): JsonObject => NuiElement("color_picker", null, color);
export const NuiOptions = (direction: number, elements: J, value: J): JsonObject => ({ ...NuiElement("options", null, value), direction, elements });
export const NuiToggles = (direction: number, elements: J, value: J): JsonObject => ({ ...NuiElement("tabbar", null, value), direction, elements });
export const NuiChartSlot = (type: number, legend: J, color: J, data: J): JsonObject => ({ type, legend, color, data });
export const NuiChart = (slots: J): JsonObject => NuiElement("chart", null, slots);

function item(type: number, enabled: J, color: J, fill: J, thickness: J, order = NUI_DRAW_LIST_ITEM_ORDER_AFTER, render = NUI_DRAW_LIST_ITEM_RENDER_ALWAYS, bindArrays = false): JsonObject {
  return { type, enabled, color, fill, line_thickness: thickness, order, render, arrayBinds: bindArrays };
}
export const NuiDrawListPolyLine = (en: J, c: J, fill: J, t: J, points: J, order?: number, render?: number, arr?: boolean): JsonObject => ({ ...item(NUI_DRAW_LIST_ITEM_TYPE_POLYLINE, en, c, fill, t, order, render, arr), points });
export const NuiDrawListCurve = (en: J, c: J, t: J, a: J, b: J, c0: J, c1: J, order?: number, render?: number, arr?: boolean): JsonObject => ({ ...item(NUI_DRAW_LIST_ITEM_TYPE_CURVE, en, c, false, t, order, render, arr), a, b, ctrl0: c0, ctrl1: c1 });
export const NuiDrawListCircle = (en: J, c: J, fill: J, t: J, rect: J, order?: number, render?: number, arr?: boolean): JsonObject => ({ ...item(NUI_DRAW_LIST_ITEM_TYPE_CIRCLE, en, c, fill, t, order, render, arr), rect });
export const NuiDrawListArc = (en: J, c: J, fill: J, t: J, center: J, radius: J, amin: J, amax: J, order?: number, render?: number, arr?: boolean): JsonObject => ({ ...item(NUI_DRAW_LIST_ITEM_TYPE_ARC, en, c, fill, t, order, render, arr), c: center, radius, amin, amax });
export const NuiDrawListText = (en: J, c: J, rect: J, text: J, order?: number, render?: number, arr?: boolean, font: J = ""): JsonObject => ({ ...item(NUI_DRAW_LIST_ITEM_TYPE_TEXT, en, c, null, null, order, render, arr), rect, text, font });
export const NuiDrawListImage = (en: J, resref: J, rect: J, aspect: J, halign: J, valign: J, order?: number, render?: number, arr?: boolean): JsonObject => ({ ...item(NUI_DRAW_LIST_ITEM_TYPE_IMAGE, en, null, null, null, order, render, arr), image: resref, rect, image_aspect: aspect, image_halign: halign, image_valign: valign });
export const NuiDrawListImageRegion = (e: JsonObject, region: J): JsonObject => ({ ...e, image_region: region });
export const NuiDrawListLine = (en: J, c: J, t: J, a: J, b: J, order?: number, render?: number, arr?: boolean): JsonObject => ({ ...item(NUI_DRAW_LIST_ITEM_TYPE_LINE, en, c, null, t, order, render, arr), a, b });
export const NuiDrawListRect = (en: J, c: J, fill: J, t: J, rect: J, order?: number, render?: number, arr?: boolean): JsonObject => ({ ...item(NUI_DRAW_LIST_ITEM_TYPE_RECT, en, c, fill, t, order, render, arr), rect });
export const NuiDrawList = (e: JsonObject, scissor: J, list: J): JsonObject => ({ ...e, draw_list: list, draw_list_scissor: scissor });
