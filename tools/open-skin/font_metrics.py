#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools>=4.50", "pillow>=10"]
# ///
"""Compares candidate fonts with a reference font (the game's fnt_maintext) the way the NWN:EE client sizes them.

The client bakes NUI fonts with Nuklear's font baker (nuklear.h, nk_font_bake_pack / nk_font_bake_convert):

- stb_truetype's ScaleForPixelHeight: font_size pixels is the hhea ascent - descent height, NOT the em. A font with
  tall ascenders or deep descenders comes out smaller than its em size suggests.
- every glyph's advance gets spacing_h (0.5 in the stock skin) added, then is rounded to a whole pixel (pixel_snap).
- no kerning.

nui-preview (and the designer's "nui-preview" text model) instead draws at the em size with FreeType's advances. Both
are reported here: "nk" columns follow nuklear.h, "em" columns follow nui-preview.

    font_metrics.py --ref /path/to/fnt_maintext.ttf --corpus corpus.txt fonts/*.ttf [--size 17] [--json out.json]

Nothing here reads or copies a reference font's outlines: only its metrics are measured, to pick a replacement.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

SAMPLE = (
    "The smith hammers the blade while the apprentice keeps the forge hot. Wood Crafting: 28 XP. "
    "Choose this deity? Requirements: Strength 13, a hammer and tongs. You cannot carry more than 200 lbs. "
    "Achievements earned: 12 of 47 (25%). Bag of Sawdust, Planks x4, Oak Branch, Iron Nails."
)


def latin1_cover(cmap) -> tuple[int, list[str]]:
    """Printable U+0020-007E and U+00A1-00FF (U+00A0 and U+00AD are layout characters NWN text never needs)."""
    want = [c for c in range(0x20, 0x7F)] + [c for c in range(0xA1, 0x100) if c != 0xAD]
    missing = [f"U+{c:04X}" for c in want if c not in cmap]
    return len(want) - len(missing), missing


def measure(path: Path, size: float, spacing_h: float, text: str) -> dict:
    f = TTFont(path)
    upm = f["head"].unitsPerEm
    hhea = f["hhea"]
    os2 = f["OS/2"]
    cmap = f.getBestCmap()
    hmtx = f["hmtx"]
    gs = f.getGlyphSet()

    nk_scale = size / (hhea.ascent - hhea.descent)
    em_scale = size / upm

    def adv_units(ch):
        g = cmap.get(ord(ch))
        if g is None:
            g = ".notdef"
        return hmtx[g][0]

    def nk_adv(ch):
        return math.floor(adv_units(ch) * nk_scale + spacing_h + 0.5)

    def em_adv(ch):
        return adv_units(ch) * em_scale

    from fontTools.pens.boundsPen import BoundsPen

    def bounds(ch):
        g = cmap.get(ord(ch))
        if g is None:
            return None
        p = BoundsPen(gs)
        gs[g].draw(p)
        return p.bounds

    def top(ch):
        b = bounds(ch)
        return b[3] if b else 0

    def bottom(ch):
        b = bounds(ch)
        return b[1] if b else 0

    lower = "abcdefghijklmnopqrstuvwxyz"
    cov, missing = latin1_cover(cmap)
    names = {r.nameID: r.toUnicode() for r in f["name"].names if r.platformID == 3}
    xh = top("x")
    return {
        "file": path.name,
        "family": names.get(1, path.stem),
        "style": names.get(2, ""),
        "weight": os2.usWeightClass,
        "upm": upm,
        "hhea_height_units": hhea.ascent - hhea.descent,
        "em_px_nk": round(upm * nk_scale, 2),
        "nk_avg_lower": round(sum(nk_adv(c) for c in lower) / 26, 2),
        "nk_text_w": sum(nk_adv(c) for c in text),
        "em_avg_lower": round(sum(em_adv(c) for c in lower) / 26, 2),
        "em_text_w": round(sum(em_adv(c) for c in text), 1),
        "nk_xheight": round(xh * nk_scale, 2),
        "nk_cap": round(top("H") * nk_scale, 2),
        "nk_asc": round(top("d") * nk_scale, 2),
        "nk_desc": round(-bottom("p") * nk_scale, 2),
        "em_xheight": round(xh * em_scale, 2),
        "xheight_ratio": round(xh / upm, 3),
        "latin1": cov,
        "latin1_missing": missing,
        "glyf": "glyf" in f,
        "variable": "fvar" in f,
    }


def wrap(text: str, width_of, width: float) -> list[str]:
    """Nuklear's word wrap as nui-preview models it: break at spaces, newlines always, cut words longer than a line."""
    lines: list[str] = []
    for para in text.split("\n"):
        line = ""
        for word in para.split(" "):
            cand = word if line == "" else line + " " + word
            if width_of(cand) <= width or line == "" and width_of(word) <= width:
                line = cand
                continue
            if line:
                lines.append(line)
            line = word
            while width_of(line) > width and len(line) > 1:
                cut = len(line)
                while cut > 1 and width_of(line[:cut]) > width:
                    cut -= 1
                lines.append(line[:cut])
                line = line[cut:]
        lines.append(line)
    return lines


def wrap_agreement(ref: Path, font: Path, strings: list[str], widths, size: float, spacing_h: float):
    """Share of (string, width) pairs that break into exactly the same lines as the reference, and the total change
    in line count."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from nkfont import NkFont

    r = NkFont("ref", ref.read_bytes(), size, spacing_h)
    f = NkFont("f", font.read_bytes(), size, spacing_h)
    same = total = dl = 0
    for w in widths:
        for s in strings:
            a, b = wrap(s, r.width, w), wrap(s, f.width, w)
            same += a == b
            total += 1
            dl += len(b) - len(a)
    return round(same / max(1, total), 3), dl


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("fonts", nargs="+", type=Path)
    ap.add_argument("--ref", type=Path, help="the reference font (fnt_maintext.ttf from the game; never committed)")
    ap.add_argument("--corpus", type=Path, help="text to measure widths on (default: a built-in sample)")
    ap.add_argument("--size", type=float, default=17.0)
    ap.add_argument("--spacing-h", type=float, default=0.5)
    ap.add_argument("--json", type=Path)
    ap.add_argument("--wrap-widths", default="160,250,350,450",
                    help="with --ref and --corpus: compare word wrap at these widths (strings over 25 characters)")
    args = ap.parse_args()
    text = args.corpus.read_text(encoding="utf-8").replace("\n", " ") if args.corpus else SAMPLE
    rows = []
    ref = measure(args.ref, args.size, args.spacing_h, text) if args.ref else None
    for p in args.fonts:
        try:
            rows.append(measure(p, args.size, args.spacing_h, text))
        except Exception as e:  # noqa: BLE001
            print(f"{p}: {e}", file=sys.stderr)
    if ref:
        for r in rows + [ref]:
            r["nk_width_vs_ref"] = round(r["nk_text_w"] / ref["nk_text_w"], 3)
            r["em_width_vs_ref"] = round(r["em_text_w"] / ref["em_text_w"], 3)
        rows.sort(key=lambda r: abs(r["nk_width_vs_ref"] - 1))
        if args.corpus:
            strings = [s for s in args.corpus.read_text(encoding="utf-8").split("\n") if len(s) > 25]
            widths = [float(w) for w in args.wrap_widths.split(",")]
            paths = {p.name: p for p in args.fonts}
            for r in rows:
                r["wrap_same"], r["wrap_line_delta"] = wrap_agreement(args.ref, paths[r["file"]], strings, widths,
                                                                      args.size, args.spacing_h)
            ref["wrap_same"], ref["wrap_line_delta"] = 1.0, 0
        rows.insert(0, ref)
    cols = ["file", "weight", "em_px_nk", "nk_avg_lower", "nk_width_vs_ref", "em_width_vs_ref", "nk_xheight",
            "nk_cap", "nk_asc", "nk_desc", "latin1", "wrap_same", "wrap_line_delta"]
    print("  ".join(f"{c:>15}" if c != "file" else f"{c:34}" for c in cols))
    for r in rows:
        print("  ".join(f"{r.get(c, '')!s:>15}" if c != "file" else f"{r[c][:34]:34}" for c in cols))
    if args.json:
        args.json.write_text(json.dumps(rows, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
