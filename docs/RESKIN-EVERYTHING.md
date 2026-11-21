# How to reskin everything

A theme is complete only when it restyles **both** GUIs the game draws:

- the **NUI** windows (`nui_skin.tml` and the `nui_*` textures: what this designer edits), and
- the **original GUI**, the MDL-panel windows from before NUI: character record, inventory, spellbook, chooser and
  radial, chat, quickbar, the DM bar, options, character select (the vault), the module list and the
  character-creation wizard.

Never mix and match: a NUI skin over the stock original GUI (or the reverse) is half a theme. **One step exports the
whole theme**: `pnpm export-theme` (or **Export skin → Full theme** in the skin editor) takes a NUI skin, retones the
original GUI's textures from your own game to match it, checks them, and writes both together, ready for a hak. A
person or an agent can follow this guide from start to finish without asking anything.

Contents: [Prerequisites](#prerequisites) · [Export the full theme](#export-the-full-theme) ·
[What it writes](#what-it-writes) · [Output A: one theme for everyone](#output-a-one-theme-for-everyone) ·
[Per-player themes (output B)](#per-player-themes-output-b) · [The report](#the-report) ·
[The original GUI's inventory and checks](#the-original-guis-inventory-and-checks) ·
[What goes wrong in game](#what-goes-wrong-in-game) · [Fonts](#the-original-guis-fonts) ·
[Check and test](#check-and-test) · [Checklist](#checklist-the-theme-is-complete) ·
[Appendix: how it works](#appendix-how-it-works)

> **Status.** The export below still **recolours** most of the original GUI's chrome. In game a recolour is not
> enough: the windows keep the stock bevels, gradients and parchment in the new colours, and some controls break
> ([What goes wrong in game](#what-goes-wrong-in-game)). `pnpm old-gui` now takes a full inventory of the original
> GUI from your game and checks a theme against it; its coverage and flatness checks fail on today's export, on
> purpose. A redraw of the chrome from the skin's own colours replaces the recolour next
> ([GAPS.md](GAPS.md#the-original-gui)).

## The rule: no game art in a repository

The export reads the stock original GUI from **your own install** and writes everything it makes to a folder you
choose (or a zip you download). The retoned textures are derived from Beamdog's art: share them with your players in
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
   - a built-in skin: `ink`, `bronze`, `brass`, `verdigris` or `oxblood` (the README's skins table);
   - a generator preset: `a-bronze`, `b-clean`, `d-iron`, `s-brass`, `s-verdigris`, `s-oxblood`;
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

The exit code is 0 when every texture passed its checks, 1 when one failed (`report.md` says which), and 2 for a
usage error: no game, a bad prefix, an unknown skin. A whole theme takes about a minute (most of it DDS
compression), about 80 seconds on a slow core.

In the editor: **Skin** → open the skin → **Export skin** (Ctrl+E) → **Full theme**. The tab says why it can't run
(no game loaded, no generator style) and shows the light-skin warning before you build. **Build the theme** shows its
progress, then a summary and **Download NAME-theme.zip**: the same files as the command line (output A and its hak
named after the skin; with **Also under a prefix**, output B, its hak `NAME_p` and `prefixed.json`), without the
contact sheets. "Read the stock textures through the module's haks too" is `--no-haks` when unticked.

## What it writes

| | |
|---|---|
| `stock/` | **output A**: the NUI skin (`nui_skin.tml`, its textures and fonts, the fonts' OFL texts, the licence note) and the retoned original GUI (100 textures, each with its stock `.txi`), all under the **stock names** |
| `NAME.hak` | output A as a hak (`--out-hak`) |
| `prefixed/` | **output B** (`--prefix`): the same files under the prefix |
| `prefixed.json` | output B's map: each stock texture to its prefixed name, and the skin's resref |
| `NAME.hak` | output B as a hak (`--prefix-hak`) |
| `report.md` | what was themed, what is left stock and why, failed checks, and the light-skin warning ([The report](#the-report)) |
| `reskin-manifest.json` | per original-GUI texture: where the stock one was read (game, hak, folder), its stock format and the format written, size, bytes, recoloured or redrawn, the compression error, the checks |
| `contact-*.png` | stock and new side by side, one sheet per group (command line only) |

Bronze, for scale: `stock/` holds 220 files (the NUI skin's 38: the `.tml`, 32 textures, 2 fonts, 2 OFL texts and the
note; 100 original-GUI textures, 97 DDS and 3 TGA; 82 `.txi`), and each hak is about 6.9 MB.

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

On today's export (Ink and brass), coverage fails on 145 of the 148 chrome textures (recoloured) and flatness on 52
of the 97 it checks: that is the gap the redraw closes. The same checks pass on a complete hand-made redraw of the
whole set.

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
  the ends of a row. A stretched cell must be one colour along its stretch.
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
in a hak (the game's own `.txi` for each name, contrast and outline only, still applies). Replace all three or none:
the check fails on a partial set. `fnt_maintext` is also the font of a NUI skin entry that names no resref of its
own, so replacing it changes those NUI windows too.

- **Licence.** Ship only a font whose licence allows it (the built-in skins' fonts are SIL OFL 1.1: ship the licence
  text beside them), never one of the game's.
- **Coverage.** A font with Latin-1 only can't draw the rest of a player's code page.
- **For everyone, not per player.** The client loads its fonts once, so a per-player theme can't switch them:
  every player on the server gets the hak's fonts, whichever theme they chose.
- **Testing on your machine.** Put the three files in the game's user `development/` folder. A player's
  `override/` folder does **not** beat the haks a server sends through NWSync; `development/` does.

## Check and test

1. **Run `pnpm old-gui check`** with the inventory of your game and the theme's `stock/` folder
   ([The original GUI's inventory and checks](#the-original-guis-inventory-and-checks)). Settle every failure.
2. **Read `report.md`.** Settle every failed check (redraw the texture by hand, or leave it out of the hak) and every
   texture left to a person (keep it, recolour it by hand, or draw new art).
3. **Open each `contact-*.png`.** For every texture: button atlases keep their three frames (up, down, hover) at
   their places, up the skin's button, down the pressed colour, hover the glow; thin rules read as the accent, not lost
   in the fill; red, green and blue signal cells stay as they were.
4. **Test in the game**: the `development/` folder for a quick look (not `override/`: it loses to the server's
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
- [ ] Every contact sheet was looked at: states in place, rules visible, signals kept.
- [ ] Every texture in `report.md`'s "Left to a person" was decided: kept, recoloured or redrawn.
- [ ] In the game, with the hak: character select (vault), module list, the creation wizard (every page), the
      character record, inventory (with an item stack split), spellbook, radial menu, chat, quickbar, DM bar,
      options and key bindings, a message box, and a NUI window of the module, all in the same look.
- [ ] For output B: a player switched to the prefixed theme sees it on both GUIs, and switching back restores output A.
- [ ] The hak is in the module's hak list, built and released.
- [ ] Nothing derived from the game's art was committed to a public repository.

## Appendix: how it works

The full-theme export is the NUI skin's own export (what **Export skin → .hak** holds) plus `pnpm reskin`'s retoned
original GUI, in one package (`src/core/reskin/theme.ts`). The rest of this guide is how the original GUI is retoned,
and what to know to retone or redraw a texture by hand.

### How the skin's colours map

| The skin's | becomes, in the original GUI |
|---|---|
| window body (`fixed_background`, `nui_windowh`) | the panel fill (the stock black and translucent grey) |
| title body (`nuio_title`), button body | the raised greys: title bars, button fields |
| active body (pressed / selected) | the stock blue-cloud "down" frames, selection cells |
| accent (`border_color`) | the gold rules and frames |
| glow (hover) | the bright gold hover frames, thin light rules |
| mark (ticks) | check marks, the yellow marker cell |
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

100 textures in four groups. The inventory ([above](#the-original-guis-inventory-and-checks)) counts 148 chrome
textures to redraw and 18 that are flat already, of 476 drawn: the reskin covers part of them, and recolours most of
those it covers.

| Group | Count | What they are | How |
|---|---|---|---|
| **Colour swatch strips** (`gui_boxes*`, `gui_replace01-06`, `gui_ig_main`, `gui_lightning`, `gui_rgbc`, `gui_textbubble`) | 14 | Strips of colour cells. Models stretch one or two texels of a cell over a box, a bevel or a divider, so these colour almost every panel at once. | Recoloured cell by cell; the cells never move (UVs point at them). Alpha as below. |
| **In-game frames, buttons and controls** (`ctl_*`, `pnl_opt_*`, `edit_box_*`, `qb_but`, `inv_stacksplit`, tab strips, inventory cells) | 40 | Whole-panel and button images drawn 1:1: a black field with gold rules; buttons hold up / down / hover frames in one atlas. | Recoloured per pixel by luminance, so frames, states and layout stay exactly where they were. The painted town picture inside `ctl_edt_mod_in1` is kept as it is. |
| **Character select, pre-game and creation wizard** (`ctl_cg_*`, `pnl_playmod*`, `gui_pre_bkgnd01/02`, `pre_load_01`, ...) | 43 | The same kind of frame art on the screens before the game. | As the frames. 32-bit cut-out buttons (the creation arrows, the help button) keep their alpha byte for byte. |
| **Scrollbar, arrow buttons, slider** (`gui_scrollbar`, `gui_chr_arrowbtn`, `gui_slider`) | 3 | Tiny pixel-art pieces. | Redrawn from the skin's own `nui_scrollv`, `nui_button_n`, `nui_cnt_up/down` and `nui_slider`, so the two GUIs' scrollbars match. |

Every texture keeps the stock **name, size, pixel layout and alpha layout**. A stock DDS keeps its format, header,
mip chain and block order (a DXT5 DDS stays a DXT5 DDS with the same number of levels); a stock TGA is recoloured in
place (same header, origin bit and row order) and then, with `--format auto` or `dds`, compressed to a DDS
([Format and size](#format-and-size)). Only colours (and, for DXT5 with an opaque skin, alpha) change. The checks
(in `manifest.json`), each against the stock texture decoded:

- same file length, same header and same size (for the recolour, before any compression);
- alpha 0 exactly where the stock has 0, alpha equal to the stock one (or the stock one through the curve, within
  one DXT5 step);
- luminance following the intended picture (the stock one mapped texel by texel), and following it the right way up
  (a moved layout fails, and so does a TGA or DDS whose rows run the wrong way). The stock picture itself is not the
  reference: a light skin turns its black fields into light paper, which inverts the luminance on purpose;
- **every rule and divider still visible**: the stock picture's edges (neighbouring texels that differ by 24 or more,
  as they show over black and over a mid-dark world) must not be flattened. One rule against a dark field (80 apart
  in the stock) lost fails the texture, and so does a quarter of all the kinds of edge. The recolour is judged on
  its own (the stock picture mapped texel by texel); what DXT's 4-colour blocks flatten on top is noted in the
  manifest;
- for redraws, the decoded file against the drawing and against the drawing upside down (a DDS stored the wrong way
  fails).

### What is left to a person

`report.md` lists these (about 100 names) with whether your install has each. Decide per texture: keep it, recolour
it by hand, or draw new art.

| Class | Examples | Why not automatic |
|---|---|---|
| Icons | radial menu atlas, journal and inventory button icons, party-bar icons, compass, stat icons, slot silhouettes | Painted pictures. A gold-to-accent recolour may suit some; anything more is new art. |
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
every state frame at its place, and put the file in `DIR/textures/` before building the hak. Run the checks again by
comparing it with the stock file in the contact sheet.

### How the two GUIs are made to match

The palette comes from the skin's generator style (`src/core/reskin/palette.ts`); `manifest.json` records it. Each
stock pixel is then mapped by its luminance along ramps of that palette (`src/core/reskin/colour.ts`), so gradients
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
- **Don't recolour twice.** Reading through a hak that already holds a reskin recolours the reskin. Use `--no-haks`
  (in the editor: untick "Read the stock textures through the module's haks too"). A hak named by `--out-hak` or
  `--prefix-hak` is left out by itself.
- **Light skins.** The original GUI's text is light whatever the textures say (see [the report](#the-report)).

### Format and size

67 of the 100 textures are 24- or 32-bit TGAs in the game. `--format` decides what they are written as:

| `--format` | A stock TGA is written as | Hak (Ink or Bronze) |
|---|---|---|
| `auto` (default) | a DDS, unless its compression error is too high (then the TGA) | 6.2 MB (64 DDS, 3 TGA) |
| `dds` | always a DDS | about 6.2 MB |
| `tga` | always the TGA | 26.7 MB |

A stock DDS stays a DDS whatever the option. The DDS is BioWare's: a 20-byte header (width, height, 3 for DXT1 or 4
for DXT5, the first level's size, the mean alpha), DXT1 for an opaque picture and DXT5 for one with alpha, every mip
level down to 1 x 1 as the game's own files have them, rows stored bottom first. The `.txi` stays beside it. The
encoder (`src/core/reskin/bc.ts`) fits each 4 x 4 block's endpoints on the colours' principal axis, then searches
the neighbouring 5:6:5 values of each endpoint; DXT5 alpha blocks keep a texel's 0 or not-0 first, then the block's
lowest and highest level exact. Mip levels are box-filtered.

`auto` decodes each DDS again and measures it against the TGA: the mean error over every texel, the mean over the
edge texels (rules, lines, text: where DXT artefacts show), the worst alpha error (each colour error scaled by the
texel's alpha, 0-255). It keeps the TGA when the mean is above 4, the edge mean above 12, the alpha error above 16, a
texel's alpha 0 moved, or a rule against a dark field was flattened. `report.md` lists every texture's numbers.

On the game's textures (Ink and Bronze alike) the panels and buttons come out at a mean of 1-3 and an edge mean of
4-9, and 3 stay TGA:

| Texture | Why it stays TGA |
|---|---|
| `gui_rgbc` | a 4 x 4 swatch of 4 signal colours (red, green, blue, the marker yellow): one DXT block holds 2 (mean error about 110) |
| `ctl_chk_pre` | a 16 x 16 checkbox of hard 1 px pixel art (mean error 9-10) |
| `ctl_cg_btn_right` | the creation wizard's 32-bit cut-out arrow: its anti-aliased rim's alpha would move by 17 |

These three are 9 KB together, so keeping them costs nothing.
