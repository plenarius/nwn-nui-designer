# How the client draws NUI

What the NWN:EE client does with a NUI window and its skin, as far as this project knows it. The designer's code cites
the sections below. Everything here is about client build **8193.37-17** (`nwmain-linux`). Other builds may differ.

Each fact carries a marker saying how it was checked:

- **[code]**: read in the client binary (decompile or disassembly). Function names are the client's symbols.
- **[data]**: seen in the game's own files.
- **[docs]**: Beamdog's patch notes, the comments in `nw_inc_nui.nss` / `nwscript.nss`, or community pages. Where they
  disagree with the code, the code wins and the conflict is noted.
- **[tested in game]**: tried in the client, with a window built for the purpose or an existing one.
- **[measured]**: measured on an in-game screenshot of a window (8193.37-17, scaled 1.8x by the capture; the scale was
  fitted from several independent distances, so single edges are good to about ±0.3 px).
- **[compared]**: a 1:1 in-game screenshot of a window (GUI scale 1.0) compared pixel by pixel with the designer's
  picture of the same JSON.
- **[inferred]**: follows from the code or from how Nuklear (the UI library NUI is built on) works, but not seen
  directly.

No Beamdog code or file content is reproduced here: only names of functions and keys, and what they do.

- [The skin file](#the-skin-file)
- [Skin keys](#skin-keys)
- [Nine-slice margins and scrollbar thumbs](#nine-slice-margins-and-scrollbar-thumbs)
- [Fonts](#fonts)
- [Text](#text)
- [Tooltips](#tooltips)
- [Layout](#layout)
- [Default sizes](#default-sizes)
- [Combo boxes](#combo-boxes)
- [Window frame](#window-frame)
- [Images](#images)
- [Draw lists](#draw-lists)
- [What scripts can set](#what-scripts-can-set)
- [What NUI cannot style](#what-nui-cannot-style)
- [The original GUI](#the-original-gui)
- [Not known yet](#not-known-yet)

## The skin file

`nui_skin.tml` is a TOML file. It sets Nuklear's global style (the textures and colours of every window part and
widget) and lists the fonts to bake. There is one style for all NUI windows at once. Patch 8193.35 added it [docs].

### When it is read [code]

- It is an ordinary resource: resref `nui_skin`, type `tml` (2076), loaded through `CExoResMan::Get` in
  `Nui__ReloadSkin`. Any resource layer can supply it: a hak, an NWSync manifest, the player's `override/` or
  `development/` folder. The base game's copy is in `data/ovr.bif` [data].
- Each frame `nk_sdl_render` calls `nk_sdl_refresh_config`. That does work only when a reload flag is set: it clears
  the flag, calls `Nui__ReloadSkin`, then bakes every font in the new list.
- The flag is set at client start (`nk_sdl_init`), on joining a server (`CNWCModule::LoadModuleResources` adds the
  NWSync manifests and haks, then calls `CNWCModule::ReloadAllResources`), on leaving (`~CNWCModule`), on re-attaching
  a hak (`ReAttachHAKFile`), on a change of GUI scale (`CAurora::ComputeGUIScaleAndUpdate`), and on a server resman
  reload message with bit 0x200 (`HandleServerToPlayerResman`). No nwscript function was found that sends that message.
- So a skin in a hak or NWSync reaches every player when they join, and is reset when they leave. The nwn.wiki NUI page
  says overrides must be in place before a module loads; that predates these patches and is wrong for 8193.37 [docs vs
  code]. Patch 8193.37 also fixed "nui_skin.tml fonts not getting rebaked when in a hak" [docs].
- The client log shows each font as it is baked ("NUI: Font N loaded successfully: …") and the atlas size ("NUI: Font
  bake complete; texture is WxHpx").

### Precedence and scope

- Resource order, highest first: the player's `development/` folder, NWSync manifests, module haks, Beamdog's patch
  haks, the player's `override/` folder, base data [code]. A module's skin beats a player's `override/` skin but loses
  to their `development/` folder.
- One skin per server session. It applies to every NUI window while connected, Beamdog's own NUI panels included
  (the options window, the NWSync storage manager, the debug tools) [code]. The classic GUI (inventory, character
  sheet, dialogue, pre-game screens) is not NUI and is not affected.
- One skin per player, not per module: `nui_skin` is looked up like any resource, so a server that redirects one
  player's `nui_skin` to another resource (a ResMan override of type 2076, e.g. NWNX's
  `NWNX_Player_SetResManOverride`) and makes the client reload (`NWNX_Player_ReloadResources`; presumably the resman
  message with bit 0x200 above) gives that player another skin [inferred; not traced]. That is how `pnpm
  export-theme --prefix` themes are meant to be switched (docs/RESKIN-EVERYTHING.md, "Per-player themes"). The classic
  GUI's textures switch with `SetTextureOverride` (see [Images](#images)).

### Odd files [code]

- **Unknown keys** are ignored: the parser asks only for the keys in [Skin keys](#skin-keys).
- **A missing key** gets a default that is usually not Beamdog's value. Colours default to `#00000000` (transparent),
  so text or borders vanish. Image-or-colour keys default to a transparent colour. Nine-slice image keys default to
  the image `""`, which fails to load and draws the not-found placeholder. Integers default to 0. A partial skin is
  therefore broken: start from a complete file.
- **A TOML syntax error** is caught. The client logs "Nui__ReloadSkin: failed to parse nui_skin.tml: …" and skips
  every style update. By then it has already emptied the skin image cache (`clear_nk_styleimg_cache`), so the old style
  points at released images [inferred]. Expect broken skin art until the next reload.
- **No `nui_skin` resource** logs "failed to load nui_skin.tml" and changes nothing.
- **A font entry without `pixel_snap`** throws inside the parser. A catch-all swallows it and the entry keeps the
  default. Other missing font keys fall back to defaults quietly.
- **No `[[fonts]]` at all**: one default font is added (`fnt_maintext`, 17 px).
- **Int and float keys**: cpptoml's conversions were not traced. An int key written as a float is probably read as 0
  [inferred].

## Skin keys

`Nui__ReloadSkin` reads these keys, in this order [code]. There are four value types:

- **9-slice image**: a texture resref drawn as a 9-slice with margins fixed per key (see the next section). A `#colour`
  here is read as a resref and fails. Helper: `nk_styleimg9`.
- **image or colour**: `"#RRGGBBAA"` gives a flat colour. Anything else is a texture stretched over the widget (not
  9-sliced). Helper: `nk_styleimg`.
- **colour**: `"#RRGGBBAA"`.
- **int**: a whole number.

| Key | Type | What it styles |
|---|---|---|
| `text.color` | colour | default text colour |
| `[[fonts]]` | see [Fonts](#fonts) | font list; the first that loads is the default |
| `border.border_image` | 9-slice | used only to derive the border thickness of windows, popups, combos, menus, groups and tooltips: slice margin + 1 = 4 px [inferred from the struct layout] |
| `window.header.normal` / `hover` / `active` | 9-slice | title bar |
| `window.header.label_normal` / `label_hover` / `label_active` | colour | title text |
| `window.header.close_button.normal` / `hover` / `active` | image or colour | close button |
| `window.header.close_button.padding_x` / `padding_y` | int | |
| `window.header.minimize_button.*` (the same five keys) | as above | collapse button |
| `window.fixed_background` | image or colour | the window body's background |
| `window.background` | colour | Nuklear's window background colour |
| `window.border_image` | 9-slice | window border |
| `window.border_color`, `popup_border_color`, `combo_border_color`, `contextual_border_color`, `menu_border_color`, `group_border_color`, `tooltip_border_color` | colour | border colours |
| `window.padding_x` / `padding_y` | int | window inner padding |
| `window.scrollbar_size_x` / `scrollbar_size_y` | int | scrollbar thickness, multiplied by the GUI scale |
| `window.scaler` | image or colour | resize grip |
| `background_color`, `color`, `border_color`, `selected_color` (top level) | colour | NuiChart background, default line colour, border, selection. Read at the top level, not under `[chart]`: Beamdog's own file puts them under `[chart]`, so they are never read there and come out transparent [data] |
| `chart.border` | int | chart border |
| `scrollv.normal` / `hover` / `active` | 9-slice | vertical scrollbar track |
| `scrollv.cursor_normal` / `cursor_hover` / `cursor_active` | 9-slice (see below) | scrollbar thumb |
| `scrollv.dec_button.*`, `scrollv.inc_button.*` (`normal` / `hover` / `active`) | image or colour | arrow buttons |
| `scrollv.border_color` | colour | |
| `scrollv.padding_x` / `padding_y` | int | |
| `scrollh.*` (as `scrollv`, without a border colour) | as above | horizontal scrollbar; `scrollh.border_color` is not read |
| `checkbox.normal` / `hover` / `active` / `cursor_normal` / `cursor_hover` | image or colour | NuiCheck box and tick |
| `option.*` (the same five) | image or colour | NuiOptions radio buttons |
| `button.normal` / `active` | 9-slice | NuiButton, and the frame behind NuiButtonImage [inferred] |
| `button.hover` | 9-slice (7) | |
| `button.text_background`, `text_normal`, `text_hover`, `text_active` | colour | button label colours |
| `button.border` | int | border thickness divided by 100, so in practice 0 |
| `contextual_button.normal` / `active` / `hover`, `padding_x` / `padding_y` | image or colour / int | right-click menu entries |
| `tab.background` | 9-slice (5, 3, 3, 3) | Nuklear tree and tab headers |
| `tab.tab_minimize_button.*`, `tab.tab_maximize_button.*`, `tab.node_minimize_button.*`, `tab.node_maximize_button.*` | image or colour | tree expand and collapse icons |
| `slider.cursor_normal` / `cursor_hover` / `cursor_active` | image or colour | slider knob |
| `slider.bar_filled` | colour | filled part of the slider |
| `selectable.normal`, `pressed`, `normal_active`, `pressed_active`, `hover_active` | 9-slice | selectable items (NuiButtonSelect and similar [inferred]) |
| `selectable.hover` | 9-slice (7) | |
| `selectable.padding_x` / `padding_y` | int | |
| `progress.normal` | 9-slice | NuiProgress track |
| `progress.hover` / `active` | 9-slice (7) | |
| `progress.cursor_normal` / `cursor_hover` / `cursor_active` | image or colour | progress fill |
| `property.normal` / `active` | image or colour | Nuklear's number "property" widget (not exposed by `nw_inc_nui.nss`) |
| `property.hover` | image or colour | never read: the client asks for `"property.hover "` with a trailing space, so it is always transparent |
| `property.dec_button.*`, `property.inc_button.*`, `property.edit.*` | image or colour | |
| `combo.normal` / `active` | 9-slice | NuiCombo |
| `combo.hover` | 9-slice (7) | |
| `combo.content_padding_x` / `content_padding_y` | int | |
| `combo.button.normal` / `active` / `hover` | image or colour | dropdown arrow |
| `edit.normal` / `hover` / `active` | 9-slice | NuiTextEdit |
| `edit.border_color`, `edit.text_normal` | colour | |
| `edit.padding_x` / `padding_y` | int | |

The skin has no keys for corner rounding, border thickness (besides the derived 4 px), per-widget fonts, text
alignment (button labels are centred), tooltip art (tooltips use the window style [inferred]), label or list-row
backgrounds, or the "encouraged" glow [code]. The base textures the game's skin points at are TGAs named `nui_*` in
`bd_nui.bif` [data].

## Nine-slice margins and scrollbar thumbs

The slice margins are hard-coded in each `nk_styleimg9` call in `Nui__ReloadSkin`. A skin cannot change them [code].
Margins are in the texture's pixels.

- **3 px on every side** for every 9-slice key not listed below.
- **7 px** for `button.hover`, `selectable.hover`, `progress.hover`, `progress.active` and `combo.hover`.
- **(5, 3, 3, 3)** for `tab.background`. Which side the 5 belongs to is not known; the designer reads it as the left.
- **The scrollbar thumbs** (`scrollv.cursor_*`, `scrollh.cursor_*`) have 0 margins and use only part of the texture:
  the rect (3, 0, 10, 16) for `scrollv` and (0, 3, 16, 10) for `scrollh`. That strip is repeated along the bar at its
  own size, and stretched across it [code, from the call's arguments]. Which tiling flag is which axis was inferred
  from a screenshot; the thumb's fine ridges match it [measured].
- The thumb is inset from the track by the skin's `padding_x` and `padding_y`, as Nuklear does: 10 px wide at the
  bar's x + 4 on an 18 px bar [measured].
- Nine-slice drawing also uses Beamdog's `nk_9slice_tiledata`. Keys that are not 9-slices (checkbox, option, slider,
  the arrow buttons) are stretched [code].

Because the margins are small, ornate frames with wide corners stretch badly through the skin. Art like that is better
drawn per window with images.

## Fonts

- **Format** [code]: `.ttf` resources (type 2074), rasterised by stb_truetype through Nuklear's font atlas
  (`nk_font_atlas_add_from_memory`). The resref is at most 16 characters. The base game ships `fnt_maintext` (the
  default), `fnt_default`, `fnt_default_hr` and the JetBrains Mono files `jbmono*` [data]. The classic `fnt_*` fonts
  of the old GUI and `PostString` are a different system.
- **How many** [code]: no fixed limit. Every entry is baked into one shared atlas texture. A size is part of an entry:
  one face at three sizes is three entries.
- **Keys** [code] (defaults from `NkConfig::Font::Font()`):
  - `name`: what scripts use. Default `(default)`.
  - `resref`: default `fnt_maintext`.
  - `font_size`: the pixel height at GUI scale 1.0, measured as the font's hhea ascent − descent
    (`stbtt_ScaleForPixelHeight`), **not** the em. Fonts with tall ascenders come out smaller than their nominal
    size. Default 17; 16 if ≤ 0. [measured: x-height 6.11 px in game, 6.16 by this rule, 6.98 by the em, for
    `fnt_maintext` at 17]
  - `pixel_height`: read but not used.
  - `pixel_snap` (default true): glyphs snap to whole pixels.
  - `oversample_h` / `oversample_v` (default 1): truncated to whole numbers. Higher values cost atlas space.
  - `spacing_h` / `spacing_v` (defaults 0.5 / 0): Nuklear's extra glyph spacing.
- **Advances** [code, nuklear.h; measured]: Nuklear's baker stores each glyph's advance scaled by the same factor, plus
  `spacing_h`, and rounds it to whole pixels when `pixel_snap` is on. Measured word starts along lines up to 457 px
  long fall within 0.6 px of this model; an em-based model falls 1 to 12 px short a line.
- **Size and GUI scale** [code]: the size baked is `font_size` × the GUI scale, and the atlas is re-baked when the
  scale changes. The "Large font" option (`ui.large-font`) changes only the classic dialogue font, not NUI.
- **Glyph ranges** [code] (`nk_sdl_refresh_config`, by the game's code page):
  - Western (cp1252, the default for English): U+0020–U+00FF only.
  - cp1251: Nuklear's Cyrillic ranges.
  - cp1250: U+0020–U+02FF and U+2000–U+21FF.

  So for Western players NUI cannot draw typographic quotes, dashes or "…", even though nwscript strings can carry
  them. Use plain `' " - ...`.
- **Missing fonts** [code]: a `.ttf` that is not found logs "Font N failed to load … not found", and its name is not
  registered. A font that is not in the active skin cannot be used.
- **Selecting a font** [docs + code]: `NuiStyleFont` (also accepts a bind; per 8193.36 it works on whole windows,
  layout groups and widgets), the `font` of `NuiWindow` (title and decorations too), and the font of
  `NuiDrawListText`. Text edits honour the element font. An unknown name logs "Requested font was not found" and keeps
  the current font (`nk_get_font_by_name`; all four callers check). `PostString` takes a classic font resref, not a
  NUI font name.
- **Duplicate names**: which entry wins when two share a name is not known.

## Text

- **Word wrap** follows Nuklear's `nk_text_clamp` with separators: a line breaks at a space when the next word would
  not fit [inferred from Nuklear]. Measured on a 13-line paragraph, the breaks match this model with Nuklear's
  advances [measured].
- **Wrap width**: a text box (`NuiText`) wraps short of its width, leaving room for a scrollbar even when there is
  none. For a 500 px box the client's wrap width is in [480, 488) [measured]. The designer uses width − 18.
- **First line**: the first line of a text box starts 2 px below the box's top [measured], and so does a multiline
  text edit's [compared].
- **Text edit inset**: a text edit's text starts 11 px in from its left edge [compared].
- **Half pixels**: a line of text whose top or left lands on a half pixel goes up and left, as the GPU fills the
  pixels whose centres the glyph quads cover [compared].
- **Line pitch**: font size + 4 (21 px for a 17 px font) [measured].
- **Draw-list text** is drawn with one `nk_draw_text` call: one line, no wrapping, clipped to its rect. The glyph that
  crosses the rect's edge is kept, as `nk_text_clamp` without separators keeps it [code].
- **Rich text**: one font and one colour per text element.

## Tooltips

How an element's `tooltip` and `disabled_tooltip` are drawn (`Nui::Layout::Layoutable::Render` and Nuklear's
`nk_tooltip`, as Beamdog changed it) [code]:

- **One line, never wrapped.** The tooltip is one `nk_text` line (left aligned) in a popup exactly as wide as the
  text plus 16 px, and one row of the font's height plus 8 px high. The client never calls Nuklear's wrapping text
  for a tooltip, at any width.
- **No line breaks.** `"\n"` does not start a new line: the text-drawing loop skips only `"\r"`, and draws every other
  character, `"\n"` included, on the same line (as the font's fallback glyph, which is `"?"` by Nuklear's default
  [inferred]). It also adds to the width.
- **No maximum width and no clamp.** The popup's left edge is 21 px right of the mouse (1 px below it), it is as wide
  as the text needs, and nothing moves or shrinks it to stay on the screen or in the window (the popup is drawn with
  no clipping). A long tooltip runs off the right edge of the screen; this happened to a server's Options window
  (its Theme tooltip) [tested in game]. Near the right edge even a short one can be cut.
- **Font**: the font in effect for the element when it is drawn: its own `font` style if it has one, else the skin's
  default NUI font (`fnt_maintext`, 17 px times the GUI scale; see [Fonts](#fonts)). The popup uses the skin's window
  and tooltip style (`tooltip_border_color` etc., see [Skin keys](#skin-keys)).
- **Which one shows**: hovering an enabled element shows its `tooltip`; a disabled one shows its `disabled_tooltip`
  (never the plain tooltip). An empty string shows nothing.
- **Not on a combo**: a tooltip and a combo's open list are both the window's one popup; a combo with a tooltip
  cannot be opened ([Combo boxes](#combo-boxes)) [tested in game].

So a tooltip should be one short line. The designer reports a tooltip (or disabled tooltip) that would run off the
screen even with the mouse at the element's left edge, the window where it opens, as an error ("tooltip off screen",
measured with the skin's real font when the game is given; `--canvas` sets the screen). Longer help belongs in the
window as wrapped text (`NuiText`).

## Layout

- The client turns a window's JSON into Kiwi (Cassowary) constraints and solves them [code]. The code for rows,
  columns and groups follows niv's public gist `nuilayout.cpp`, linked from the nwn.wiki NUI page.
- **Margin and padding** [code]: the `Layoutable` constructor sets padding 0 and a margin of **2 px on every side**.
  Three widgets set their margin to **0** right after: `Nui::Layout::Widgets::spacer` (a spacer, whatever its size or
  parent), `Widgets::tabbar` (JSON type `tabbar`, `NuiToggles`) and `Widgets::options` (`NuiOptions`). No other
  `SetMargin` or `SetPadding` call in the client changes a default. A JSON `margin` or `padding` replaces the default
  for every widget, applied after construction, but only when it is 0 or more: the JSON default is -1, meaning not set
  (`LayoutableJ::Construct`, `from_json`). `SetMargin` and `SetPadding` make each side a required constraint. The
  spacer's 0 accounts for a measured difference exactly: on the in-game deity window, a row
  `[group 260, spacer 16, group 530]` put the right pane 4.0 px left of a 2 px-margin spacer's layout [measured].
- **Required sizes** [code]: `width` and `height` from the JSON are required. A 32 px element in a 34 px row fails
  (32 + 2 + 2 > 34), and the client refuses the window [tested in game].
- **Rows and columns** (`Span::BuildConstraintDependants`): along the span, the fit is at medium strength, so overflow
  clips. Across it, the span must be at least each child's size plus its margins, as a required constraint: children
  can never be bigger than their parent.
- **Groups and lists** (`LayoutGroup::SetChildren`): a group lays its child out in a solver of its own, whose size is
  only a medium suggestion. A group's content never makes its parent unsolvable. A list row is `row_height` high.
- **Whole pixels** [compared]: a span places its children one after another at whole-pixel sizes. Each solved size is
  cut to a whole pixel, and the next child starts where the last one ended: a row of widths 302.6, 176.9 and 64.5 puts
  its third child at 478.
- **A forced scrollbar** keeps its room, but the client draws none while the content fits: an empty or short list
  shows a bare column where the bar would be [compared].
- **Widgets with no width or height** get a default size: see [Default sizes](#default-sizes).
- **Solutions**: when several solutions are equally good, C++ Kiwi's choice depends on its maps being sorted by
  symbol. JavaScript ports that keep insertion order pick a different one; the designer's vendored Kiwi sorts its maps.
- **Sizes cannot be bound**: `NuiWidth`, `NuiHeight`, `NuiAspect`, `NuiMargin` and `NuiPadding` are static. Swap a
  group's layout with `NuiSetGroupLayout` to change geometry [docs].

### Default sizes

Each widget's constructor asks for a size when its JSON sets none [code]. *s* is the GUI scale (pinned to
`nk_get_gui_scale()` for a group's content in `LayoutGroup::SetChildren`; medium confidence for the window's own
content); the designer lays out at *s* = 1. "Strong" is Cassowary's strong strength: it beats a row's or column's own
fit (medium), so a span too small for its children overflows instead of squeezing them. A JSON `width` or `height`
(required) replaces the default.

| widget (JSON type) | width | height |
|---|---|---|
| button, image button (`button`, `button_image`) | 150·s strong | 50·s strong |
| check (`check`) | 150·s **weak** | 35·s strong |
| slider (`slider`, `sliderf`) | 150·s strong | 35·s strong |
| float progress (`progress`, `NuiProgress`) | 150·s strong | 35·s strong |
| int progress (not made by `nw_inc_nui`) | none | 35·s strong |
| text edit (`textedit`) | none | 35·s strong |
| combo (`combo`) | 150·s strong | 35·s strong |
| button select (`button_select`) | 150 strong [tested in game] | not traced |

Labels, text, images, lists, groups, charts and spacers ask for nothing. The 150-wide button measured in game
(a deity window's list, 8193.37-17) is this default.

**Options and toggles** (`Widgets::options`, `Widgets::tabbar`): both build a `SelectList`, a row when `direction` is 0
(horizontal) and a column when it is 1. The list itself has margin 0 ([Layout](#layout)).
`SelectList::MakeButtons` makes one entry per label (`Widgets::custom`): an ordinary widget, **margin 2**, asking for
**35·s high** and, in a horizontal list only, **150·s wide**, both strong. The label's text does not change the size and
the entries do not share the list's width. So a horizontal list of *n* entries wants *n* × 154 by 39; a vertical one
*n* × 39 high, as wide as its column. A list given a smaller required size cuts the last entries off. Options draw each
entry with `nk_option_label` (a radio and its text), toggles with `nk_button_label`.

**Scrollbars**: Nuklear scrolls the window's content when it reaches past the body, entries cut off by their list
included. Layonara's options window (a 392 × 72 body, options given 284 wide whose two entries reach 412) showed both
scrollbars in game: the horizontal one covers the bottom of the body, so content that fills the height then needs the
vertical one too [tested in game; the reservation itself is inferred, not traced].

### Combo boxes

**The box** (`NuiCombo`; its constructor) asks for 150·s wide and 35·s high, both strong, with the usual margin 2
([Default sizes](#default-sizes)) [code].

**The open list** (`nk_combo_callback`, as the client builds its size) [code]:

- **Placement**: its left edge is the combo's left edge, its top the combo's bottom less `style.window.combo_border`
  (4 px: the border thickness the skin's `border.border_image` gives, see [Skin keys](#skin-keys)). It always opens
  **downward**, whatever room is left below.
- **No clipping by the window or the screen**: it is drawn from an unlimited clip rect and clipped only to its own
  bounds, like a [tooltip](#tooltips). An open list reaches past the window's edge, and one near the bottom or right
  of the screen runs off it; nothing moves or shrinks it.
- **Rows**: each entry is a row the font's height + 2 high (19 for the default 17 px font), rows
  `style.window.spacing.y` apart (Nuklear's 4; the skin does not set it).
- **Width**: s × the widest entry label + 50 + the scrollbar size (`window.scrollbar_size_x`): not the combo's width.
- **Height**: min(300·s, s × ((spacing + row) × entries + 2 × (padding + spacing))), where padding is the `padding.y`
  of the panel the combo is in (the window's `window.padding_y`; a group's or list's group padding, Nuklear's 4). Past
  300·s it scrolls.
- **No entries**: a combo whose `elements` is empty (or bound to an empty array, or to a bind with no value yet) still
  opens, as a popup with no rows only s × 2 × (padding + spacing) px high (16 px with 4 and 4). In game that looks like
  nothing happened when the combo was clicked (a real Layonara bug).
- **No tooltip**: a combo with a `tooltip` cannot be opened. Nuklear keeps one popup slot per window, and both the
  tooltip and the open list are popups: while the mouse is over the combo's header the tooltip takes the slot and the
  list closes, every frame, so clicking the combo only flashes the list [tested in game] (the slot sharing is
  [inferred] from Nuklear). Put the tooltip on the combo's label instead. A `disabled_tooltip` is harmless: a
  disabled combo does not open.

The designer warns about a combo with no entries ("empty combo": an empty array, or a bind whose sample value is
empty, per row in a list) and asks for a sample value for bound entries that have none. A combo with a tooltip is an
error ("combo tooltip": a static one, or a bind unless its sample value is empty), in the Problems panel and in
`pnpm check` with or without a style; the Tooltip property's help says so too. It warns when the open list
would run off the screen ("combo list off screen", measured with the combo where it is drawn on the `--canvas`
screen). The canvas bar's "Open combo list" draws the selected combo's list on top of the window, past its edge if
need be (in a list, in its first row), with the window's background and border and the contextual button's rows
[inferred: the popup's own look is not traced].

## Window frame

Measured on an in-game window with a title bar, at GUI scale 1.0 [measured]:

- The title bar is **33 px** high.
- The body's frame starts right under it, with **no gap**.
- The content is inset **8 px** on the left, right and bottom, and 8 px below the title bar.
- The title bar's frame is drawn a pixel taller than 33, so the body's frame covers its last row [compared]. The close
  and collapse buttons are centred in that taller bar.
- The title starts 8 px in, a pixel further than the frame's 7, and takes `window.header.label_active`: a window the
  client has just opened has focus [compared].
- So the frame adds **16 px** to the width and **49 px** to the height (33 + 8 + 8).
- How GUI scale above 1.0 scales layout units, the frame and the slices is not known. The scrollbar thickness is
  multiplied by the scale [code].

### What the window's keys turn on [code]

`JsonWindow::Initialize` reads them as follows. "Bind" means a bind whose value has not been set yet: for `closable`,
`border`, `transparent` and `accepts_input` the bind only registers a listener, so the starting state holds until the
bind is set. The designer draws a bind with its sample value when it has one, else with this starting state.

| key | `true` | `false` | `null` | missing | bind |
|---|---|---|---|---|---|
| `collapsed` | button, opens collapsed | no button | button, opens expanded | no button | button; collapsed while the value is true |
| `closable` | close button | none | close button | close button | close button |
| `border` | drawn | none | none | drawn | none |
| `transparent` | background alpha 0 | opaque | opaque | opaque | opaque |
| `accepts_input` | on | blocks input | on | on | on |
| `resizable` | yes | no | yes [docs; untraced] | yes | — |

- **The title bar** is hidden only when the title is empty **and** the close button is off **and** the collapse
  button is off. A title of `false` counts as no title (per `nw_inc_nui.nss`; the conversion was not traced). A window
  that opens collapsed shows its title bar alone.
- **Geometry** (`x`, `y`; GUI scale *s*, results below 0 clamped to 0): `x = -1` centres
  (screenW / 2 − s·w / 2), `-2` puts the corner at the mouse (mouseX), `-3` centres on the mouse (mouseX − s·w / 2);
  `y` likewise, with screenH − mouseY as the mouse. The result is not rounded: a centred window of odd size starts on
  a half pixel [compared]. The designer has no mouse and takes the canvas centre, so `-3`
  draws as `-1` and `-2` puts the corner in the middle.
- **`size_constraint`** goes to `SetWindowSizeConstraints(x, y, w, h)`; **`edge_constraint`** to
  `SetWindowEdgeConstraints` reordered as (x, w, y, h), meaning left, right, top, bottom. The designer keeps both but
  does not draw or check them.

## Images

- **Lookup order** [code; tested in game]: `nk_loadimg` probes wbm, gif, png, tga, jpg and dds with
  `CExoResMan::Exists` and **keeps the last one that exists**, so **dds > jpg > tga > png > gif > wbm**, whichever
  resource layer each file is in. That type then comes from the best layer that has it. The 8193.36 patch notes and
  nwn.wiki say DDS is used last; the code and the game disagree: a base-game DDS shows in NUI instead of a hak's TGA
  of the same name. PLT is not supported.
- **Consequence**: to replace a base `nui_*.tga`, ship a TGA (or DDS) of the same name. A PNG of the same name loses
  to the base TGA even from a higher layer. Two formats under one name should be the same picture: NUI shows the DDS,
  other parts of the game may use the TGA.
- **DDS row order** [tested in game]: NUI reads a DDS **bottom row first**. A DDS stored bottom row first shows
  upright in an `NuiImage`; one stored top row first shows upside down. Ship DDS for NUI bottom row first. Standard
  `DDS ` files are assumed to behave the same [inferred].
- **Draw-list images** (`NuiDrawListImage`) almost certainly use the same loader, and so the same row order
  [inferred, not tested].
- **TGA origin**: whether NUI honours a TGA's top-left-origin flag (descriptor bit 5) is **not known**. The engine
  ignores that flag for model textures. The designer honours it.
- **Decoding** [code]: `NkImage::Load` sniffs `DDS ` and `GIF89a`; anything else goes to stb_image (tga, png, jpg).
  GIFs keep 1 to 255 frames and play by each frame's delay, looping. WebM plays through the movie player. Images load
  in the background with a loading placeholder; a missing one shows a not-found image.
- **Caches** [code]: each window caches images by resref and type (`Nui::Window::GetImageByResRef`). Skin images
  have their own cache, emptied on every skin reload.
- **Placement** [docs]: `NuiImage(resref, aspect, halign, valign)` with aspect FIT, FILL, FIT100, EXACT, EXACTSCALED or
  STRETCH. `NuiImageRegion` and `NuiDrawListImageRegion` draw a sub-rectangle. Transparency comes from the image's own
  alpha.
- **Drawing** [compared]: the GPU samples a NUI image bilinearly with no mipmaps, so a shrunk image is not smoothed. A
  picture that lands on a half pixel goes up and left. A button's image is inset 6 px, Nuklear's padding 2 plus
  rounding 4: a 40 px button shows a 28 px image.
- **Nine-slice middles** [compared]: a middle larger than its rect is not shrunk. It is drawn at its own size and cut
  at the rect's end: a 268 px window shows the first 262 px of `nui_windowh`'s 506 px middle, then its right edge.
- **Missing images** [compared]: an empty resref draws `gui_notfound`, placed like the image. A resref no layer has
  draws `gui_error` at its own size, centred, each side shrunk only to fit the box, its shape not kept: a 132 px box
  shows it 36 x 36, a 40 x 30 one 36 x 30.
- **`SetTextureOverride`** [code]: adds resource overrides for tga, dds, ktx, plt, bmp, mtr and txi only (not png,
  jpg, gif or wbm), and refreshes 3D textures. It does not clear the NUI image caches, so it is not a reliable way to
  change a NUI image.

## Draw lists

[compared]:

- **A 1 px outline** (`NuiDrawListRect`, not filled) is Nuklear's anti-aliased line centred on the rect's edge: the edge
  pixels and the pixels just outside them show the colour at half strength, never past the widget's own rect.
- **A thicker outline** is centred on the edge too: a 2 px one covers the pixel on each side of it.
- **An image's rect** is taken at whole pixels: a portrait at y 3.875 starts on row 3.
- **A disabled element's** draw list is drawn at half brightness, still opaque: 92,86,71 shows as 46,43,35.

## What scripts can set

From `nw_inc_nui.nss` and `nwscript.nss` [docs], and the client's JSON keys [code: strings].

- **Window**: title, geometry (x and y of -1 centre the window; -2 puts it at the mouse; -3 centres it on the
  mouse), resizable, collapsed, closable, transparent, border, accepts_input (false makes a click-through overlay),
  size_constraint, edge_constraint, font. There is no per-window colour, background image or skin, and no z-order API.
- **Any element**: width, height, aspect, margin, padding, enabled, visible (an invisible element still takes space),
  tooltip, disabled tooltip, encouraged (an animated glow), foreground colour (`NuiStyleForegroundColor`: one solid
  colour, text for labels, the bar for progress bars), font, id (which makes it send events).
- **Widgets**: label, text, button, image button, select button, check, image, combo, sliders, progress, text edit,
  list, colour picker, options, toggles, chart, spacer. The client also parses an undocumented `movieplayer` widget
  [code: strings].
- **Draw lists** (`NuiDrawList`): line, polyline, Bézier curve, circle, arc, rect, text and image, painted in order.
  Every parameter can be bound; bind arrays draw one copy per entry. `ORDER_BEFORE` paints under the widget,
  `ORDER_AFTER` over it. Render conditions: always, not hovered, hovered, or while the left, right or middle button is
  held. With `scissor` off, drawing can spill outside the element's box [docs].
- **Binds never set** read as null [compared]: `visible` or `enabled` bound to one hides or disables the element, a
  draw-list item's `enabled` skips the item, and a draw-list `color` draws nothing.
- **Events**: the client's strings name click, mousedown, mouseup, mousescroll, blur, watch, unknown-bind and open.
  No hover event is documented or found in the client [code: strings; very likely, not proven].

## What NUI cannot style

- Per-element backgrounds: paint one with a draw list (`ORDER_BEFORE`) behind the element.
- Image tint, alpha or rotation: make separate art, or lay a translucent draw-list rect over the image.
- Corner rounding: the skin's 9-slice textures decide the corners.
- Border colour and thickness per element: they come from the skin, for every window.
- Text effects (outline, glow, shadow). A shadow can be faked by drawing draw-list text twice, offset.
- Rich text: one font and one colour per text element.
- Per-window skins: the skin applies to every NUI window.
- Multi-line or wrapped tooltips: a tooltip is always one line ([Tooltips](#tooltips)).
- Anything client-side beyond hover and pressed looks, tooltips, sliders, text entry, scrolling, combo lists,
  window drag and resize, GIF and WebM playback and the encouraged glow. Everything else is a bind update from the
  server, one message per change.
- Pre-game screens (main menu, server list, the engine's character creation) use the classic GUI, not NUI.

## The original GUI

The windows from before NUI (character record, inventory, options, character select, the creation wizard, ...) are
panel models placed on each other by `.gui` layouts. `pnpm old-gui` and the reskin work from these facts.

- **Models and layouts** [data]: a `.gui` (GFF type `GUI `) places each object's model (`Obj_ResRef`) on a hook node
  (`Obj_Parent_Hook`) of its parent (`Obj_Parent`, a tag), with a caption (`Obj_Caption`: `AurString_Font`, the text
  or a string reference). The panels the client builds in code (character record, inventory, store, spellbook,
  journal) have no layout: the client places their pieces on their models' hooks itself.
- **Scale** [data, inferred]: a GUI model is laid out at 100 screen pixels per model unit at UI scale 1.
- **Placing** [data]: a `.gui` object sits at its parent's hook node plus its `Obj_X` and `Obj_Y`; a node's place is
  its parents' transforms and its own position and orientation (a quaternion in a compiled model, an axis and angle
  in an ASCII one). An animation's first position and orientation keys move a node in that state. Some hooks are
  turned: the rest popup's `status` hook turns its bar on its side, so the bar runs left to right.
- **Which way up** [tested in game]: a texture's top row is texture v = 1. The client reads a DDS and a TGA alike,
  bottom row first, whatever the TGA's origin flag says.
- **States** [data]: a control's states are animations of its model (`up`, `down`, `hilite`, `disabled`,
  `encouraged`, `checkedup`, `checkeddown`, `uncheckedup`, `uncheckeddown`, `checkedhilite`), each pointing the
  meshes at another rectangle of the same atlas (an animmesh's `animtverts`). A control may read another control's
  texture: the old close button `ctl_btn_x` draws `ctl_chk_pre`; the checkbox `ctl_btn_xch` draws its box and mark
  from the tab-icon atlas `ctl_btn_jnl_inv`.
- **Run-time sizes** [data, inferred]: the `size` and `thumbsize` animations resize a piece (the scrollbar's track and
  thumb, the radial band); `percentage` fills a bar between its first frame (empty) and its last (full).
- **Stretching** [tested in game]: a quad's texture vertices are mapped over its geometry, so a cell of a colour
  strip is stretched over a whole panel (`gui_boxes*` cells 20 to 200 times). With filtering on, a stretched span
  also reads half a texel past each end. Some pieces are strips turned on their side.
- **txi** [tested in game]: `filter 0` draws without filtering (each pixel takes the texel it falls in); `clamp 3`
  repeats the edge texel past both axes' ends instead of wrapping (the tab bodies read far past their texture's last
  row, so that row fills the body); `mipmap 0` draws the base level at every size.
- **Shared list rows** [tested in game]: the spell tree, the spell boxes, the journal's quests, the Player List and
  the store draw their rows from one strip of `gui_boxes_ingame` (columns 224-227, `filter 0`): each row 0.34 units
  tall at a 0.4 pitch, from half a texel inside the strip's first row to half a texel past its last.
- **Built-in names** [code: strings]: the client names some textures in its code, and builds families with a number
  (`ctl_inv_sto_tab%d`, `gui_icon_%dx%d...`, `gui_icon_armr%d...`, `gui_mp_custom%02d...`, `pnl_mapgen_%dx%d`).
- **Fonts** [tested in game]: the client remaps every old-GUI font name to one of three TrueType files:
  `fnt_maintext` (titles and labels, `fnt_galahad14`, about 17 px), `fnt_default` (the rest, about 14 px) and
  `fnt_default_hr` (dialog and floating text with the large-font option, about 16 px). The game's `.txi` of each name
  (contrast, outline, spacing) still applies. Fonts are loaded once per client: no per-player switch.
- **Where a player's files count** [tested in game]: a file in the user folder's `development/` beats the haks a
  server sends through NWSync; a file in `override/` does not.
- **DXT1** [tested in game]: a dark warm face that 5:6:5 cannot hold exactly is stored as a mix that leans green
  ("olive"); a face colour 5:6:5 stores exactly decodes to itself in every block.

## Not known yet

- Whether NUI honours a TGA's top-left-origin flag.
- Whether draw-list images flip a DDS as `NuiImage` does (almost certainly).
- How a group reports its content height to Nuklear: measured scrollbar thumbs are about 20 px shorter than
  `visible / content × track − 2 × padding_y` with the solver's extent.
- How GUI scale above 1.0 scales layout units, the window frame and the skin slices.
- Which side of `tab.background` has the 5 px margin.
- Which `[[fonts]]` entry wins when two share a name.
- Hover, pressed and focused drawing follow Nuklear's own state logic; not traced in the client.
