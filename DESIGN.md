# Design

The decisions that hold now, each with its reason. What is still stubbed, approximate or unknown is in
[docs/GAPS.md](docs/GAPS.md); what the client does (from its disassembly and checks in game) is in
[docs/CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md); how the code is laid out is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); setup and tests are in [CONTRIBUTING.md](CONTRIBUTING.md).

The target is the NWN:EE client, build 8193.37-17. The layout, rendering and checks began as a port of
**nui-preview**, a Python NUI renderer in Layonara's module repository (not public). The golden check still compares
the two (see [Fidelity](#fidelity)).

- [Stack](#stack)
- [Layout](#layout)
- [Text](#text)
- [Rendering](#rendering)
- [Resources](#resources)
- [Window editor](#window-editor)
- [Problems and house style](#problems-and-house-style)
- [Export: `.jui` and NWScript](#export-jui-and-nwscript)
- [Skin editor](#skin-editor)
- [Local settings and the local API](#local-settings-and-the-local-api)
- [The check command](#the-check-command)
- [Fidelity](#fidelity)
- [Open questions](#open-questions)

Next after the skin editor: an **art-window mode** (draw lists, image regions, hover and pressed images: windows
painted with their own art).

## Stack

- **TypeScript, Vite, a framework-free core.** `src/core` has no UI framework and no DOM or Node API: it takes bytes
  (`ByteSource`), a canvas factory and an image decoder from its host. So the same code draws in the editor, the CLI,
  the unit tests and the golden check.
- **The window's JSON is the model.** Layout and drawing are pure functions of (JSON, binds, skin, resources); the
  core never converts the JSON into classes of its own. Keys the editor does not know survive every edit and export.
  Every drawn element is reported as an `Outline` (rect, path, the JSON object itself, list row): the editor's hit
  testing, selection and drop targets.
- `src/core/model/nui.ts` mirrors `nw_inc_nui.nss`'s builders one for one: the fixtures are written with it, and the
  NWScript export maps JSON back onto it.
- **React 19** for the UI: tree, forms, drag and drop and undo over an immutable document are React's home ground,
  with the most contributors; nothing outside the canvas is performance-bound.
- **Canvas 2D** draws everything. Nine-sliced textures, text and images are built as RGBA buffers with Pillow's own
  arithmetic (`resample.ts`, `text.ts`) and composited at whole pixels; shapes are canvas paths. `Surface` is the
  seam a WebGL or software backend could replace.
- **No drag-and-drop library**: pointer events on the canvas, HTML drag and drop in the palette and tree. A library
  would have added a second model of the same geometry.
- **Non-null assertions are allowed** (they come with `noUncheckedIndexedAccess`): banning them would mean rewriting
  the ports, making them harder to compare with the Python, and the binary readers reject damaged input up front.

## Layout

`layout.ts` builds the same Kiwi constraints as the client (and nui-preview's `layout.py`), in the same order and at
the same strengths ([CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md#layout)).

**A vendored, corrected `@lume/kiwi`** (`src/core/layout/kiwi/`, `maptype.ts` changed to sorted maps). Both
JavaScript Kiwi ports keep rows and cells in insertion order; C++ Kiwi (kiwisolver, the client) keeps them sorted by
symbol. The solver picks pivots by walking those maps, so on NUI's many layouts with several equally good solutions
(a top-level span smaller than its room, rigid content against a medium suggestion) the JS ports end on a different
one: 10 to 20 px off on real windows. With sorted maps, every rectangle of every compared window is identical to
nui-preview's, and 5,000 random layouts (`pnpm golden:layout`; nested spans, fixed, missing and conflicting sizes,
margins, padding, aspect, spacers, unsized buttons) solve identically, including the 960 both refuse. `@lume/kiwi`
was picked over `kiwi.js` as maintained, TypeScript and ESM.

C++ Kiwi orders an expression's terms by the variables' heap addresses; the port uses creation order. The fuzz check
found no case where that matters.

## Text

Text has to wrap and clip at the same characters as the client.

- **The default text model is Nuklear's baker** (`TextModel "nuklear"`: font_size over the hhea ascent − descent
  height, advances plus `spacing_h` rounded to whole pixels), as the in-game check settled
  ([Fidelity](#checked-against-the-client)). The em model (`"nui-preview"`, FreeType's advances and size metrics as
  Pillow reports them, reproduced exactly) stays selectable to compare with older nui-preview runs.
- **Glyphs** are drawn as nui-preview draws them: each outline (opentype.js, unhinted) filled at 4x, blended into a
  line mask as Pillow blends glyph bitmaps, averaged down with Pillow's box filter, a 0.75 gamma, and the client's
  faint dark outline (a 3x3 max filter at 25 %). Against Pillow's mask for the same line: aligned to the pixel, mean
  difference 3.9/255, the rest being FreeType's hinting.
- **Text box metrics** from the in-game check: a text box wraps at its width − 18 (`TEXT_WRAP_LESS`, room for a
  scrollbar) and its first line starts 2 px down (`TEXT_INSET_Y`).
- **Text outside cp1252** is drawn as `?`, as the Western client bakes only U+0020–U+00FF.

Rejected:

- **Canvas `FontFace` + `fillText`**: hinting, sub-pixel positioning and gamma differ between browsers and
  platforms, and the canvas will not put each glyph on a whole pixel. It cannot match anything exactly.
- **stb_truetype compiled to wasm**: it would reproduce the client's rasteriser, but adds a C toolchain, and
  opentype.js with the Nuklear model already puts words within 0.6 px of the client's over 457 px lines and glyph
  heights within 0.15 px. It would change only the anti-aliasing.

## Rendering

- **One drawing mode: the client's**, as far as it is known. (A separate "nui-preview, bugs included" mode existed
  until nwn-module #1115 moved nui-preview to the client's behaviour.)
- **Skin textures: margins per key** (`src/core/render/slice.ts`, the one table of them): 3 px, 7 px for the hover
  keys, (5, 3, 3, 3) for `tab.background`; scrollbar thumbs use only their texture's middle strip, repeated along
  the bar and stretched across it; keys that are not 9-slices are stretched
  ([CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md#nine-slice-margins-and-scrollbar-thumbs)). `sliceSpec(key)`,
  `skinSlice(tex, key, w, h)` and `nineSlice(tex, w, h, margins, tile)` are the API the skin editor's previews use.
- **Window chrome**: `CHROME` in `render.ts` (title bar 33, no gap under it, content inset 8: +16 wide, +49 tall),
  measured in game ([CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md#window-frame)).
- **Clipping**: everything inside a list or group is clipped to its content area, as the client's scissor clips it
  (images and their placeholders, slider bars, colour pickers, charts, frames, text, draw lists).
- **Draw lists** are drawn as Nuklear draws them: circles of radius w / 2 (8x supersampled), anti-aliased lines and
  polygons, text as one clamped line, `arrayBinds` items once per entry of the longest array.
- **Exact alpha compositing.** A canvas keeps premultiplied 8-bit pixels, so `drawImage` of a partly transparent
  layer rounds twice (one level dark in about a third of pixels). Such layers are composited in software with
  `round((s·a + d·(255−a)) / 255)` (`alphaCompositeInPlace`), as Pillow and the client's float blending do.
- **Skin slices are cached across redraws** (`slicecache.ts`; 20 to 67 % off a redraw, pixel-identical): one cache
  per Skin object, an entry valid only while the skin hands out the same texture object, least recently used out
  above 32 MB per skin.
- **Solved layouts are kept across redraws** (`layout.ts`, `solveContent`; exact to the bit): per element object, then
  path, then size. A layout depends only on the element's JSON subtree, its path and the size it is given (not on
  binds, skin or fonts), and an edit never changes a JSON object in place, so an edited element is a new object and
  an unchanged one is solved once; undo hands back the old objects and finds their solves. Each element and path
  keeps one solver built but never given a size, and solves each size on a copy of it (`Solver.clone`): a copy
  does exactly what a solver built for that size does, while re-suggesting a size on one solver lands on another of
  several equally good solutions now and then (`tests/layout.test.ts` checks both). Eight sizes per element and
  path, least recently used out; a WeakMap, so the entries go with the documents.
- **The screen canvas and its background are reused** (`view.ts`): the background gradient is drawn once per canvas
  size and copied (it is opaque, so the copy leaves exactly what drawing it does), and the 1440 x 900 canvas a
  cropped redraw draws on goes back for the next one.
- **Which way up images are drawn.** A DDS is drawn **bottom row first** (`decodeDds`; `decodeStored` keeps the
  stored order), checked in game with `NuiImage` on two DDS-only portraits, one stored each way. Draw-list images and
  standard `DDS ` files are flipped the same way (inferred: [Open questions](#open-questions)). A TGA's
  top-left-origin flag (descriptor bit 5) is honoured, as Pillow does; whether NUI does is unproven.

## Resources

- **Readers written here**: KEY/BIF (V1), ERF/HAK/MOD (V1.0, V1.1), TGA (all types, RLE, both origins), DDS
  (BioWare's header and the standard one; DXT1, DXT3, DXT5, uncompressed) and TOML. PNG, JPEG and GIF are decoded by
  the platform.
- **The client's order**: haks (the first listed wins), loose override files, the game's `ovr/`, its texture packs,
  its keys. Images use the client's lookup (`dds > jpg > tga > png > gif > wbm`, whichever layer each is in;
  [CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md#images)).
- **Everything is read through `ByteSource.read(offset, length)` and a `FileTree`**, so a 1 GB hak costs a few KB
  until something in it is drawn. A hak is checked as readable by reading one byte (`checkReadable`), never whole
  (a 562 MB hak is past Node's string limit).

## Window editor

- **The document** (`edit/project.ts`) is the window's JSON plus sample bind values, panes, notes and export
  settings. An element is addressed by its **path**, the child indices from the root (a list's children are its
  template cells).
- **Every edit is a pure function** (`tree.ts`, `ops.ts`) copying only the objects on the path, so unknown keys
  survive (tested), undo is a stack of documents (`history.ts`; typing in one field within a second is one step;
  samples, notes, name and export settings undo too), and a map from object to path (`pathIndex`) is all the canvas
  needs for hit testing and drop targets (`drop.ts`, pure geometry). The selection is a list of paths outside the
  history (`selection.ts`), the first picked first: the **key** element, which Match size and Align measure against,
  as in design tools. After an undo, paths that no longer exist drop out; with none left, the key's nearest ancestor.
- **Align and distribute change sizes, never positions** (`arrange.ts`). NUI has no free x and y: a row places its
  children one after another, and the solver settles every position. So Match size sets `width` / `height` (required);
  Align moves an element through the spacer before it in its row (the column for top / middle / bottom), resizing it
  or inserting one (margin 0: a spacer of d moves what follows by exactly d), climbing to the column or group the
  element is in when that is what the row places; Distribute sets equal sizes or sizes the spacers between. Each
  result is **measured by laying the window out again as the canvas does** (`view.ts` `layoutView`: the renderer's
  dry pass, same outlines and problems, no drawing) and adjusted until the edges land within 0.001 px, at most 12
  rounds: a row with unsized elements shares its room out again after every change, which a fixed formula would get
  wrong. A result the client would refuse (an "unsolvable" problem that was not there before) or that does not settle
  is refused whole with the reason, and the document stays as it was. Cases that need no layout to refuse (two
  elements side by side in one row, nothing that places an element along the axis, different parents for Distribute)
  are found before measuring, so the panel can grey the tool and say why in its tooltip. The tools measure at UI scale
  1, the designer's layout scale (the canvas scales the finished picture).
- **Several selected**: Delete, duplicate, move up / down and Alt+arrow sizes act on each selected element (a selected
  container takes its selected content along), one undo step; copy, paste, wrap and unwrap stay single-element and say
  so. The properties panel shows the catalog properties all of them have (ids left out: they must stay unique), a
  value they do not share as mixed; a set goes to all of them in one step.
- **What can be bound: exactly what NUI binds.** `nw_inc_nui.nss` takes plain `float`s for width, height, aspect,
  margin, padding and row height, and plain `int`s for a text's border, scrollbars, a text edit's length and flags,
  direction, draw-list order, render condition and array-bind flag; the client never resolves a bind there. So the
  catalog marks a property bindable exactly where `nw_inc_nui.nss` documents `Bind:...`, the panel offers the bind
  button only there, and the validator reports any other bind. Switching static ↔ bound keeps what is drawn (the
  value becomes the bind's sample, and back).
- **The catalog** (`catalog.ts`): one entry per element type `nw_inc_nui.nss` makes, with its palette default, its
  container rule and every property with its kind and builder parameter type (the exports use it). **Group** comes
  with a column in it (a group holds one child, and an empty one could take nothing dropped on it); **Drawing** is
  `NuiDrawList(NuiSpacer())`. Drops follow NUI: rows and columns take anything, a group one child, a list's template
  up to 16 cells and never another list.
- **Resizing on the canvas** (`resize.ts`): NUI sizes are required constraints, so a dragged size must land on the
  grid: the size (not the pointer) snaps to the grid step, after turning screen pixels into layout units. A drag
  writes exactly what the properties panel writes (`width` / `height`, `geometry`, or that bind's sample when
  geometry is bound). The layout re-solves live (`preview` in `history.ts`) and the drag is one undo step. Impossible
  sizes are not prevented: that is the problems list's job. The drawing is centred, so the window's drag counts double
  to keep its edge under the pointer.
- **Dialogs** are one component, `Modal.tsx`, a native `<dialog>` with `showModal()` (focus trap and return for free).
  Toasts go inside the open dialog, or they would sit under its backdrop.
- **Files.** A project is `{"format": "nwn-nui-designer/project", "version": 1, ...}` (`<name>.nuidesign.json`).
  Save uses the File System Access API where there is one, else a download. The autosave (IndexedDB, one slot) wraps
  every access, so blocked storage only loses the autosave.
- **Framework windows** (a dump with a `profiles.default`, as Layonara's NUI framework writes) are drawn with the
  profile's binds under the dump's (`view.ts`).

## Problems and house style

There is **one problem list** (`src/core/edit/lint.ts`): the client checks (`validate.ts`), the chosen style rules,
and the renderer's problems told through `editorProblems` (`issues.ts`), worst first. The Problems panel and
`pnpm check` both call it, so a new check reaches both or neither. The renderer's own list stays as nui-preview
reports it, because the golden compares it; the editor's changes sit on top:

- **Client checks** (`validate.ts`): types and ranges, enums, colours (0 to 255), resrefs of 16 characters, binds
  where none can be, a group's one child, a list's cells, `AUTO` scrollbars on a list, fonts the skin lacks,
  duplicate ids (outside list rows), keys the client does not read, combos with no entries, and a combo with a
  tooltip (an error: the tooltip closes its open list, [CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md#combo-boxes)). Keys people reach for that NUI cannot apply get a
  warning saying what to do instead ([CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md#what-nui-cannot-style)); other
  unknown keys are notes, grouped into one row.
- **An unsolvable window is one entry**: the static "unsolvable size" (why: the span and the sizes that do not fit)
  with the solver's refused element added to its text, when one path is inside the other (`foldUnsolvable`). A solver
  problem no static one explains still shows on its own. "unsolvable size" is the port of nwn-module's
  `nui_i_check` (`render/check.ts`).
- **An empty text box bound with no sample value** is "no sample value for bind X" (a note), not "wasted room".
- **A window whose geometry the game sets** (none in the dump, or a geometry bind with no sample) gets one note,
  "give it a sample value", and no layout problems at the default 400 x 300. A plain window with no geometry is
  still an error.
- **Identical notes are grouped** (`groupIssues`): one source, kind and severity whose text differs only in numbers
  and quoted parts is one row ("40 places") that opens to the elements; canvas markers stay per element.
- **Tooltip off screen is an error** (`Renderer.tooltips`), because the client never wraps or clamps a tooltip
  ([CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md#tooltips)): the popup (text width in the element's font + 16) is
  placed with the mouse at the element's left edge, for `tooltip` and `disabled_tooltip` whatever the element's
  current state, since both change at runtime. Fallback-glyph characters (`"\n"`, past ASCII) are measured as `?`.

**House style is optional and off by default** (`style.ts`): a rule set is a list of checks with ids, titles and a
one-line summary; each can be turned off, and a rule can list windows it skips (`StyleRule.exempt`, by document name
or the window's `id`). A rule set can also declare the window keys its framework adds (`knownWindowKeys`), so the
client check stops calling them unknown. Style rules check the JSON only.

**A house style is a style file** (`styles/*.json`, schema `styles/style.schema.json`, `styles/generic.ts`): most of
a house style is numbers and lists, so the rules are generic and parameterised (a gap list, a row height, a palette,
a tooltip length...) and a style file picks the ones it wants with their numbers, severity and exemptions. Rules a
number cannot say go in an optional JS module the file names (`plugin`), whose default export adds `StyleRule`s; it
gets the rule writers' helpers as its argument (`PLUGIN_API`), so it needs no imports and runs the same in Node and in
the browser. The editor and `pnpm check` build a style from the same parsed JSON (`parseStyleDef`): `pnpm check`
reads the files named by `styles` (`src/node/styles.ts`), the editor gets their JSON from the local API
(`LocalState.styles`) and fetches a plugin through the file API's `style:N` root, the style file's folder, with the
same confinement as every other root. A plugin runs with the user's rights, like any plugin.

**One rule set ships as an example: Layonara (example)** (`styles/layonara.json`, built in through
`src/core/edit/styles/layonara.ts`), a real server's house style, to copy and adapt; it needs no plugin. It was a
TypeScript rule set until the style files came; `tests/styles.test.ts` checks the file finds exactly what that code
found (`tests/layonara.legacy.ts`). It restates, in its own words, what can be checked from the JSON in that server's (non-public) style
guide: fixed size, at most 1000 x 720 of content, geometry = footprint + the frame (+16 / +49, +16 / +16 with no
title bar), gaps of 8 or 16, 36 px control rows, list rows of 32+, disabled controls with a disabled tooltip, short
one-line tooltips (≤ 60 characters), no help paragraphs, Close 120 wide and last, drawn progress bars,
the house colours, 8 px a character for bound text, no Refresh button. What each rule skips (tile rows, footer
fillers, static text the layout already measures, drawn art, a window it exempts) is in `generic.ts`' comments and
`tests/rules.test.ts`. Headings and drawn-text sizes are guide-only: the JSON cannot tell a heading from other
labels.

## Export: `.jui` and NWScript

### What `NuiCreateFromResRef` loads

From `nwscript.nss`, `nw_inc_nui.nss` and the 8193.37-17 binaries
(`CNWSMessage::SendServerToPlayerNui_CreateClient`, `CNWCMessage::HandleServerToPlayerNuiEvent`):

- **Resource type 2083** (`RESTYPE_JUI`).
- **The server sends only the resref**; the client looks it up in **its own** resman, so the file must reach the
  player: a hak, NWSync, or their override.
- **It is the window's JSON**, parsed like `NuiCreate`'s: copied into a string, measured with `strlen` (nothing after
  a NUL counts), parsed with nlohmann::json `strict = true` (one value, nothing after it but whitespace), comments
  off. So: UTF-8 text of exactly what `NuiWindow` returns, with `"version": 1`.
- **Binds and ids carry over; bind values do not**: the script sets them with `NuiSetBind` after
  `NuiCreateFromResRef` returns the token. The window id is its `sWindowId`.
- The client reads an int or a float into a float alike; `jui.ts` still writes a float where the builder makes one,
  so a `.jui` reads like the JSON a script would build.

### The NWScript export

`nwscript.ts` writes each element as its builder and its modifiers in a fixed order, enums as their constants, binds
and ids as named string constants, and a long element as statements. Whatever the builders do not reproduce exactly
(framework keys, hand-made JSON) is fixed with `JsonObjectSet` / `JsonObjectDel`, so the result is the window's JSON
**exactly, whatever made it**. A container of more than 40 elements gets a function of its own. Strings are written
in cp1252 (`\xNN`; a character cp1252 lacks becomes `?`, as the game would draw it). The optional skeleton opens the
window with the script as its event script, sets the samples, and has empty click and watch branches.

Proof, in three steps:

1. **Its own evaluation** (`evalProgram`, the builders' semantics as `nw_inc_nui.nss` implements them) rebuilds every
   fixture, local dump and palette element exactly (`tests/export.test.ts`).
2. **The compiler** (`nwn_script_comp` 2.3.2 with the game's `nw_inc_nui.nss`) compiles each, as a script and as an
   include.
3. **The game** (`pnpm nss:server`, not in `pnpm test`): each script runs on a game server; all 40 windows tried
   built the `.jui`'s JSON. Run it again when the generator changes.

The compiler **parses a float literal truncated, not rounded** (`0.05` → 0x3D4CCCCC, not 0x3D4CCCCD), so the game's
number can be one float32 step below the `.jui`'s. The comparison counts that as equal (`sameFloat32`): the game's
own compiler cannot write it closer and the client cannot tell. Writing literals that truncate to the rounded float
would make the code harder to read for no visible gain.

**Round trip**: every window exported as a `.jui` and read back is the same model (every key, in order), binds,
layout, problems and pixels (`tests/export.test.ts`; `pnpm roundtrip` with a game).

## Skin editor

**A mode beside the window editor** (the toolbar's Window | Skin switch). It starts from a built-in skin, the game's,
a skin in a hak or ERF, loose files, or a saved skin project (`.nuiskin.json`). One toolbar select says what the
window editor's canvas draws with (the game's skin, a built-in one, or the skin being edited, the default once a skin
is open; its problems then check fonts against it), and the skin editor's left panel names the skin being edited and
whether the window editor draws with it, so the two never seem to disagree. Every edit is one undo step.

- **The key model** (`src/core/skin/keys.ts`): every key the client reads, in its order, with type, default, group
  and a note. Margins come from `render/slice.ts`; a test keeps the two lists of 9-slice keys equal, and another keeps
  `tools/open-skin/skin_keys.py` (the research copy) equal.
- **Per value type** (`KeyEditor.tsx`): a 9-slice image is shown with the key's margins over it and at three sizes
  through `skinSlice`, and warns when the art reaches deeper than the margin (`artDepth`), because that part
  stretches. Uploads become 32-bit TGAs, since the client's lookup ranks TGA above PNG.
- **The checker** (`skin/check.ts`) checks what the client does with each key ([CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md#odd-files-code)):
  besides the README's list, a `#RRGGBB` without alpha (`nk_rgba_hex` reads garbage), an int written as a float (the
  value's text decides), fractional oversampling, an ignored `pixel_height`, a font name used twice.
- **`nui_skin.tml` is kept as text** (`tmldoc.ts`): a changed value is replaced in its line and keeps its comment; a
  new key goes next to its siblings, written as they are (dotted or not); `[[fonts]]` blocks keep their comments; an
  unedited file is written back byte for byte. A new file uses the generator's layout.
- **Fonts**: the panel shows each font in the client's text model, its coverage of the code page the client bakes
  (cp1252, cp1250 or cp1251), an atlas estimate (`fontinfo.ts`: Nuklear's baker's boxes, a skyline packer) and its
  widths against `fnt_maintext` with a game.
- **The generator is TypeScript** (`src/core/skin/gen/`), a byte-for-byte port of the first Python generator:
  `pil.ts` reproduces the Pillow 13.0 drawing operations it used (with Draw.c's float32 scan lines), `mt.ts` is
  MT19937 seeded as CPython seeds `random.Random(int)`, and `tgawrite.ts` lays TGAs out as Pillow does. All 98
  textures of the three presets matched the Python output. The Python generator was removed, because two
  implementations of the same pixels would drift unnoticed, and the TypeScript one runs in the browser, in
  `pnpm test` and on the CLI with no Python. What Python proved is pinned: the committed TGAs are compared byte for
  byte on every test run, two presets' sha256 from the Python run are in the test, and `build_hak.py` runs from git
  (`e38d1ca`) to compare the hak when Python is there. Regenerating every texture takes about 110 ms, so the Generator
  panel redraws live.
- **Five built-in skins** (`themes.ts`): Ink and brass (default), Bronze, and the steampunk Brass and soot,
  Verdigris and paper, and Oxblood and rivets. Each folder in `assets/skin/` is a complete skin and a hak on its own
  (so JetBrains Mono is committed five times); the haks are built on demand, not committed. What they are and why:
  [docs/OPEN-SKIN.md](docs/OPEN-SKIN.md).
- **Export: only what the user brought** (`planExport`): the `.tml`; the user's own files it names (for a texture, the
  format the client would pick); own textures and fonts it does not name (a texture under a game name replaces the
  game's); each OFL font's licence; a licence note (`nuid_skin_lic.txt`) saying whose terms each file is under.
  Whatever only the game has is **left out and listed**, so nothing of Beamdog's can be in an export. Formats: a hak or
  ERF (`erfwrite.ts`: the same bytes as `build_hak.py`, read back by `nwn_erf` byte for byte), a zip of loose files,
  the `.tml` alone, or the skin project.
- **Round trips** (`pnpm skin:roundtrip`): each skin exported as a hak and read back has the same `.tml` text,
  values, own files and pictures (a window and the widget sheet, every pixel). The game's skin exports with 0 own
  files.

## Local settings and the local API

Everyone runs the designer locally (`pnpm dev`, the CLIs), not as a hosted site. So the local Node side reads the
disk for the page, instead of browser folder pickers that list every file of an install and forget it on reload.

- **One settings file, `nui-designer.ini`** ([README](README.md#settings-nui-designerini)). INI because NWN players
  already edit it, and it is small enough to read and write without a dependency (`src/node/settings.ts`). Comments
  are whole-line only (`#` and `;` are legal in paths). The writer replaces each key's first line in place and keeps
  comments, sections and unknown keys, so a hand-edited file survives the dialog's Save.
- **Install detection** (`src/node/detect.ts`) runs only for the editor, only when no `game` is set: Steam (its
  folders, Flatpak and Snap on Linux, every library in `libraryfolders.vdf`), GOG (Linux's `game/`, the macOS app
  bundle's `Contents/Resources/game`) and the Beamdog client, each checked with `isGameDir`. The first found is used
  unsaved. **The CLIs do not detect**: a golden run or test must not change with what is installed.
- **Files reach the browser as a file list, then HTTP Range reads.** The server sends the install's `data/`,
  `data/txpk/` and `ovr/` files with their sizes, the haks in module order and the override folders' files; the
  browser wraps each in an `HttpSource` whose reads are Range requests to `/api/local/file`. So `openResourceSet` and
  every container stay exactly as they are for a picked folder, and a BIF never crosses whole. (A server answering per
  resource would have meant a second resource stack.)
- **The API is a Vite plugin** over a plain handler (`localApi`), so the browser tests mount the same handler. It
  answers only a loopback peer with a localhost `Host` (no DNS rebinding), takes settings only as JSON from its own
  origin (so no other site can send them without a CORS preflight), refuses a bad folder with a 200 and
  `saved: false` (not a red network error), and serves a file only when its real path, symlinks followed, is inside a
  configured folder.
- On start the editor asks for the state first, so a configured game draws from the first frame. **The browser
  pickers stay as the fallback** when there is no local API (the static `dist/` elsewhere).

## The check command

`pnpm check` lists exactly what the Problems panel lists (`lint.ts`), so a module's CI can lint its NUI windows the
way the designer does.

- It draws each window as the editor does (1440 x 900, the `nuklear` text model, the dump's binds over the framework
  profile's), so the layout checks see the editor's rectangles.
- Resources come from the same loader as `pnpm render` (`cliResources`, `node/setup.ts`), and it prints what it used.
  Without a game it runs with the built-in skin and says which checks that makes approximate (`NEEDS_GAME`: those
  that measure text, missing images, font names).
- Rows are grouped as in the panel: one GitHub annotation per row, so one rule does not use up GitHub's per-step
  annotation limit.
- Exit 1 at or above `--fail-on` (default `error`), 2 for a bad option. A file that is not a window is an error of
  that file, not a crash.
- Paths are the caller's: pnpm runs scripts in the package folder, so they are resolved against `INIT_CWD`.

## Fidelity

### The golden check

`pnpm golden` (`golden/run.ts`, `golden/py_export.py`) draws windows with this code and with nui-preview and compares
every rectangle, the problems, the font metrics and the pixels; `pnpm golden:layout` fuzzes the layout. How to run
it, and what it needs: [CONTRIBUTING.md](CONTRIBUTING.md#the-golden-check). Results go to `.golden-out/summary.md`.
It loads haks only with a hak order, and takes it from the reference checkout's `origin/ee` by default
(`findModuleIfo`, `golden/reference.ts`), so both sides always load the same haks.

Last full run (32 real windows with their 56 haks, and the 7 fixtures, after nwn-module #1121, before this
designer read the spacer's margin and the window keys from the client): every rectangle identical; pixels differing
by more than 32 at most 0.885 % (draw-list fixtures; every real window at most 0.255 %); font advances identical;
problems identical. What differs: glyph edges (opentype.js through this rasteriser against FreeType), 1 px draw-list
lines (anti-aliased here, aliased in Pillow), and draw-list curves, arcs and pie slices nui-preview does not draw.

Since then the designer follows the client where nui-preview does not yet (until nui-preview is updated, the golden
shows these): **a spacer, a tabbar and options have margin 0** (rows holding one move by up to 4 px, 8 in the
draw-list fixtures with two spacers; 22 windows), and **geometry below 0 other than -1, -2 and -3 clamps to 0**
instead of centring (`achvtoast`, y = -400; `cust`, x = -411). The window keys (collapse button, border on a
transparent window, title bar) change no compared window. `pnpm golden:layout` gives spacers their margin
explicitly, so it still compares the two solvers on the same constraints.

### Checked against the client

A screenshot of a 106-element deity window in game (8193.37-17, a macOS Retina capture at a fitted scale of 1.800,
not committed: it shows Beamdog's and a server's art) was compared with the designer's render scaled onto it, by
sub-pixel cross-correlation of profiles and patches; single edges are good to about ±0.3 px. It settled the window
frame (+16 / +49, no gap under the title bar), the Nuklear text model (x-height 6.11 in game, 6.16 Nuklear, 6.98 em;
word starts within 0.26 px on average), the text box's wrap width and first line, the thumb's inset and ridges, and
the button frames' rims. All 13 paragraph lines break at the game's words. The right pane sat 4.0 px right of the
game's: a spacer has no margin in the client, and with that the designer moves it exactly 4 px left. One difference
is open ([GAPS.md](docs/GAPS.md#found-in-game)). The facts are in
[CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md), marked [measured].

A module's windows were also shot in game at 1:1 (GUI scale 1.0, not committed for the same reason) and each shot
compared pixel by pixel with the designer's picture of the same JSON, text masked and checked by place and size. The
facts it settled are marked [compared], and `tests/client-behaviour.test.ts` holds each one the fallback skin can show,
on a small window.

## Open questions

1. **niv's gist** (`nuilayout.cpp`) states no licence. nui-preview, and through it this port, follow its set of
   constraints, their order and strengths; no code text is copied. Its author has been asked. Settle before the
   repository goes public.
2. **nui-preview's future**: fix its remaining differences upstream in nwn-module, or retire it in favour of this
   (`pnpm render` already does what `nui_preview.py` does, minus building the dumps).
3. **Does NUI honour a TGA's top-left-origin flag?** The designer and nui-preview do; the engine ignores it for model
   textures (nwn-haks 12e3d85a81). If NUI ignores it too, both draw every flagged TGA upside down. No TGA-only
   portrait has the flag, so it needs a flagged TGA-only resref in an `NuiImage` on a test server.
4. **Draw-list images and DDS**: flipped as `NuiImage`'s are (inferred). A DDS-only resref in `NuiDrawListImage` on a
   test server would prove it.
5. **Bindable sizes as a design aid**: NUI cannot bind sizes, margins, padding or row height, and the editor follows
   NUI. A "bound size" picked from a named constant would be a feature of its own.
6. **Where `.jui` files should live** for a module (a hak of their own, the NWSync manifest, or not at all: the
   NWScript export builds the same window without shipping anything).
