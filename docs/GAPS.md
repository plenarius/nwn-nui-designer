# Gaps and debt

What is stubbed, approximate or unknown, and what would settle it. Delete an item when it is fixed (git keeps the
history). Decisions are in [DESIGN.md](../DESIGN.md); facts about the client in
[CLIENT-BEHAVIOUR.md](CLIENT-BEHAVIOUR.md), whose "Not known yet" lists the engine questions.

## Not drawn, or drawn as a stand-in

- **Hover, pressed and focused states.** Every widget is drawn at rest, so draw-list items that render only on hover
  or while a button is held do not show (the properties panel says so). Porting Nuklear's state logic
  (`nk_button_behavior`, the skin's `hover`/`active` keys) would allow a "preview state" switch. The skin editor's
  widget-states sheet shows the states, with widgets placed by hand (not Nuklear's spacing), and a row of disabled
  widgets.
- **Tooltips, the text cursor, the resize grip** are not drawn (tooltips are measured: one off the screen is an
  error).
- **Open combo lists** are measured (one off the screen is a warning) and drawn only on demand (the canvas bar's "Open
  combo list", for the selected combo). Their look is a stand-in: the window's background and border, a contextual
  button per row, no hover or selected row; how the client draws the popup itself is not traced. The GUI scale is
  taken as 1, `style.window.spacing.y` and a group's padding as Nuklear's default 4, and `combo_border` as the border
  image's 4 px (not read from the client).
- **Sliders and the colour picker** are nui-preview's stand-ins (a line and a knob; a flat swatch); **charts** are a
  black frame. Nuklear's `nk_slider`, `nk_color_picker` and `nk_chart` are to be ported.
- **Toggles** (`NuiToggles`) are drawn as a button per entry (`nk_button_label`), the chosen one pressed; how the
  client marks the chosen tab is not traced.
- **Window scrollbars** are reported (overflow), not drawn. Their thickness is taken as a group's (18 px) and the body
  is not re-laid out for them; how the client reserves room for them is not traced.
- **Colour codes** (`<c...>`) are drawn as text. **StrRefs** show as `<strref N>`: no TLK reader yet.
- **WebM images** are not drawn; **GIFs** show their first frame. PLT is not drawn (nor by the client).
- **Bind formatting**: `number_flags`, `number_precision` and `text_flags` are ignored when drawing, and kept and
  exported but not editable in the panel (edit the element's JSON). Whole numbers print as integers.

## Approximate

- **UI scale** scales the finished picture. The client re-bakes fonts at `font_size` × scale and multiplies the
  scrollbar size; how it scales layout units, chrome and slices is unknown. Needs a test in game at 1.0 and 2.0.
- **Glyphs** differ from Pillow's by FreeType's hinting (mean 3.9/255 a pixel) and from the client's stb_truetype by an
  unknown amount.
- **1 px draw-list lines** on a whole-pixel coordinate are drawn as Nuklear's anti-aliased quad (two rows at half
  intensity); Pillow draws one aliased row. A rect's outline is checked in game
  ([CLIENT-BEHAVIOUR.md](CLIENT-BEHAVIOUR.md#draw-lists)); a line's is not. The slider bar uses Pillow's 2-wide line
  approximately.
- **Disabled widgets** are drawn at 50 % alpha (nui-preview's guess). A disabled element's draw list is checked in
  game: half brightness, opaque.
- **Window placement**: geometry -2 and -3 place the window at the mouse in the client; the designer takes the canvas
  centre. `size_constraint` and `edge_constraint` are kept but not drawn or checked.
- **Window keys not traced**: `resizable: null` (the docs say resizable) and a `false` title (no title, per
  `nw_inc_nui.nss`) were not followed through the client's conversion code. A window that opens collapsed is drawn
  as its title bar alone, with the same collapse texture as when expanded; whether the client draws a border round
  it or another symbol is unchecked.
- **Fonts on windows and groups**: only an element's own font is used (and the window font for the title). Whether
  children inherit a group's or window's font (patch 8193.36 says `NuiStyleFont` works on both) is untested.
- **Non-ASCII text** is drawn as `?`, assuming cp1252; other code pages bake other ranges.
- **A font name listed twice**: the first wins here, the last in nui-preview; the client's choice is unknown.
- **GUI scale in layout**: the default sizes (150, 50, 35) are multiplied by the GUI scale in the client; the
  designer lays out at 1.0 and scales the picture. The scale for a window's own content (not a group's) is medium
  confidence.
- **Bound options and toggles labels**: a SelectList whose `elements` is a bind has no entries in the solver (the
  layout depends on the JSON only), so it is drawn with its sample labels sharing its box and its overflow is not
  checked. The client makes its entries when the bind is set (not traced).
- **What else reaches the window's scroll extent**: a SelectList's cut-off entries do (seen in game); whether a child
  overflowing a fixed-size row or column does is untested (the designer reports it on the row, not as window
  overflow).
- **List cells**: any element but a list can be a template cell. Whether the client takes a row, column or group
  there is untested.
- **cpptoml's conversions are inferred**: an int key written as a float is reported (assumed read as 0), a float key
  written as an int accepted. Neither was tried in game.

## Found in game

From the deity window screenshot ([DESIGN.md](../DESIGN.md#checked-against-the-client)):

- **Scrollbar thumbs are about 20 px shorter in game** (about 296 against 317; top, width and inset right). The
  thumb's length is `visible / content × track − 2 padding_y`, so the content height the client gives Nuklear for a
  group is larger than the solver's extent (by about 45 px on 1320). Needs a second screenshot with another content
  height, or the decompile.

## The original GUI

`pnpm old-gui` takes the inventory and runs the checks ([RESKIN-EVERYTHING.md](RESKIN-EVERYTHING.md#the-original-guis-inventory-and-checks)).
Still open, in the order they are planned:

- **Previews are approximate where the client decides in code**: the number of list rows and their texts, which tab
  is selected, the scrollbar thumb's length, and each label's font size and place. The panels with no layout and no
  hand layout (chat, dialogue, quickbar, party bar, radial menu, DM bar) show only what sits on their hooks.
- **The frame check lists, it does not fail**: some findings are by design (a doubled stock rule drawn as one, a
  separator a stretched cell drops), so a person reads them. It takes a few seconds a screen (about 150 screens).
- **Lines dropped with shared stretched cells**: the Character Record's ability grid and page lines, and the server
  list's row separators, share texels with cells big panels stretch, so the redraw drops them (as the reference
  redraw does).
- **The editor runs the export and its checks, not the previews.** `pnpm old-gui inventory`, `previews` and the frame
  check are command-line only (they read the game executable and draw about 150 screens).
- **Hak size.** 16 textures stay TGA with `--format auto` (4 MB of the 11.9 MB hak) because DXT would move a flat face
  by 5 to 11 levels where a 4 x 4 block holds a frame's edge, rule and face. A better block fit (or frames placed on
  block edges) would let them be DDS.
- **Roles of new textures.** The role tables are the stock 8193.37 client's; a newer client's textures show as
  uncategorised until someone looks at them.

## Resources

- **NWSync** manifests and the `E1` formats (ERF E1.0, KEY/BIF E1) are not read.
- **The folder `<input>` fallback** (Firefox, Safari; only without the local API) makes the browser list every file of
  the install first; slow on a big install.

## Window editor

- **Panes are drawn, not edited.** A dump's `panes` are kept, saved and drawn in place of the group's child, but the
  tree edits the group's own child (marked "pane swapped in"). Edit a pane in the project file's JSON.
- **Several selected**: copy, paste, wrap and unwrap work on one element, and a canvas drag moves one. Align and
  distribute change only widths, heights and spacers (NUI has no free positions), so they refuse what that cannot
  reach (an element side by side with the key in one row, one with nothing before it to move it left). A list cell's
  position is the row template's: aligning an element in one moves the whole list.
- **The NWScript skeleton** is a starting point: it does not set watches or bind the module's own event script. Long
  sample arrays are set with one `JsonParse`.
- **The autosave has one slot**, and a file opened with the File System Access API is remembered for Save only in the
  session (its handle is not stored).
- **Style rules check the JSON only**: rules that need data (every item shown with its real icon, the longest real
  value) cannot be checked.
- **The `.jui` when the resource is missing** was not traced in the client (an empty window, or nothing).
- **Tests outside CI**: CI runs `pnpm smoke` but not `pnpm e2e`, `pnpm e2e:skin`, the round trips, the golden or the
  server check; they need the game, Docker or nwn-module.

## Skin editor

- **The atlas size is an estimate**: a plain skyline packer, and Nuklear's own extra rects (cursor, white texel) are not
  counted. The client logs the real size.
- **`artDepth`** is a heuristic (mean change between neighbouring columns or rows, threshold 8): heavy noise near the
  edge can trigger it, a faint ornament can slip under it.
- **The skin project is not autosaved** (Export, Project saves it). One skin at a time; its undo is separate.
- **The texture field offers only the names the project and skin use**, not every game texture; any name can be
  typed. Uploads take PNG, JPEG and TGA (not DDS, GIF or WebM).
- **The generator writes under the game's names** (`nui_button_n`, ...): turning it on over a hand-made skin replaces
  those files, and "Use for every key" points every texture key at them. Undo takes it back.
- **The licence note is generic**: it names the user's own files without asking for their terms.

## Local settings

- **Install detection has not met a real install on Windows or macOS.** CI (`install-detection.yml`, on changes to
  that code) runs it on Windows and macOS runners with fake installs at each store's default places: Steam (Program
  Files, a library on another drive, Steam's registry path; `~/Library/Application Support`), GOG (`C:\GOG Games`,
  the `.app` in `/Applications`), Beamdog (`%APPDATA%`, `~/Library/Application Support`), and the hak folder in
  Documents, also moved to OneDrive through the registry. What that cannot show: whether real installs sit where the
  stores' documentation says (the Beamdog client's numbered folder, a GOG Galaxy library elsewhere, the Mac App
  Store's Steam), and the game's own user folder when `NWN_HOME` or the game's `nwn.ini` move it. Someone with a real
  install on each: open the dialog and say whether the install and hak folder are found. A GOG or Beamdog install
  moved elsewhere is not found (Custom path… covers it); GOG's registry entries are not read.
- **Symlinks that leave a configured folder are refused**, also into another configured folder. Configure the target.
- **The command line does not search for installs** (by choice); saving the found install in the dialog writes it to
  the ini for both.
- **The `windows` list is one folder, not recursive**, names only.

## The check command

- No per-window rule exemptions from the command line (a rule's `exempt` list is the place).
- Annotations go on the dump's file; a dump is not mapped back to the script that builds it.

## Mobile clients

From the nwn-nui-spec's measurements ([MOBILE.md](MOBILE.md)): one iPhone at density 3 and one Android tablet.

- **Density 2 is not measured.** Its multipliers are taken to follow the same rule as density 3 (d for sizes,
  d / s for the position); the frame's extra and the list inset are the density-3 numbers scaled by (d - 1) / 2,
  the narrowest cell by d / 3, guesses. `nui_touch.nss` makes the same guess for the frame.
- **The probe cannot tell iOS at a GUI scale equal to its density** (d = s, say density 2 at scale 2.0) from a
  desktop: it measures the position factor d / s, which is then 1, but the client still multiplies sizes by d. The
  preview shows such a client as iOS; `nui_touch.nss` treats it as a desktop.
- **Row spacing at s = 1.6 is not measured.** The preview takes it as 4 d (12 on an iPhone, NUI-MOBILE-022 at
  s = 1.0) like the other sizes; `nui_touch.nss`'s `NuiTouch_FitRows` (from a helper used on an iPhone) counts 4.
- **The narrowest list cell** (about 11 px at s = 1.0, T61) is taken to be in the cells' own space (11 units at any
  GUI scale), not fixed in screen pixels; only s = 1.0 was measured.
- **The iOS frame's extra is a fit through two GUI scales** (K / s²); a large window needed about 10 more height at
  1.6 (the spec's T73, cause unknown). The preview takes the fit without the 6 units of slack.
- **Not modelled in the preview:** the iOS button frame drawn about 10 px inside its box (NUI-MOBILE-031) and
  right-aligned text on it (-032), padding (not measured), and the first list cell drawing a little wider than
  3 x its width (T60). `nui_touch.nss` grows such controls; the preview shows them that much taller.
- **Bound values** of draw-list coordinates are multiplied in the preview; bound row heights and cell widths do not
  exist (NUI does not bind them).
- **Images in list rows (`mobile-list-image`, NUI-MOBILE-052)** were measured only as a cell of the row template
  on iOS. An image nested deeper in a cell (in a row, column or group) is taken to break the same way and is
  flagged too; Android is not measured (it had none of iOS's layout issues). The preview hides such images on iOS
  but does not draw the broken row.
- **`mobile-tga` needs the game**, and checks only static resrefs and bind samples, not resrefs a script picks at
  run time.
- **Portable margins** keep fixed layouts exactly; where flexible elements share room the solver can settle a
  little differently (spans fit their children at medium strength), and a list cell's content fills its cell.
- **The probe in `nui_touch.nss` has not been run on a server by this repository's tests** (it compiles); its
  method is the spec's (prb_clamp, prb_clampev).

## Speed

Editor redraws took about 90–210 ms (a desktop) per Alt+arrow press on a large window. Solved layouts, the screen
canvas and its background are now kept across redraws, as skin slices already were ([DESIGN.md](../DESIGN.md#rendering)): on
a slow server core the medians of `pnpm bench:redraw` went from 286 to 176 ms (gods) and from 107 to 94 ms
(furnplace@acts-arrange). Each press still draws every widget and every text anew. `pnpm bench:redraw` measures it
(`--profile` adds a CPU profile per area). What is left, in order:

1. **Cheaper big stretches** for window resizes: the window border's middle is a bilinear upscale in
   `resampleRaw` (float sums, channels innermost). An exact integer path, shared coefficient rows, or stretching only
   the middle per size: up to −20 % on a resize.
2. **Text**: keep text layers across redraws, and blend a redraw's partly transparent layers into one buffer read
   once, instead of a `getImageData` + `putImageData` per layer: −10 to −20 %.

The profile is main-thread JavaScript plus 10–15 % Canvas 2D calls; both carry over to a desktop Chrome, since every
canvas asks for `willReadFrequently` and is drawn on the CPU. Headless Chromium leaves out the compositor's upload to
the screen and the wait for a frame (up to 16 ms).
