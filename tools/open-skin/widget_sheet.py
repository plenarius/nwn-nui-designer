#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=11", "fonttools>=4.50"]
# ///
"""Draws every widget state a skin styles, one sheet per skin: window frame and title, buttons (normal, hover,
pressed), selectables (all six states), checkboxes and radio buttons, combo, text edit, progress, scrollbars, slider,
tree header, context-menu entries, the property widget, and both fonts. Each 9-slice key is drawn with the margins
the client uses for it (skin_keys.py), so this also shows how a texture stretches.

nui-preview draws only the rest state of each widget; this sheet is where hover and pressed art can be judged. The
layout of each widget here is an approximation (Nuklear's own spacing is not reproduced), the textures and fonts are
the skin's.

    widget_sheet.py --nui-preview DIR SKIN_DIR [SKIN_DIR ...] -o OUT_DIR
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from nkfont import NkFont
from skin_keys import KEYS, REGION, TILE, get

MARGINS = {k: m for k, t, m, _ in KEYS if t == "image9"}
BG = (52, 48, 44, 255)
LABEL = (230, 200, 140, 255)


def tiled(tex: Image.Image, w: int, h: int, tile: tuple) -> Image.Image:
    """tex over w x h: stretched, or repeated at its own size along an axis that tiles (stretched across the other)."""
    p = tex.resize((tex.width if tile[0] else w, tex.height if tile[1] else h), Image.BILINEAR)
    if not (tile[0] or tile[1]):
        return p
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(0, h, p.height):
        for x in range(0, w, p.width):
            out.paste(p, (x, y))
    return out


def nine(tex: Image.Image, w: int, h: int, m: tuple, tile: tuple = (False, False)) -> Image.Image:
    """9-slice with (left, top, right, bottom) source margins drawn at the same size; 0 = the whole texture as the
    middle, stretched or (tile) repeated."""
    w, h = max(1, int(w)), max(1, int(h))
    l, t, r, b = m
    tw, th = tex.size
    if not any(m):
        return tiled(tex, w, h, tile)
    l, r = min(l, w // 2, tw // 2), min(r, w // 2, tw // 2)
    t, b = min(t, h // 2, th // 2), min(b, h // 2, th // 2)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    xs, ys = [0, l, tw - r, tw], [0, t, th - b, th]
    xd, yd = [0, l, w - r, w], [0, t, h - b, h]
    for i in range(3):
        for j in range(3):
            if xs[j + 1] > xs[j] and ys[i + 1] > ys[i] and xd[j + 1] > xd[j] and yd[i + 1] > yd[i]:
                piece = tex.crop((xs[j], ys[i], xs[j + 1], ys[i + 1]))
                out.paste(piece.resize((xd[j + 1] - xd[j], yd[i + 1] - yd[i]), Image.BILINEAR), (xd[j], yd[i]))
    return out


class SkinDir:
    def __init__(self, d: Path, draw_text):
        self.d = d
        self.data = tomllib.loads((d / "nui_skin.tml").read_text(encoding="utf-8"))
        self.draw_text = draw_text
        self.fonts = []
        for f in self.data.get("fonts", []):
            p = d / f"{f['resref']}.ttf"
            if p.is_file():
                self.fonts.append(NkFont(f["name"], p.read_bytes(), float(f.get("font_size", 17)),
                                         float(f.get("spacing_h", 0.5)), bool(f.get("pixel_snap", True))))
        self._tex: dict[str, Image.Image | None] = {}

    def tex(self, name: str):
        name = name.lower()
        if name not in self._tex:
            p = self.d / f"{name}.tga"
            self._tex[name] = Image.open(p).convert("RGBA") if p.is_file() else None
        return self._tex[name]

    def item(self, key: str, w: int, h: int) -> Image.Image | None:
        """What the key draws over a w x h widget: a 9-slice, a stretched image or a flat colour."""
        v = get(self.data, key)
        if not isinstance(v, str):
            return None
        if v.startswith("#"):
            c = tuple(int(v[i:i + 2], 16) for i in (1, 3, 5, 7))
            return Image.new("RGBA", (int(w), int(h)), c) if c[3] else None
        t = self.tex(v)
        if t is None:
            im = Image.new("RGBA", (int(w), int(h)), (255, 0, 255, 255))
            return im
        if key in REGION:
            x, y, rw, rh = REGION[key]
            t = t.crop((x, y, min(t.width, x + rw), min(t.height, y + rh)))
        if key in MARGINS:
            return nine(t, w, h, MARGINS[key], TILE.get(key, (False, False)))
        return t.resize((int(w), int(h)), Image.BILINEAR)

    def colour(self, key: str, default=(255, 255, 255, 255)):
        v = get(self.data, key)
        if isinstance(v, str) and v.startswith("#") and len(v) == 9:
            return tuple(int(v[i:i + 2], 16) for i in (1, 3, 5, 7))
        return default


def sheet(sk: SkinDir, title: str) -> Image.Image:
    W, H = 1000, 840
    img = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(img)
    font = sk.fonts[0]
    mono = sk.fonts[1] if len(sk.fonts) > 1 else font
    text = sk.colour("text.color")

    def put(key, x, y, w, h):
        im = sk.item(key, w, h)
        if im is not None:
            img.alpha_composite(im, (int(x), int(y)))

    def txt(s, x, y, fill=None, f=None, clip=None):
        f = f or font
        sk.draw_text(img, f, s, x, y, fill or text, clip or (0, 0, W, H))

    def centred(s, x, y, w, h, fill=None):
        f = font
        tw = f.width(s)
        txt(s, x + (w - tw) / 2, y + (h - f.line) / 2, fill, f, (x, y, x + w, y + h))

    def label(s, x, y):
        d.text((x, y), s, fill=LABEL)

    d.text((16, 8), title, fill=(255, 255, 255, 255))

    # Window: title bar (33 high), body, a bordered group inside.
    x0, y0, ww, wh = 16, 30, 330, 210
    put("window.header.normal", x0, y0, ww, 33)
    txt("Window title", x0 + 7, y0 + 8, sk.colour("window.header.label_normal"), clip=(x0, y0, x0 + ww - 60, y0 + 33))
    for i, b in enumerate(("close_button", "minimize_button")):
        put(f"window.header.{b}.normal", x0 + ww - 25 - i * 26, y0 + 8, 16, 16)
    put("window.fixed_background", x0, y0 + 34, ww, wh - 34)
    put("window.border_image", x0, y0 + 34, ww, wh - 34)
    txt("Body text in the default font.", x0 + 12, y0 + 46)
    put("window.border_image", x0 + 10, y0 + 74, ww - 20, wh - 84)
    txt("A group or list frame", x0 + 20, y0 + 84)
    put("scrollv.normal", x0 + ww - 32, y0 + 78, 18, wh - 92)
    put("scrollv.dec_button.normal", x0 + ww - 32, y0 + 78, 18, 18)
    put("scrollv.inc_button.normal", x0 + ww - 32, y0 + wh - 32, 18, 18)
    put("scrollv.cursor_normal", x0 + ww - 29, y0 + 98, 12, 40)
    for i, s in enumerate(("Row one", "Row two", "Row three")):
        put("selectable.normal_active" if i == 1 else "selectable.normal", x0 + 18, y0 + 108 + i * 30, ww - 62, 26)
        centred(s, x0 + 18, y0 + 108 + i * 30, ww - 62, 26)
    label("window, title bar, group, list rows, scrollbar", x0, y0 + wh + 4)

    # Buttons.
    bx, by = 370, 30
    label("button: normal / hover / pressed (active)", bx, by)
    for i, (k, s) in enumerate((("normal", "Normal"), ("hover", "Hover"), ("active", "Pressed"))):
        put(f"button.{k}", bx + i * 205, by + 16, 195, 32)
        centred(s, bx + i * 205, by + 16, 195, 32, sk.colour(f"button.text_{k}"))
    by += 62
    label("selectable: normal / hover / pressed / selected / selected+hover / selected+pressed", bx, by)
    for i, (k, s) in enumerate((("normal", "Normal"), ("hover", "Hover"), ("pressed", "Pressed"),
                                ("normal_active", "Selected"), ("hover_active", "Sel+hover"),
                                ("pressed_active", "Sel+press"))):
        cx = bx + (i % 3) * 205
        cy = by + 16 + (i // 3) * 38
        put(f"selectable.{k}", cx, cy, 195, 32)
        centred(s, cx, cy, 195, 32)
    by += 100
    label("checkbox: normal / hover / active / checked / checked+hover", bx, by)
    for i, (k, cur) in enumerate((("normal", None), ("hover", None), ("active", None), ("normal", "cursor_normal"),
                                  ("hover", "cursor_hover"))):
        cx = bx + i * 120
        put(f"checkbox.{k}", cx, by + 18, 22, 22)
        if cur:
            put(f"checkbox.{cur}", cx + 4, by + 22, 14, 14)
        txt("Check", cx + 28, by + 20)
    by += 50
    label("option (radio): normal / hover / active / chosen / chosen+hover", bx, by)
    for i, (k, cur) in enumerate((("normal", None), ("hover", None), ("active", None), ("normal", "cursor_normal"),
                                  ("hover", "cursor_hover"))):
        cx = bx + i * 120
        put(f"option.{k}", cx, by + 18, 22, 22)
        if cur:
            put(f"option.{cur}", cx + 5, by + 23, 12, 12)
        txt("Radio", cx + 28, by + 20)
    by += 50
    label("combo: normal / hover / active", bx, by)
    for i, k in enumerate(("normal", "hover", "active")):
        cx = bx + i * 205
        put(f"combo.{k}", cx, by + 16, 195, 32)
        put(f"combo.button.{k}", cx + 195 - 28, by + 21, 22, 22)
        txt("Option two", cx + 10, by + 23, clip=(cx, by + 16, cx + 165, by + 48))
    by += 60
    label("text edit: normal / hover / active", bx, by)
    for i, k in enumerate(("normal", "hover", "active")):
        cx = bx + i * 205
        put(f"edit.{k}", cx, by + 16, 195, 32)
        txt("Search recipes" if i == 0 else "Typed text", cx + 10, by + 23,
            (128, 128, 128, 255) if i == 0 else sk.colour("edit.text_normal"), clip=(cx, by + 16, cx + 190, by + 48))
    by += 60
    label("progress: normal 40% / hover 70% / active 100%", bx, by)
    for i, (k, f) in enumerate((("normal", 0.4), ("hover", 0.7), ("active", 1.0))):
        cx = bx + i * 205
        put(f"progress.{k}", cx, by + 16, 195, 24)
        put(f"progress.cursor_{k}", cx + 2, by + 18, int(191 * f), 20)

    # Lower left: scrollbars, slider, tree header, context menu, property, fonts.
    lx, ly = 16, 270
    label("scrollbars (track, arrows, thumb): vertical and horizontal", lx, ly)
    put("scrollv.normal", lx, ly + 16, 18, 150)
    put("scrollv.dec_button.normal", lx, ly + 16, 18, 18)
    put("scrollv.inc_button.normal", lx, ly + 148, 18, 18)
    put("scrollv.cursor_normal", lx + 3, ly + 40, 12, 60)
    put("scrollh.normal", lx + 30, ly + 16, 300, 18)
    put("scrollh.dec_button.normal", lx + 30, ly + 16, 18, 18)
    put("scrollh.inc_button.normal", lx + 312, ly + 16, 18, 18)
    put("scrollh.cursor_normal", lx + 60, ly + 19, 100, 12)
    label("slider: bar_filled and knob", lx + 30, ly + 44)
    d.line([(lx + 36, ly + 72), (lx + 320, ly + 72)], fill=(70, 60, 50, 255), width=2)
    d.line([(lx + 36, ly + 72), (lx + 150, ly + 72)], fill=sk.colour("slider.bar_filled"), width=2)
    put("slider.cursor_normal", lx + 144, ly + 63, 12, 18)
    label("tree header (tab.background) with its buttons", lx + 30, ly + 90)
    put("tab.background", lx + 30, ly + 106, 300, 28)
    put("tab.tab_minimize_button.normal", lx + 38, ly + 112, 16, 16)
    txt("Tree node (open)", lx + 62, ly + 111)
    put("tab.background", lx + 30, ly + 138, 300, 28)
    put("tab.tab_maximize_button.normal", lx + 38, ly + 144, 16, 16)
    txt("Tree node (closed)", lx + 62, ly + 143)
    ly += 186
    label("context menu: normal / hover / active", lx, ly)
    for i, k in enumerate(("normal", "hover", "active")):
        put(f"contextual_button.{k}", lx, ly + 16 + i * 26, 200, 24)
        txt(["Examine", "Pick up", "Use"][i], lx + 8, ly + 20 + i * 26)
    label("property (not in nw_inc_nui)", lx + 220, ly)
    put("property.normal", lx + 220, ly + 16, 120, 24)
    put("property.dec_button.normal", lx + 220, ly + 16, 24, 24)
    put("property.inc_button.normal", lx + 316, ly + 16, 24, 24)
    txt("12", lx + 272, ly + 19)
    put("window.scaler", lx + 220, ly + 60, 14, 14)
    label("scaler", lx + 240, ly + 60)
    ly += 104
    label("fonts: (default) and (monospace) at 17 px", lx, ly)
    txt("The quick brown fox jumps over the lazy dog. 0123456789", lx, ly + 16)
    txt("Wood Crafting, level 1 - 28 / 250 XP (222 to level 2)", lx, ly + 37)
    txt("Àéîõü ÇÑß æø ¿¡ «» ©®°±²³µ¶ ×÷", lx, ly + 58)
    txt("int nResult = GetLocalInt(oPC, \"x\"); // mono", lx, ly + 82, f=mono)
    d.text((16, H - 18), f"{font.name} ({sk.data['fonts'][0]['resref']}), {mono.name}; textures from "
                         f"{sk.d.name}", fill=(170, 170, 170, 255))
    return img


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("skins", nargs="+", type=Path)
    ap.add_argument("--nui-preview", type=Path, required=True)
    ap.add_argument("-o", "--out", type=Path, required=True)
    ap.add_argument("--title", action="append", default=[], help="DIRNAME=Title")
    a = ap.parse_args()
    sys.path.insert(0, str(a.nui_preview))
    from skin import draw_text

    titles = dict(t.split("=", 1) for t in a.title)
    a.out.mkdir(parents=True, exist_ok=True)
    for sd in a.skins:
        sk = SkinDir(sd, draw_text)
        im = sheet(sk, titles.get(sd.name, sd.name))
        p = a.out / f"widgets-{sd.name}.png"
        im.convert("RGB").save(p)
        print(p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
