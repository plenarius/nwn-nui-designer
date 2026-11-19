#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=11", "kiwisolver>=1.4"]
# ///
"""Runs nwn-module's nui-preview (the reference implementation) on windows and writes what the golden checks compare:
the plain render (PNG), every element's rectangle and the problems (JSON), and the skin fonts' metrics.

    golden/py_export.py --nui-preview DIR --out DIR [--game G] [--hak-dir D --module-ifo F] [--override DIR...] FILE...

It imports nui-preview's own modules unchanged and drives them as nui_preview.py does (same canvas, background,
renderer), with the resources given here instead of nui_preview.py's defaults, so the TypeScript port can be given the
very same ones.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def advance(font, ch: str) -> float:
    """A character's advance as nui-preview lays text out: Font.advance (the Nuklear text model, nwn-module #1121 on),
    or the Pillow face's length (the em model before it)."""
    if hasattr(font, "advance"):
        return font.advance(ch)
    return font.face.getlength(ch)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--nui-preview", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--game", type=Path, required=True)
    ap.add_argument("--hak-dir", type=Path)
    ap.add_argument("--module-ifo", type=Path)
    ap.add_argument("--override", action="append", default=[], type=Path)
    ap.add_argument("--canvas", default="1440x900")
    args = ap.parse_args()

    sys.path.insert(0, str(args.nui_preview.resolve()))
    import resman  # noqa: E402
    from nui_preview import background, load_input  # noqa: E402
    from render import Renderer  # noqa: E402
    from skin import Skin  # noqa: E402

    haks = resman.module_haks(args.module_ifo) if args.module_ifo else []
    rm = resman.ResMan(args.game, args.hak_dir, haks, fallback_dirs=tuple(args.override), checkout=None)
    tml = rm.get("nui_skin", "tml")
    skin = Skin(tml, rm)
    images = resman.Images(rm)
    cw, ch = (int(v) for v in args.canvas.lower().split("x"))
    args.out.mkdir(parents=True, exist_ok=True)

    fonts = {}
    for f in skin.font_list:
        fonts[f.name] = {
            "size": f.size,
            "ascent": f.ascent,
            "descent": f.descent,
            "advances": {chr(c): advance(f, chr(c)) for c in range(0x20, 0x7F)},
        }
    (args.out / "fonts.json").write_text(json.dumps(fonts, indent=1))

    for name in args.files:
        d = load_input(name)
        stem = Path(name).stem
        rend = Renderer(skin, images, dict(d.get("binds") or {}))
        img = background(cw, ch)
        try:
            wx, wy, ww, wh = rend.window(img, d["window"], cw, ch, d.get("panes") or {})
        except Exception as e:  # noqa: BLE001 - the reference cannot draw it: say so, go on
            (args.out / f"{stem}.json").write_text(json.dumps({"name": stem, "error": f"{type(e).__name__}: {e}"}))
            print(f"{stem}: nui-preview failed: {type(e).__name__}: {e}")
            continue
        img.convert("RGB").save(args.out / f"{stem}.png")
        data = {
            "name": d.get("name", stem),
            "window": [wx, wy, ww, wh],
            "outlines": [{"rect": list(r), "path": p, "span": s} for (r, p, s) in rend.outlines],
            "problems": [{"path": p.path, "kind": p.kind, "text": p.text, "rect": list(p.rect)} for p in rend.problems],
        }
        (args.out / f"{stem}.json").write_text(json.dumps(data, indent=1))
        print(f"{stem}: {len(rend.outlines)} elements, {len(rend.problems)} problem(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
