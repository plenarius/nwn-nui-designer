/**
 * What the editor knows about each element type: its palette entry (a default made with the nw_inc_nui builders),
 * which children it takes, and every property it supports, with the property's kind, whether nw_inc_nui lets it be
 * bound ("Bind:..." parameters), and how the client reads it.
 *
 * Sizes (width, height, aspect, margin, padding), a list's row height and the static int/bool parameters (a text's
 * border, a list's scrollbars, a text edit's max length) are plain floats or ints in nw_inc_nui.nss: the client never
 * resolves a bind there, so the editor offers them as static values only.
 */
import * as N from "../model/nui.js";
import type { JsonObject, JsonValue } from "../model/types.js";

export type PropKind =
  | "float"
  | "int"
  | "bool"
  | "string"
  | "text"
  | "resref"
  | "font"
  | "color"
  | "rect"
  | "vec"
  | "enum"
  | "id"
  | "strings"
  | "combo"
  | "floats"
  | "chart"
  | "title";

export interface EnumOption {
  value: number;
  label: string;
  /** The nw_inc_nui.nss constant (the NWScript export uses it). */
  constant: string;
}

export interface PropDef {
  key: string;
  label: string;
  kind: PropKind;
  /** nw_inc_nui takes a json here ("Bind:..."): the value can be a bind. */
  bindable: boolean;
  /** The key may be left out (the modifiers: NuiTooltip, NuiWidth, ...): the panel can clear it. */
  optional?: boolean;
  /** null is a meaningful value ("let the user collapse without a bind"). */
  nullable?: string;
  options?: EnumOption[];
  /** The value a new property gets when it is switched on. */
  initial?: JsonValue;
  group: "Element" | "Content" | "Layout" | "State" | "Style" | "Window";
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  /** The builder's parameter is a float (the .jui and NWScript exports write it as one). */
  float?: boolean;
}

const opts = (prefix: string, names: [number, string, string][]): EnumOption[] =>
  names.map(([value, label, c]) => ({ value, label, constant: `${prefix}${c}` }));

export const HALIGN = opts("NUI_HALIGN_", [
  [0, "Centre", "CENTER"],
  [1, "Left", "LEFT"],
  [2, "Right", "RIGHT"],
]);
export const VALIGN = opts("NUI_VALIGN_", [
  [0, "Middle", "MIDDLE"],
  [1, "Top", "TOP"],
  [2, "Bottom", "BOTTOM"],
]);
export const ASPECT = opts("NUI_ASPECT_", [
  [0, "Fit", "FIT"],
  [1, "Fill", "FILL"],
  [2, "Fit, at most 100%", "FIT100"],
  [3, "Exact", "EXACT"],
  [4, "Exact, scaled", "EXACTSCALED"],
  [5, "Stretch", "STRETCH"],
]);
export const SCROLLBARS = opts("NUI_SCROLLBARS_", [
  [0, "None", "NONE"],
  [1, "Horizontal", "X"],
  [2, "Vertical", "Y"],
  [3, "Both", "BOTH"],
  [4, "Auto", "AUTO"],
]);
export const DIRECTION = opts("NUI_DIRECTION_", [
  [0, "Horizontal", "HORIZONTAL"],
  [1, "Vertical", "VERTICAL"],
]);
export const CHART_TYPE = opts("NUI_CHART_TYPE_", [
  [0, "Lines", "LINES"],
  [1, "Columns", "COLUMN"],
]);
export const DRAW_TYPE = opts("NUI_DRAW_LIST_ITEM_TYPE_", [
  [0, "Polyline", "POLYLINE"],
  [1, "Curve", "CURVE"],
  [2, "Circle", "CIRCLE"],
  [3, "Arc", "ARC"],
  [4, "Text", "TEXT"],
  [5, "Image", "IMAGE"],
  [6, "Line", "LINE"],
  [7, "Rectangle", "RECT"],
]);
export const DRAW_ORDER = opts("NUI_DRAW_LIST_ITEM_ORDER_", [
  [-1, "Before the widget (under it)", "BEFORE"],
  [1, "After the widget (over it)", "AFTER"],
]);
export const DRAW_RENDER = opts("NUI_DRAW_LIST_ITEM_RENDER_", [
  [0, "Always", "ALWAYS"],
  [1, "When the mouse is off", "MOUSE_OFF"],
  [2, "When the mouse hovers", "MOUSE_HOVER"],
  [3, "While the left button is held", "MOUSE_LEFT"],
  [4, "While the right button is held", "MOUSE_RIGHT"],
  [5, "While the middle button is held", "MOUSE_MIDDLE"],
]);

// --- the properties every element has -------------------------------------------------------------------------

const ID: PropDef = { key: "id", label: "Id", kind: "id", bindable: false, optional: true, group: "Element", initial: "", help: "NuiId: the element sends events under this id. Letters, digits and _." };
const LAYOUT: PropDef[] = [
  { key: "width", label: "Width", kind: "float", bindable: false, optional: true, group: "Layout", initial: 100, min: 0, float: true, help: "NuiWidth: a required constraint, including nothing of the margin." },
  { key: "height", label: "Height", kind: "float", bindable: false, optional: true, group: "Layout", initial: 30, min: 0, float: true, help: "NuiHeight: a required constraint." },
  { key: "aspect", label: "Aspect (w / h)", kind: "float", bindable: false, optional: true, group: "Layout", initial: 1, min: 0, step: 0.1, float: true },
  { key: "margin", label: "Margin", kind: "float", bindable: false, optional: true, group: "Layout", initial: 2, min: 0, float: true, help: "Room around the element on every side; 2 when not set." },
  { key: "padding", label: "Padding", kind: "float", bindable: false, optional: true, group: "Layout", initial: 0, min: 0, float: true, help: "Room inside a row, column or group, round its children; 0 when not set." },
];
const STATE: PropDef[] = [
  { key: "enabled", label: "Enabled", kind: "bool", bindable: true, optional: true, group: "State", initial: true },
  { key: "visible", label: "Visible", kind: "bool", bindable: true, optional: true, group: "State", initial: true, help: "An invisible element still takes its room." },
  { key: "tooltip", label: "Tooltip", kind: "string", bindable: true, optional: true, group: "State", initial: "", help: "NuiTooltip: one line, shown on hover. Not on a combo: it closes the combo's open list (docs/CLIENT-BEHAVIOUR.md#combo-boxes); put it on the combo's label." },
  { key: "disabled_tooltip", label: "Disabled tooltip", kind: "string", bindable: true, optional: true, group: "State", initial: "", help: "NuiDisabledTooltip: shown instead of the tooltip while the element is disabled." },
  { key: "encouraged", label: "Encouraged", kind: "bool", bindable: true, optional: true, group: "State", initial: true, help: "The client's animated glow." },
];
const STYLE: PropDef[] = [
  { key: "foreground_color", label: "Foreground colour", kind: "color", bindable: true, optional: true, group: "Style", initial: N.NuiColor(255, 255, 255), help: "NuiStyleForegroundColor: text for labels, the bar for progress bars. One solid colour." },
  { key: "font", label: "Font", kind: "font", bindable: true, optional: true, group: "Style", initial: "", help: "NuiStyleFont: a [[fonts]] name of the loaded skin." },
];

const str = (key: string, label: string, group: PropDef["group"] = "Content", extra: Partial<PropDef> = {}): PropDef => ({ key, label, kind: "string", bindable: true, group, ...extra });

export interface ElementSpec {
  type: string;
  /** The palette's name. */
  title: string;
  /** The nw_inc_nui.nss builder. */
  builder: string;
  category: "Layout" | "Text" | "Buttons" | "Input" | "Display" | "Drawing";
  /** Children: rows, columns and groups take elements; a list takes its row template's cells. */
  container: "span" | "group" | "list" | null;
  props: PropDef[];
  make: () => JsonObject;
  /** Shown in the palette's tooltip. */
  blurb: string;
}

const common = (own: PropDef[]): PropDef[] => [ID, ...own, ...LAYOUT, ...STATE, ...STYLE];

const sized = (e: JsonObject, w: number | null, h: number | null): JsonObject => {
  let out = e;
  if (w !== null) out = N.NuiWidth(out, w);
  if (h !== null) out = N.NuiHeight(out, h);
  return out;
};

export const ELEMENTS: ElementSpec[] = [
  {
    type: "row",
    title: "Row",
    builder: "NuiRow",
    category: "Layout",
    container: "span",
    blurb: "Lays its children out side by side.",
    props: common([]),
    make: () => N.NuiRow([]),
  },
  {
    type: "col",
    title: "Column",
    builder: "NuiCol",
    category: "Layout",
    container: "span",
    blurb: "Lays its children out top to bottom.",
    props: common([]),
    make: () => N.NuiCol([]),
  },
  {
    type: "group",
    title: "Group",
    builder: "NuiGroup",
    category: "Layout",
    container: "group",
    blurb: "One child in a frame of its own, scrolled if it does not fit. Its layout can be swapped (NuiSetGroupLayout).",
    props: common([
      { key: "border", label: "Border", kind: "bool", bindable: false, group: "Content", initial: true },
      { key: "scrollbars", label: "Scrollbars", kind: "enum", bindable: false, group: "Content", options: SCROLLBARS, initial: 4 },
    ]),
    make: () => sized({ ...N.NuiGroup(N.NuiCol([])) }, null, 120),
  },
  {
    type: "list",
    title: "List",
    builder: "NuiList",
    category: "Layout",
    container: "list",
    blurb: "Rows made from a row template: each cell's binds are arrays, one value a row.",
    props: common([
      { key: "row_count", label: "Row count", kind: "int", bindable: true, group: "Content", initial: 5, min: 0 },
      { key: "row_height", label: "Row height", kind: "float", bindable: false, group: "Content", initial: 25, min: 1, float: true },
      { key: "border", label: "Border", kind: "bool", bindable: false, group: "Content", initial: true },
      { key: "scrollbars", label: "Scrollbars", kind: "enum", bindable: false, group: "Content", options: SCROLLBARS.filter((o) => o.value !== 4), initial: 2, help: "nw_inc_nui: a list's scrollbars cannot be AUTO." },
    ]),
    make: () => sized(N.NuiList([N.NuiListTemplateCell(N.NuiLabel(N.NuiBind("row_text"), N.NUI_HALIGN_LEFT, N.NUI_VALIGN_MIDDLE), 0, true)], N.NuiBind("row_count"), 25), null, 160),
  },
  {
    type: "spacer",
    title: "Spacer",
    builder: "NuiSpacer",
    category: "Layout",
    container: null,
    blurb: "Empty room that takes what is left (or its width and height). With an id and a draw list, a drawn widget.",
    props: common([]),
    make: () => N.NuiSpacer(),
  },
  {
    type: "label",
    title: "Label",
    builder: "NuiLabel",
    category: "Text",
    container: null,
    blurb: "One line of text, clipped at its edges.",
    props: common([
      str("value", "Text", "Content", { kind: "text" }),
      { key: "text_halign", label: "Horizontal alignment", kind: "enum", bindable: true, group: "Content", options: HALIGN, initial: 1 },
      { key: "text_valign", label: "Vertical alignment", kind: "enum", bindable: true, group: "Content", options: VALIGN, initial: 0 },
    ]),
    make: () => sized(N.NuiLabel("Label", N.NUI_HALIGN_LEFT, N.NUI_VALIGN_MIDDLE), null, 30),
  },
  {
    type: "text",
    title: "Text",
    builder: "NuiText",
    category: "Text",
    container: null,
    blurb: "Wrapped text that scrolls when it is too long.",
    props: common([
      str("value", "Text", "Content", { kind: "text" }),
      { key: "border", label: "Border", kind: "bool", bindable: false, group: "Content", initial: true },
      { key: "scrollbars", label: "Scrollbars", kind: "enum", bindable: false, group: "Content", options: SCROLLBARS, initial: 4 },
    ]),
    make: () => sized(N.NuiText("Some text that wraps onto as many lines as it needs."), null, 80),
  },
  {
    type: "button",
    title: "Button",
    builder: "NuiButton",
    category: "Buttons",
    container: null,
    blurb: "A button with a centred label (150 x 50 unless given a size).",
    props: common([str("label", "Label")]),
    make: () => sized(N.NuiButton("Button"), null, 35),
  },
  {
    type: "button_image",
    title: "Image button",
    builder: "NuiButtonImage",
    category: "Buttons",
    container: null,
    blurb: "A button showing an image (the skin's button frame under it).",
    props: common([{ key: "label", label: "Image", kind: "resref", bindable: true, group: "Content" }]),
    make: () => sized(N.NuiButtonImage("ir_attack"), 40, 40),
  },
  {
    type: "button_select",
    title: "Select button",
    builder: "NuiButtonSelect",
    category: "Buttons",
    container: null,
    blurb: "A button that stays down while its value is true.",
    props: common([str("label", "Label"), { key: "value", label: "Selected", kind: "bool", bindable: true, group: "Content" }]),
    make: () => sized(N.NuiButtonSelect("Select", false), null, 35),
  },
  {
    type: "check",
    title: "Checkbox",
    builder: "NuiCheck",
    category: "Input",
    container: null,
    blurb: "A box to tick, with a label.",
    props: common([str("label", "Label"), { key: "value", label: "Checked", kind: "bool", bindable: true, group: "Content" }]),
    make: () => sized(N.NuiCheck("Checkbox", false), null, 30),
  },
  {
    type: "tabbar",
    title: "Toggles",
    builder: "NuiToggles",
    category: "Input",
    container: null,
    blurb: "A row (or column) of buttons, one of them down: tabs.",
    props: common([
      { key: "direction", label: "Direction", kind: "enum", bindable: false, group: "Content", options: DIRECTION },
      { key: "elements", label: "Labels", kind: "strings", bindable: false, group: "Content" },
      { key: "value", label: "Selected index", kind: "int", bindable: true, group: "Content", min: 0 },
    ]),
    // 39: the entries are 35 high plus their margins (docs/CLIENT-BEHAVIOUR.md#default-sizes).
    make: () => sized(N.NuiToggles(N.NUI_DIRECTION_HORIZONTAL, ["First", "Second"], 0), null, 39),
  },
  {
    type: "options",
    title: "Options",
    builder: "NuiOptions",
    category: "Input",
    container: null,
    blurb: "Radio buttons: one of a few labels.",
    props: common([
      { key: "direction", label: "Direction", kind: "enum", bindable: false, group: "Content", options: DIRECTION },
      { key: "elements", label: "Labels", kind: "strings", bindable: false, group: "Content" },
      { key: "value", label: "Selected index", kind: "int", bindable: true, group: "Content", min: 0 },
    ]),
    make: () => sized(N.NuiOptions(N.NUI_DIRECTION_HORIZONTAL, ["One", "Two", "Three"], 0), null, 39),
  },
  {
    type: "combo",
    title: "Combo box",
    builder: "NuiCombo",
    category: "Input",
    container: null,
    blurb: "A drop-down list of entries (label, value).",
    props: common([
      { key: "elements", label: "Entries", kind: "combo", bindable: true, group: "Content" },
      { key: "value", label: "Selected", kind: "int", bindable: true, group: "Content", min: 0 },
    ]),
    make: () => sized(N.NuiCombo([N.NuiComboEntry("First", 0), N.NuiComboEntry("Second", 1)], 0), null, 35),
  },
  {
    type: "slider",
    title: "Slider (int)",
    builder: "NuiSlider",
    category: "Input",
    container: null,
    blurb: "A whole-number slider.",
    props: common([
      { key: "value", label: "Value", kind: "int", bindable: true, group: "Content" },
      { key: "min", label: "Minimum", kind: "int", bindable: true, group: "Content" },
      { key: "max", label: "Maximum", kind: "int", bindable: true, group: "Content" },
      { key: "step", label: "Step", kind: "int", bindable: true, group: "Content", min: 1 },
    ]),
    make: () => sized(N.NuiSlider(5, 0, 10, 1), null, 30),
  },
  {
    type: "sliderf",
    title: "Slider (float)",
    builder: "NuiSliderFloat",
    category: "Input",
    container: null,
    blurb: "A slider of fractional values.",
    props: common([
      { key: "value", label: "Value", kind: "float", bindable: true, group: "Content", float: true, step: 0.05 },
      { key: "min", label: "Minimum", kind: "float", bindable: true, group: "Content", float: true },
      { key: "max", label: "Maximum", kind: "float", bindable: true, group: "Content", float: true },
      { key: "step", label: "Step", kind: "float", bindable: true, group: "Content", float: true, step: 0.01 },
    ]),
    make: () => sized(N.NuiSliderFloat(0.5, 0, 1, 0.05), null, 30),
  },
  {
    type: "textedit",
    title: "Text field",
    builder: "NuiTextEdit",
    category: "Input",
    container: null,
    blurb: "Text the player types, on one line or several.",
    props: common([
      str("label", "Placeholder"),
      str("value", "Text"),
      { key: "max", label: "Max length", kind: "int", bindable: false, group: "Content", min: 1, max: 65535 },
      { key: "multiline", label: "Several lines", kind: "bool", bindable: false, group: "Content" },
      { key: "wordwrap", label: "Wrap words", kind: "bool", bindable: false, group: "Content" },
    ]),
    make: () => sized(N.NuiTextEdit("Type here", "", 64, false), null, 35),
  },
  {
    type: "color_picker",
    title: "Colour picker",
    builder: "NuiColorPicker",
    category: "Input",
    container: null,
    blurb: "Nuklear's colour picker.",
    props: common([{ key: "value", label: "Colour", kind: "color", bindable: true, group: "Content" }]),
    make: () => sized(N.NuiColorPicker(N.NuiColor(200, 160, 90)), 160, 160),
  },
  {
    type: "image",
    title: "Image",
    builder: "NuiImage",
    category: "Display",
    container: null,
    blurb: "A picture by resref (dds, jpg, tga, png, gif or webm).",
    props: common([
      { key: "value", label: "Image", kind: "resref", bindable: true, group: "Content" },
      { key: "image_aspect", label: "Aspect", kind: "enum", bindable: true, group: "Content", options: ASPECT },
      { key: "image_halign", label: "Horizontal alignment", kind: "enum", bindable: true, group: "Content", options: HALIGN },
      { key: "image_valign", label: "Vertical alignment", kind: "enum", bindable: true, group: "Content", options: VALIGN },
      { key: "image_region", label: "Region", kind: "rect", bindable: true, optional: true, group: "Content", initial: N.NuiRect(0, 0, 32, 32), float: true, help: "NuiImageRegion: draw only this part of the image (sprite sheets)." },
    ]),
    make: () => sized(N.NuiImage("is_fireball", N.NUI_ASPECT_FIT, N.NUI_HALIGN_CENTER, N.NUI_VALIGN_MIDDLE), 64, 64),
  },
  {
    type: "progress",
    title: "Progress bar",
    builder: "NuiProgress",
    category: "Display",
    container: null,
    blurb: "A bar from 0.0 to 1.0.",
    props: common([{ key: "value", label: "Value (0 to 1)", kind: "float", bindable: true, group: "Content", float: true, min: 0, max: 1, step: 0.05 }]),
    make: () => sized(N.NuiProgress(0.5), null, 20),
  },
  {
    type: "chart",
    title: "Chart",
    builder: "NuiChart",
    category: "Display",
    container: null,
    blurb: "Lines or columns from arrays of numbers.",
    props: common([{ key: "value", label: "Series", kind: "chart", bindable: false, group: "Content" }]),
    make: () => sized(N.NuiChart([N.NuiChartSlot(N.NUI_CHART_TYPE_LINES, "Series", N.NuiColor(222, 184, 80), [1, 3, 2, 4])]), null, 120),
  },
  {
    type: "drawing",
    title: "Drawing",
    builder: "NuiDrawList",
    category: "Drawing",
    container: null,
    blurb: "A spacer with a draw list: shapes, text and images painted on it.",
    props: [],
    make: () =>
      sized(
        N.NuiDrawList(N.NuiSpacer(), true, [
          N.NuiDrawListRect(true, N.NuiColor(55, 50, 44), true, 1, N.NuiRect(0, 0, 120, 40)),
          N.NuiDrawListText(true, N.NuiColor(222, 184, 80), N.NuiRect(8, 10, 110, 20), "Drawn text"),
        ]),
        120,
        40,
      ),
  },
];

/** The palette entry "drawing" is a spacer; its properties are a spacer's. */
const BY_TYPE = new Map(ELEMENTS.map((e) => [e.type, e]));
BY_TYPE.get("drawing")!.props = BY_TYPE.get("spacer")!.props;

/** "toggles" is what nui-preview (wrongly) called a tabbar; treat it as one. */
export function specOf(type: string): ElementSpec | null {
  if (type === "toggles") return BY_TYPE.get("tabbar") ?? null;
  return BY_TYPE.get(type) ?? null;
}

/** The palette (the "drawing" entry makes a spacer, so it is not a type of its own in the tree). */
export const PALETTE = ELEMENTS;

export const WINDOW_PROPS: PropDef[] = [
  { key: "title", label: "Title", kind: "title", bindable: true, group: "Window", help: "false or empty, with closing and collapsing off, hides the title bar." },
  { key: "geometry", label: "Geometry", kind: "rect", bindable: true, group: "Window", float: true, help: "x and y of -1 centre the window; -2 puts its corner at the mouse, -3 centres it on the mouse (the designer takes the canvas centre as the mouse)." },
  { key: "resizable", label: "Resizable", kind: "bool", bindable: true, nullable: "user can resize", group: "Window" },
  { key: "collapsed", label: "Collapsed", kind: "bool", bindable: true, nullable: "user can collapse", group: "Window", help: "true opens it collapsed; null shows the collapse button; false or no key hides it. A bind shows the button." },
  { key: "closable", label: "Closable", kind: "bool", bindable: true, group: "Window", help: "Only false hides the close button." },
  { key: "transparent", label: "Transparent", kind: "bool", bindable: true, group: "Window", help: "No background: paint the window's art with draw lists." },
  { key: "border", label: "Border", kind: "bool", bindable: true, group: "Window", help: "true or no key draws it; false or null does not (nor a bind, until it is set)." },
  { key: "accepts_input", label: "Accepts input", kind: "bool", bindable: true, group: "Window", help: "false makes a click-through overlay." },
  { key: "size_constraint", label: "Size constraint", kind: "rect", bindable: true, nullable: "none", group: "Window", float: true, help: "Minimum (x, y) and maximum (w, h) size." },
  { key: "edge_constraint", label: "Edge constraint", kind: "rect", bindable: true, nullable: "none", group: "Window", float: true, help: "Keeps the window this far from the screen's edges." },
  { key: "font", label: "Font", kind: "font", bindable: true, group: "Window", help: "The window's font, its title's too." },
];

// --- draw lists -----------------------------------------------------------------------------------------------

/** The properties of a draw-list item of each type (besides type, order, render and arrayBinds). */
export const DRAW_ITEM_PROPS: Record<number, PropDef[]> = (() => {
  const en: PropDef = { key: "enabled", label: "Enabled", kind: "bool", bindable: true, group: "Content" };
  const col: PropDef = { key: "color", label: "Colour", kind: "color", bindable: true, group: "Content" };
  const fill: PropDef = { key: "fill", label: "Filled", kind: "bool", bindable: true, group: "Content" };
  const thick: PropDef = { key: "line_thickness", label: "Line thickness", kind: "float", bindable: true, group: "Content", float: true, min: 0 };
  const rect: PropDef = { key: "rect", label: "Rect", kind: "rect", bindable: true, group: "Content", float: true };
  const vec = (key: string, label: string): PropDef => ({ key, label, kind: "vec", bindable: true, group: "Content", float: true });
  return {
    0: [en, col, fill, thick, { key: "points", label: "Points (x, y pairs)", kind: "floats", bindable: true, group: "Content", float: true }],
    1: [en, col, thick, vec("a", "Start"), vec("b", "End"), vec("ctrl0", "Control 1"), vec("ctrl1", "Control 2")],
    2: [en, col, fill, thick, rect],
    3: [
      en,
      col,
      fill,
      thick,
      vec("c", "Centre"),
      { key: "radius", label: "Radius", kind: "float", bindable: true, group: "Content", float: true },
      { key: "amin", label: "Start angle (radians)", kind: "float", bindable: true, group: "Content", float: true, step: 0.1 },
      { key: "amax", label: "End angle (radians)", kind: "float", bindable: true, group: "Content", float: true, step: 0.1 },
    ],
    4: [en, col, rect, { key: "text", label: "Text", kind: "string", bindable: true, group: "Content" }, { key: "font", label: "Font", kind: "font", bindable: true, group: "Content" }],
    5: [
      en,
      { key: "image", label: "Image", kind: "resref", bindable: true, group: "Content" },
      rect,
      { key: "image_aspect", label: "Aspect", kind: "enum", bindable: true, group: "Content", options: ASPECT },
      { key: "image_halign", label: "Horizontal alignment", kind: "enum", bindable: true, group: "Content", options: HALIGN },
      { key: "image_valign", label: "Vertical alignment", kind: "enum", bindable: true, group: "Content", options: VALIGN },
      { key: "image_region", label: "Region", kind: "rect", bindable: true, optional: true, group: "Content", float: true, initial: N.NuiRect(0, 0, 32, 32) },
    ],
    6: [en, col, thick, vec("a", "From"), vec("b", "To")],
    7: [en, col, fill, thick, rect],
  };
})();

export const DRAW_ITEM_COMMON: PropDef[] = [
  { key: "order", label: "Order", kind: "enum", bindable: false, group: "Content", options: DRAW_ORDER },
  { key: "render", label: "Render", kind: "enum", bindable: false, group: "Content", options: DRAW_RENDER, help: "The editor draws the items that show at rest (always, mouse off)." },
  { key: "arrayBinds", label: "Array binds", kind: "bool", bindable: false, group: "Content", help: "One copy of the item for each entry of its array binds." },
];

/** A new draw-list item of type t with the builder's defaults. */
export function newDrawItem(t: number): JsonObject {
  const white = N.NuiColor(255, 255, 255);
  switch (t) {
    case 0:
      return N.NuiDrawListPolyLine(true, white, false, 1, [0, 0, 40, 20, 80, 0]);
    case 1:
      return N.NuiDrawListCurve(true, white, 1, N.NuiVec(0, 20), N.NuiVec(80, 20), N.NuiVec(20, 0), N.NuiVec(60, 40));
    case 2:
      return N.NuiDrawListCircle(true, white, false, 1, N.NuiRect(0, 0, 32, 32));
    case 3:
      return N.NuiDrawListArc(true, white, false, 1, N.NuiVec(20, 20), 16, 0, 3.14159);
    case 4:
      return N.NuiDrawListText(true, white, N.NuiRect(0, 0, 100, 20), "Text");
    case 5:
      return N.NuiDrawListImage(true, "is_fireball", N.NuiRect(0, 0, 32, 32), N.NUI_ASPECT_FIT, N.NUI_HALIGN_CENTER, N.NUI_VALIGN_MIDDLE);
    case 6:
      return N.NuiDrawListLine(true, white, 1, N.NuiVec(0, 0), N.NuiVec(80, 0));
    default:
      return N.NuiDrawListRect(true, white, false, 1, N.NuiRect(0, 0, 40, 20));
  }
}

/** The props of a draw list itself (on any element). */
export const DRAW_LIST_SCISSOR: PropDef = { key: "draw_list_scissor", label: "Clip to the element", kind: "bool", bindable: true, group: "Content", help: "NuiDrawList's jScissor." };

/** Every key the client reads on an element of this type (for the "the client ignores this" check). */
export function knownKeys(type: string): Set<string> {
  const s = new Set(["type", "label", "value", "draw_list", "draw_list_scissor"]);
  const spec = specOf(type);
  for (const p of spec?.props ?? []) s.add(p.key);
  if (type === "row" || type === "col" || type === "group") s.add("children");
  if (type === "list") s.add("row_template");
  return s;
}

/** A new window: an empty column in a 480 x 360 window, centred, not resizable. */
export function newWindow(title = "New window"): JsonObject {
  return N.NuiWindow(N.NuiCol([]), title, N.NuiRect(-1, -1, 480, 360), false, null, true, false, true, true, null, null, "");
}
