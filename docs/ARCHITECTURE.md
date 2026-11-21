# Architecture

The code map: the modules, and how a window goes from JSON to pixels. Why each choice was made:
[DESIGN.md](../DESIGN.md). Setup, tests and rules: [CONTRIBUTING.md](../CONTRIBUTING.md). What the game client does
that the code imitates: [CLIENT-BEHAVIOUR.md](CLIENT-BEHAVIOUR.md).

## Three hosts, one core

```text
                 ┌────────────────────────────── src/core ──────────────────────────────┐
                 │  model   layout   render   res   font   skin   edit   view   session │
                 └──────────────────────────────────────────────────────────────────────┘
                     ▲ bytes, a canvas factory, an image decoder (each host supplies them)
        ┌────────────┴────────────┐   ┌───────────┴───────────┐   ┌────────────┴────────────┐
        │ src/app (browser, React)│   │ src/node (CLI)        │   │ tests/, golden/         │
        │ platform.ts: File System│   │ fs.ts: @napi-rs/canvas│   │ vitest, Playwright,     │
        │ Access API, <input>,    │   │ setup.ts: open game,  │   │ the golden check        │
        │ createImageBitmap       │   │ haks, folders         │   │                         │
        └─────────────────────────┘   └───────────────────────┘   └─────────────────────────┘
```

`src/core` has no UI framework and no DOM or Node API. It takes bytes through `ByteSource` and `FileTree`, a
`CanvasFactory` that makes Canvas 2D canvases, and a `BitmapDecoder` for PNG, JPEG and GIF. The browser
(`src/app/platform.ts`) and Node (`src/node/fs.ts`, `src/node/setup.ts`) each provide those. So the editor, the CLI,
the unit tests and the golden check all run the same drawing code.

## Module map

| Folder | Role | Main files |
|---|---|---|
| `src/core/model/` | The window JSON and what can be opened | `types.ts` (`NuiDocument`, JSON types), `input.ts` (`.jui`, JSON, `JsonDump` strings, nui-preview dumps), `binds.ts` (resolving binds), `nui.ts` (the `nw_inc_nui.nss` builders) |
| `src/core/layout/` | The constraint layout | `layout.ts` (builds the Kiwi constraints for rows, columns, groups and lists, as the client does), `kiwi/` (vendored `@lume/kiwi`, with sorted maps so ties break as in C++ Kiwi) |
| `src/core/render/` | Drawing and checks | `render.ts` (`Renderer`: window chrome, every widget, draw lists, clipping, outlines, problems), `text.ts` (glyph masks, wrapping, clamping), `slice.ts` (the client's 9-slice margins per skin key), `check.ts` (layout rules the client enforces), `surface.ts` and `canvas.ts` (the drawing seam), `resample.ts` (Pillow-compatible resizing) |
| `src/core/res/` | Game resources | `resman.ts` (layers: haks, loose files, `ovr/`, texture packs, KEY/BIF), `containers.ts` (ERF/HAK/MOD, KEY/BIF, folders), `gff.ts` (a small GFF reader), `hakorder.ts` (a module's hak order from a `module.ifo`, a `.mod` or a `module.ifo.json`), `images.ts` (the client's image lookup and decoding), `tga.ts`, `dds.ts`, `erfwrite.ts`, `tgawrite.ts`, `zip.ts` |
| `src/core/font/` | Fonts | `font.ts` (opentype.js outlines; the Nuklear and em text models), `fontinfo.ts` (code-page coverage, atlas estimate) |
| `src/core/skin/` | `nui_skin.tml` and skins | `toml.ts` (reader), `tmldoc.ts` (format-keeping editor), `skin.ts` (the skin the renderer uses), `keys.ts` (every key the client reads), `check.ts` (the skin checker), `project.ts` (skin projects and export plans), `sheet.ts` (widget-states sheet), `themes.ts` and `fallback.ts` (built-in skins), `gen/` (the texture generator) |
| `src/core/reskin/` | The original GUI to match a skin, and the full theme (`pnpm reskin`, `pnpm export-theme`, [RESKIN-EVERYTHING.md](RESKIN-EVERYTHING.md)) | `palette.ts` (the palette from a generator style), `colour.ts` (the per-pixel mappings and the alpha curve), `retone.ts` (DDS and TGA recoloured in place: the flat cells), `bc.ts` (DXT1/DXT5 blocks, BioWare DDS), `compress.ts` (a TGA to DDS, the error that decides `--format auto`), `validate.ts`, `textures.ts` (what is handled and what is left), `reskin.ts`, `theme.ts` (the full theme: the skin and the retone as outputs A and B, the prefix, the light-skin check, the report) |
| `src/core/oldgui/` | The original GUI's inventory and checks (`pnpm old-gui`, [RESKIN-EVERYTHING.md](RESKIN-EVERYTHING.md#the-original-guis-inventory-and-checks)) | `mdl.ts` (binary and ASCII GUI models: meshes, texture vertices, state animations), `guilayout.ts` (`.gui` layouts), `txi.ts`, `collect.ts` (every GUI model, layout, client name and txi link through a ResMan), `cells.ts` (the UV cells each model samples, their stretch, the texels filtering reads), `roles.ts` (each texture's role and treatment, the fill bars, the font names), `inventory.ts` (the TSV and cells file), `checks.ts` (categories, coverage, state icons, fill bars, flatness, fonts), `texture.ts` (a GUI texture the way up the models show it), `draw/` (the redraw: `style.ts` the colours from a palette, snapped to exact 5:6:5; `rules.ts` the stock's rules and frames found; `redraw.ts` button atlases, panels, colour strips, shapes, stretched cells made flat; `hand.ts` the small controls, bars, tabs, radial and the Player List drawn by hand; `index.ts` which texture gets which), `preview/` (the screens: `render.ts` a software renderer for the panel models, txi filter and clamp honoured, fill levels; `scene.ts` a screen's pieces; `screens.ts` every `.gui` layout and the panels the client builds in code laid out on their hooks, the bars at each level; `frames.ts` the frame-continuity check) |
| `src/core/edit/` | The editor's model | `project.ts` (`EditorDoc`, project files), `tree.ts` and `ops.ts` (pure edits by path), `history.ts` (undo), `catalog.ts` (every element type and property), `binds.ts` (sample values and presets), `validate.ts`, `style.ts` and `styles/` (house rules), `issues.ts` (the renderer's problems as the editor tells them, identical notes grouped), `lint.ts` (the problem list itself: client checks, style rules and layout problems, worst first; the editor and `pnpm check` both use it), `drop.ts` (drop targets), `resize.ts` (sizes dragged on the canvas: snapping and the size edits), `selection.ts` (the selection of several: the key, ranges, the box, what survives an undo), `multi.ts` (delete, duplicate, move and property sets on the selection), `arrange.ts` (match size, align and distribute, measured with `layoutView`), `jui.ts` (the `.jui` writer), `nwscript.ts` (the NWScript export and its evaluator) |
| `src/core/view.ts` | Draws a document | `renderView`; `layoutView` (the same layout, outlines and problems with nothing drawn: the arrange tools measure with it) |
| `src/core/session.ts` | Opens a resource set | `openResourceSet` |
| `src/core/errors.ts` | One way to turn a thrown value into a message | `errorText` |
| `src/app/` | The React UI | `App.tsx`, `editor/` (window editor panels, `Canvas.tsx`, files and autosave), `editor/a11y.ts` (keyboard support for clickable rows and headers), `editor/Modal.tsx` (every dialog: a native modal `<dialog>`), `skin/` (skin editor: `SkinMode.tsx`, `KeyEditor.tsx`, `FontPanel.tsx`, `GeneratorPanel.tsx`), `platform.ts`. The skin editor, both export dialogs and `skin/project.ts` load on first use (see below) |
| `src/node/` | Node | `cli.ts` (`pnpm render`), `check.ts` (`pnpm check`: the Problems panel's list for each window, as text, JSON or GitHub annotations), `skin.ts` (`pnpm skin`), `reskin.ts` and `reskinsheet.ts` (`pnpm reskin` and its contact sheets), `theme.ts` (`pnpm export-theme`), `oldgui.ts`, `oldguicheck.ts` and `oldguipreview.ts` (`pnpm old-gui`: inventory, checks, previews and the frame check), `openskin.ts` (the built-in skins and presets on disk, the skin a CLI is given), `stockres.ts` (the stock textures' resources, the out-of-repository rule), `setup.ts` (game and hak loading: `--game`, `$NWN_ROOT` or the ini, a module's haks), `fs.ts`, `settings.ts` (`nui-designer.ini`: the one loader the CLIs and the dev server share), `detect.ts` (Steam, GOG and Beamdog installs, the user's hak folder; the Windows registry for Steam and Documents), `hakorder.ts` (the hak order file on disk), `filesource.ts` (a file as a `ByteSource`), `localapi.ts` (the dev server's local API) |
| `src/app/local.ts` | The local API's client | `HttpSource` (a `ByteSource` read with HTTP Range requests), `HttpTree` (the install's file list as a `FileTree`), the state and settings calls |

## From a `.jui` to pixels

```text
 .jui / JSON / dump ──► model/input.ts ──► NuiDocument { name, window, binds, panes }
                                                 │
 game, haks, loose files ──► session.ts ──► Resources { resman, skin, images }
                             (res/resman.ts, skin/skin.ts, res/images.ts)
                                                 │
                         view.ts renderView(doc, skin, images, canvasFactory, options)
                                                 │
                         render.ts Renderer.window()
                           1. window geometry and chrome (title bar, border)
                           2. layout.ts: Kiwi constraints for the root ──► a rectangle per element
                           3. each element: binds resolved, the widget drawn with its skin keys
                              (slice.ts 9-slices, text.ts with font.ts, images from images.ts),
                              lists and groups laid out and clipped in turn, draw lists on top
                           4. check.ts and the widget code record problems
                                                 │
                         Surface (surface.ts) over a Canvas 2D canvas
                                                 │
                ViewResult { canvas, problems, outlines, windowRect }
```

1. **Input.** `loadDocument` (`model/input.ts`) accepts a `.jui`, window JSON (also a quoted `JsonDump`), a
   nui-preview dump or a bare layout element, and returns a `NuiDocument`. The JSON is kept as it is: there are no
   model classes, so unknown keys survive.
2. **Resources.** `openResourceSet` (`session.ts`) layers the haks (first wins), loose files and the game, as the
   client does. It reads `nui_skin.tml` from them, or uses a built-in skin when there is no game or the user chose
   one. Images are looked up by the client's order of formats (`dds`, `jpg`, `tga`, `png`, `gif`, `wbm`).
3. **Layout.** `layout.ts` turns rows and columns into the same Kiwi constraints the client builds, at the same
   strengths and in the same order, and solves them. Lists solve their row template per row; groups solve their
   child inside their content area.
4. **Drawing.** `Renderer` draws the chrome, then each element. Skin textures are 9-sliced with the client's margins
   for that key. Text is laid out by the chosen text model (Nuklear's by default) and rasterised from opentype.js
   outlines. Images load asynchronously, so `renderView` draws, loads what was asked for, and draws again (at most a
   few passes).
5. **Output.** The canvas, the problems, and an `Outline` for every drawn element: its rectangle, its path and the
   JSON object itself. The editor uses the outlines for hit testing, selection and drop targets.

## The local API

The editor runs on this computer (`pnpm dev`), so its server reads the disk for it:

```text
 nui-designer.ini ─┐                                  GET /api/local/state   ─► settings, installs found, the game's
 NWN_ROOT, ...  ───┼─► settings.ts ─► localapi.ts ──►                            file list, haks in order, windows
 Steam/GOG/Beamdog ┘   detect.ts      (Vite plugin)    PUT /api/local/settings ─► checked, written to the ini
                                                       GET /api/local/windows  ─► the windows folder with titles
                                                       GET /api/local/file?root=game&path=data/nwn_base.key (Range)
                                                                  │
 src/app/local.ts: HttpTree (FileTree) and HttpSource (ByteSource, reads = Range requests) ──► openResourceSet
```

The containers read through the same `ByteSource` interface as from a picked folder, so the browser fetches only the
bytes it draws (a hak's directory, a texture), never a whole BIF. The server answers only localhost, and serves a
file only inside the configured folders (`confine`). Without the API (a static build elsewhere) the editor falls back
to the browser's pickers (`platform.ts`). The CLIs read the same ini through `settings.ts`. Decisions:
[DESIGN.md](../DESIGN.md#local-settings-and-the-local-api).

## The editor

- **State.** An `EditorDoc` (`edit/project.ts`): the window JSON, sample bind values, panes, notes and export
  settings. Every edit (`edit/tree.ts`, `edit/ops.ts`) is a pure function from one document to the next, copying
  only the objects on the path to the change. Undo is a stack of documents (`edit/history.ts`).
- **Paths.** An element is addressed by the child indices from the root. The renderer's outlines hold the same
  objects as the document, so a map from object to path finds the element under the pointer.
- **Selection.** A list of paths, the key element first (`edit/selection.ts`), held in `useEditor.ts` outside the
  history. The tree and the canvas pick with Ctrl/Cmd (toggle) and Shift (a range), the canvas also with a box from an
  empty place. With several selected the properties panel is `editor/ArrangePanel.tsx`: the arrange tools and the
  shared properties.
- **Arrange.** `edit/arrange.ts` takes a `Measure`, a function from a document to its laid-out rects and the
  client's refusals. The app builds it on `layoutView` with the canvas's skin and screen; the unit tests on the
  built-in skin. Each tool edits, measures, adjusts and checks, and throws an `EditError` with the reason when it
  cannot, so `apply()` shows a toast and the history does not change.
- **Redraw.** `src/app/editor/Canvas.tsx` calls `renderView` after each change and draws the selection and drop
  targets over the result. The Problems panel merges the renderer's problems with `edit/validate.ts` (types, ranges,
  binds, unknown keys) and the optional style rules, through `edit/lint.ts` and `edit/issues.ts` (`pnpm check` runs the same code): an empty bound text box with no sample
  value is reported as that, a window whose geometry the game sets gets one note instead of layout problems at the
  default size, and identical notes share a row. The renderer's own list stays as nui-preview reports it (the
  golden compares it).
- **Files.** Projects, the `.jui` and NWScript exports, and autosave (IndexedDB) live in `src/app/editor/files.ts`
  and `edit/project.ts`, `edit/jui.ts`, `edit/nwscript.ts`.

## The skin editor

- **Loading.** The skin editor is a separate chunk, loaded when the Skin tab is first opened (`React.lazy` in
  `App.tsx`); `useSkin.ts` stays in the app and imports `skin/project.ts` and `skin/preview.ts` only once there is a
  project. The window editor's export dialog (the `.jui` and NWScript writers) is lazy too. React and opentype.js are
  their own chunks (`vite.config.ts`), loaded at start: the canvas parses the skin's fonts with opentype.js.
- **State.** A skin project (`skin/project.ts`): the `nui_skin.tml` text, held as a `TmlDoc` (`skin/tmldoc.ts`) so
  comments and order survive edits, and the project's own files (uploads, generated textures, fonts).
- **Preview.** `skin/preview.ts` lays the project's files over the current resources, so the window editor's canvas,
  the widget sheet (`skin/sheet.ts`) and the font panel all draw with the edited skin.
- **Checks.** `skin/check.ts` checks the keys against `skin/keys.ts` and, with resources, the files they name.
- **Generator.** `skin/gen/` draws the built-in skins' textures from a `Style` of about 30 numbers. It reproduces
  Pillow's drawing arithmetic and Python's random numbers, so it writes the same bytes as the original Python
  generator. `pnpm skin ship` writes `assets/skin/` with it.
- **Export.** `planExport` (`skin/project.ts`) lists what goes out (only the user's own files, the `.tml` and a
  licence note) and what is left out. `res/erfwrite.ts` writes a hak or ERF, `res/zip.ts` a zip.

## Tests

`tests/*.test.ts` are the unit tests (`pnpm test`), `tests/*.browser.ts` the browser tests, `tests/*.cli.ts` the
round trips with the game, `tests/server/` the NWScript server check, and `golden/` the comparison with nui-preview.
What each command checks and needs: [CONTRIBUTING.md](../CONTRIBUTING.md#checks).
