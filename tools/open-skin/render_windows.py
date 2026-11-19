#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=11", "kiwisolver>=1.4", "fonttools>=4.50"]
# ///
"""Draws window dumps with each skin through nui-preview (nwn-module tools/nui-preview, not part of this repo), and
puts the results side by side: one contact sheet per window.

    render_windows.py --nui-preview DIR --game GAME_ROOT [--haks DIR --module-ifo FILE] \
        --skin stock=DIR --skin a-bronze=DIR ... --window gods.json ... -o OUT

Each --skin is a folder holding nui_skin.tml, its textures and fonts; it is searched before anything else, so the
skin's own textures win. The game (and haks) are only used for the windows' own images (icons, emblems).
--font NAME=TTF draws a skin with another default font (the font comparison).

nui-preview slices each skin key with the client's margins itself since nwn-module PR #1115 (3 px, 7 px for some
hover states, the scrollbar thumbs' repeated middle strip). One change to how it draws, applied to every skin alike:
- text is sized by Nuklear's rule (nkfont.py: font_size = hhea ascent - descent, advances + spacing_h, rounded),
  not by the em. See docs/OPEN-SKIN.md, "Which text model".
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from nkfont import NkFont


def load(np_dir: Path):
    sys.path.insert(0, str(np_dir))
    import nui_preview  # noqa: F401
    import render
    import resman
    import skin as skin_mod

    return render, resman, skin_mod


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nui-preview", type=Path, required=True)
    ap.add_argument("--game", type=Path, required=True)
    ap.add_argument("--haks", type=Path)
    ap.add_argument("--module-ifo", type=Path)
    ap.add_argument("--skin", action="append", required=True, help="LABEL=DIR")
    ap.add_argument("--font", action="append", default=[], help="LABEL=TTF: replace the default font for that label")
    ap.add_argument("--window", action="append", type=Path, required=True)
    ap.add_argument("--canvas", default="1440x900")
    ap.add_argument("-o", "--out", type=Path, required=True)
    ap.add_argument("--sheet-name", default="")
    a = ap.parse_args()
    render, resman, skin_mod = load(a.nui_preview)
    import nui_preview

    a.out.mkdir(parents=True, exist_ok=True)
    haks = resman.module_haks(a.module_ifo) if a.module_ifo else []
    fonts_override = dict(f.split("=", 1) for f in a.font)
    cw, ch = (int(v) for v in a.canvas.split("x"))
    results: dict[str, dict[str, Path]] = {}
    for spec in a.skin:
        label, _, d = spec.partition("=")
        d = Path(d)
        rm = resman.ResMan(a.game, a.haks, haks)
        rm.containers.insert(0, resman.Folder(d))
        tml = (d / "nui_skin.tml").read_bytes()
        sk = skin_mod.Skin(tml, rm)
        # Nuklear's text sizing for every font of the skin.
        nk = {}
        for f in sk.data.get("fonts", []):
            ttf = rm.get(f.get("resref", ""), "ttf")
            if ttf:
                nk[f.get("name")] = NkFont(f.get("name"), ttf, float(f.get("font_size", 17)),
                                           float(f.get("spacing_h", 0.5)), bool(f.get("pixel_snap", True)))
        if label in fonts_override:
            first = sk.data["fonts"][0]
            nk[first["name"]] = NkFont(first["name"], Path(fonts_override[label]).read_bytes(),
                                       float(first.get("font_size", 17)), float(first.get("spacing_h", 0.5)))
        sk.fonts = nk
        sk.font_list = list(nk.values())
        sk.default_font = sk.font_list[0]
        images = resman.Images(rm)

        for wpath in a.window:
            dump = json.loads(wpath.read_text())
            rend = render.Renderer(sk, images, dict(dump.get("binds") or {}))
            img = nui_preview.background(cw, ch)
            wx, wy, ww, wh = rend.window(img, dump["window"], cw, ch, dump.get("panes") or {})
            m = 12
            img = img.crop((max(0, wx - m), max(0, wy - m), min(cw, wx + ww + m), min(ch, wy + wh + m)))
            p = a.out / f"{wpath.stem}.{label}.png"
            img.convert("RGB").save(p)
            results.setdefault(wpath.stem, {})[label] = p
            print(p, f"{len(rend.problems)} problem(s)")
    labels = [s.partition("=")[0] for s in a.skin]
    for win, by in results.items():
        ims = [Image.open(by[lb]) for lb in labels]
        w = sum(i.width for i in ims) + 10 * (len(ims) + 1)
        h = max(i.height for i in ims) + 40
        sheet = Image.new("RGB", (w, h), (24, 22, 20))
        d = ImageDraw.Draw(sheet)
        x = 10
        for lb, im in zip(labels, ims):
            d.text((x, 10), lb, fill=(255, 220, 150))
            sheet.paste(im, (x, 30))
            x += im.width + 10
        p = a.out / f"sheet-{win}{a.sheet_name}.png"
        sheet.save(p)
        half = sheet.resize((sheet.width // 2, sheet.height // 2), Image.LANCZOS)
        half.save(a.out / f"sheet-{win}{a.sheet_name}.half.png")
        print(p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
