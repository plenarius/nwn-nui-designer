#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=11", "fonttools>=4.50"]
# ///
"""A font specimen: each font drawn at the client's size rule (nkfont.py) on black, with the same lines, and a bar
showing how wide a fixed corpus comes out next to the reference. Text drawing is nui-preview's (skin.draw_text).

    specimen.py --nui-preview ~/nui-skin-research/nui-preview --ref fnt_maintext.ttf -o specimen.png a.ttf b.ttf ...
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from nkfont import NkFont

LINES = [
    "Wood Crafting, level 1     Bag of Sawdust - Mahogany     Choose this deity",
    "Ingredients come from the station first, then from your pack and bags.",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 (46) 28 / 250 XP",
    "Àéîõü ÇÑß æø ¿¡ «» ©®°±²³µ¶·¹º¼½¾ ×÷",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("fonts", nargs="+", type=Path)
    ap.add_argument("--nui-preview", type=Path, required=True)
    ap.add_argument("--ref", type=Path)
    ap.add_argument("--size", type=float, default=17.0)
    ap.add_argument("--spacing", action="append", default=[], help="FILE=SPACING_H to override 0.5 for one font")
    ap.add_argument("-o", "--out", type=Path, required=True)
    args = ap.parse_args()
    sys.path.insert(0, str(args.nui_preview))
    from skin import draw_text

    spacing = {k: float(v) for k, _, v in (s.partition("=") for s in args.spacing)}
    fonts = ([args.ref] if args.ref else []) + args.fonts
    W = 900
    block = 30 + len(LINES) * 24 + 10
    img = Image.new("RGBA", (W, block * len(fonts) + 10), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    ref_w = None
    for i, p in enumerate(fonts):
        sh = spacing.get(p.name, 0.5)
        f = NkFont(p.stem, p.read_bytes(), args.size, sh)
        y0 = 10 + i * block
        w = f.width(LINES[1])
        if ref_w is None:
            ref_w = w
        tag = "REFERENCE (not shipped)  " if (args.ref and i == 0) else ""
        d.text((10, y0), f"{tag}{p.name}  em {f.em_px:.1f}px  spacing_h {sh}  line 2 = {w:.0f}px "
                         f"({w / ref_w:.3f} of ref)", fill=(255, 210, 120, 255))
        for j, s in enumerate(LINES):
            draw_text(img, f, s, 10, y0 + 18 + j * 24, (255, 255, 255, 255), (0, 0, W, img.height))
        bx = 10 + w
        d.line([(bx, y0 + 18 + 24), (bx, y0 + 18 + 24 + 20)], fill=(255, 60, 60, 255))
        if args.ref and i > 0:
            rx = 10 + ref_w
            d.line([(rx, y0 + 18 + 24), (rx, y0 + 18 + 24 + 20)], fill=(60, 200, 255, 255))
        d.line([(0, y0 + block - 4), (W, y0 + block - 4)], fill=(60, 60, 60, 255))
    img.convert("RGB").save(args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
