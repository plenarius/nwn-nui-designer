"""A font measured and drawn the way Nuklear's font baker sizes it (nuklear.h nk_font_bake_pack/convert): font_size is
the hhea ascent - descent height (stb_truetype ScaleForPixelHeight), each advance gets spacing_h and is rounded to a
whole pixel (pixel_snap), no kerning. Drawn unhinted at 4x and averaged down, as nui-preview's skin.py draws.

Used by the specimen and the render scripts so every candidate (and the stock reference, locally) is measured by the
same rule. See docs/OPEN-SKIN.md, "Which text model".
"""

from __future__ import annotations

import io
import math

from fontTools.ttLib import TTFont
from PIL import ImageFont

SUPERSAMPLE = 4


class NkFont:
    def __init__(self, name: str, ttf: bytes, size: float, spacing_h: float = 0.5, pixel_snap: bool = True):
        self.name = name
        self.size = size
        self.line = size
        tt = TTFont(io.BytesIO(ttf))
        self.upm = tt["head"].unitsPerEm
        hh = tt["hhea"]
        self.scale = size / (hh.ascent - hh.descent)
        self.em_px = self.upm * self.scale
        self.ascent = hh.ascent * self.scale
        self.descent = -hh.descent * self.scale
        # The baseline's distance from the top of a SUPERSAMPLE x line mask: nui-preview's skin.draw_text (nwn-module
        # #1121 on) draws with it, rounded as Nuklear rounds (halves up).
        self.big_ascent = math.floor(hh.ascent * self.scale * SUPERSAMPLE + 0.5)
        self._cmap = tt.getBestCmap()
        self._hmtx = tt["hmtx"]
        self.spacing_h = spacing_h
        self.pixel_snap = pixel_snap
        self._adv: dict[str, float] = {}
        self._ttf = ttf
        # Pillow takes float sizes: the em in pixels.
        self.face = ImageFont.truetype(io.BytesIO(ttf), self.em_px, layout_engine=ImageFont.Layout.BASIC)
        self._big = None

    def big(self):
        if self._big is None:
            self._big = ImageFont.truetype(io.BytesIO(self._ttf), self.em_px * SUPERSAMPLE,
                                           layout_engine=ImageFont.Layout.BASIC)
        return self._big

    def advance(self, ch: str) -> float:
        a = self._adv.get(ch)
        if a is None:
            g = self._cmap.get(ord(ch), ".notdef")
            raw = self._hmtx[g][0] * self.scale + self.spacing_h
            a = math.floor(raw + 0.5) if self.pixel_snap else raw
            self._adv[ch] = a
        return a

    def width(self, text: str) -> float:
        return sum(self.advance(c) for c in text)
