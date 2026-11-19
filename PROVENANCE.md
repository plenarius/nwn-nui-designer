# Provenance

Where each part of this project came from, and the licence of everything it depends on or ports. This project's own
code is under the **MIT licence** ([LICENSE](LICENSE)); the built-in open skins in `assets/skin/ink/` and
`assets/skin/bronze/` (textures and `nui_skin.tml`) are **CC0 1.0** (each folder's `LICENSE`); the bundled fonts keep
their own licences (below).

Some sources below are in Layonara's module repository (`nwn-module`) or its documentation, which are not public. They
are named so the history is complete; nothing in this repository needs them to build or run.

## Ported code and behaviour

| Part | From | Licence | Notes |
|---|---|---|---|
| `src/core/layout/layout.ts`, `src/core/render/render.ts` (widgets, chrome numbers, checks), `src/core/render/text.ts` (text masks, wrap, nine-slice), `src/core/skin/skin.ts`, `src/core/res/*` (resource order), `tests/layout.test.ts` | nui-preview, nwn-module `tools/nui-preview` (`layout.py`, `render.py`, `skin.py`, `resman.py`, `test_layout.py`), origin/ee ac8e3a0a1 (not public) | Written by this project's author for Layonara; ported with permission | Line-for-line ports, since kept in step with nui-preview's later fixes (nwn-module #1115, #1121). The numbers in `CHROME` and the insets were measured against in-game screenshots. |
| The constraints in `layout.ts` (spans, groups, strengths) | niv's gist `nuilayout.cpp` (<https://gist.github.com/niv/9bf60ca649fdf6709c17886a1a467755>), via nui-preview | **Not stated**: the gist has no licence; its author has been asked (open: [DESIGN.md](DESIGN.md#open-questions)) | Linked from the nwn.wiki NUI page as a description of how NUI lays out windows. nui-preview, and through it `layout.ts`, follow its set of constraints, their order and their strengths. No code text is copied. |
| `src/core/render/check.ts` | nwn-module `core/nss/nui/nui_i_check.nss` (not public) | Written by this project's author for Layonara | The layout rules it encodes were read from the client's disassembly (Layonara's notes, not public). |
| `src/core/layout/kiwi/` | `@lume/kiwi` 0.4.4 (<https://github.com/lume/kiwi>), itself a port of Kiwi (<https://github.com/nucleic/kiwi>) | BSD-3-Clause (`src/core/layout/kiwi/COPYING.txt`) | Vendored. Changed: `maptype.ts` keeps its maps sorted by id, as C++ Kiwi's `AssocVector` is, so ties between equally good solutions break as in kiwisolver and the client ([DESIGN.md](DESIGN.md#layout)). |
| `src/core/render/resample.ts`, `alphaCompositeInPlace`, `pilLinePixels`, the MaxFilter in `text.ts`, the premultiply and unpremultiply arithmetic | Behaviour of Pillow (<https://github.com/python-pillow/Pillow>): `libImaging/Resample.c`, `AlphaComposite.c`, `Draw.c`, `Filter.c` | Pillow is MIT-CMU (HPND) | Reimplemented in TypeScript from Pillow's algorithms so the output matches nui-preview's pixels. No Pillow code is copied verbatim. |
| FreeType-style metrics in `font.ts` (`FT_MulFix`, `FT_DivFix`, ceiling and floor of the size metrics) | FreeType's documented fixed-point arithmetic | FreeType Licence (FTL) / GPLv2 | Formulas only, to reproduce the advances Pillow reports. |
| The "nuklear" text model in `font.ts` | `nuklear.h` (`nk_font_bake_convert`: `stbtt_ScaleForPixelHeight`, `xadvance + spacing.x`, pixel snap) | Nuklear: public domain or MIT, at your choice | Behaviour only. |
| `src/core/model/nui.ts` | `nw_inc_nui.nss` of NWN:EE 8193.37-17 (the JSON each `Nui*` builder makes) | Beamdog's script, shipped with the game | Reimplements the JSON shapes (an API, facts about the format). No comments or code text copied. |
| The built-in open skins, `assets/skin/ink/` (B, Ink and brass: the default), `assets/skin/bronze/` (A, Bronze), `assets/skin/brass/` (S1, Brass and soot), `assets/skin/verdigris/` (S2, Verdigris and paper) and `assets/skin/oxblood/` (S3, Oxblood and rivets), and their generator `src/core/skin/gen/` (first written in Python in `tools/open-skin/`, since removed; in git at `e38d1ca`) | Written for this project: `nui_skin.tml` from the key names of the client's interface ([docs/CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md#skin-keys)), the textures drawn from hand-picked numbers (`style.ts`) | **CC0 1.0** (each folder's `LICENSE`); the generator is MIT like the rest of the code | Only the key names are shared with Beamdog's file. No pixel is sampled, traced or derived from Beamdog's textures. How each file was made: each folder's `PROVENANCE.md` and `docs/OPEN-SKIN.md`. |
| `src/core/skin/gen/pil.ts` (ImageDraw's lines, wide lines, polygons, ellipses, chords, pie slices, rounded rectangles; paste with a mask; RGBA to LA; the quarter turn) | Behaviour of Pillow 13.0 (`libImaging/Draw.c`, `Paste.c`, `Convert.c`, `Geometry.c`, `PIL/ImageDraw.py`) | Pillow is MIT-CMU (HPND) | Reimplemented in TypeScript from Pillow's algorithms, including its float32 scan-line arithmetic, so the generator draws the bytes the Python generator drew. No Pillow code is copied verbatim. |
| `src/core/skin/gen/mt.ts` | The Mersenne Twister MT19937 (Matsumoto and Nishimura's published algorithm) seeded as CPython's `random.Random(int)` seeds it, `random()` as CPython builds a double | MT19937's reference code is BSD-3-Clause; CPython is PSF | Written from the published algorithm and CPython's documented seeding; no code copied. Gives Python's noise bit for bit. |
| `src/core/skin/keys.ts`, `src/core/skin/check.ts`, `src/core/font/fontinfo.ts` (the code-page ranges) | [docs/CLIENT-BEHAVIOUR.md](docs/CLIENT-BEHAVIOUR.md) (from the client's decompile): the keys, types and defaults the client reads; the glyph ranges `nk_sdl_refresh_config` bakes; nuklear.h's Cyrillic ranges | Facts about the client's interface; nuklear.h is public domain or MIT | No Beamdog code or file content. |
| `src/core/font/fontinfo.ts` (the atlas estimate) | Behaviour of nuklear.h's font baker with stb_truetype and stb_rect_pack (boxes, padding, oversampling, a 512 or 1024 px atlas, power-of-two height) | Public domain or MIT | An estimate written for this project. |
| ERF writer (`src/core/res/erfwrite.ts`), TGA writer (`tgawrite.ts`), zip writer (`zip.ts`) | The published formats (BioWare Aurora ERF V1.0, Truevision TGA 2.0, PKWARE's APPNOTE) | - | Written for this project. The ERF layout follows the removed `build_hak.py` (this project's own) byte for byte. |
| `src/core/edit/catalog.ts`, `src/core/edit/nwscript.ts` (the builders' semantics: which parameters are binds, ints, floats, bools) | `nw_inc_nui.nss` and `nwscript.nss` of NWN:EE 8193.37-17 | Beamdog's scripts, shipped with the game | The API's facts (key names, parameter types, constants' names and values). No comments or code text copied. The generated NWScript calls those functions; it contains no Beamdog code. |
| What a `.jui` is ([DESIGN.md](DESIGN.md#what-nuicreatefromresref-loads)) | Disassembly of the 8193.37-17 client and server (`nwmain-linux`, `nwserver-linux`, with objdump) | - | Behaviour only, read for interoperability; no code. |
| `src/core/edit/styles/layonara.ts` | nwn-module `docs/NUI-STYLE.md` (origin/ee, not public) | Layonara's style guide, by this project's author | The rules are restated in our own words; the numbers they check (the 36 px row, 8 and 16 px gaps, the + 16 / + 49 frame, 1000 x 720, the colour palette) are the guide's. It ships as an example of a style rule set. |
| KEY/BIF, ERF, TGA, DDS, TOML readers | The published formats (BioWare Aurora KEY/BIF and ERF specifications, Truevision TGA 2.0, Microsoft DDS and BCn, TOML 1.0) | - | Written for this project. |

## Fonts (shipped)

| File | Font | Copyright | Licence | Source |
|---|---|---|---|---|
| `assets/skin/ink/nuio_brawler.ttf` | Brawler Regular | Copyright 2011 The Brawler Project Authors (<https://github.com/cyrealtype/Brawler>) | SIL OFL 1.1, no Reserved Font Name (`assets/skin/ink/OFL-nuio_brawler.txt`) | <https://github.com/google/fonts> at 7af0d90 (`ofl/brawler/Brawler-Regular.ttf`, sha256 `5f7fcee6…`) |
| `assets/skin/bronze/nuio_philo_b.ttf` | Philosopher Bold | Copyright 2011 The Philosopher Project Authors (<https://github.com/alexeiva/philosopher>) | SIL OFL 1.1, no Reserved Font Name (`assets/skin/bronze/OFL-nuio_philo_b.txt`) | <https://github.com/google/fonts> at 7af0d90 (`ofl/philosopher/Philosopher-Bold.ttf`, sha256 `2277c78b…`) |
| `assets/skin/brass/nuio_oldstdb.ttf` | Old Standard TT Bold | Copyright 2011 The Old Standard Project Authors (amkryukov@gmail.com) | SIL OFL 1.1, no Reserved Font Name (`assets/skin/brass/OFL-nuio_oldstdb.txt`) | <https://github.com/google/fonts> at 5bd87dfc (`ofl/oldstandardtt/OldStandard-Bold.ttf`, sha256 `7d831e9d…`) |
| `assets/skin/brass/nuio_rye.ttf` | Rye Regular | Copyright (c) 2011 by Sorkin Type Co (www.sorkintype.com) | SIL OFL 1.1, Reserved Font Name "Rye" (shipped unmodified) (`assets/skin/brass/OFL-nuio_rye.txt`) | <https://github.com/google/fonts> at 5bd87dfc (`ofl/rye/Rye-Regular.ttf`, sha256 `b7edee5e…`) |
| `assets/skin/verdigris/nuio_spectsb.ttf` | Spectral SemiBold | Copyright 2017 The Spectral Project Authors (https://github.com/productiontype/Spectral) | SIL OFL 1.1, no Reserved Font Name (`assets/skin/verdigris/OFL-nuio_spectsb.txt`) | <https://github.com/google/fonts> at 5bd87dfc (`ofl/spectral/Spectral-SemiBold.ttf`, sha256 `5f86915a…`) |
| `assets/skin/verdigris/nuio_federnt.ttf` | Federant Regular | Copyright (c) 2011, Cyreal (www.cyreal.org) | SIL OFL 1.1, Reserved Font Name "Federant" (shipped unmodified) (`assets/skin/verdigris/OFL-nuio_federnt.txt`) | <https://github.com/google/fonts> at 5bd87dfc (`ofl/federant/Federant-Regular.ttf`, sha256 `d40cb09c…`) |
| `assets/skin/oxblood/nuio_zillasb.ttf` | Zilla Slab SemiBold | Copyright 2017, The Mozilla Foundation | SIL OFL 1.1, no Reserved Font Name (`assets/skin/oxblood/OFL-nuio_zillasb.txt`) | <https://github.com/google/fonts> at 5bd87dfc (`ofl/zillaslab/ZillaSlab-SemiBold.ttf`, sha256 `aafcb295…`) |
| `assets/skin/oxblood/nuio_cinzldb.ttf` | Cinzel Decorative Bold | Copyright (c) 2012 Natanael Gama (info@ndiscovered.com) | SIL OFL 1.1, Reserved Font Name "Cinzel" (shipped unmodified) (`assets/skin/oxblood/OFL-nuio_cinzldb.txt`) | <https://github.com/google/fonts> at 5bd87dfc (`ofl/cinzeldecorative/CinzelDecorative-Bold.ttf`, sha256 `e854e68a…`) |
| `assets/skin/{ink,bronze,brass,verdigris,oxblood}/nuio_jbmono.ttf` | JetBrains Mono Regular 2.304 | Copyright 2020 The JetBrains Mono Project Authors (<https://github.com/JetBrains/JetBrainsMono>) | SIL OFL 1.1, no Reserved Font Name (`OFL-nuio_jbmono.txt` beside it) | <https://github.com/JetBrains/JetBrainsMono> tag v2.304 (`fonts/ttf/JetBrainsMono-Regular.ttf`, sha256 `a0bf60ef…`) |

All are unmodified (renamed files only, to fit NWN's 16-character resrefs) and pinned in
`tools/open-skin/sources.toml`; `pnpm skin ship` checks the committed copies against the pins.

- **Brawler Regular** is the default skin's `(default)` font (research: [docs/OPEN-SKIN.md](docs/OPEN-SKIN.md)).
  It was briefly removed when Bronze alone shipped, and restored from the same pinned commit and checksum.
- **Philosopher Bold** is Bronze's `(default)` font.
- **JetBrains Mono 2.304** is byte for byte the version the game ships as its `(monospace)` font.

They are not covered by the skins' CC0. They replace an earlier fallback's Merriweather Sans and JetBrains Mono 2.305. The built
site (`pnpm build`) bundles them with their OFL texts, and every hak or skin export that includes one adds its OFL
text.

## Screenshots

`docs/screenshots/*.png` are made by `pnpm screenshots` (`tools/screenshots.ts`) with no game loaded: only the
built-in skins and their fonts draw them, and no window shown has an image. The furniture window is Layonara's
(nwn-module's `furnplace` window, dumped by its test server), shown with permission; the other windows are this
repository's fixtures. They contain no Beamdog art.

## Dependencies

Only the first two rows end up in the built site; the rest are development tools.

| Package | Use | Licence |
|---|---|---|
| opentype.js 2.0 | Reads TrueType fonts (metrics and outlines) | MIT |
| React, React DOM 19 | The editor's UI | MIT |
| Vite, @vitejs/plugin-react | Dev server and build | MIT |
| TypeScript | Types | Apache-2.0 |
| Vitest | Tests | MIT |
| tsx | Runs TypeScript in Node (CLI, golden) | MIT |
| @napi-rs/canvas (dev) | Canvas 2D in Node (Skia), for the CLI, the tests and the golden check | MIT |
| playwright-core (dev) | Browser tests | Apache-2.0 |
| oxlint (dev) | Lint (`pnpm lint`) | MIT |
| Python side of the golden check: Pillow, kiwisolver (fetched by uv, not shipped) | The reference | MIT-CMU; BSD-3-Clause |
| Python research tools in `tools/open-skin/`: Pillow, fontTools (fetched by uv, not shipped) | Font and skin comparisons | MIT-CMU; MIT |

## Not in this repository

- Beamdog's game files: textures, `nui_skin.tml`, fonts (`fnt_maintext`, `jbmono*`), models, screenshots of game art.
  The viewer reads them from the user's own install at run time.
- Layonara content: window dumps, haks, art, the Layonara skin. They live in the ignored `local/` folder on the
  machine that runs the golden check.
- The browser tests (`pnpm e2e`) copy the game and hak resources the windows need into a temporary folder for the
  run and delete it after (`tests/minigame.ts`). The NWScript server check writes its scripts into a separate
  nwn-module checkout and removes them after. The fixtures name a few base-game resrefs (`is_fireball`, `ir_attack`, ...) but
  contain no game data.
