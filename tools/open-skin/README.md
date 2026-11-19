# Open skin tools

The five built-in skins (`assets/skin/ink/`, `bronze/`, `brass/`, `verdigris/`, `oxblood/`; see [docs/OPEN-SKIN.md](../../docs/OPEN-SKIN.md))
are built, checked and packed by the designer itself (`src/core/skin/gen/`, `pnpm skin`). This folder keeps the
skins' pinned font sources and the Python research tools that compared skins and fonts. None of them ships anything.

```bash
pnpm skin ship                     # rebuild all five skins in assets/skin/ (textures, nui_skin.tml, PROVENANCE.md, LICENSE)
pnpm skin ship --theme bronze      # rebuild one
pnpm skin ship --check             # are the committed files exactly what the generator makes?
pnpm skin hak                      # Ink and brass as nuid_ink_skin.hak
pnpm skin hak --theme bronze --erf -o nuid_bronze_skin.erf   # Bronze as an ERF
pnpm skin check assets/skin/ink/nui_skin.tml --res assets/skin/ink   # every key the client reads (--game [DIR], --hak FILE)
pnpm skin preset d-iron -o out/d-iron    # another preset's files (the shipped ones, or d-iron, which is not shipped)
pnpm skin sheet assets/skin/ink -o widgets.png   # every widget state of a skin folder (no folder: the game's skin)
```

Set `SOURCE_DATE_EPOCH` for a hak with a fixed date.

## Fonts

`sources.toml` pins the fonts the skins use (Brawler Regular, Philosopher Bold, JetBrains Mono Regular 2.304, and
the steampunk skins' six), by URL and sha256, with their copyright lines and licences. `fetch.py` downloads them and their licence texts into
`~/.cache/nwn-nui-designer/open-skin` (or `$NUI_SKIN_CACHE`, or `--cache DIR`) and checks the sums.
`pnpm skin ship` checks the copies in `assets/skin/` against the same sums; `pnpm skin ship` and `pnpm skin preset`
take a font no built-in skin ships yet from that cache.

```bash
python3 tools/open-skin/fetch.py [--cache DIR]
```

## History

The Python generator (`draw.py`, `candidates.py`, `gen_skin.py`), `build_hak.py` and `check_skin.py` were removed
when the skin editor arrived. The TypeScript port draws the same bytes (all 98 textures of the three presets, checked against Pillow
13.0) and writes the same hak (`tests/skin.test.ts` runs `build_hak.py` from git, commit `e38d1ca`, when Python is
installed). [DESIGN.md](../../DESIGN.md#skin-editor) says why.

## Research tools

They need nui-preview (from Layonara's module repository, not public; pass its `tools/nui-preview` folder), and for
windows a game folder and window dumps. Their pictures stay out of git. They run with
[uv](https://docs.astral.sh/uv/), which fetches Pillow, fontTools and kiwisolver.

```bash
tools/open-skin/widget_sheet.py --nui-preview ../nwn-module/tools/nui-preview assets/skin/ink -o sheets
tools/open-skin/render_windows.py --nui-preview ../nwn-module/tools/nui-preview --game $NWN_ROOT \
    --skin ink=assets/skin/ink --window gods.json -o renders
uv run tools/open-skin/font_metrics.py --ref fnt_maintext.ttf --corpus strings.txt some.ttf other.ttf
tools/open-skin/specimen.py --nui-preview ../nwn-module/tools/nui-preview --ref fnt_maintext.ttf -o specimen.png some.ttf
```

`render_windows.py --window` takes nui-preview dumps (`{"window": ...}`), not a bare `.jui`.

`pnpm skin sheet` is the maintained widget sheet; `widget_sheet.py` is kept for comparing against nui-preview.

| File | What |
|---|---|
| `sources.toml`, `fetch.py` | The three fonts, pinned, with their licences. |
| `CC0-1.0.txt` | The CC0 1.0 legal code, copied into each skin's `LICENSE` by `pnpm skin ship`. |
| `skin_keys.py` | The research copy of the key list (`src/core/skin/keys.ts` is the designer's; a test keeps them equal). |
| `nkfont.py` | Fonts sized as Nuklear's baker sizes them (hhea height, rounded advances). |
| `font_metrics.py`, `specimen.py` | Font comparison: widths, x-height, Latin-1 coverage, wrap agreement; a visual specimen. |
| `widget_sheet.py`, `render_windows.py` | Every widget state per skin; windows drawn with each skin through nui-preview. |

Never commit Beamdog files or renders made with them.
