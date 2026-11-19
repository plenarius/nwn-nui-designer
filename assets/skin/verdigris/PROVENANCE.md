# nwn-nui-designer open skin (S2: Verdigris and paper): provenance

Steampunk in daylight: aged paper panels and sepia ink in a thin verdigris copper pipe with copper fittings, a patinated title plate, pale verdigris for pressed and selected, a copper glow on hover. Spectral SemiBold, Federant for headings. Procedural.

## Textures and nui_skin.tml

Drawn by nwn-nui-designer's skin generator (src/core/skin/gen: draw.ts, style.ts) from the numbers of the preset `s-verdigris`: gradients, seeded value noise, 1 px rims, lit pipes, corner rivets, glows and antialiased polygons. No input image. The palette was picked by hand for this look; nothing was sampled, traced or derived from Beamdog's textures. nui_skin.tml was written by the same generator from the list of keys the client reads (src/core/skin/keys.ts); only the key names, the client's interface, are shared with Beamdog's file. Texture names follow the game's (nui_windowh, ...) so a hak that replaces one still takes effect; nuio_* names are this skin's own. (The generator was first written in Python, tools/open-skin/ until 2026-11-16; the TypeScript port draws the same bytes.)

Licence: CC0 1.0 (LICENSE).

## Fonts (SIL OFL 1.1, unmodified)

- `nuio_spectsb.ttf`: Spectral SemiBold, Copyright 2017 The Spectral Project Authors (https://github.com/productiontype/Spectral). From https://raw.githubusercontent.com/google/fonts/5bd87dfc525c8a0d1d8529d3684716e00c3fc59a/ofl/spectral/Spectral-SemiBold.ttf (sha256 5f86915a744832ecf6e4a17ab04bea091b9fa992ef5164ff65ae34c1da2fe94b), unmodified, renamed to its resref only. Licence: OFL-nuio_spectsb.txt.
- `nuio_jbmono.ttf`: JetBrains Mono Regular, Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono). From https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/ttf/JetBrainsMono-Regular.ttf (sha256 a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f), unmodified, renamed to its resref only. Licence: OFL-nuio_jbmono.txt.
- `nuio_federnt.ttf`: Federant Regular, Copyright (c) 2011, Cyreal (www.cyreal.org). From https://raw.githubusercontent.com/google/fonts/5bd87dfc525c8a0d1d8529d3684716e00c3fc59a/ofl/federant/Federant-Regular.ttf (sha256 d40cb09c85114c2b0c9442636412e997d8258b383e1d1a684e7e32b21d07a5c2), unmodified, renamed to its resref only. Licence: OFL-nuio_federnt.txt.

## Files

- `nui_button_a.tga` 128x32
- `nui_button_ah.tga` 128x32
- `nui_button_d.tga` 128x32
- `nui_button_h.tga` 128x32
- `nui_button_n.tga` 128x32
- `nui_checkbox_d.tga` 22x22
- `nui_checkbox_h.tga` 22x22
- `nui_checkbox_n.tga` 22x22
- `nui_checkbox_x.tga` 14x14
- `nui_close.tga` 16x16
- `nui_cnt_down.tga` 16x16
- `nui_cnt_left.tga` 16x16
- `nui_cnt_right.tga` 16x16
- `nui_cnt_up.tga` 16x16
- `nui_header.tga` 128x32
- `nui_maximize.tga` 16x16
- `nui_minimize.tga` 16x16
- `nui_progress.tga` 8x16
- `nui_radial_d.tga` 24x24
- `nui_radial_h.tga` 24x24
- `nui_radial_n.tga` 24x24
- `nui_radial_x.tga` 14x14
- `nui_scrollh.tga` 32x14
- `nui_scrollv.tga` 14x32
- `nui_shld_down.tga` 24x24
- `nui_shld_left.tga` 24x24
- `nui_shld_right.tga` 24x24
- `nui_shld_up.tga` 24x24
- `nui_slider.tga` 12x18
- `nui_windowh.tga` 128x128
- `nui_windowv.tga` 18x64
- `nuio_title.tga` 128x32
- `nuio_trackh.tga` 64x18
