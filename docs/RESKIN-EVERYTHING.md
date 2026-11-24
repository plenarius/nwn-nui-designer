# How to reskin everything

A theme is complete only when it restyles **both** GUIs the game draws:

- the **NUI** windows (`nui_skin.tml` and the `nui_*` textures: what this designer edits), and
- the **original GUI**, the MDL-panel windows from before NUI: character record, inventory, spellbook, chooser and
  radial, chat, quickbar, the DM bar, options, character select (the vault), the module list and the
  character-creation wizard.

Never mix and match: a NUI skin over the stock original GUI (or the reverse) is half a theme. **One step exports the
whole theme**: `pnpm export-theme` (or **Export skin → Full theme** in the skin editor) takes a NUI skin, redraws the
original GUI's chrome from your own game in its colours, checks it, and writes both together, ready for a hak. A
person or an agent can follow this guide from start to finish without asking anything.

Contents: [Prerequisites](#prerequisites) · [Export the full theme](#export-the-full-theme) ·
[What it writes](#what-it-writes) · [Output A: one theme for everyone](#output-a-one-theme-for-everyone) ·
[Per-player themes (output B)](#per-player-themes-output-b) · [The report](#the-report) ·
[The original GUI's inventory and checks](#the-original-guis-inventory-and-checks) ·
[Previews and the frame check](#previews-and-the-frame-check) ·
[What goes wrong in game](#what-goes-wrong-in-game) · [Fonts](#the-original-guis-fonts) ·
[Check and test](#check-and-test) · [Checklist](#checklist-the-theme-is-complete) ·
[Appendix: how it works](#appendix-how-it-works)

> **Status.** The export **redraws** the original GUI's chrome from the skin's own colours (flat faces, one rule,
> the pressed fill and the hover glow, every state in the cell its model reads), and `pnpm old-gui check` passes on
> it: every one of the 148 chrome textures is redrawn and every face is flat. `pnpm old-gui previews` draws every
> screen stock beside the theme and checks its frames; `--old-gui-fonts` gives the old windows the skin's font. What
> is still open: [GAPS.md](GAPS.md#the-original-gui).

## The rule: no game art in a repository

The export reads the stock original GUI from **your own install** and writes everything it makes to a folder you
choose (or a zip you download). The redrawn textures are derived from Beamdog's art (their layout, and the pictures
and icons they keep): share them with your players in
your module's haks, but never commit them to a public repository, and never put them, or screenshots of the original
GUI, in this one. The command line refuses an output folder inside this repository (except the ignored `local/`).
The NUI skin's own files (the built-in skins' textures and `.tml`, CC0; their fonts, OFL) are not derived from the
game; the licence note in the export (`nuid_skin_lic.txt`) says which files are which.

## Prerequisites

1. **NWN:EE** installed (a folder with `data/nwn_base.key` and its BIFs). Without it the export stops with a message
   saying so: the original GUI comes only from your install.
2. **Node 24 and pnpm**, and this repository installed: `pnpm install --frozen-lockfile`.
3. The game folder known to the tools: `NWN_ROOT=/path/to/game`, or `game = ...` in `nui-designer.ini` (see the
   README's "Use your own game"), or `--game DIR` on the command line; in the editor, **Game and haks**.
4. **A NUI skin with a generator style.** One of:
   - a built-in skin: `ink`, `bronze`, `brass`, `verdigris`, `oxblood` or `winter` (the README's skins table);
   - a generator preset: `a-bronze`, `b-clean`, `d-iron`, `s-brass`, `s-verdigris`, `s-oxblood`, `w-winter`;
   - your own skin, made in the skin editor's **Generator** (start from a preset, change its colours), saved as a
     project (`*.nuiskin.json`), or open in the editor. The original GUI's palette is derived from the generator's
     numbers, so a skin made only from uploaded images can't be used as it is: generate it (or regenerate one close to
     it) first.
5. About 40 MB free for the output (both outputs and their haks).

Look at the skin in the widget sheet and on a few windows first: the original GUI takes its colours from it
([how](#how-the-skins-colours-map)).

## Export the full theme

On the command line:

```bash
NWN_ROOT=/path/to/game pnpm export-theme bronze -o ~/themes/bronze --out-hak bronze_theme
# with a per-player copy under the prefix bz:
NWN_ROOT=/path/to/game pnpm export-theme bronze -o ~/themes/bronze --out-hak bronze_theme --prefix bz --prefix-hak bronze_theme_p
# your own skin:
pnpm export-theme ~/skins/mytheme.nuiskin.json -o ~/themes/mytheme --out-hak mytheme
```

| Option | |
|---|---|
| `SKIN` | a built-in skin, a preset or a `.nuiskin.json` project ([Prerequisites](#prerequisites)) |
| `-o DIR` | the output folder (required; not inside this repository) |
| `--out-hak NAME` | also write output A as `DIR/NAME.hak` (at most 16 characters) |
| `--prefix P` | also write output B under the prefix `P`: 1 or 2 letters and digits, starting with a letter |
| `--prefix-hak NAME` | also write output B as `DIR/NAME.hak` (needs `--prefix`) |
| `--game DIR` | the game (else `$NWN_ROOT`, else `nui-designer.ini`) |
| `--hak FILE`, `--override DIR` | read the stock textures through these too (else the haks and folders `nui-designer.ini` names) |
| `--no-haks` | read the game alone (use this when your haks already hold an earlier theme under the stock names) |
| `--alpha keep\|opaque` | override the alpha rule (default: from the skin's window body; [Alpha](#how-the-two-guis-are-made-to-match)) |
| `--format auto\|dds\|tga` | what a texture that is a TGA in the game is written as (default `auto`; [Format and size](#format-and-size)) |
| `--no-sheet` | no contact sheets |
| `--old-gui-fonts` | also the skin's text font as the original GUI's three fonts, in `stock/` ([Fonts](#the-original-guis-fonts)) |

After writing, the export runs the original-GUI checks on `stock/` ([The original GUI's inventory and
checks](#the-original-guis-inventory-and-checks)) and puts them in `report.md`. The exit code is 0 when every texture
passed its own checks and the original-GUI checks pass, 1 when one failed (`report.md` says which), and 2 for a usage
error: no game, a bad prefix, an unknown skin, a font whose licence does not allow shipping it. A whole theme takes
about two minutes on a slow core (most of it DDS compression).

In the editor: **Skin** → open the skin → **Export skin** (Ctrl+E) → **Full theme**. The tab says why it can't run
(no game loaded, no generator style) and shows the light-skin warning before you build. **Build the theme** shows its
progress, then a summary and **Download NAME-theme.zip**: the same files as the command line (output A and its hak
named after the skin; with **Also under a prefix**, output B, its hak `NAME_p` and `prefixed.json`), without the
contact sheets. "Read the stock textures through the module's haks too" is `--no-haks` when unticked; "The skin's
font for the original GUI too" is `--old-gui-fonts` (greyed out, with the reason, when the font's licence doesn't
allow shipping it). The summary ends with the original-GUI checks.

## What it writes

| | |
|---|---|
| `stock/` | **output A**: the NUI skin (`nui_skin.tml`, its textures and fonts, the fonts' OFL texts, the licence note) and the redrawn original GUI (161 textures with the game alone, each with its stock `.txi`), all under the **stock names** |
| `NAME.hak` | output A as a hak (`--out-hak`) |
| `prefixed/` | **output B** (`--prefix`): the same files under the prefix |
| `prefixed.json` | output B's map: each stock texture to its prefixed name, and the skin's resref |
| `NAME.hak` | output B as a hak (`--prefix-hak`) |
| `report.md` | what was themed, what is left stock and why, the original-GUI checks, failed checks, and the light-skin warning ([The report](#the-report)) |
| `reskin-manifest.json` | per original-GUI texture: where the stock one was read (game, hak, folder), its stock format and the format written, size, bytes, recoloured or redrawn, the compression error, the checks |
| `contact-*.png` | stock and new side by side, one sheet per group (command line only) |

Ink and brass, for scale, with the game alone: `stock/` holds 332 files (the NUI skin's 39; 161 original-GUI
textures, 145 DDS and 16 TGA, and their `.txi`), and its hak is 11.9 MB.

## Output A: one theme for everyone

Put `NAME.hak` in the module's hak list (or the contents of `stock/` in a hak of your own), build the module (and
NWSync), and every window has the look: the NUI windows when a player joins, the original GUI from character select
on, since the hak is a location above the base game. Ship the one hak, update it as one, remove it as one: the NUI
skin and the original GUI never drift apart.

For a quick try on your own machine, copy the contents of `stock/` into the game's user folder `development/`
(e.g. `Documents/Neverwinter Nights/development/`); it beats every other location. Empty it afterwards.

## Per-player themes (output B)

A server that lets each player choose a theme ships one theme under the stock names (output A, the default everyone
sees, character select included) and every other theme prefixed (output B), in its haks. Each prefixed theme is the
same files under new names, so several can sit in the same hak list without replacing anything:

- a prefix of one or two characters replaces each name's first part with itself and one letter for that part: with
  `bz`, `gui_boxes` → `bzg_boxes`, `ctl_opt_gen` → `bzc_opt_gen`, `pnl_opt_gen` → `bzp_opt_gen`, `nui_skin` →
  `bzn_skin`, `nuio_philo_b` → `bzo_philo_b`. Every name keeps its stock length, so all fit in 16 characters;
- the export refuses a prefix whose names would start like the game's own (`gu` would make `inv_stacksplit`
  `gui_stacksplit`), or that the game or a hak already has, and stops before any work;
- the prefixed `nui_skin.tml` (`bzn_skin.tml`) names the prefixed textures and fonts itself.

`prefixed.json`:

```json
{
 "tool": "nwn-nui-designer export-theme",
 "theme": "Bronze",
 "prefix": "bz",
 "skin": { "stock": "nui_skin", "resref": "bzn_skin", "restype": 2076 },
 "textures": { "ctl_att": "bzc_att", "gui_boxes": "bzg_boxes", "...": "..." },
 "skinFiles": { "nui_windowh": "bzn_windowh", "nuio_philo_b": "bzo_philo_b", "...": "..." }
}
```

How a server applies it to one player (a sketch; turn the manifest into a 2DA, a JSON resource or a database table,
whatever your module reads):

- **The original GUI**: for each pair in `textures`, `SetTextureOverride(stock, prefixed, oPC)`. Clear them with
  `SetTextureOverride(stock, "", oPC)` to go back to output A. The `.txi` beside each texture travels with its name.
- **The NUI skin**: the skin is one resource, `nui_skin` (type 2076, tml), and the client reads it when it joins.
  Point that player's `nui_skin` at the prefixed one and make the client reload its resources: with NWNX,
  `NWNX_Player_SetResManOverride(oPC, 2076, "nui_skin", "bzn_skin")` then `NWNX_Player_ReloadResources(oPC)`. The
  `skinFiles` need no override: the prefixed skin names them itself.
- **Limits**: per-player overrides reach a player only once they are in the module, never character select or the
  creation wizard (those show output A). Remember the choice (a campaign variable, the database) and apply it on
  every login. Try every window after switching: a panel already open may keep its old texture until it is opened
  again.

## The report

`report.md` opens with what is in the export, then:

- **Left stock**: the textures the client uses that no export changes, by kind, with why: icons, pictures, baked
  text, cursors, bitmap fonts and content need an artist (or stay as they are); the original GUI's text colours,
  fonts and layout are not textures at all ([What is left to a person](#what-is-left-to-a-person));
- **Original GUI checks**: `pnpm old-gui check` on `stock/`, with an inventory of the models and layouts the export
  read (the client's own names, which `pnpm old-gui inventory` also reads, are left out: run that for the full set);
- **Checks**: every failed check and every skipped texture, by name;
- the original GUI in detail: formats and sizes, each texture's compression error, and every texture left to a person
  by name.

**Light skins.** When the skin's window body (or its fixed background) has a luma of 128 or more (Verdigris and
paper's aged paper is 214; the dark built-in skins are 3 to 45), the report, the command line and the editor open
with a warning: the original GUI draws its text in light colours, set by its `.gui` files and the client's code, not
by any texture, so on light panels its text is hard to read, and nothing in the export can change that. NUI windows
that hard-code a light text colour instead of taking the skin's (some of the game's, and module windows that set
their own colours) suffer the same way. A light skin's export is otherwise complete and passes its checks; try every
window in the game before shipping it, or theme the original GUI from a dark skin.

## The original GUI's inventory and checks

`pnpm old-gui` reads every texture the original GUI can draw from **your own game and haks**, gives each one a role,
and checks a theme against that list. It is how you know a theme is complete, and its checks run in CI without the
game.

```bash
# once per game version (and whenever your haks add GUI models or textures):
NWN_ROOT=/path/to/game pnpm old-gui inventory -o ~/themes/mytheme/inventory
# then, as often as you like (no game needed; a theme repository can run this in CI):
pnpm old-gui check ~/themes/mytheme/inventory --theme ~/themes/mytheme/stock
```

`inventory` takes the same `--game`, `--hak`, `--override` and `--no-haks` as `pnpm reskin`, and:

- `--client FILE`: the game executable to read the client's built-in names from (by default the one in the game's
  `bin/` folder; the names are needed because the client draws some textures from its code alone, such as the
  inventory's slot silhouettes and the map's custom pins);
- `--roles FILE`: your own decisions for textures the built-in tables don't know (see below).

It reads:

- every GUI model, binary or ASCII: the GUI archives' models and every model with a GUI name, as your haks override
  them, and every model a layout places;
- every `.gui` layout: the models it places on which hooks, and its labels' fonts;
- the client's built-in names (its strings), and the families it builds with a number (`ctl_inv_sto_tab%d`,
  `gui_icon_%dx%d...`, `pnl_mapgen_%dx%d`);
- every texture a `.txi` names (environment maps and the like), followed until nothing new turns up.

It writes two files, names and numbers only (no art), so a theme's own repository may keep them:

| File | |
|---|---|
| `old-gui-inventory.tsv` | one row per texture: `group` (chrome, icon, content, text, cursor, font, scene, none), `kind` (button, panel, edit, tab, cells, scrollbar, slider, checkbox, bar, row, item-cell, radial, shape, ...), `role`, `treatment`, `drawn`, its format and size and where it is read from, its txi (`filter 0`, `mipmap 0`, `clamp 3`), and where it is used: `models`, `layouts`, `client`, `txi_from`, and the controls that read a different cell of it per state |
| `old-gui-cells.json` | every UV cell the models sample from each drawn texture: the texels, how many screen pixels each texel becomes along each axis (0 when the client resizes it at run time), and which model, node and animation (state) reads it |

**Treatments.** `redraw` (chrome: drawn again in the skin's style), `flat` (chrome that is already flat cells or
marks), `icon` (kept, or its ground recoloured), `hold` (left for you: content art, baked text and logos, cursors,
bitmap fonts), `scene` (3D textures of the menu scenes), `missing` (named, but the game has no such file), `unused`
(in a GUI archive, drawn by nothing).

On the EE 8193.37 game alone: 1620 GUI models, 104 layouts and 1242 textures, 476 of them drawn:

| Treatment | Count |
|---|---|
| redraw (chrome) | 148 |
| flat (chrome already flat) | 18 |
| icon | 214 |
| hold (content, baked text, logos, cursors, bitmap fonts) | 64 |
| scene | 32 |
| missing | 47 |
| unused | 719 |

**Your haks.** A texture your haks add that something draws, and that the built-in tables (`src/core/oldgui/roles.ts`)
don't know, is `uncategorised`, and the check fails until you decide. Write the decision in a roles file and pass it
with `--roles`:

```json
{
 "textures": {
  "my_gui_frame": { "group": "chrome", "treatment": "redraw", "kind": "panel", "role": "my window's frame" },
  "my_gui_icons": { "group": "icon", "treatment": "icon", "stateIcon": "the toolbar's icons, on the buttons' own frames" }
 }
}
```

**The checks.** `check DIR` runs on the inventory folder; with `--theme` (a folder of textures under the stock names,
such as `export-theme`'s `stock/`, or the export folder itself) the rest run too. `--skin SKIN` names the skin the
theme was made from (else the export's manifest beside the theme says), so its light fills (pressed, accent, glow,
marks) count as faces on purpose. Exit code 0 when everything passes, 1 when a check fails; `--json` for a machine.

| Check | Fails when |
|---|---|
| categories | a drawn texture has no role |
| coverage | a drawn chrome texture has no file in the theme, or its file was only recoloured (the export's manifest says which); a file under a GUI name the inventory doesn't know |
| state icons | a texture kept as an icon or held art is read by a control in a different cell per state (normal, hover, pressed, checked) and is not known to hold only icons. A control's state cells are usually its frames: the character-select checkbox draws its box and mark from an atlas of tab icons |
| fill bars | a bar the client fills (a progress-bar role, or a cell a model draws with its `percentage` animation) has no previews at three levels or more from empty to full |
| flatness | a chrome face (a region at least 3 texels thick) whose colour spreads over 10 levels (a bevel, ramp, vignette, mottling); a face lighter than the skin's fill that is not one of its light fills; a cell a model draws at 3 or more pixels per texel (or resizes at run time) whose texels change along that axis: filtering spreads any change over the whole stretch. Pictures inside frames, icons in a control's atlas and a few known cases are skipped, each with its reason |
| fonts | the theme replaces one or two of the old GUI's three font files, not all three ([Fonts](#the-original-guis-fonts)) |

On `export-theme ink` every check passes: coverage 148 of 148 redrawn, flatness on the 155 textures it reads (148
chrome and the flat cells), with the game alone (EE 8193.37). Before the redraw, coverage failed on 145 of the 148
(recoloured) and flatness on 52 of 97.

### Previews and the frame check

Textures alone don't show a theme: the old GUI builds its windows from many pieces of many textures. `pnpm old-gui
previews` draws every screen from your game, stock beside the theme, with the models at their places and states:

```bash
NWN_ROOT=/path/to/game pnpm old-gui previews -o ~/themes/mytheme/previews --theme ~/themes/mytheme/export
```

- **Every `.gui` layout**, as the client places it: each object's model on its parent's hook, one button pressed
  and the next hovered, lists filled with sample rows (the first selected, the second hovered) and their scrollbar,
  labels with their text from the game's string table, in the game's own font.
- **The panels the client builds in code**, laid out by hand on their models' hooks: the Character Record, the
  inventory with its equipment page and item cells, the store with its tabs, the spellbook and Memorize Spells with
  their level medallions and spell icons, the journal, character select with its tabs, its checkbox in each state,
  and the Player List filled (its icon buttons in each state, rows with their attitude buttons).
- **Every bar the client fills** at 0, 40 and 100 % (the load and rest bars, the player's and a party member's
  health): the renderer mixes the `percentage` animation's first and last frame, as the client sets its time.
- **Sampled as the game does**: a texture whose txi says `filter 0` is drawn without blending (each pixel takes the
  texel it falls in), a clamped axis repeats its edge texel.
- The panels with no layout and no hand layout (chat, dialogue, quickbar, party bar, the radial menu, the DM bar, ...)
  are drawn with what sits on their hooks.

Approximate where the client decides in code: the number of rows and their texts, which tab is selected, the
scrollbar thumb's length, each label's font size and exact place.

Each screen gets `screen_<key>.png` (stock | theme) and `frames_<key>.png`, the **frame check**: both drawn without
text, and their rules (thin lines clearly brighter than the fill around them) compared where the two differ:

| Finding | What it is |
|---|---|
| missing | a stock rule with no theme rule within 6 px: a frame line that vanished |
| stray | a theme rule with no stock rule within 6 px: a line the stock does not draw (the hover glow excepted) |
| ends | a theme line that stops 3-7 px short of where the stock's goes on (a break, or a step to another row), or that jogs one pixel to the side where the stock's runs straight |
| stubs | a theme stub of 1-4 px standing off a line where the stock draws no line across (a separator's end cut into a frame's edge piece: a dot or tick on the frame) |

The overlay shows stock rules blue, theme rules brass, missing red, stray green, ends as white boxes and stubs as
magenta rings; `frames.txt` lists every screen. The same check runs in `pnpm old-gui check ... --frames` (it reads
the game; `--frames-out DIR` writes the overlays). Its findings are listed **to look at, not failed**: a doubled
stock rule drawn as one, a faint stock separator drawn as a visible rule, and a rule dropped on purpose because a
stretched cell shares its texels (below) are by design. Every other one is a fault to fix.

## What goes wrong in game

What a theme of the original GUI has to get right, each learnt from a fault seen in game:

- **A recolour keeps the stock look.** Bevelled double-line frames, the mottled "cloud" on pressed buttons and the
  selected list row, light scrollbar tracks, vignetted panel fills and parchment faces all survive a recolour in the
  new colours. Chrome has to be redrawn: flat faces, one rule, the pressed or selected fill, the hover glow, from the
  skin's own colours.
- **Every state stays in the cell the model reads.** A button atlas holds its normal, pressed, hover and disabled
  frames at the places the model's animations point at (`up`, `down`, `hilite`, `disabled`, `checkedup`, ...). A
  disabled animation may read another state's frame. Some controls draw another control's texture: the old windows'
  close button `ctl_btn_x` draws `ctl_chk_pre`.
- **Frames built from separate strips.** Some frames are three or more strips of one texture (a bar's left end,
  middle and right end), or overlapping pieces of an atlas (the Player List's top row and its "PvP Zone" box). Drawn
  as one panel, the rules break, step where the pieces meet, or stop short. Each piece must carry its rules on the
  same rows as its neighbours.
- **Stretched cells.** The colour-cell strips (`gui_boxes*`) are stretched 20 to 200 times over panels. Filtering
  reads half a texel past each end of a span, so a rule next to a stretched cell turns into a soft band or a fade at
  the ends of a row. A stretched cell must be one colour along its stretch. A frame's rule that a cell stretched at
  most 12 times reaches only at its very end stays (a soft edge of 6 px at most); where a cell stretched further
  reads it, the rule goes. So the strip cells some tables tile for their row separators (the Character Record's
  ability grid and page lines, the server list) lose them: the same cells are the fill of chat windows and store
  pages, which would show the rule as a glow along their edges. The frame check lists these as missing lines.
- **Shared cells have one owner.** One strip of `gui_boxes_ingame` (columns 224-227) is the rows of the spell tree,
  the spell boxes, the journal's quests, the Player List and the store, and the loot window stretches it too. The
  texture is not filtered (`filter 0`), and each row is drawn from half a texel inside the strip's first row to half
  a texel past its last: a rule on the first row shows at both ends of every row (a doubled line). Its rule belongs
  on the last row. Other cells of the same texture are the inventory's item outlines and the translucent cell that
  dims a disabled button: change one and every user changes.
- **`clamp 3`.** The tab textures' txi clamps both axes, and the tab bodies read far past the texture's last row, so
  the edge row is stretched over the whole body. A rule on that row is a bright strip under every tab.
- **Rotated strips.** Some pieces draw a strip turned on its side (the rest bar). Measure a piece's stretch along its
  own mapping, not the texture's axes; the inventory's cells do.
- **Bars that fill.** The load and rest bars, and the health bars, grow by a `percentage` animation: a bar redrawn as
  a panel shows nothing while it fills. Look at every bar at 0, 40 and 100 %.
- **The radial menu** draws its big disc at 56 and 128 px from the same 112 texels, with no mipmaps: a hard 1-texel
  rule breaks into dashes and stair-steps. Its circles need anti-aliased alpha and a rim of about 2 texels.
- **DXT turns dark faces olive.** DXT1 stores two 5:6:5 end colours per 4 x 4 block; a dark warm face that 5:6:5
  can't hold exactly is stored as a mix that leans green. Pick face colours that 5:6:5 stores exactly (each block then
  decodes to the face), and snap dark colours to warm 5:6:5 values. The export's DDS encoder fits blocks well, but a
  face that is not exactly representable still drifts.
- **Previews must sample as the game does.** `filter 0` textures are drawn without blending (each pixel takes the
  texel it falls in); filtering them in a preview hides the doubled row rule above.

## The original GUI's fonts

The original GUI does not draw with its bitmap fonts any more. The EE client remaps every font name a `.gui` or its
code uses to one of three TrueType files:

| File | Draws |
|---|---|
| `fnt_maintext` | titles and labels (`fnt_galahad14` and the other title fonts), at about 17 px |
| `fnt_default` | everything else (`fnt_console`, chat, lists, dialog), at about 14 px |
| `fnt_default_hr` | dialog and floating text with the large-font option, at about 16 px |

So a theme can give the old windows the NUI skin's font by shipping that font three times, under those three names,
in a hak (the game's own `.txi` for each name, contrast and outline only, still applies). `export-theme
--old-gui-fonts` (in the editor: "The skin's font for the original GUI too") does it: it copies the skin's text font
(its `(default)` `[[fonts]]` entry) to `stock/fnt_maintext.ttf`, `fnt_default.ttf` and `fnt_default_hr.ttf`, and the
licence note says they are copies. Replace all three or none, with one font: the check fails on a partial set and on
three that are not the same file. `fnt_maintext` is also the font of a NUI skin entry that names no resref of its
own, so replacing it changes those NUI windows too.

- **Licence.** Ship only a font whose licence allows it, never one of the game's. The option takes the built-in
  skins' fonts (SIL OFL 1.1: their licence text goes in the export beside them) and a font of yours whose own name
  table says SIL Open Font License, Apache License, Ubuntu Font Licence or public domain and whose OS/2 table doesn't
  restrict embedding; it refuses anything else, saying why.
- **Coverage.** A font with Latin-1 only can't draw the rest of a player's code page.
- **For everyone, not per player.** The client loads its fonts once, so a per-player theme can't switch them:
  every player on the server gets the hak's fonts, whichever theme they chose. The option puts them in output A only.
- **Testing on your machine.** Put the three files in the game's user `development/` folder. A player's
  `override/` folder does **not** beat the haks a server sends through NWSync; `development/` does.

## Check and test

1. **Run `pnpm old-gui check`** with the inventory of your game and the theme's `stock/` folder
   ([The original GUI's inventory and checks](#the-original-guis-inventory-and-checks)). Settle every failure.
2. **Read `report.md`.** Settle every failed check (redraw the texture by hand, or leave it out of the hak) and every
   texture left to a person (keep it, recolour it by hand, or draw new art).
3. **Run `pnpm old-gui previews`** and look at every screen and its frame check
   ([Previews and the frame check](#previews-and-the-frame-check)): frames closed, no line that vanished or stops
   short, no stray dot on a frame, the selected and hovered rows, every bar at 0, 40 and 100 %.
4. **Open each `contact-*.png`.** For every texture: button atlases keep their three frames (up, down, hover) at
   their places, up the skin's button, down the pressed colour, hover the glow; thin rules read as the accent, not lost
   in the fill; red, green and blue signal cells stay as they were.
5. **Test in the game**: the `development/` folder for a quick look (not `override/`: it loses to the server's
   NWSync haks), then the hak in the module as players get it.
   Check character select and the creation wizard too (a hak reaches them once the player has connected), and, for
   output B, switch a player to the prefixed theme and back.

## Checklist: the theme is complete

- [ ] The NUI skin is final.
- [ ] `pnpm old-gui inventory` ran on the game and haks the players will have, and `pnpm old-gui check` passes on
      the theme (or every failure was looked at and settled).
- [ ] `pnpm export-theme` (or Full theme in the editor) ran from it with exit code 0, or every failed check in
      `report.md` was looked at and settled.
- [ ] A light skin's warning was read, and every window tried with it in the game.
- [ ] Every preview and its frame check was looked at (`pnpm old-gui previews`), and every finding settled.
- [ ] Every contact sheet was looked at: states in place, rules visible, signals kept.
- [ ] Every texture in `report.md`'s "Left to a person" was decided: kept, recoloured or redrawn.
- [ ] In the game, with the hak: character select (vault), module list, the creation wizard (every page), the
      character record, inventory (with an item stack split), spellbook, radial menu, chat, quickbar, DM bar,
      options and key bindings, a message box, and a NUI window of the module, all in the same look.
- [ ] For output B: a player switched to the prefixed theme sees it on both GUIs, and switching back restores output A.
- [ ] The hak is in the module's hak list, built and released.
- [ ] Nothing derived from the game's art was committed to a public repository.

## Appendix: how it works

The full-theme export is the NUI skin's own export (what **Export skin → .hak** holds) plus `pnpm reskin`'s redrawn
original GUI, in one package (`src/core/reskin/theme.ts`). The rest of this guide is how the original GUI is redrawn,
and what to know to redraw a texture by hand.

### How the skin's colours map

| The skin's | becomes, in the original GUI |
|---|---|
| window body (`fixed_background`, `nui_windowh`) | the panel fill, the tab ink, the tracks (darker) and the frames' outer edge (darker still) |
| button body | every button face and list row |
| active body (pressed / selected) | the pressed and selected face, the selected list row and item cell |
| accent (`border_color`) | the one rule of every frame, the scroll thumb and slider knob, the bars' fill |
| glow (hover) | the hover rule inside a hovered button, a hovered row's rule |
| mark (ticks) | check marks, the X, arrows and the glyphs on buttons |
| window body opacity | whether the old translucent panels become opaque (see Alpha) |

### `pnpm reskin`: the original GUI alone

`pnpm export-theme` runs this for you. Run it alone to work on the original GUI only (to try a palette change on a
few textures with `--only`, say):

```bash
NWN_ROOT=/path/to/game pnpm reskin ink -o ~/reskin/ink --out-hak gui_ink_skin
pnpm reskin ink -o ~/reskin/try --only gui_boxes,ctl_att --format tga
```

| Option | |
|---|---|
| `SKIN` | a built-in skin, a preset or a `.nuiskin.json` project, as for `pnpm export-theme` |
| `-o DIR` | the output folder (required; not inside this repository) |
| `--out-hak NAME` | also write `DIR/NAME.hak` (at most 16 characters) |
| `--game DIR` | the game (else `$NWN_ROOT`, else `nui-designer.ini`) |
| `--hak FILE`, `--override DIR` | read the stock textures through these too (else the haks and folders `nui-designer.ini` names) |
| `--no-haks` | read the game alone (use this when your haks already hold an earlier reskin) |
| `--alpha keep\|opaque` | override the alpha rule (default: from the skin's window body) |
| `--format auto\|dds\|tga` | what a texture that is a TGA in the game is written as (default `auto`; see [Format and size](#format-and-size)) |
| `--only A,B` | only these textures (to try a change quickly) |
| `--no-sheet` | no contact sheets |

It writes, under `DIR`:

| | |
|---|---|
| `textures/` | every new texture under its **stock name**, as DDS or TGA (`--format`), with the stock `.txi` beside it |
| `NAME.hak` | the same files as a hak (with `--out-hak`) |
| `manifest.json` | per texture: where the stock one was read (game, hak, folder), its stock format and the format written, size, bytes, recoloured or redrawn, the compression error, the checks |
| `report.md` | the formats (how many DDS and TGA, the size, each TGA's compression error and why one stayed TGA), failed checks, skipped textures, and the textures left to a person |
| `contact-*.png` | stock and new side by side, one sheet per group |

The exit code is 0 when every texture passed its checks and 1 when one failed (`report.md` says which). A run over
the whole set takes about 15 seconds with `--format tga`, and about a minute with DDS compression (on a slow core).

The reskin reads each texture where the client would find it: the first layer that has the name (haks in hak-list
order, then override folders, then the game), a DDS before a TGA within one layer. If a hak of yours already holds
an earlier reskin under the stock names, it would be recoloured again: leave that hak out (`--no-haks`, or name
the hak you are writing with `--out-hak`, which the reskin skips by itself).

### What the reskin changes

Every chrome texture the inventory counts (148), plus the flat colour cells and the icons the tabs carry: 161
textures in all with the game alone. The code is `src/core/oldgui/draw/`.

| What | How |
|---|---|
| **Button atlases** (`ctl_btn_*`, `ct_btn_srv_*`, `ctl_att*`, `ctl_class`, `ctl_skill`, ...) | Every frame a model reads, found from the models' UVs per animation (`up`, `down`, `hilite`, `disabled`, `checked*`), drawn as a button in its state: a 1 px outer edge, one rule in the skin's accent, a flat face; hover adds the glow rule inside it, pressed and selected take the pressed fill, disabled the grey. A frame the stock marks with its blue "cloud" is the pressed one. A disabled animation that reads another state's frame draws that state. The sub-cell rules of a normal frame are kept. |
| **Panels** (`pnl_*`, `ctl_cg_*`, `ctl_pre_*`, `edit_box_*`, ...) | The window fill; each stock rule (a bevel of 2 or 3 texels, a doubled line) becomes one 1 px rule on its brightest line, where the stock draws it, so strips cut from different places of a texture still meet. Pictures inside frames (the module and new-game paintings, the death screen, the server list's logo) are kept. |
| **Colour-cell strips** (`gui_boxes*`, `gui_ig_main`) | Every grey ramp becomes a flat level: translucent greys the fill, opaque greys and whites the rule, a single grey separator row the darker track rule; signal colours (health tints, the quick bar's outlines) stay, a brown thumb cell becomes the brass. List rows are flat (a rule on top, the face, the glow under the rule on hover, the pressed fill when selected). The shared list-row strip (columns 224-227) carries its rule on its last row, the loot window's hover cells are clear. |
| **Small controls, bars, tabs, radial** | Drawn by hand at the stock size and layout: the scrollbar thumb (a flat brass bar at the NUI's proportions), the slider, arrow buttons, the checkbox and close face, item cells, the map and party-bar buttons with their glyph, the creation arrows, the container bar, the checkbox inside `ctl_btn_jnl_inv` (its icons kept). The load bar's frame is three strips with their rules on the same rows and its fill one band along the whole width; the rest bar is a band across its 14-texel cell. Text tabs are outlined on top and both sides and open at the bottom (their txi clamps, so the body is one row stretched down); the Character Record's tabs mark the selected one by its own rows. The radial menu's discs and rings are circles with anti-aliased alpha and a rim of 2.2 texels (1.3 for pieces drawn 1:1). The Player List's frame atlas keeps its cells' and box's rules on the same rows. |
| **Flat cells** (`gui_replace01-06`, `gui_rgbc`, `gui_lightning`, `gui_gring01`, `gui_pre_chkbox`) | Already one colour per cell: recoloured cell by cell. |
| **Icons the tabs carry** (`gui_char_icons`, `gui_inv_icons`, `gui_inv_sto_icon`) | Their dark ground recoloured to the tabs' ink; the art stays. |

Then every cell a model draws stretched (3 or more pixels per texel, or resized at run time) is made one colour
along the stretch, the commonest of the texels it covers, so filtering has nothing to spread; a frame's 1:1 rule
that a cell reaches only at its very end stays. Every face colour is snapped to one DXT1 stores exactly, keeping its
hue, and the DDS encoder weighs face texels 12 times, so a block that holds an edge, a rule and a face keeps the face.

Every texture keeps the stock **name, size, UV layout and alpha layout** (cut-outs stay cut out). A stock DDS stays a
DDS (DXT5 when the redraw has alpha); a stock TGA becomes a DDS with `--format auto` unless the DDS is too far off,
now including a flat face that DXT would move by more than 4 levels ([Format and size](#format-and-size)). The
checks (in `manifest.json`): the stock size; the decoded file against the drawing (mean error at most 6), and not
upside down; no alpha 0 moved by the encoding. The flat cells keep the recolour's checks (same header, alpha layout,
luminance following the stock one mapped, every rule still visible).

### What is left to a person

`report.md` lists these (82 names) with whether your install has each. Decide per texture: keep it, recolour
it by hand, or draw new art.

| Class | Examples | Why not automatic |
|---|---|---|
| Icons | stat icons, slot silhouettes, the compass, party states, the radial's icons (the radial's discs and the icon atlases' frames and grounds are redrawn) | Painted pictures. A gold-to-accent recolour may suit some; anything more is new art. |
| Pictures | `gui_banner` (the weapons banner on every creation page) | A picture, not chrome. |
| Baked text | `gui_pre_logo`, `load_legal`, `load_legal2` | Text and a logo painted into the image. |
| Cursors | `gui_mp_*` (30) | Optional for a theme. |
| Bitmap fonts | `fnt_console`, `fnt_floaty_smal`, `fnt_galahad14` | Glyph atlases tied to their `.txi` metrics. |
| Content | colour pickers (`gui_pal_*`), menu backgrounds, splash and pause art | Not part of the chrome. |

**Not in any texture** (no texture theme can change them): the original GUI's text colours (`.gui` files, the
client's code) and its fonts (the three TrueType files of [Fonts](#the-original-guis-fonts): a hak can replace them,
for everyone), panel geometry and layout (models and `.gui` files: a hak can replace
them, for everyone), selection tints and the radial's dimming, portraits and item and spell icons.

To redraw one by hand: work from the stock file (`nwn_resman_cat` or the designer's resources), keep the **name**,
the **size**, the **format family** (TGA or DDS, and DXT1 or DXT5), the **alpha layout** and the **.txi**, keep
every state frame at its place, and put the file in `DIR/textures/` before building the hak. Then run `pnpm old-gui
check` and `pnpm old-gui previews` on the folder.

### How the two GUIs are made to match

The palette comes from the skin's generator style (`src/core/reskin/palette.ts`); `manifest.json` records it. The
redraw (`src/core/oldgui/draw/style.ts`) takes its colours from it, each snapped to a colour DXT1 stores exactly:

| Redraw colour | From the skin |
|---|---|
| face | the button body |
| window fill, tab ink | the window body |
| pressed / selected face | halfway between the active body's two ends |
| rule | the accent |
| hover rule | the glow |
| outer edge | the window body, 70 % towards black |
| track, field, item cell | the window body, 40 % towards black; its rule the accent 45 % towards the window body |
| thumb or knob brass | the accent 15 % towards the window body |
| disabled face and rule | the button body and the mark, as greys |
| marks (ticks, X, arrows, glyphs) | the mark |

The flat cells are recoloured as below. The rest of this section is how a recolour maps colours (it is what the
flat cells get, and what the export did for all chrome before the redraw).

Each stock pixel is mapped by its luminance along ramps of that palette (`src/core/reskin/colour.ts`), so gradients
stay gradients:

- **neutral** (black and greys): ink → raised → button → pressed → accent;
- **gold** (rules and frames): ink → dark brass → accent → glow → a lighter glow. The bright gold hover frames land
  on the glow, as the NUI hover does. The dark brass step is the pressed colour when it has the accent's hue (Ink and
  brass's amber), else the accent darkened (Bronze's pressed is steel blue: gold must not pass through blue);
- **pressed** (the blue-cloud "down" frames): ink → pressed dark → pressed → towards the accent. The cloud's texture
  survives as a cloud in the skin's pressed colour;
- **signals** (bright reds, greens, blues): kept.

**Contrast.** The original GUI draws its rules, dividers and bevels with greys that differ from the fill as much by
alpha as by colour: the same `#636563` is the fill at alpha 64 and 102 and a rule at alpha 255; black at 128 darkens
the world behind; white at 102-166 lightens it. Two things can erase that, and the first reskin of Bronze did (the
character record's row rules, the tab rows and the inventory's bevels were gone in the game): the opaque alpha curve
(below) raises 64 and 102 to 228 and 235, next to 255, so alpha no longer separates rule and fill; and a skin whose
ink, title and button bodies are all near black (Bronze's are `#040302`, `#070604`, `#0A0806`) maps every grey to
one colour. So:

- the neutral steps get a floor of contrast against ink: raised 14, button 21, the rule colour 64 and the light
  colour 96 levels of luminance away from ink, a step the skin's own colour does not reach being moved towards the
  accent (Ink and brass's own raised and button clear it and stay as they are; Bronze's become `#14110B`, `#1D1810`,
  rule `#50422A`);
- with an opaque skin, a swatch texel, and a translucent dark or grey frame texel (the inventory cells), is placed on
  the neutral ramp by how the stock texel shows over a mid-dark world (luminance 80), not by its raw colour: black at
  255 → ink, black at 128 → ink, the fills (`#636563` at 64 and 102) → raised, the rule (`#636563` at 255) → the rule
  colour, white at 102-166 → the light colour and up to the accent.
- the tab strips (`gui_ig_chartabs`, `gui_ig_chartabs2`, `gui_ig_jourtabs`, `gui_pre_playtabs`) draw each tab's
  outline in the stock grey (`#636563`, opaque or at alpha 100-109) on black; as a frame's grey it lands on the raised
  step, which some skins draw darker than ink (Oxblood: `#341012` on `#581A1C`, the outlines vanished) or barely above
  it. An outline texel that would sit within the rule's 64 levels of ink takes the rule colour instead (Ink and
  brass's tab outlines become `#605239`, Bronze's `#50422A`; Brass's and Verdigris's are clear already and stay).

**Alpha.** The stock panels are translucent (alpha 64 and 102 over the world; rules at 36-48). A NUI skin whose window
body is opaque (alpha 240 or more) makes them dense too: 0 stays 0, 36 → 150, 48 → 160, 64 → 228, 102 → 235, 255
stays 255, and thin light rules become the glow so they stay visible. A translucent NUI skin keeps the stock alpha.
`--alpha keep|opaque` overrides it. Inventory highlight cells always keep theirs.

To check the match, open the NUI skin's widget sheet (`pnpm skin sheet`) next to the contact sheets: fill, rule,
pressed and hover should read as the same four colours. Then in the game, open a NUI window and an original one side
by side (the character record next to a NUI window of your module).

### Pitfalls

- **Alpha.** Keep alpha 0 where the stock has 0 (cut-outs, transparent cells) and keep each cell's alpha level, or
  boxes go solid or vanish. The reskin checks it; a hand-made texture must too.
- **DDS orientation.** A DDS is stored bottom row first relative to the TGA of the same texture: the first stored row
  is the bottom of the picture. Convert a TGA to DDS (or back) without flipping and the art comes out upside down
  (and button states swap). BioWare's DDS has a 20-byte header (width, height, bytes per pixel 3 = DXT1 or 4 = DXT5,
  the first level's size, the mean alpha), then every mip level to 1 x 1; keep all of it.
- **Texture priority.** The client looks for a texture by location first (development, then NWSync, then haks in
  hak-list order, then the base game; a player's `override/` folder does not beat the server's NWSync haks), and
  only within one location by format (KTX before DDS before TGA). Your hak
  is a location above the base game, so its DDS or TGA wins over the stock file in either format. Within one
  location, never ship one name as both DDS and TGA (the DDS wins, and any difference between the two is a trap): the
  reskin writes each name in one format only, and removes an older file of the other format from `textures/`. A KTX
  of the same name in the same hak wins over your DDS or TGA.
- **Per-player overrides against haks.** `SetTextureOverride(old, new, oPC)` swaps textures per player, but only once
  the player is in the module: character select and the creation wizard never see it. A theme in a hak **under the
  stock names** reaches every screen after connecting. So: ship one theme under the stock names (output A); if
  players should be able to choose, ship the others prefixed (output B) and switch per player
  ([Per-player themes](#per-player-themes-output-b)).
- **16-character names.** Resrefs (texture and hak names) have at most 16 characters. Several stock names are 16
  already (`ctl_con_prtl_inf`, `gui_boxes_chrgen`), and some differ only in their first part (`ctl_opt_gen` and
  `pnl_opt_gen`, `gui_slider` and the skin's `nui_slider`). So a prefix replaces the first part with one or two
  characters and that part's letter (`bzg_boxes_chrgen`, `bzc_opt_gen`, `bzp_opt_gen`): every name keeps its length,
  and none meet.
- **Keep the .txi.** The stock `.txi` (mipmap, filter, clamp settings) goes beside each texture under the same name;
  without it a texture may tile, blur or wrap differently.
- **Hak size.** Most panels are 24-bit TGAs in the game (512 x 512 is 768 KB): written as TGA the original-GUI hak
  is about 27 MB, as DDS about 6 MB ([Format and size](#format-and-size)). Players download it through NWSync, so
  keep the default `--format auto`.
- **Read the stock, not a theme.** The redraw finds each texture's rules and frames in the stock art: reading through
  a hak that already holds a theme redraws that theme instead, and a flat redraw has no bevels left to find. Use `--no-haks`
  (in the editor: untick "Read the stock textures through the module's haks too"). A hak named by `--out-hak` or
  `--prefix-hak` is left out by itself.
- **Light skins.** The original GUI's text is light whatever the textures say (see [the report](#the-report)).

### Format and size

102 of the 161 textures are 24- or 32-bit TGAs in the game. `--format` decides what they are written as:

| `--format` | A stock TGA is written as | Hak (Ink and brass, the game alone) |
|---|---|---|
| `auto` (default) | a DDS, unless its compression error is too high, DXT would move a flat face, or the DDS fails the flatness check (then the TGA) | 10.9 to 12.5 MB by skin (16 to 23 TGA) |
| `dds` | always a DDS | 9.3 MB (a few faces move in DXT: the flatness check fails on one) |
| `tga` | always the TGA (24-bit when opaque) | 43.3 MB |

A stock DDS stays a DDS (unless `auto` finds no DXT fit that passes the flatness check, below), with as many mip levels as the stock file has; a stock TGA whose txi
says `mipmap 0` is written with its base level only (the client draws that level at every size). The DDS is BioWare's: a 20-byte header (width, height, 3 for DXT1 or 4
for DXT5, the first level's size, the mean alpha), DXT1 for an opaque picture and DXT5 for one with alpha, every mip
level down to 1 x 1 as the game's own files have them, rows stored bottom first. The `.txi` stays beside it. The
encoder (`src/core/reskin/bc.ts`) fits each 4 x 4 block's endpoints on the colours' principal axis, then searches
the neighbouring 5:6:5 values of each endpoint; DXT5 alpha blocks keep a texel's 0 or not-0 first, then the block's
lowest and highest level exact. Mip levels are box-filtered.

`auto` decodes each DDS again and measures it against the TGA: the mean error over every texel, the mean over the
edge texels (rules, lines, text: where DXT artefacts show), the worst alpha error (each colour error scaled by the
texel's alpha, 0-255). It keeps the TGA when the mean is above 4, the edge mean above 12, the alpha error above 16, a
texel's alpha 0 moved, or a rule against a dark field was flattened. `report.md` lists every texture's numbers.

It also keeps the TGA when DXT would move a flat face (a texel whose 3 x 3 neighbourhood is one colour) by more than 4
levels: a 4 x 4 block that holds a frame's outer edge, its rule and the face can't store all three exactly, and the
face is what the flatness check reads. The encoder weighs face texels 12 times and tries each pair of a block's own
colours as its ends, which keeps most faces exact.

On Ink and brass, with the game alone, 16 stay TGA (4 MB): 13 button atlases and panels where a face would move 5 to
11 levels (`ctl_skill`, `ctl_class`, `ctl_opt_btn_key`, `ct_btn_srv_lst`, `ctl_pre_btn_save`, `pnl_party_bar`, ...),
`ctl_btn_jnl_inv` (its kept icons), `ctl_pre_new1` (its picture's edges) and `gui_rgbc` (4 signal colours in one 4 x 4
block: one DXT block holds 2).

Last, `auto` runs the old-GUI flatness check (`pnpm old-gui check`) on each decoded DDS. When the DDS fails it where
the drawing passes (a face that spreads more than 10 levels), it encodes again with face texels weighted 48 times,
then not weighted (the endpoint search lands differently each time), and keeps the TGA if none passes. A redrawn stock
DDS goes through the same tries, and through the redraw's own check (decoded mean error at most 6). So `old-gui check`
passes on every built-in skin's export with the default format:

| Skin | Hak | TGA |
|---|---|---|
| Ink | 11.9 MB | 16 |
| Bronze | 11.7 MB | 17 |
| Brass | 12.5 MB | 19 |
| Oxblood | 12.5 MB | 23 |
| Verdigris | 10.9 MB | 19 (one a stock DDS, `gui_chr_arrowbtn`) |

