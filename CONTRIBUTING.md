# Contributing

Thanks for helping. This file covers setup, the checks, how to add an element type, and the rules every change
follows. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the code map; [DESIGN.md](DESIGN.md) records why things are
the way they are, and [docs/GAPS.md](docs/GAPS.md) what is still open.
[docs/CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md) is the reference for how the client draws NUI.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Issues and pull requests

- **Issues** use forms ([new issue](https://github.com/plenarius/nwn-nui-designer/issues/new/choose)): "Draws
  differently from the game" (the window, a 1:1 in-game screenshot and the designer's picture), "Bug" and "Feature
  request". Security problems go privately, as [SECURITY.md](SECURITY.md) says, never in an issue.
- **Pull requests** get a template ([.github/pull_request_template.md](.github/pull_request_template.md)): what changed
  and why, the [checks](#checks) you ran, and for a change in client behaviour its evidence and the
  [CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md) update.

## Setup

You need Node.js 24 and pnpm (`corepack enable`).

```bash
pnpm install --frozen-lockfile
pnpm dev          # the editor at http://localhost:5173, reloading on save
```

An NWN:EE install is optional. Without one, the editor and the CLI draw with the built-in skins. Tests that need
the game skip themselves when there is none.

**Settings.** `nui-designer.ini` and the environment variables that beat it are described in the
[README](README.md#settings-nui-designerini). The editor's dev server (`src/node/localapi.ts`) and every CLI read it
through one loader, `src/node/settings.ts`.

**Game.** The command line uses `--game DIR`, else `NWN_ROOT`, else `game` in the ini (the folder with
`data/nwn_base.key`). It never searches for installs, so tests and golden runs use only a game they were given; the
editor does search (Steam, GOG, Beamdog; `src/node/detect.ts`) when the ini names none.

**Haks** for the golden check and the browser tests come from `--hak-dir DIR`, else `NWN_HAK_DIR`, else `hak_dir` in
the ini, in the order of the module's `module.ifo.json`: `--module-ifo FILE`, else `NWN_MODULE_IFO`, else
`module_ifo` in the ini, else `local/res/module.ifo.json`, else the one at `origin/ee` in the `nwn-module` checkout
(`NWN_MODULE`, default `../nwn-module`), the same commit the reference code comes from, whatever branch that checkout
is on. (`pnpm render` and the browser tests also take the ini's `haks` list when there is no `module.ifo.json`; the
golden check does not, as nui-preview needs the file.) A hak folder needs a hak order: without one, only the game is
used, and the golden check warns. Override folders: `--override DIR`, else the ini's `overrides`, else
`local/res/layo-skin/` when it exists. So in a fresh clone or a worktree (no `local/`), this is enough:

```bash
NWN_ROOT=/path/to/game NWN_HAK_DIR=/path/to/hak pnpm golden   # haks in the order of ../nwn-module's origin/ee module.ifo.json
```

or the same `game` and `hak_dir` in `nui-designer.ini` and a plain `pnpm golden`.

## Checks

Run these before you open a pull request:

```bash
pnpm typecheck    # tsc --noEmit
pnpm lint         # oxlint, configured in .oxlintrc.json
pnpm test         # unit tests (vitest), under a minute, no game needed
pnpm build        # the static site in dist/; also type-checks
pnpm smoke        # the editor's main flows in headless Chromium, built-in skin (after pnpm build)
pnpm e2e:skin     # the skin editor in headless Chromium (after pnpm build)
pnpm skin ship --check   # the committed built-in skins are exactly what the generator makes
```

The browser tests use Playwright's Chromium. Install it once with `npx playwright-core install chromium`. Both write
screenshots: `pnpm smoke` and `pnpm e2e` to `.golden-out/e2e/`, `pnpm e2e:skin` to `.out/phase3/`
(`$OUT_DIR/phase3` when `OUT_DIR` is set). Pass `--out DIR` to change that. With a game they draw the game's art, so
never commit those screenshots.

CI (`.github/workflows/ci.yml`) runs `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm smoke`, each
as its own step, on every pull request and every push to `main`, on a GitHub-hosted Ubuntu runner with Node.js 24 and the pnpm
that `packageManager` in `package.json` names (12.18.0). It has no game, haks, `uv` or `nwn_script_comp`, so the
tests that need them skip themselves; `pnpm smoke` is the only browser test it runs. To reproduce it locally, run the
same commands without the game (and without a `nui-designer.ini` naming one, or with `NUI_DESIGNER_INI=/dev/null`).
It also runs `tests/detect.real.test.ts` with `NUID_REAL_INSTALLS=1`, which writes fake installs to the runner's real
Steam, GOG and Beamdog folders (it refuses to run outside CI; never force it on your own computer).
`install-detection.yml` runs that test, the local settings tests and the hak order tests on Windows and macOS runners,
only when that code changes or by hand (Actions, "Run workflow"), as those minutes cost more. To reproduce `ci.yml`:

```bash
pnpm install --frozen-lockfile
env -u NWN_ROOT -u NWN_HOME -u NWN_HAK_DIR NUI_DESIGNER_INI=/dev/null pnpm test
pnpm typecheck && pnpm lint && pnpm build && pnpm smoke
```

The browser tests serve the built editor with the local API over a settings file of their own in a temporary folder
(`tests/serve.ts`), with no install search, so your `nui-designer.ini` and your installs do not change them.

Say in your pull request which of the other checks you ran.

### Checks that need more

| Command | What it checks | Needs |
|---|---|---|
| `pnpm e2e [--dump FILE]` | The editor's flows with the game's skin (`pnpm smoke` is the same without the game), on the widgets fixture or the window `--dump` names | `pnpm build`, a game |
| `pnpm roundtrip` | Every fixture (and local dump) exported as a `.jui` and read back: the same model, binds, rectangles, problems and pixels | a game |
| `pnpm skin:roundtrip` | Each built-in skin (and the game's) exported as a hak and read back, compared byte and pixel for pixel | (a game for the game's skin) |
| `pnpm golden` | This port against nui-preview, the Python reference (below) | a game, `uv`, nui-preview |
| `pnpm golden:layout [COUNT] [SEED]` | `COUNT` random layouts (default 500) solved by kiwisolver and by this port | `uv`, nui-preview (found as for `pnpm golden`, below; no game needed) |
| `pnpm nss:server --module DIR` | The NWScript export run on a real game server | Layonara's module repository and its test harness (Docker) |
| `pnpm bench:redraw [--dump FILE]... [--path P] [--profile DIR]` | How long a redraw takes: Alt+Arrow pressed 40 times on the window (or the element at tree path `P`), main-thread busy time per press; `--profile` writes a CPU profile and the time per area (build with `pnpm exec vite build --minify false` first for function names). [GAPS.md](docs/GAPS.md#speed) | `pnpm build`, local dumps (default `gods` and `furnplace@acts-arrange`), a game for the real skin |
| `pnpm fixtures` | Rewrites `fixtures/` from `fixtures/make.ts` | nothing |
| `pnpm screenshots [--dumps DIR] [--out DIR]` | Redraws the README's pictures in `docs/screenshots/` with the built-in skins and no game; refuses a window that shows an image. Run it when the UI or the drawing changes visibly | `pnpm build`, `local/dumps/furnplace@acts-arrange.json` (nwn-module's `tests/run.sh --nui`; else a fixture stands in), `oxipng` on the `PATH` to shrink the PNGs |

The NWScript compile test in `pnpm test` runs only when `nwn_script_comp` (from
[neverwinter.nim](https://github.com/niv/neverwinter.nim)) is on the `PATH` and a game is found; otherwise it is
skipped.

### The golden check

The layout, rendering and checks were ported from **nui-preview**, a Python renderer in Layonara's module repository.
The golden check draws the same windows with both and compares every element's rectangle, the problems, the font
metrics and the pixels:

```bash
pnpm golden                              # the fixtures, plus local/dumps/{cnr-carpenter,gods,achv}.json if present
pnpm golden local/dumps/*.json fixtures/*   # any windows
pnpm golden --tolerance 16               # count pixels that differ by more than 16 (default 32)
pnpm golden --text-model nui-preview     # this port with the old em text model
```

It needs:

- the game (`$NWN_ROOT`, or `game` in `nui-designer.ini`);
- [uv](https://docs.astral.sh/uv/), which fetches Pillow and kiwisolver for the Python side;
- nui-preview: the folder in `NUI_PREVIEW`, or the `nwn-module` checkout at `NWN_MODULE` (default `../nwn-module`,
  next to this one; it reads `tools/nui-preview` from `origin/ee`). That repository is not public, so outside
  contributors cannot run the golden check. Say so in your pull request; a maintainer will run it.

When one of these is missing, it says which. Haks and loose files (`--hak-dir`, `--module-ifo`, `--override`) are
found as in [Setup](#setup). It prints how many haks it loaded
and from where, warns when a hak folder was given but no haks loaded or some the module lists are missing, and the
summary's "Haks: N" says how many were used.

Problems are compared by kind and path. The designer's `unsolvable size` findings (its port of nwn-module's
`nui_i_check`, `src/core/render/check.ts`) have no counterpart in nui-preview: they are counted apart ("1 / 1 + 1
nui_i_check") and left out of the comparison. Results go to `.golden-out/summary.md`, and side-by-side pictures (Python | TypeScript | diff, red where a
channel differs by more than the tolerance) to `.out/` at the repository root, whatever the current directory (set
`OUT_DIR` to change it). `.out/` is ignored by git.

When a change moves the headline numbers, update the summary in [DESIGN.md](DESIGN.md#the-golden-check).

### Local inputs

The ignored folder `local/` holds inputs that must never be committed:

- `local/dumps/*.json`: window dumps from a live module (made by nwn-module's `tests/run.sh --nui`);
- `local/res/module.ifo.json`: a module's hak order (the haks themselves are read from the hak folder); without it, the
  `nwn-module` checkout's at `origin/ee` is used;
- `local/res/layo-skin/`: loose skin files laid over the haks (named for Layonara's skin, the maintainer's example; any
  server's loose skin files can go there).

## Code layout

`src/core` is everything that is not UI (no DOM, no Node, no framework); `src/app` is the React editor; `src/node` the
Node file access, the local API and the CLIs; `tests/`, `golden/` and `fixtures/` the checks; `assets/skin/` the
generated built-in skins; `tools/open-skin/` the fonts' pins and Python research tools. The module map, file by file:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#module-map).

## Adding an element type

NUI's element types are fixed by the client, so a "new widget" here means one `nw_inc_nui.nss` makes that the
designer does not handle yet. Touch these places, in this order:

1. **`src/core/model/nui.ts`**: the builder, written to produce exactly the JSON `nw_inc_nui.nss` produces.
2. **`src/core/edit/catalog.ts`**: an entry in `ELEMENTS` with its `type`, `title`, `builder`, palette `category`,
   `container` rule, its properties (`kind`, `bindable` exactly where `nw_inc_nui.nss` documents `Bind:...`,
   `float` where the builder takes a float) and a `make()` default built with the `nui.ts` builder.
3. **`src/core/render/render.ts`**: a case in `widget()` that draws it, using the skin keys the client uses for it.
   If the layout gives it a default size, that goes in `src/core/layout/layout.ts` (`DEFAULT_WIDTH`).
4. **`src/core/edit/nwscript.ts`**: a case that writes its builder call, so the export rebuilds the same JSON.
   **`src/core/edit/jui.ts`**: mark float parameters if the builder writes floats.
5. **`src/core/edit/validate.ts`** and **`src/core/render/check.ts`**: any rules the client applies to it. Both reach the
   Problems panel and `pnpm check` through `src/core/edit/lint.ts`: never add a check to one of them only. A check that
   needs the font or the screen (as "tooltip off screen") is a renderer problem in `render.ts` instead: give its kind
   a severity in `layoutSeverity` (`issues.ts`), and add it to the golden's `CHECK_ONLY` if nui-preview does not
   report it.
6. **`src/app/editor/icons.tsx`**: a palette icon.
7. **`fixtures/make.ts`**: add it to a fixture, then `pnpm fixtures`.
8. Run `pnpm test` (the NWScript export test builds a window of every palette element and checks that the script
   rebuilds it), `pnpm smoke`, and the golden check if you can.

Cite where the behaviour comes from (the script, a measurement in game, or the client's documented behaviour) in a
comment or in DESIGN.md. A new fact about the client goes in [docs/CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md)
with its evidence marker, and the code cites its section.

## Changing the built-in skins

The files in `assets/skin/` are generated. Change the generator (`src/core/skin/gen/`, the presets in `style.ts`),
then run `pnpm skin ship` and commit the result. `pnpm skin ship --check` and `pnpm test` fail when the committed
files differ from what the generator makes. The fonts are pinned with their sha256 in `tools/open-skin/sources.toml`.

## Rules

- **Never commit game assets.** No Beamdog file (textures, models, fonts such as `fnt_maintext`, `nui_skin.tml`,
  2DAs, scripts' text), no screenshot or render that shows the game's art, and no content from a live server's haks
  or dumps. Tests and tools read the game from the user's own install at run time. Keep such files in `local/` or
  outside the repository.
- **Only open licences.** New art is CC0 (or drawn by code); new fonts are OFL or similar and unmodified; new
  dependencies have a permissive licence. Add every new third-party part to [PROVENANCE.md](PROVENANCE.md) with its
  source and licence.
- **Reimplement, don't copy.** Facts about the game's formats and the client's behaviour are fine; code or comments
  copied from Beamdog's scripts or binaries are not.
- **`src/core` stays framework-free**: no DOM, no Node API, no React. Hosts pass in bytes, a canvas factory and an
  image decoder.
- **The window JSON is the model.** Keys the editor does not know must survive every edit and every export.
- **Resrefs are at most 16 characters**: file names in a skin, hak names, `.jui` names.
- **Keep the docs current**: a decision and its one-line reason go in [DESIGN.md](DESIGN.md), under its topic; anything
  left approximate or unknown goes in [docs/GAPS.md](docs/GAPS.md), and is deleted from there when fixed (git keeps
  the history). Say what is true now, once: link to the doc that owns a fact instead of repeating it.
- Plain, short English in docs and messages.
