/**
 * Writes the synthetic fixtures (fixtures/*.jui, fixtures/*.json): windows that between them use every element type,
 * every draw-list item, bound and static values, and every problem the checks report. Run `pnpm fixtures` after
 * changing this file; the golden check draws them with nui-preview and with this project.
 *
 * Images are base-game resrefs (the files are the game's, not in this repo).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as N from "../src/core/model/nui.js";
import type { JsonObject } from "../src/core/model/types.js";

const dir = import.meta.dirname;
const W = (w: number, h: number) => ({ x: -1, y: -1, w, h });
const H = (e: JsonObject, h: number) => N.NuiHeight(e, h);
const WH = (e: JsonObject, w: number, h: number) => N.NuiHeight(N.NuiWidth(e, w), h);
const gold = N.NuiColor(214, 198, 160);

function save(name: string, v: unknown) {
  writeFileSync(join(dir, name), JSON.stringify(v, null, 1) + "\n");
  console.log(name);
}

// 1. Every widget, at rest.
save(
  "widgets.jui",
  N.NuiWindow(
    N.NuiCol([
      H(N.NuiRow([WH(N.NuiLabel("Label, left", 1, 0), 160, 32), WH(N.NuiLabel("centred", 0, 0), 120, 32), WH(N.NuiLabel("right", 2, 0), 120, 32), WH(N.NuiStyleForegroundColor(N.NuiLabel("Gold, top", 1, 1), gold), 140, 32), WH(N.NuiLabel(N.NuiBind("unbound_label"), 1, 2), 160, 32)]), 36),
      H(N.NuiRow([WH(N.NuiButton("Button"), 120, 32), WH(N.NuiEncouraged(N.NuiButton("Encouraged"), true), 140, 32), WH(N.NuiEnabled(N.NuiButton("Disabled"), false), 120, 32), WH(N.NuiButtonSelect("Select off", false), 130, 32), WH(N.NuiButtonSelect("Select on", true), 130, 32), WH(N.NuiButtonImage("ir_attack"), 40, 40)]), 44),
      H(N.NuiRow([WH(N.NuiCheck("Check off", false), 140, 30), WH(N.NuiCheck("Check on", true), 140, 30), WH(N.NuiOptions(N.NUI_DIRECTION_HORIZONTAL, ["One", "Two", "Three"], 1), 462, 36), WH(N.NuiCombo([N.NuiComboEntry("First", 0), N.NuiComboEntry("Second", 1)], 1), 160, 32)]), 36),
      H(N.NuiRow([WH(N.NuiSliderFloat(0.25, 0, 1, 0.05), 180, 30), WH(N.NuiSlider(7, 0, 10, 1), 180, 30), WH(N.NuiProgress(0.6), 200, 26), WH(N.NuiColorPicker(N.NuiColor(80, 140, 200)), 60, 30), WH(N.NuiToggles(N.NUI_DIRECTION_HORIZONTAL, ["Tab A", "Tab B"], 0), 308, 36)]), 36),
      H(N.NuiRow([WH(N.NuiTextEdit("Placeholder", "", 40, false), 200, 32), WH(N.NuiTextEdit("Placeholder", "Typed text", 40, false), 200, 32), WH(N.NuiTextEdit("", "A multi-line text edit wraps its words and keeps going on the next line.", 200, true), 260, 70)]), 74),
      H(N.NuiRow([
        WH(N.NuiImage("is_fireball", N.NUI_ASPECT_FIT, 0, 0), 48, 48),
        WH(N.NuiImage("po_hu_m_01_m", N.NUI_ASPECT_FILL, 0, 0), 48, 48),
        WH(N.NuiImage("is_fireball", N.NUI_ASPECT_FIT100, 1, 1), 48, 48),
        WH(N.NuiImage("is_fireball", N.NUI_ASPECT_EXACT, 2, 2), 48, 48),
        WH(N.NuiImage("is_fireball", N.NUI_ASPECT_STRETCH, 0, 0), 80, 48),
        WH(N.NuiImageRegion(N.NuiImage("is_fireball", N.NUI_ASPECT_FIT, 0, 0), N.NuiRect(0, 0, 16, 16)), 48, 48),
        WH(N.NuiImage("iit_midmisc_090", N.NUI_ASPECT_FIT, 0, 0), 48, 48),
        WH(N.NuiChart([N.NuiChartSlot(N.NUI_CHART_TYPE_LINES, "a", N.NuiColor(255, 0, 0), [1, 3, 2])]), 160, 48),
        N.NuiSpacer(),
      ]), 52),
      H(N.NuiRow([
        WH(N.NuiText("A text box with a border wraps its words like Nuklear does, and shows a scrollbar when it needs one, which this one does not."), 300, 90),
        WH(N.NuiText("No border, no scrollbar.", false, N.NUI_SCROLLBARS_NONE), 200, 90),
        WH(N.NuiStyleFont(N.NuiText("Monospace (the skin's second font).", true, N.NUI_SCROLLBARS_NONE), "(monospace)"), 220, 90),
        WH(N.NuiLabel(N.NuiStrRef(1), 1, 0), 120, 32),
      ]), 94),
      H(N.NuiRow([
        WH(N.NuiList([N.NuiListTemplateCell(N.NuiImage("ir_cntrspell", 0, 0, 0), 24, false), N.NuiListTemplateCell(N.NuiLabel("Row label", 1, 0), 0, true), N.NuiListTemplateCell(N.NuiButton("Go"), 50, false)], 6, 26), 420, 150),
        WH(N.NuiGroup(N.NuiCol([H(N.NuiLabel("In a group", 1, 0), 26), H(N.NuiButton("Inside"), 30), H(N.NuiLabel("more", 1, 0), 26), H(N.NuiLabel("and more", 1, 0), 26), H(N.NuiLabel("scrolls", 1, 0), 26)])), 220, 150),
        WH(N.NuiGroup(N.NuiCol([H(N.NuiLabel("No border", 1, 0), 26)]), false, N.NUI_SCROLLBARS_NONE), 160, 150),
        WH(N.NuiVisible(N.NuiButton("Invisible"), false), 80, 32),
      ]), 154),
    ]),
    "Every widget",
    W(1100, 760),
  ),
);

// 2. Layout: spacers, margins, padding, aspect, nested rows and columns, unsized buttons.
save(
  "layout.jui",
  N.NuiWindow(
    N.NuiCol([
      H(N.NuiRow([N.NuiSpacer(), WH(N.NuiButton("Centred"), 120, 30), N.NuiSpacer()]), 34),
      H(N.NuiRow([N.NuiSpacer(), WH(N.NuiButton("Two"), 80, 30), N.NuiSpacer(), WH(N.NuiButton("spacers"), 100, 30), N.NuiSpacer()]), 34),
      H(N.NuiRow([N.NuiHeight(N.NuiButton("Unsized: 150 wide"), 30), N.NuiHeight(N.NuiButtonSelect("Also 150", true), 30)]), 34),
      H(N.NuiRow([WH(N.NuiMargin(N.NuiButton("Margin 0"), 0), 100, 30), WH(N.NuiMargin(N.NuiButton("Margin 8"), 8), 100, 30), N.NuiHeight(N.NuiAspect(N.NuiButton("Aspect 2"), 2), 30)]), 50),
      H(N.NuiPadding(N.NuiRow([WH(N.NuiButton("Padded row"), 120, 30)]), 6), 46),
      H(N.NuiRow([
        N.NuiWidth(N.NuiCol([H(N.NuiLabel("Column A", 1, 0), 24), H(N.NuiButton("a1"), 28), H(N.NuiButton("a2"), 28)]), 160),
        N.NuiWidth(N.NuiCol([H(N.NuiLabel("Column B", 1, 0), 24), N.NuiSpacer(), H(N.NuiButton("bottom"), 28)]), 160),
        N.NuiCol([H(N.NuiLabel("Column C takes the rest", 1, 0), 24), H(N.NuiRow([N.NuiSpacer(), WH(N.NuiButton("right"), 90, 28)]), 32)]),
      ]), 120),
      N.NuiSpacer(),
      H(N.NuiRow([N.NuiSpacer(), WH(N.NuiButton("OK"), 100, 32), WH(N.NuiButton("Cancel"), 100, 32)]), 36),
    ]),
    "Layout",
    W(640, 480),
  ),
);

// 3. Draw lists: every item type nui-preview draws, scissor on and off, render conditions.
const red = N.NuiColor(220, 60, 60);
const green = N.NuiColor(60, 200, 90);
const blue = N.NuiColor(80, 120, 230, 200);
save(
  "drawlist.jui",
  N.NuiWindow(
    N.NuiCol([
      H(N.NuiRow([
        WH(N.NuiDrawList(N.NuiSpacer(), true, [
          N.NuiDrawListRect(true, N.NuiColor(40, 40, 60), true, 1, N.NuiRect(0, 0, 200, 120)),
          N.NuiDrawListRect(true, gold, false, 2, N.NuiRect(10, 10, 180, 100)),
          N.NuiDrawListLine(true, red, 1, N.NuiVec(10, 60), N.NuiVec(190, 60)),
          N.NuiDrawListLine(true, green, 1, N.NuiVec(10, 10), N.NuiVec(190, 110)),
          N.NuiDrawListPolyLine(true, blue, false, 1, [20, 100, 60, 30, 100, 90, 140, 20, 180, 100]),
          N.NuiDrawListText(true, N.NuiColor(255, 255, 255), N.NuiRect(14, 14, 170, 20), "Draw-list text"),
        ]), 200, 120),
        WH(N.NuiDrawList(N.NuiSpacer(), false, [
          N.NuiDrawListCircle(true, red, true, 1, N.NuiRect(10, 10, 60, 60)),
          N.NuiDrawListCircle(true, gold, false, 2, N.NuiRect(80, 10, 60, 60)),
          N.NuiDrawListPolyLine(true, green, true, 1, [10, 110, 60, 80, 110, 110]),
          N.NuiDrawListImage(true, "is_fireball", N.NuiRect(140, 70, 40, 40), N.NUI_ASPECT_FIT, 0, 0),
          N.NuiDrawListImageRegion(N.NuiDrawListImage(true, "is_fireball", N.NuiRect(150, 10, 40, 40), N.NUI_ASPECT_STRETCH, 0, 0), N.NuiRect(8, 8, 16, 16)),
        ]), 200, 120),
        WH(N.NuiDrawList(N.NuiButton("Hover-only red"), true, [
          N.NuiDrawListRect(true, N.NuiColor(255, 255, 255, 90), true, 1, N.NuiRect(0, 0, 40, 40)),
          N.NuiDrawListRect(true, red, true, 1, N.NuiRect(120, 0, 40, 40), N.NUI_DRAW_LIST_ITEM_ORDER_AFTER, N.NUI_DRAW_LIST_ITEM_RENDER_MOUSE_HOVER),
        ]), 160, 40),
      ]), 124),
    ]),
    "Draw lists",
    W(640, 200),
  ),
);

// 3b. What nui-preview does not draw and this project does in client mode: ORDER_BEFORE, curves, arcs, array binds,
// toggles. (The golden check reports that nui-preview cannot draw it; compare drawlist-client.client.png by eye.)
save("drawlist-client.json", {
  name: "drawlist-client",
  form: "drawlist-client",
  window: N.NuiWindow(
    N.NuiCol([
      H(N.NuiRow([
        WH(N.NuiDrawList(N.NuiSpacer(), true, [
          N.NuiDrawListCurve(true, gold, 2, N.NuiVec(10, 80), N.NuiVec(190, 80), N.NuiVec(60, 0), N.NuiVec(140, 120)),
          N.NuiDrawListArc(true, green, false, 2, N.NuiVec(100, 60), 40, 0, 3.14),
          N.NuiDrawListArc(true, blue, true, 1, N.NuiVec(40, 40), 25, 0, 1.6),
        ]), 200, 120),
        WH(N.NuiDrawList(N.NuiSpacer(), true, [
          N.NuiDrawListRect(true, N.NuiBind("bar_color"), true, 1, N.NuiBind("bar_rect"), N.NUI_DRAW_LIST_ITEM_ORDER_AFTER, 0, true),
          N.NuiDrawListText(true, N.NuiColor(255, 255, 255), N.NuiRect(4, 96, 200, 20), N.NuiBind("bar_text")),
        ]), 200, 120),
        WH(N.NuiDrawList(N.NuiButton("Under and over"), true, [
          N.NuiDrawListRect(true, N.NuiColor(200, 80, 40), true, 1, N.NuiRect(-4, -4, 168, 48), N.NUI_DRAW_LIST_ITEM_ORDER_BEFORE),
          N.NuiDrawListRect(true, N.NuiColor(255, 255, 255, 90), true, 1, N.NuiRect(0, 0, 40, 40)),
        ]), 160, 40),
      ]), 124),
    ]),
    "Draw lists (client only)",
    W(640, 200),
  ),
  binds: {
    bar_color: [N.NuiColor(200, 60, 60), N.NuiColor(60, 200, 60), N.NuiColor(60, 60, 200)],
    bar_rect: [N.NuiRect(10, 10, 40, 80), N.NuiRect(60, 30, 40, 60), N.NuiRect(110, 50, 40, 40)],
    bar_text: "Array-bound bars",
  },
  panes: {},
});

// 3c. A size the client refuses ("The constraint can not be satisfied"): reported, not drawn (nui-preview throws).
save(
  "unsolvable.jui",
  N.NuiWindow(N.NuiCol([H(N.NuiRow([WH(N.NuiButton("Taller than its row"), 160, 40)]), 34)]), "Unsolvable", W(400, 160)),
);

// 4. Problems: one of each kind the checks report.
save(
  "problems.jui",
  N.NuiWindow(
    N.NuiCol([
      H(N.NuiRow([WH(N.NuiButton("A label much too long for its button"), 120, 32), WH(N.NuiLabel("Café × 3 — not ASCII", 1, 0), 260, 32), WH(N.NuiImage("no_such_image", 0, 0, 0), 32, 32)]), 36),
      H(N.NuiRow([WH(N.NuiText("This text has far more words than its small box can show, so the last lines are cut off by the bottom of the box.", true, N.NUI_SCROLLBARS_NONE), 220, 60), WH(N.NuiText(""), 200, 60)]), 64),
      WH(N.NuiRow([WH(N.NuiButton("Wide"), 300, 30), WH(N.NuiButton("Too"), 300, 30)]), 520, 34),
      H(N.NuiRow([WH(N.NuiGroup(N.NuiCol([H(N.NuiLabel("one", 1, 0), 30), H(N.NuiLabel("two", 1, 0), 30), H(N.NuiLabel("three", 1, 0), 30)]), true, N.NUI_SCROLLBARS_NONE), 200, 70), WH(N.NuiList([N.NuiListTemplateCell(N.NuiLabel("a row label that is wider than its cell", 1, 0), 0, true)], 5, 24, true, N.NUI_SCROLLBARS_NONE), 220, 70)]), 74),
    ]),
    "Problems",
    W(560, 360),
  ),
);

// 4b. Layonara's options window (nwn-module core/nss/theme/nui_f_options.nss, built as its nui_i_kit calls build it):
// a 392 x 72 body whose horizontal options are given 284 x 32. The client's options entries are 150 wide each
// (SelectList::MakeButtons), so the two reach 412: in game the window showed both scrollbars.
{
  const fit = (e: JsonObject, w: number, h: number) => WH(e, w - 4, h - 4);
  const span = (e: JsonObject, w: number, h: number) => N.NuiMargin(WH(e, w, h), 0);
  const tip = "How the classic NWN windows look";
  const themes = N.NuiTooltip(N.NuiId(N.NuiOptions(N.NUI_DIRECTION_HORIZONTAL, ["Ink and brass", "Classic"], N.NuiBind("op_theme")), "op_theme"), tip);
  save(
    "options-window.jui",
    N.NuiWindow(
      span(
        N.NuiCol([
          span(N.NuiRow([N.NuiTooltip(fit(N.NuiLabel("Theme", 1, 0), 104, 36), tip), fit(themes, 288, 36)]), 392, 36),
          span(N.NuiRow([N.NuiMargin(WH(N.NuiSpacer(), 272, 36), 0), fit(N.NuiId(N.NuiButton("Close"), "op_close"), 120, 36)]), 392, 36),
        ]),
        392,
        72,
      ),
      "Options",
      W(392 + 16, 72 + 49),
    ),
  );
}

// 5. Binds and panes, in the dump format: list rows from arrays, a swapped pane, bound geometry and title.
save("binds.json", {
  name: "binds",
  form: "binds",
  window: N.NuiWindow(
    N.NuiCol([
      H(N.NuiRow([WH(N.NuiLabel(N.NuiBind("title_text"), 1, 0), 300, 30), WH(N.NuiProgress(N.NuiBind("progress")), 200, 24)]), 34),
      H(N.NuiRow([
        WH(N.NuiList([N.NuiListTemplateCell(N.NuiImage(N.NuiBind("icons"), 0, 0, 0), 26, false), N.NuiListTemplateCell(N.NuiStyleForegroundColor(N.NuiLabel(N.NuiBind("names"), 1, 0), N.NuiBind("colours")), 0, true), N.NuiListTemplateCell(N.NuiCheck("", N.NuiBind("ticks")), 30, false)], N.NuiBind("rows"), 28), 320, 200),
        WH(N.NuiId(N.NuiGroup(N.NuiLabel("not swapped in", 1, 0)), "pane"), 240, 200),
      ]), 204),
      H(N.NuiRow([N.NuiSpacer(), WH(N.NuiEnabled(N.NuiButton(N.NuiBind("ok_label")), N.NuiBind("ok_on")), 120, 32)]), 36),
    ]),
    N.NuiBind("title"),
    N.NuiBind("geometry"),
  ),
  binds: {
    title: "Bound title",
    geometry: { x: -1, y: -1, w: 620, h: 360 },
    title_text: "Values from binds",
    progress: 0.35,
    rows: 4,
    icons: ["is_fireball", "ir_attack", "ir_cntrspell", "no_icon_here"],
    names: ["Fireball", "Attack", "Counterspell", "A missing icon"],
    colours: [N.NuiColor(255, 200, 120), N.NuiColor(255, 255, 255), N.NuiColor(160, 200, 255), N.NuiColor(255, 120, 120)],
    ticks: [true, false, true, false],
    ok_label: "Disabled OK",
    ok_on: false,
  },
  panes: {
    pane: N.NuiCol([H(N.NuiLabel("The swapped-in pane", 1, 0), 28), H(N.NuiText("Panes swapped with NuiSetGroupLayout are drawn in place of the group's own child.", false, 0), 90)]),
  },
});
