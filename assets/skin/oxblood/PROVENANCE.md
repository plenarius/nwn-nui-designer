# nwn-nui-designer open skin (S3: Oxblood and rivets): provenance

Steampunk upholstery: oxblood leather panels in a bevelled brass band riveted at the corners, dark verdigris for pressed and selected, a brass glow on hover. Zilla Slab SemiBold, Cinzel Decorative for headings. Procedural.

## Textures and nui_skin.tml

Drawn by nwn-nui-designer's skin generator (src/core/skin/gen: draw.ts, style.ts) from the numbers of the preset `s-oxblood`: gradients, seeded value noise, 1 px rims, corner rivets, glows and antialiased polygons. No input image. The palette was picked by hand for this look; nothing was sampled, traced or derived from Beamdog's textures. nui_skin.tml was written by the same generator from the list of keys the client reads (src/core/skin/keys.ts); only the key names, the client's interface, are shared with Beamdog's file. Texture names follow the game's (nui_windowh, ...) so a hak that replaces one still takes effect; nuio_* names are this skin's own. (The generator was first written in Python, tools/open-skin/ until 2026-11-16; the TypeScript port draws the same bytes.)

Licence: CC0 1.0 (LICENSE).

## Fonts (SIL OFL 1.1, unmodified)

- `nuio_zillasb.ttf`: Zilla Slab SemiBold, Copyright 2017, The Mozilla Foundation. From https://raw.githubusercontent.com/google/fonts/5bd87dfc525c8a0d1d8529d3684716e00c3fc59a/ofl/zillaslab/ZillaSlab-SemiBold.ttf (sha256 aafcb295b88d520357db1ecf9a1c3167055e87e9ddf5f63e560cbd139ec2805e), unmodified, renamed to its resref only. Licence: OFL-nuio_zillasb.txt.
- `nuio_jbmono.ttf`: JetBrains Mono Regular, Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono). From https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/ttf/JetBrainsMono-Regular.ttf (sha256 a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f), unmodified, renamed to its resref only. Licence: OFL-nuio_jbmono.txt.
- `nuio_cinzldb.ttf`: Cinzel Decorative Bold, Copyright (c) 2012 Natanael Gama (info@ndiscovered.com). From https://raw.githubusercontent.com/google/fonts/5bd87dfc525c8a0d1d8529d3684716e00c3fc59a/ofl/cinzeldecorative/CinzelDecorative-Bold.ttf (sha256 e854e68a388aa50d742a4415c1ae5c17a617ef7956c95a70021d0a4a44f20518), unmodified, renamed to its resref only. Licence: OFL-nuio_cinzldb.txt.

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
