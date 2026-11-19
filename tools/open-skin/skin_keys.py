"""Every key the NWN:EE 8193.37-17 client reads from nui_skin.tml, in the order Nui__ReloadSkin reads them, with its
value type and (for 9-slice images) the slice margins the client hard-codes.

Source: docs/CLIENT-BEHAVIOUR.md#skin-keys, itself from the client decompile. This is a description of the client's interface, written for this project; it
contains no Beamdog file content.

Types:
  colour   "#RRGGBBAA"; a missing key is #00000000 (transparent) in the client
  image9   a texture resref drawn as a 9-slice with fixed margins (left, top, right, bottom source pixels);
           a missing key loads the image "" and draws the not-found placeholder
  imgcol   "#RRGGBBAA" for a flat colour, anything else is a texture stretched to the widget
  int      whole number, missing = 0

The margins tuple order for tab.background is (5, 3, 3, 3) as documented; which side the 5 belongs to is not known
(open question in docs/OPEN-SKIN.md).
"""

from __future__ import annotations

M3 = (3, 3, 3, 3)
M7 = (7, 7, 7, 7)
M0 = (0, 0, 0, 0)
MTAB = (5, 3, 3, 3)

# (key, type, margins or None, note)
KEYS: list[tuple[str, str, tuple | None, str]] = []


def _k(key, typ, margins=None, note=""):
    KEYS.append((key, typ, margins, note))


_k("text.color", "colour", note="default text colour (labels, text)")
_k("border.border_image", "image9", M3, "only its slice margin is used: border thickness = margin + 1 = 4 px")
_k("window.fixed_background", "imgcol", note="window body background")
_k("window.background", "colour")
_k("window.border_image", "image9", M3, "window border; also groups, lists and bordered text")
for c in ("border_color", "popup_border_color", "combo_border_color", "contextual_border_color", "menu_border_color",
          "group_border_color", "tooltip_border_color"):
    _k(f"window.{c}", "colour")
_k("window.scaler", "imgcol", note="resize grip")
_k("window.padding_x", "int")
_k("window.padding_y", "int")
_k("window.scrollbar_size_x", "int", note="times the GUI scale")
_k("window.scrollbar_size_y", "int")
for s in ("normal", "hover", "active"):
    _k(f"window.header.{s}", "image9", M3, "title bar")
for s in ("label_normal", "label_hover", "label_active"):
    _k(f"window.header.{s}", "colour", note="title text")
for b in ("close_button", "minimize_button"):
    for s in ("normal", "hover", "active"):
        _k(f"window.header.{b}.{s}", "imgcol")
    _k(f"window.header.{b}.padding_x", "int")
    _k(f"window.header.{b}.padding_y", "int")
# NuiChart: read at the TOP LEVEL (the stock file puts them under [chart], where they are never read).
for c in ("background_color", "color", "border_color", "selected_color"):
    _k(c, "colour", note="NuiChart (top level, not under [chart])")
_k("chart.border", "int")
for sb in ("scrollv", "scrollh"):
    for s in ("normal", "hover", "active"):
        _k(f"{sb}.{s}", "image9", M3, "scrollbar track")
    for s in ("cursor_normal", "cursor_hover", "cursor_active"):
        _k(f"{sb}.{s}", "image9", M0, "scrollbar thumb: the texture's middle strip repeated along the bar (REGION, TILE)")
    for b in ("dec_button", "inc_button"):
        for s in ("normal", "hover", "active"):
            _k(f"{sb}.{b}.{s}", "imgcol")
    if sb == "scrollv":
        _k("scrollv.border_color", "colour", note="scrollh.border_color is not read")
    _k(f"{sb}.padding_x", "int")
    _k(f"{sb}.padding_y", "int")
for sec in ("checkbox", "option"):
    for s in ("normal", "hover", "active", "cursor_normal", "cursor_hover"):
        _k(f"{sec}.{s}", "imgcol", note="NuiCheck" if sec == "checkbox" else "NuiOptions")
_k("button.normal", "image9", M3)
_k("button.hover", "image9", M7)
_k("button.active", "image9", M3)
for s in ("text_background", "text_normal", "text_hover", "text_active"):
    _k(f"button.{s}", "colour")
_k("button.border", "int", note="divided by 100")
for s in ("normal", "active", "hover"):
    _k(f"contextual_button.{s}", "imgcol")
_k("contextual_button.padding_x", "int")
_k("contextual_button.padding_y", "int")
_k("tab.background", "image9", MTAB, "tree/tab headers")
for b in ("tab_minimize_button", "tab_maximize_button", "node_minimize_button", "node_maximize_button"):
    for s in ("normal", "active", "hover"):
        _k(f"tab.{b}.{s}", "imgcol")
for s in ("cursor_normal", "cursor_hover", "cursor_active"):
    _k(f"slider.{s}", "imgcol", note="slider knob")
_k("slider.bar_filled", "colour")
for s in ("normal", "pressed", "normal_active", "pressed_active", "hover_active"):
    _k(f"selectable.{s}", "image9", M3, "NuiButtonSelect")
_k("selectable.hover", "image9", M7)
_k("selectable.padding_x", "int")
_k("selectable.padding_y", "int")
_k("progress.normal", "image9", M3)
_k("progress.hover", "image9", M7)
_k("progress.active", "image9", M7)
for s in ("cursor_normal", "cursor_hover", "cursor_active"):
    _k(f"progress.{s}", "imgcol", note="progress fill")
_k("property.normal", "imgcol", note="Nuklear property widget (not exposed by nw_inc_nui)")
_k("property.active", "imgcol")
# The client asks for "property.hover " (trailing space), so property.hover is never read. Listed for completeness.
_k("property.hover", "imgcol", note="NEVER READ: the client asks for 'property.hover ' (trailing space)")
for b in ("dec_button", "inc_button", "edit"):
    for s in ("normal", "hover", "active"):
        _k(f"property.{b}.{s}", "imgcol")
_k("combo.normal", "image9", M3)
_k("combo.hover", "image9", M7)
_k("combo.active", "image9", M3)
_k("combo.content_padding_x", "int")
_k("combo.content_padding_y", "int")
for s in ("normal", "active", "hover"):
    _k(f"combo.button.{s}", "imgcol", note="dropdown arrow")
for s in ("normal", "hover", "active"):
    _k(f"edit.{s}", "image9", M3, "NuiTextEdit")
_k("edit.border_color", "colour")
_k("edit.text_normal", "colour")
_k("edit.padding_x", "int")
_k("edit.padding_y", "int")

READ_KEYS = [k for k in KEYS if not k[3].startswith("NEVER READ")]
FONT_KEYS = ["name", "resref", "pixel_height", "pixel_snap", "oversample_h", "oversample_v", "font_size", "spacing_h",
             "spacing_v"]


# The scrollbar thumbs use only part of their texture and repeat it along the bar (Nui::ReloadSkin's nk_styleimg9
# region and tiling flag, from the disassembly; nwn-module PR #1115, the designer's src/core/render/slice.ts): x, y, w,
# h of the part, and whether it repeats across x / along y.
REGION = {f"{sb}.{s}": r for sb, r in (("scrollv", (3, 0, 10, 16)), ("scrollh", (0, 3, 16, 10)))
          for s in ("cursor_normal", "cursor_hover", "cursor_active")}
TILE = {f"{sb}.{s}": t for sb, t in (("scrollv", (False, True)), ("scrollh", (True, False)))
        for s in ("cursor_normal", "cursor_hover", "cursor_active")}


def get(data: dict, path: str):
    d = data
    for p in path.split("."):
        if not isinstance(d, dict) or p not in d:
            return None
        d = d[p]
    return d


def margins_by_texture(data: dict) -> dict[str, tuple]:
    """Texture resref -> the 9-slice margins of the first key that uses it (for preview drawing)."""
    out: dict[str, tuple] = {}
    for key, typ, m, _ in KEYS:
        v = get(data, key)
        if typ == "image9" and isinstance(v, str):
            out.setdefault(v.lower(), m)
    return out


def textures(data: dict) -> set[str]:
    out = set()
    for key, typ, _, _ in KEYS:
        v = get(data, key)
        if typ in ("image9", "imgcol") and isinstance(v, str) and not v.startswith("#"):
            out.add(v.lower())
    return out
