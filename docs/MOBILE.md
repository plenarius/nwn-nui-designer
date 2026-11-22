# Mobile clients

The iOS and Android clients build NUI windows differently from the desktop client. The rules, the measurements
and the probes that show them are in the **[nwn-nui-spec](https://github.com/plenarius/nwn-nui-spec)**:
[spec/mobile.md](https://github.com/plenarius/nwn-nui-spec/blob/main/spec/mobile.md) (rules NUI-MOBILE-001 to
-060), [engine/mobile.md](https://github.com/plenarius/nwn-nui-spec/blob/main/engine/mobile.md) (the findings) and
[tables/mobile.yaml](https://github.com/plenarius/nwn-nui-spec/blob/main/tables/mobile.yaml) (the numbers). This
page is a short summary, and says what the designer does about each rule.

**The numbers come from one iPhone (screen density 3, at GUI scales 1.0 and 1.6) and one Android tablet**, on
build 89.8193.37-17. Other devices and builds may differ. Density 2 (smaller or older iPhones and iPads) was not
measured: the designer scales its numbers from the density-3 ones (below).

## What breaks

- **iOS multiplies some quantities by f = d / s**, the screen's density over the GUI scale (3 on an iPhone at
  scale 1.0; NUI-MOBILE-020): every element's **margin**, the default 2 included; a list's **row height** and the
  space between rows; a row template's **cell widths**; every **draw-list coordinate** and size; and the **window's
  position**. Sizes, fonts and glyphs are not multiplied.
- So a row or column with a fixed size that fits the desktop's margins is **refused** on iOS ("Error constructing
  window from json: The constraint can not be satisfied", NUI-MOBILE-021). Without fixed sizes the window is built
  but overflows and scrolls.
- **A window at -1 (centred)** lands in the bottom-right corner on iOS, mostly off-screen (NUI-MOBILE-027).
- **A list cell is never narrower than about 11 px** on iOS, so thin spacer cells push the others (NUI-MOBILE-024).
- **The frame and a bordered list's inset are bigger** on iOS, fixed in screen pixels (NUI-MOBILE-030, -033).
- **Base-game images that exist only as TGA draw black** in NUI on iOS and Android (portraits, spell and feat
  icons, many item icons); a hak copy draws (NUI-MOBILE-050, -051).
- **Android lays windows out as the desktop does**, and reports a GUI scale of 0, which means 1.0 (NUI-MOBILE-040).
- **A script cannot ask** which client it talks to: an iPhone reports the platform of an Apple-silicon Mac, and no
  device property tells (NUI-MOBILE-001, -002). It can measure: the density probe (NUI-MOBILE-010).

## What the designer does

### Checks

The **Mobile checks** button in the toolbar turns them on (they are always on while the Client is not Desktop);
`pnpm check --mobile` runs them on the command line. Each rule can be turned off in that dialog, or with
`pnpm check --disable-rule ID`. They are listed as source `mobile` (`src/core/mobile/lint.ts`):

| Rule | Severity | Spec |
|---|---|---|
| `mobile-margin`: an element placed with a margin above 0, the default included | warning | NUI-MOBILE-021, -060 |
| `mobile-centred`: geometry x or y of -1, -2 or -3 | warning | NUI-MOBILE-027 |
| `mobile-thin-cell`: a fixed list template cell narrower than 4 | warning | NUI-MOBILE-024 |
| `mobile-scaling`: the window has lists or draw lists, which need per-player scaling for iOS (once per window) | info | NUI-MOBILE-022, -023, -025, -060 |
| `mobile-tga`: an image whose resref the client finds as a base-game TGA only (needs the game) | warning | NUI-MOBILE-050, -051 |

### Preview

The toolbar's **Client** picks Desktop, iOS (density 2), iOS (density 3) or Android, with the **UI scale** as the
GUI scale. On iOS the canvas lays the window out as the client does (`src/core/mobile/`): margins, row heights, row
spacing, cell widths (at least 11 px) and draw coordinates multiplied by f, the window placed in points (a -1
window in the bottom-right corner), the frame's extra (32 / s² wide and 66 / s² high at density 3) taken from the
content, and the list inset at 14 px. A window the client would refuse shows its refusal in the problems list.
Desktop and Android draw exactly as before. `pnpm check --client ios3 [--ui-scale S]` checks the same way.

At density 2 the multipliers follow f = d / s; the pixel-fixed extras (frame, list inset) are the density-3 ones
scaled by (d - 1) / 2, which is an assumption, not a measurement.

### Export

- **Portable margins** (the export dialog, .jui and NWScript tabs; saved with the project): writes margin 0 on every
  element and makes the gaps with spacers instead (NUI-MOBILE-060, item 1), so the window is laid out the same on
  every client. Fixed sizes land exactly where they were; list cells lose their margin and their content fills the
  cell (thin spacer cells would break on iOS, NUI-MOBILE-024). It adds spacers and wrapping rows and columns, so the
  window's JSON gets longer.
- **Scale for touch clients** (NWScript tab, with the skeleton): the generated `_Open` builds the window through
  [`nss/nui_touch.nss`](../nss/nui_touch.nss), which the dialog lets you download.

### `nui_touch.nss`

An MIT-licensed include for a module, independent of the designer (it needs only `nw_inc_nui`):

- `NuiTouch_StartProbe(oPC)` at login, and `NuiTouch_HandleEvent()` first in the NUI event script: the density
  probe of NUI-MOBILE-010 (a watched geometry window at 20000, 20000; d from the clamped report; a touch client when
  |d - s| > 0.25; a GUI scale of 0 counts as 1).
- `NuiTouch_Window(oPC, jWindow)`: the window for that player. On a touch client, list row heights, template cell
  widths and draw-list coordinates are divided by f, thin fixed spacer cells are dropped, and a static geometry goes
  through `NuiTouch_Rect`. On a desktop or Android client, or before the probe answers, the window is unchanged.
- `NuiTouch_Rect(oPC, x, y, w, h)`: the position divided by f, -1 / -2 / -3 put at the top left, and the size
  grown by the frame's extra and 6 units of slack (NUI-MOBILE-030).
- `NuiTouch_Factor(oPC)` and `NuiTouch_DivGeom(jValue, f)`: for values the script binds to draw coordinates.

It does not change margins: give the window margin 0 (the portable-margins export does).

## Not done

What is left approximate or open is in [GAPS.md](GAPS.md#mobile-clients).
