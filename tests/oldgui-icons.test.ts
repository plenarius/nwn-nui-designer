// Icon buttons (src/core/oldgui/draw/icons.ts): the redraw keeps each stock pictogram at its size and place, and the
// icon size check fails a theme whose pictogram shrank. Every texture here is synthetic.
import { describe, expect, it } from "vitest";
import { iconShrink, measureIcons, plates, silhouette } from "../src/core/oldgui/draw/icons.js";
import { oldGuiStyle, redrawOldGui } from "../src/core/oldgui/draw/index.js";
import { type Pic, fillRect, fromImage, pic } from "../src/core/oldgui/draw/raster.js";
import { alphaCurve } from "../src/core/reskin/colour.js";
import { paletteFromStyle } from "../src/core/reskin/palette.js";
import { CLEAN } from "../src/core/skin/gen/style.js";

const s = oldGuiStyle(paletteFromStyle(CLEAN));

/** A 64x64 party-bar button: three parchment plates at x 14-49 (rows 5, 23, 41), each with a dark bar 20x8 in it. */
function pbButton(): Pic {
  const p = pic(64, 64, [0, 0, 0], 255);
  for (const y0 of [5, 23, 41]) {
    fillRect(p, 14, y0, 49, y0 + 17, [190, 170, 130]);
    fillRect(p, 21, y0 + 4, 41, y0 + 12, [20, 15, 10]);
  }
  return p;
}

describe("icon buttons", () => {
  it("finds the plates and the stock pictogram", () => {
    const st = pbButton();
    expect(plates(st, 14, 49)).toEqual([
      [14, 5, 49, 22],
      [14, 23, 49, 40],
      [14, 41, 49, 58],
    ]);
    const cells = measureIcons("pb_but_pvp", st);
    expect(cells.map((c) => c.extent)).toEqual([
      [7, 4, 27, 12],
      [7, 4, 27, 12],
      [7, 4, 27, 12],
    ]);
    expect(cells[0]!.area).toBe(160);
    expect(silhouette(st, [14, 5, 49, 22], "dark").reduce((a, v) => a + v, 0)).toBe(160);
  });

  it("redraws the pictogram at the stock's size, and the check passes it", () => {
    const st = pbButton();
    const stock = { width: 64, height: 64, data: Uint8ClampedArray.from(st.d) } as never;
    const out = redrawOldGui({ name: "pb_but_pvp", stock, uv: [], style: s, alpha: alphaCurve("opaque") })!;
    const img = fromImage(out);
    for (const c of measureIcons("pb_but_pvp", st)) expect(iconShrink(img, c)).toBeNull();
  });

  it("fails a pictogram drawn smaller", () => {
    const st = pbButton();
    const small = pic(64, 64, s.out, 255);
    for (const y0 of [5, 23, 41]) {
      fillRect(small, 14, y0, 49, y0 + 17, s.btn);
      fillRect(small, 25, y0 + 6, 37, y0 + 10, s.mark);
    }
    const why = measureIcons("pb_but_pvp", st).map((c) => iconShrink(small, c));
    expect(why.every((w) => w && /the stock's 7,4,27,12 with 160/.test(w))).toBe(true);
  });
});
