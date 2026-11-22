# nwn-nui-designer

[![CI](https://github.com/plenarius/nwn-nui-designer/actions/workflows/ci.yml/badge.svg)](https://github.com/plenarius/nwn-nui-designer/actions/workflows/ci.yml)

A visual designer for Neverwinter Nights: Enhanced Edition **NUI** windows: the JSON windows a script opens with
`NuiCreate` or `NuiCreateFromResRef` (not the older `.gui` files).

- **Window editor.** Build a window from every element `nw_inc_nui.nss` can make. It is laid out and drawn the way
  the NWN:EE client (build 8193.37-17) does it, and its problems are listed as you work. Export it as a `.jui` or as
  NWScript that builds the same window.
- **Skin and font editor.** Restyle every NUI window of a module through `nui_skin.tml`: frames, buttons,
  scrollbars, colours and fonts. Every key is checked as the client reads it. Export the skin as a hak.
- **Command line.** The same code runs in Node: draw windows to PNG, check windows in CI (the Problems panel's
  list, as GitHub annotations), check a skin, pack a hak.

It runs in your browser, served by a small local server (`pnpm dev`) that reads your game and hak files where they
are. Nothing is uploaded.

![The window editor: the element palette and tree on the left, a furniture-arranging window drawn with the built-in Ink
and brass skin in the middle, the selected button's properties and binds on the right](docs/screenshots/editor.png)

*The window editor with a real server's window (Layonara's furniture window), drawn with the built-in Ink and brass
skin.*

This is an independent project. It is not made or endorsed by Beamdog, and it contains no Beamdog game files.

## Contents

- [Quick start](#quick-start)
- [Use your own game for the exact look](#use-your-own-game-for-the-exact-look)
- [Design a window](#design-a-window)
- [Export: .jui, NWScript, project](#export-jui-nwscript-project)
- [Edit a skin and its fonts](#edit-a-skin-and-its-fonts)
- [The built-in skins](#the-built-in-skins)
- [Command line](#command-line)
- [Export a full theme: the original GUI too](#export-a-full-theme-the-original-gui-too)
- [Mobile clients](#mobile-clients)
- [How close to the client](#how-close-to-the-client)
- [Known limits](#known-limits)
- [Contributing](#contributing)
- [Credits and licences](#credits-and-licences)

## Quick start

You need [Node.js](https://nodejs.org/) 24 and pnpm (run `corepack enable` once to get it).

```bash
git clone https://github.com/plenarius/nwn-nui-designer.git
cd nwn-nui-designer
pnpm install
pnpm dev            # the editor at http://localhost:5173
```

Pick **New window**, open a file, or start from one of the samples. If you have NWN:EE installed through Steam, GOG
or the Beamdog client, the editor finds it and draws with the game's own skin; without a game it draws with its own
open skin, so it works on a machine without the game.

### Settings: `nui-designer.ini`

Optional. Copy `nui-designer.example.ini` (commented) to `nui-designer.ini` in the repository root, or just run the
editor: the **Game and haks** dialog finds your install and writes the file when you save. It is ignored by git. The
editor and every command read it.

| Key | What |
|---|---|
| `game` | The NWN:EE install: the folder with `data/nwn_base.key` and `ovr/` |
| `hak_dir` | The folder with your module's `.hak` files (default: the game's user folder's `hak/`) |
| `module_ifo` | The hak order (the first hak wins), from the module's `module.ifo` (binary, in a module folder), its packed `.mod`, or a [nasher](https://github.com/squattingmonk/nasher) `module.ifo.json`; told apart by content |
| `haks` | Or the hak order by name, best first (`module_ifo` wins when both are set) |
| `overrides` | Folders of loose files, searched after the haks |
| `windows` | A folder of window files, listed on the start screen |
| `styles` | Style files (`.json`) or folders of them: [your own house styles](#your-own-house-style) |

`~` is your home folder; relative paths are from the repository root; lists are comma separated or repeated lines;
quote a value with a comma. The environment beats the file: `NWN_ROOT` (game), `NWN_HAK_DIR` (hak folder),
`NWN_MODULE_IFO` (hak order), `NUI_DESIGNER_STYLES` (styles, several separated as in `PATH`); `NUI_DESIGNER_INI`
names another settings file.

`pnpm build` writes a static site to `dist/` (`pnpm preview` serves it with the local server). Opened from any other
web server, it has no local server: you then pick your folders in the browser instead (below).

## Use your own game for the exact look

The built-in skins only resemble the game's. For the real look, the editor uses your game install. With `pnpm dev`
it looks in the usual places: Steam (with its extra library folders), GOG and the Beamdog client, on Linux, Windows
and macOS. Click the **folder button** in the toolbar (**Game and haks**) to see or change what it uses:

1. **Install**: the installs it found, or **Custom path…**: the folder that holds `data/` (with `nwn_base.key`) and
   `ovr/`. On Steam this is usually `steamapps/common/Neverwinter Nights`. A folder that is not an install is refused
   with the reason.
2. **Hak folder** (default: the game's user folder, `~/.local/share/Neverwinter Nights/hak` on Linux,
   `Documents/Neverwinter Nights/hak` on Windows, wherever Documents was moved, and macOS) and **Hak order**: the
   module's `module.ifo`, its `.mod`, a [nasher](https://github.com/squattingmonk/nasher)-style `module.ifo.json`,
   or the haks picked from the folder one by one. The haks are listed in module order (the first wins); haks the
   module lists but the folder lacks are marked.
3. **Override folders**: folders of loose files, such as `override/` or `development/` (a newer `nui_skin.tml`, its
   textures and fonts).
4. **Windows**: a folder of your window files (your module's windows, or a folder of nui-preview dumps), listed on
   the start screen and in the [window switcher](#switch-windows) to open with a click.

**Save to nui-designer.ini** keeps them for the next start, when they load with no clicks. The editor then uses the
game's skin, fonts and textures, with your haks on top, in the same order the client searches them. The **Drawn
with** select in the toolbar switches between the game's skin and the built-in skins.

The files never leave your computer: the local server (only reachable from this computer) hands the page the parts
of them it draws, and only from the folders you configured.

**Without the local server** (the static build on another web server), the dialog offers the browser's pickers
instead: **Pick NWN folder…**, **Add haks…**, **Order by module.ifo…** (a `module.ifo`, `.mod` or
`module.ifo.json`) and **Add loose files…**. Your browser may ask whether to "upload" the folder; that is its word for
letting the page read it, and nothing is sent anywhere.
These choices are forgotten on reload. Chromium browsers (Chrome, Edge) read only the folders they need; Firefox and
Safari list every file of the install first, which is slow on a large install.

## Design a window

The window editor has five areas:

- **Elements** (top left): every element type. Drag one onto the canvas or the tree, or click it to add it at the
  selection.
- **Tree** (left): the window's elements. Drag to reorder or re-nest. Right-click for duplicate, copy, paste, wrap
  in a row, column or group, unwrap and delete. Problems are marked. Ctrl+click and Shift+click select several
  ([Select several, align and distribute](#select-several-align-and-distribute)).
- **Canvas** (middle): the window as the client draws it, on the screen size and UI scale chosen in the toolbar.
  Click to select (the margin shows orange, the padding green). Drag a widget, group or list to move it; a drag
  from a row's or column's background or a spacer draws a selection box instead (move those in the tree). Ctrl+wheel
  zooms. At 100 %, 200 % and 300 % (and 150 % on a 2× display) each game pixel is a whole number of screen pixels and
  shows sharp; zooms between are smoothed. Fit picks the largest whole zoom that fits, or less than 100 % for a window bigger than
  the stage.
  **Resize** with the handles on the selection's right edge, bottom edge and corner, or on the window's when nothing
  is selected. Sizes snap to the toolbar's **Grid** (2, 4 or 8 px; hold Shift for 1 px), the size shows next to the
  pointer, Escape cancels, and the whole drag is one undo step. A drag writes the same width and height as the
  properties panel; double-click a handle to make the size automatic again. From the keyboard, Alt+arrows grow or
  shrink the selection (or the window) by the grid step, Shift+Alt+arrows by 1 px. Sizes the client would refuse
  are not stopped: the problems list reports them.
- **Problems** (under the canvas): clipped text, overflow, sizes the client refuses, tooltips that run off the screen
  (the client draws a tooltip on one line and never wraps it), missing images, wrong types and
  ranges, binds where NUI cannot bind, keys the client ignores, and styling NUI cannot do. Click one to select its
  element.
- **Properties, Binds and Notes** (right):
  - **Properties** lists every property of the selected element. The link button turns a property into a bind
    where NUI allows one. Draw lists, chart series, list cells and the raw JSON have their own editors.
  - **Binds** lists every bind with a sample value, which is what the canvas draws. Presets stress the layout:
    short text, long text, empty, every list full.
  - **Notes** are saved with the project.

The toolbar's **Style** select turns on house style rules (off by default). One style ships, **Layonara
(example)** (`styles/layonara.json`): a real server's house style, to copy and adapt for your own
([DESIGN.md](DESIGN.md#problems-and-house-style) says what it checks). Your own styles, from the `styles` setting,
are listed beside it ([Your own house style](#your-own-house-style)). A style can also declare the window keys its
framework adds, so the client check stops calling them unknown. The Problems panel puts identical notes (one rule saying the same thing of many elements) on one row that
opens to the elements; the canvas still marks each element. Press `?` for the keyboard shortcuts; Escape closes any dialog. Headers and rows that open or fold also
work from the keyboard (Tab, then Enter or Space).

**Files.** Open takes a project, a `.jui`, window JSON (also a quoted `JsonDump` copied from a log), or a
nui-preview dump. You can also drop a file on the page or paste JSON. Save (Ctrl+S) writes a project,
`<name>.nuidesign.json`: the window, the sample values, notes and export settings. In Chromium browsers Save writes
back to the file you opened; elsewhere it downloads a file. The current window is also autosaved in the browser.

### Select several, align and distribute

![The layout fixture with three buttons of three rows selected, their left edges lined up on the key element's (Padded
row, outlined in amber); the properties panel shows the three, the Arrange tools and the properties they
share](docs/screenshots/arrange.png)

**Select several.** Ctrl+click (Cmd+click on a Mac) adds an element to the selection or takes it out, in the tree or on
the canvas. Shift+click selects a range: in the tree, the rows from the first selected to the one clicked; on the
canvas, the siblings between them. On the canvas, a box dragged from an empty place (outside the elements, a row's or
column's background, or a spacer: they draw nothing) selects the widgets, groups and lists drawn fully inside it; with
Ctrl or Shift held it adds them. The first element selected is the **key** (outlined in amber, marked "key" in the
tree): Match size and Align measure against it. Escape clears a selection of several.

With several selected, Delete, Ctrl+D (duplicate), Alt+Page Up / Down (move, for children of one row or column) and
Alt+arrows (each one's size by the grid step) work on all of them, each as one undo step. Copy, paste, wrap and unwrap
work on one element and say so. The properties panel shows the properties they have in common: a value they do not
share shows as *mixed*, and what you set goes to all of them.

**Arrange.** NUI has no free x and y: rows and columns place their children one after another, and the client's layout
solver decides every position. So the tools in the panel's **Arrange** section only change sizes (a `width` or
`height`, or a spacer's), and every result is laid out again exactly as the canvas draws it before it is kept. One
undo step each.

- **Match size**: the same width, height or both, to the largest of them or to the key.
- **Align to key** (Alt+A left edges, Alt+H centres, Alt+D right edges across rows; Alt+W top edges, Alt+V middles,
  Alt+S bottom edges across columns): each element moves through the spacer before it in its row, which is resized
  or, when there is none, inserted (a spacer has margin 0, so it moves what follows by exactly its width). An element
  that sits in a column inside a row moves with that column.
- **Distribute** within one row or column: **equal gaps** (Alt+Shift+H in a row, Alt+Shift+V in a column; the
  spacers between them sized evenly, inserted where there are none) or **equal widths / heights** (each the average,
  so together they take the room they took).

What cannot be done is refused whole, and nothing changes. The message names the elements as you see them (by
their text, else type and id) and says what to do instead. For example: two elements side by side in one row
cannot line up their left edges; an element that would have to move left with no spacer before it (make it the key
instead); a size a column is too narrow for (the client would refuse the window: "the constraint can not be
satisfied"); gaps that cannot be even because something sits between two of the elements; a row whose other elements
have no width of their own, so it shares its room out again after every change (give them a width first). A tool that
cannot run is greyed, and its tooltip says why. Edges land exactly (to 0.001 px) at UI scale 1; at another scale the
client multiplies every size, so they still line up, though each rect is rounded to whole pixels on its own and may
land 1 px apart.

### Switch windows

The open window's name in the toolbar is a button: click it for the window switcher.

![The window switcher open under the window's name in the toolbar: the name to rename the window, the windows folder's
files with their titles, and New window and Open… at the bottom](docs/screenshots/switcher.png)

- **Name** at the top renames the window (the name the exports start from).
- **Recent in this browser**: the windows you opened lately, from anywhere (newest first, up to 12). A window from
  the windows folder, or one opened with Open… in a Chromium browser, opens as the file is now (the browser may ask
  once to read it again); a dropped, imported or pasted window, or a sample, opens the copy the browser kept when you
  opened it.
- **Windows folder** (**This folder** when the open window came from it): every window file in the folder set under
  Windows in **Game and haks** (`windows` in `nui-designer.ini`), by name, with each window's title.
- A search box when the list is long: type any words of a name or title, Enter opens the first match. The arrow
  keys walk the list, Escape closes it.
- **New window** and **Open…** at the bottom.

Like New window, switching asks first when the open window has changes that are not saved to a file
(the autosave keeps only the window that is open). Without the local server (a static build) the switcher lists the
recent windows and Open… only; the browser cannot see the folder a picked file came from.

![A test window with numbered problem markers on its elements, and the Problems panel under it listing clipped text,
non-ASCII text, a missing image, an empty text box and overflow](docs/screenshots/problems.png)

*The Problems panel and its markers on the canvas: each finding names the element, and a click selects it.*

### Your own house style

A house style is a JSON file, no fork needed. Copy [`styles/example.json`](styles/example.json) (every key, with
neutral defaults), give it your `id` and `title`, and list it in `nui-designer.ini`:

```ini
styles = ~/my-module/nui-style.json
; or a folder: every .json in it (not *.schema.json) is a style file
styles = ~/my-module/nui-styles
```

(or `NUI_DESIGNER_STYLES=...`). The editor's Style select lists it after a reload, and `pnpm check --style ID` takes
its id, or the file's path without any setting: `pnpm check --style ./nui-style.json dumps/`. A file that cannot be
used is named with the key that is wrong (`nui-style.json: rules.gaps.allowed: expected a non-empty list of numbers`):
`pnpm check` stops with it, the editor shows it on the Style select's tooltip. A style file with the id of a built-in
style replaces it.

```json
{
  "$schema": "./style.schema.json",
  "id": "mine",
  "title": "My server",
  "knownWindowKeys": ["my_framework_data"],
  "rules": {
    "fixed-size": { "exempt": ["character_sheet"] },
    "gaps": { "allowed": [4, 8, 16] },
    "row-grid": { "height": 32 },
    "tooltip-length": { "max": 80, "severity": "info" },
    "palette": { "colours": [[255, 255, 255], [222, 184, 80]] }
  }
}
```

A rule runs when it is listed under `rules` (`true`, or an object) and not `"enabled": false`. Every rule takes
`enabled`, `severity` (`error`, `warning` or `info`: every note it makes), `exempt` (window names it skips: the form or
document name, or a framework window's `id`), `title` and `summary`. The generic rules and their parameters (the
schema, [`styles/style.schema.json`](styles/style.schema.json), describes each; an editor with JSON Schema support
completes them; sizes are footprints, the size plus the element's margins):

| Rule | Parameters | Checks |
|---|---|---|
| `fixed-size` | | Windows are not resizable |
| `max-content` | `width`, `height` | The content (geometry less the frame) fits |
| `frame` | | Geometry is the root's footprint plus the client's frame: no empty band |
| `gaps` | `allowed` (8, 16), `fillerOver` (32) | Spacers between things are an allowed gap; wider ones are fillers |
| `row-grid` | `height` (36) | Rows of controls have the standard height |
| `control-height` | `allowed` (36) | Controls with a set height have a standard height |
| `margins` | `allowed` (0, 2, 4) | Explicit margins are allowed values |
| `disabled-tip` | | A control that can be disabled has a disabled tooltip |
| `tooltip-length` | `max` (60) | Tooltips are one line of at most `max` characters |
| `no-help-text` | `maxChars` (200) | No long static text paragraphs |
| `list-rows` | `minHeight` (32) | List rows with text are tall enough |
| `close-last` | | The Close button is the last control |
| `close-width` | `width` (120) | The Close button's width |
| `drawn-progress` | `hint` | No `NuiProgress`: draw the bar |
| `palette` | `colours` ([r, g, b]...), `artItems` (16) | Colours come from the palette (drawn art is skipped) |
| `fonts` | `allowed` | Elements' fonts are house fonts |
| `label-budget` | `pxPerChar` (8), `labelPad` (8), `buttonPad` (24) | Bound labels and buttons are wide enough for their sample values |
| `no-refresh` | | No Refresh button |

`pnpm style:schema` rewrites the schema after a rule changes.

**Rules of your own: a plugin.** What a number cannot say goes in a JavaScript module beside the style file (or below
it), named by `"plugin": "my-rules.mjs"`. Its default export is a list of rules, or a function that gets the rule
writers' helpers (`eachElem`, `typeOf`, `valueOf`, `isBound`, `fp`, `isCloseButton`...) and returns one; a rule is
`{ id, title, summary, check(ctx, report) }`, and an entry under `rules` with its id sets its `enabled`, `severity`,
`exempt`, `title` and `summary`. [`styles/example-rules.mjs`](styles/example-rules.mjs) is a small one. **A plugin is
code and runs with your rights**, in `pnpm check` and in the editor (which fetches it from the style file's folder
through the local server), like any plugin: list only style files whose plugins you trust. A rule that throws becomes
an error note of that rule, not a crash.

## Export: .jui, NWScript, project

**Export** (Ctrl+E) offers four formats, each with a preview of the file:

| Format | What you get | Use it with |
|---|---|---|
| `.jui` | The window's JSON, exactly what `NuiWindow` returns | `NuiCreateFromResRef` |
| NWScript | `nw_inc_nui` builder calls that build the same JSON, either as a script with an open, bind and event skeleton or as an include | `NuiCreate` |
| Project | The designer's own file (window, samples, notes) | Opening it again here |
| Dump | nui-preview's format | nui-preview |

![The export dialog: tabs for .jui, NWScript, Project and Dump, the .jui tab open with its resref, window id and the
NuiCreateFromResRef line to use, and the window's JSON on the right](docs/screenshots/export-jui.png)

*`.jui`: the window's JSON, for `NuiCreateFromResRef`. The dialog shows the line of NWScript that opens it.*

![The NWScript tab: script name, prefix and window id on the left, the generated function building the window's
first column with NuiLabel, NuiButton, NuiWidth and NuiBind calls on the right](docs/screenshots/export-nwscript.png)

*NWScript: `nw_inc_nui` builder calls that build the same JSON, for `NuiCreate`, with binds and ids as constants.*

The skin editor has its own export (below): the skin as a `.hak` or `.erf`, loose files for `override/` or
`development/`, `nui_skin.tml` alone, or the skin project.

![The skin export dialog: tabs for .hak, .erf, loose files, nui_skin.tml, project and full theme, and the list of files that go
into the hak with their size and licence](docs/screenshots/export-skin.png)

*The skin export: what goes into the hak, file by file, with each file's licence.*

**What a `.jui` is.** UTF-8 text of the window's JSON, resource type 2083. The server sends only the resref; the
client loads the file from its own resources. So the `.jui` must reach the player: in a hak, through NWSync, or in
their override folder. The client parses it as strict JSON without comments. Binds and ids are part of it; bind
values are not, so set them with `NuiSetBind` after `NuiCreateFromResRef` returns. Details:
[DESIGN.md](DESIGN.md#what-nuicreatefromresref-loads).

**The NWScript export** is checked three ways: the designer evaluates the script and compares the JSON, the
community compiler (`nwn_script_comp`) compiles it, and a game server runs it: every window tried (40) built
exactly the same JSON as the `.jui`. The file is saved in Windows-1252, the encoding the compiler reads.

## Edit a skin and its fonts

![The skin editor on Ink and brass: the keys grouped by widget on the left, the widget-states sheet in the middle
(every widget in its normal, hover and pressed states), the button keys' textures with their 9-slice margins on the
right](docs/screenshots/skin-editor-states.png)

*The skin editor: every key by widget, and the widget-states sheet drawn with the skin being edited.*

Click **Skin** in the toolbar (beside **Window**). Start from a built-in skin, your game's skin (with a game folder),
a skin inside a hak or ERF, loose files (`nui_skin.tml` with its images and fonts), or a saved skin project.
**Open another skin** (under the skin's name, top left) goes back to these choices. The skin editor does not
autosave: if the skin has changes since it was opened, last exported or saved as a project, it asks first ("Discard
your changes to NAME?"). Save it as a project (Export skin, Project) to keep it.

- **Keys** (left), grouped by widget: window, title bar, button, checkbox, option, combo, text edit, scrollbars,
  slider, progress, tree and tab, list and group, selectable, property, context menu, chart. Each key's editor fits
  its type:
  - **9-slice image**: pick a texture or upload a PNG, JPEG or TGA (saved as a 32-bit TGA). It is shown with the
    margins the client uses for that key, and warns when the art reaches past them (that part would stretch).
  - **Image or colour**, **colour** (RGBA), **int**.
- **Checks**: missing keys and the client's default for them; wrong types; keys the client never reads; resrefs
  over 16 characters; missing textures and fonts; two image formats under one name; your PNG that the game's TGA of
  the same name would beat.
- **Preview** (middle): your current window drawn with the edited skin, the **Widget states** sheet (every widget
  in every state), or the selected **Font**.
- **Fonts**: add a `.ttf`, remove and reorder (the first is the default), and set size, oversampling, spacing and
  pixel snap. Each font shows a specimen sized as the client sizes it, its coverage of the code page (the client
  draws `?` for a missing glyph), an estimate of the font atlas, and its widths against the game's font.
- **Generator**: the numbers behind the built-in skins (rim colours, bevel, fills, noise, glow, marks). Every
  texture is redrawn live.

  ![The generator's settings on the right (preset, rim colours, bevel, fills and noise for each part), the window
  drawn with the skin in the middle](docs/screenshots/skin-generator.png)

  *The generator: the numbers behind a built-in skin, applied live to the window.*

  ![The furniture window twice: in Ink and brass, and with the rim and the pressed and selected fill changed to teal
  in the generator](docs/screenshots/skin-generator-change.png)

  *One change in the generator: the rim and accent colours, before and after.*
- **nui_skin.tml**: the file itself. Edits made anywhere keep its comments and key order.
- **Export skin** (Ctrl+E): a `.hak` or `.erf`, a zip of loose files for `override/` or `development/`, the `.tml`
  alone, or the skin project. The dialog lists what goes in and what is left out. Only your own files go in (your
  uploads, generated textures, the `.tml`) with a licence note. **The game's textures and fonts are never put in an
  export**: players already have them. **Full theme** adds the original GUI redrawn to match, from your own game
  ([Export a full theme](#export-a-full-theme-the-original-gui-too)).

## The built-in skins

Five built-in skins, to give you an idea or a starting point. They draw the canvas when no game folder is loaded, and
you can use any of them in your own module or open one in the skin editor and make it yours.

![The same furniture window in the five built-in skins: Ink and brass, Bronze, Brass and soot, Verdigris and paper,
and Oxblood and rivets](docs/screenshots/skins-compare.png)

*The same window in each skin, at 1:1.*

| Skin | Look | Fonts | Folder | Hak |
|---|---|---|---|---|
| **Ink and brass** (default) | Flat dark panels, one thin brass line, amber for pressed and selected | Brawler | `assets/skin/ink/` | `nuid_ink_skin.hak` |
| **Bronze** | Close to the stock look: black panels, a three-line bronze rim | Philosopher Bold | `assets/skin/bronze/` | `nuid_bronze_skin.hak` |
| **Brass and soot** | Soot-black brushed metal in a lit brass pipe, a brass title plate, ember copper | Old Standard TT Bold, Rye | `assets/skin/brass/` | `nuid_brass_skin.hak` |
| **Verdigris and paper** | Aged paper and sepia ink in a verdigris copper pipe, a light skin | Spectral SemiBold, Federant | `assets/skin/verdigris/` | `nuid_verdi_skin.hak` |
| **Oxblood and rivets** | Oxblood leather in a bevelled brass band riveted at the corners | Zilla Slab SemiBold, Cinzel Decorative | `assets/skin/oxblood/` | `nuid_oxbld_skin.hak` |

The second font of the last three is a `display` font for headings (`NuiStyleFont`). All five use JetBrains Mono
2.304 as the monospace font, the same file the game ships. The textures are generated by code in this repository (no
pixel comes from Beamdog's art) and are CC0. The fonts are under the SIL Open Font Licence. Make a hak with
`pnpm skin hak --theme ID` (below) and list it in your module. None of the skins has been checked in the game yet.

The generator's pipes, rivets and brushed, grained and noisy fills are there for your own skins too: start from any
of the five in the skin editor and change its numbers. The research and decisions behind them:
[docs/OPEN-SKIN.md](docs/OPEN-SKIN.md).

## Command line

```bash
pnpm render WINDOW.json [more windows] [options]
```

Draws windows to PNG with the same code as the editor. It takes a `.jui`, window JSON, a nui-preview dump or a
project. It prints each window's problems. It exits with 0 when there are none, 1 when there are any, and 2 (with a
one-line message) for a bad option or a file it cannot read. `pnpm render --help` prints the options.

| Option | Meaning |
|---|---|
| `-o FILE` | Where to write the PNG (default: next to the input). With several windows, a folder (a `.png` name is an error) |
| `--overlay` | Draw element outlines and numbered problems |
| `--crop` | Crop to the window and a 12 px margin |
| `--canvas WxH` | The screen size (default `1440x900`) |
| `--scale N` | Scale the finished picture (default `1`) |
| `--set bind=JSON` | A sample value for a bind (repeat). The `=` is required; a value that is not JSON is taken as text |
| `--binds FILE` | Sample values from a JSON object (repeat) |
| `--game DIR` | The game install (default: `$NWN_ROOT`, else `game` in `nui-designer.ini`). Without a game, a built-in skin draws, and a note says so |
| `--hak FILE` | A hak, first listed wins (repeat) |
| `--hak-dir DIR --module-ifo FILE` | The haks the module lists, from one folder (give both); FILE is a `module.ifo`, a `.mod` or a `module.ifo.json` |
| `--override DIR` | Loose files, searched after the haks (repeat) |
| (none of the above) | Without `--hak` and `--hak-dir`, the haks and override folders `nui-designer.ini` names |
| `--fallback` | Ignore the game's skin: use a built-in skin |
| `--theme ID` | Which built-in skin: `ink` (the default), `bronze`, `brass`, `verdigris` or `oxblood`; any other name is an error |
| `--text-model nuklear\|nui-preview` | How text is measured (default `nuklear`, as the client does) |
| `--json FILE` | Write every element's rectangle and the problems as JSON |
| `--quiet` | Print only the problems |

```bash
pnpm skin ship [--theme ID] [--check]           # rebuild the built-in skins in assets/skin/ (--check: compare only)
pnpm skin hak [--theme ID] [-o FILE] [--erf]
                                                # a built-in skin as a hak (default nuid_ink_skin.hak)
pnpm skin check SKIN.tml [--res DIR]... [--game [DIR]] [--hak FILE]...
                                                # check every key the client reads, and the files it names
pnpm skin sheet [DIR] [--game [DIR]] [--theme ID] [-o widgets.png] [--title TEXT]
                                                # the widget-states sheet of a skin folder (no DIR: the game's skin)
pnpm skin preset d-iron -o DIR                  # a generator preset's files (not shipped)
pnpm export-theme SKIN -o DIR [--out-hak NAME] [--prefix P [--prefix-hak NAME]] [--game DIR] [--no-haks]
                                                # the full theme: the NUI skin and the original GUI (needs the game)
pnpm old-gui inventory -o DIR [--game DIR]      # every texture the original GUI draws, with its role (needs the game)
pnpm old-gui check DIR [--theme DIR]            # check a theme of the original GUI against it (no game needed)
```

Examples:

```bash
pnpm render fixtures/widgets.jui --fallback --crop -o widgets.png
NWN_ROOT=~/games/nwn pnpm render my_window.jui --overlay --set title='"Hello"'
pnpm skin check assets/skin/ink/nui_skin.tml --res assets/skin/ink
SOURCE_DATE_EPOCH=1763251200 pnpm skin hak --theme bronze -o nuid_bronze_skin.hak   # a reproducible hak
```

`--game` without a folder means the game at `$NWN_ROOT` (else the one `nui-designer.ini` names). The command line
does not search for installs: it uses only a game it was given, so a test or a render does not change with what is
installed. An unknown `--theme` is an error. `pnpm skin check` exits
with 1 when the skin has errors; every `pnpm skin` command exits with 2 (and a one-line message) for a bad option or a
file it cannot read. A hak's name must be at most 16 characters.

### Check windows (for CI)

```bash
pnpm check [--style ID|FILE] [--mobile] [--client CLIENT] [--fail-on error|warning|info] [--format text|json|github] FILES_OR_FOLDERS...
```

![A terminal: pnpm check on a clean window ("no problems found", exit 0), then on a window with nine warnings run
with --fail-on warning (each warning listed with its element, exit 1)](docs/screenshots/check.png)

*`pnpm check` without a game: a clean window passes; with `--fail-on warning`, a window with warnings fails.*

Lists, for each window, exactly what the editor's Problems panel lists: the client checks (types, ranges, binds,
unknown keys, fonts, empty combos, a tooltip on a combo), the layout's problems (clipped text, overflow, sizes the client refuses, tooltips off the
screen, missing images) and,
with `--style`, the house style rules, with identical notes grouped as in the panel. A folder is searched, with its
subfolders, for `.jui` and `.json` files (windows, nui-preview dumps, projects). A file that is not a window is
reported as an error of that file. It exits with 1 when anything at or above `--fail-on` (default `error`) is found,
0 when not, and 2 for a bad option. Paths are taken from the folder you ran pnpm in, so
`pnpm -C path/to/nwn-nui-designer check dumps/` works from another checkout. `pnpm check --help` prints the options.

| Option | Meaning |
|---|---|
| `--style ID\|FILE` | A house style: a built-in one (`layonara`), the id of a style file from the `styles` setting, or a style file's path ([Your own house style](#your-own-house-style)); default none, as in the editor |
| `--disable-rule ID` | Turn one of its rules off, or a mobile rule (repeat) |
| `--mobile` | Also run the [mobile checks](docs/MOBILE.md#checks) |
| `--client CLIENT`, `--ui-scale S` | Lay the windows out as `desktop` (default), `ios2`, `ios3` (iOS at density 2 or 3) or `android`, at GUI scale `S` (default 1), as the editor's Client preview; any but `desktop` turns `--mobile` on |
| `--fail-on LEVEL` | `error` (default), `warning` or `info` |
| `--format FORMAT` | `text` (default); `json`, one object on stdout with every issue; `github`, a GitHub Actions annotation per row on the window's file, the text report in a folded group, and a summary table in `$GITHUB_STEP_SUMMARY` |
| `--canvas WxH`, `--text-model` | As for `pnpm render` (default `1440x900`, `nuklear`) |
| `--game`, `--hak`, `--hak-dir --module-ifo`, `--override`, `--fallback`, `--theme` | The resources, as for `pnpm render` (default: `$NWN_ROOT`, `NWN_HAK_DIR`, `NWN_MODULE_IFO`, else `nui-designer.ini`) |

It starts by saying what it used: the game and where the skin came from, how many haks from which folder in which
order (and any the order lists that the folder lacks), the override folders and the style. **Without a game** it
still runs, with the built-in skin, and says which checks that makes approximate: clipped text, clipped content,
overflow, empty text boxes and tooltips off the screen are measured with the built-in fonts, every texture the game or the haks would have is
reported missing, and font names are checked against the built-in skin's. The other client checks, unsolvable sizes
and the style rules do not need the game. In CI, give it the game and the module's haks for the real result:

```bash
NWN_ROOT=/path/to/game pnpm check --hak-dir /path/to/hak --module-ifo mymodule.mod \
  --style layonara --fail-on warning --format github dumps/
```

## Export a full theme: the original GUI too

A NUI skin restyles only the NUI windows. The game's original windows (character record, inventory, chat,
quickbar, character select, the creation wizard) are textures of their own, and a theme is complete only when both
match. **Export full theme** does both in one step: the NUI skin, and the original GUI's chrome redrawn from your own
install in the skin's colours (flat faces, one rule, the pressed fill and the hover glow, every state where its model
reads it; bars that fill, anti-aliased radial circles), every file checked and compressed to DDS where that is good
enough.

```bash
NWN_ROOT=/path/to/game pnpm export-theme bronze -o ~/themes/bronze --out-hak bronze_theme
# also a prefixed copy (bzg_boxes, bzn_skin, ...) for a server that lets each player choose:
NWN_ROOT=/path/to/game pnpm export-theme bronze -o ~/themes/bronze --out-hak bronze_theme --prefix bz --prefix-hak bronze_theme_p
# the skin's font for the original GUI too (fnt_maintext, fnt_default, fnt_default_hr; an OFL font):
NWN_ROOT=/path/to/game pnpm export-theme bronze -o ~/themes/bronze --out-hak bronze_theme --old-gui-fonts
```

Or in the skin editor: **Export skin** (Ctrl+E) → **Full theme** → **Build the theme**, then download the zip. The
summary ends with the original-GUI checks on what it built.

- **Output A**, `stock/` (and `--out-hak`): everything under the stock names. Put it in a hak (or an override
  folder) and every window has the look. Ink and brass with the game alone: 332 files, an 11.9 MB hak.
- **Output B**, `prefixed/` (with `--prefix`): the same files under a one- or two-character prefix, and
  `prefixed.json`, the map a server uses to switch one player (`SetTextureOverride` per texture, and a ResMan
  override of `nui_skin` for the skin).
- **`report.md`**: what was themed, what stays stock and why (icons, cursors, pictures, bitmap fonts: they need an
  artist), the original-GUI checks, failed checks, and a **warning for a light skin**: the original GUI draws its text light whatever its
  textures, so on light panels (Verdigris and paper's) it is hard to read.

The export needs your own game files and stops with a message without them. Its output is derived from the game's
art: ship it in your module's haks, never in a public repository. The whole guide, per-player themes and how the
redraw works: [docs/RESKIN-EVERYTHING.md](docs/RESKIN-EVERYTHING.md). (`pnpm reskin` writes the original GUI alone.)

`pnpm old-gui inventory` lists every texture the original GUI can draw in your game and haks, with its role, and
`pnpm old-gui check` holds a theme to it: every drawn chrome texture redrawn (not recoloured), flat faces, every bar
that fills previewed, the old GUI's fonts replaced as a set. They pass on `export-theme ink`. `pnpm old-gui previews` draws every screen of
the original GUI from your game, stock beside the theme (every `.gui` layout, the panels the client builds in code on
their hooks, lists with a selected and a hovered row, every bar at 0, 40 and 100 %), and checks the theme's frames
against the stock's: lines that vanish, stray lines, breaks, one-pixel steps and stubs.

## Mobile clients

The iOS client multiplies margins, list row heights, cell widths and draw-list coordinates by its screen density
(whatever the GUI scale) and the window position by its density over the GUI scale, and base-game TGA images draw
black in NUI on iOS and Android
([nwn-nui-spec](https://github.com/plenarius/nwn-nui-spec/blob/main/spec/mobile.md)). The toolbar's **Client**
previews a window as iOS builds it (refusals included), the **Mobile checks** list what will break
(`pnpm check --mobile`), the export can write **portable margins** (margin 0 and spacers), and
[`nss/nui_touch.nss`](nss/nui_touch.nss) scales a window per player in game. How, and what the numbers rest on:
[docs/MOBILE.md](docs/MOBILE.md).

## How close to the client

There is one drawing mode: the client's, as far as it is known.

- **Layout** uses the same constraint solver as the client (Kiwi, with its tie-breaking order), so element sizes
  and positions match it.
- **Skins** are nine-sliced with the margins the client uses for each key; scrollbar thumbs repeat their texture's
  middle strip; everything is clipped to its list or group; draw lists are drawn as Nuklear draws them.
- **Text** is sized as Nuklear's font baker sizes it, and wraps at the same words.

How this was measured:

- **Against an in-game screenshot** of a 106-element window (a server's deity window): frames, buttons and text within about half a pixel,
  every paragraph line broken at the same word. One difference is still open (scrollbar thumbs about 20 px
  shorter); a 4 px shift turned out to be a spacer's margin, 0 in the client, and is fixed.
- **Against nui-preview** (the Python renderer this code was ported from, which now follows the same in-game
  findings), on 39 windows (32 from a live server and the 7 fixtures):
  - **every element's rectangle identical** (0 px difference in all 39) before the designer took spacer margins
    and window placement from the client, where nui-preview has not caught up ([DESIGN.md](DESIGN.md#the-golden-check));
  - **pixels differing by more than 32 (of 255): 0.000 % to 0.885 %** per window (every live window at most
    0.255 %); pixels differing at all: 0 % to 9.4 %, almost all of it anti-aliasing at glyph edges;
  - font advances identical (0.0000 px worst).

  What is left: 1 px draw-list lines (anti-aliased here, aliased there), glyph edge pixels, and draw-list curves nui-preview does
  not draw.

Method and what is left: [DESIGN.md](DESIGN.md#fidelity).

## Known limits

- Widgets are drawn at rest: no hover, pressed or focused states on the canvas (the skin editor's widget-states
  sheet shows them).
- Not drawn: tooltips, the text cursor, the resize grip, WebM images, PLT textures. GIFs show their first frame. An
  open combo list is drawn only on demand (the canvas bar's "Open combo list").
- Sliders, the colour picker and charts are simple stand-ins.
- StrRefs show as `<strref N>` (no TLK reader yet). Colour codes (`<c...>`) are drawn as text. Text outside
  Windows-1252 is drawn as `?`.
- UI scale scales the finished picture; how the client scales each part is not known.
- NWSync manifests and the newer `E1` archive formats are not read.
- Copy, paste, wrap and unwrap work on one element at a time, and the canvas drags one element; list panes swapped
  in by id are drawn but not edited. Distribute works in rows and columns, not across a list's row template cells. While a dragged size makes the
  window one the client refuses, nothing is drawn (as in the game), so the handles go until the size is possible
  again; the drag itself goes on.
- The skin project is not autosaved. The built-in skins have not been checked in the game yet.

Every gap, with the reason and what would settle it: [docs/GAPS.md](docs/GAPS.md); the open questions are at the end
of [DESIGN.md](DESIGN.md#open-questions).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and rules, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for how the code fits together. [DESIGN.md](DESIGN.md) records the decisions, [docs/GAPS.md](docs/GAPS.md) what is
still open.
[docs/CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md) collects what is known about how the game client draws NUI
(layout, window frame, skin keys, fonts, text, images), with how each fact was checked.

A window that draws differently from the game is the most useful report: open an issue with the
[form for it](https://github.com/plenarius/nwn-nui-designer/issues/new?template=draws-differently.yml). Report security
problems privately, as [SECURITY.md](SECURITY.md) says. Everyone taking part follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Credits and licences

- **Code**: MIT ([LICENSE](LICENSE)).
- **Built-in skins** (textures, `nui_skin.tml`): CC0 1.0 (`assets/skin/*/LICENSE`).
- **Fonts** (unmodified, SIL Open Font Licence 1.1, not covered by CC0):
  - Brawler Regular (Ink and brass), Copyright 2011 The Brawler Project Authors;
  - Philosopher Bold (Bronze), Copyright 2011 The Philosopher Project Authors;
  - Old Standard TT Bold and Rye (Brass and soot), Copyright 2011 The Old Standard Project Authors; Copyright (c)
    2011 by Sorkin Type Co;
  - Spectral SemiBold and Federant (Verdigris and paper), Copyright 2017 The Spectral Project Authors; Copyright (c)
    2011, Cyreal;
  - Zilla Slab SemiBold and Cinzel Decorative Bold (Oxblood and rivets), Copyright 2017, The Mozilla Foundation;
    Copyright (c) 2012 Natanael Gama;
  - JetBrains Mono Regular 2.304 (all five), Copyright 2020 The JetBrains Mono Project Authors.

  Each font's licence text ships next to it; [PROVENANCE.md](PROVENANCE.md#fonts-shipped) has the sources and
  Reserved Font Names.
- **nui-preview**: the layout, rendering and checks are a port of nui-preview, a Python NUI renderer by the same
  author in Layonara's module repository (not public), used with permission.
- **niv's `nuilayout.cpp`** ([gist](https://gist.github.com/niv/9bf60ca649fdf6709c17886a1a467755)), linked from the
  nwn.wiki NUI page, describes how NUI builds its layout constraints. nui-preview, and so this project, follow its set
  of constraints, their order and their strengths; no code text is copied. The gist states no licence, and its
  author has been asked about it.
- **Kiwi**: `@lume/kiwi` 0.4.4, vendored with one change (BSD-3-Clause, `src/core/layout/kiwi/COPYING.txt`).
- Neverwinter Nights: Enhanced Edition, its scripts (`nw_inc_nui.nss`, `nwscript.nss`) and its art belong to their
  owners. The designer reimplements the JSON format those scripts build, and reads your own install at run time.

Where every part came from, in detail: [PROVENANCE.md](PROVENANCE.md).
