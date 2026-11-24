// The flat chrome the frame mapping recolours: the close X, the translucent window fills and the item outline strips
// stayed stock beside a theme's chrome before they were listed. Every texture here is synthetic: no game art.
import { describe, expect, it } from "vitest";
import { alphaCurve, frameColour, ladder, lum } from "../src/core/reskin/colour.js";
import { paletteFromStyle } from "../src/core/reskin/palette.js";
import { AUTO } from "../src/core/reskin/textures.js";
import { BRONZE, VERDIGRIS } from "../src/core/skin/gen/style.js";

describe("flat chrome", () => {
  it("is recoloured, the outline strips keeping their alpha", () => {
    for (const n of ["gui_ig_xbutton", "gui_transprnt", "gui_transprnt2", "gui_pregame_bkg"]) {
      expect(AUTO.find((t) => t.name === n)).toMatchObject({ action: "recolour", group: "frame" });
    }
    for (const n of ["gui_inv_1x1_ol", "gui_inv_1x2_ol", "gui_inv_2x1_ol", "gui_inv_2x2_ol", "gui_inv_2x4_ol"]) {
      expect(AUTO.find((t) => t.name === n)).toMatchObject({ action: "recolour", keepAlpha: true });
    }
  });

  for (const style of [BRONZE, VERDIGRIS]) {
    const p = paletteFromStyle(style);
    it(`fills run from ink to the button face, between them (${style === BRONZE ? "Bronze" : "Verdigris"})`, () => {
      const m = frameColour(p, "gui_transprnt");
      expect(m(0, 0, 0, 166)).toEqual(p.ink);
      expect(m(99, 101, 99, 153).map(Math.round)).toEqual(ladder(p).button.map(Math.round));
      const [a, b] = [lum(p.ink), lum(ladder(p).button)].sort((x, y) => x - y);
      expect(lum(m(49, 52, 49, 140))).toBeGreaterThanOrEqual(a! - 1);
      expect(lum(m(49, 52, 49, 140))).toBeLessThanOrEqual(b! + 1);
      expect(alphaCurve("opaque")(140)).toBeGreaterThan(230);
    });
    it(`the close X: white to the accent, grey to the rule (${style === BRONZE ? "Bronze" : "Verdigris"})`, () => {
      const m = frameColour(p, "gui_ig_xbutton");
      expect(m(0, 0, 0, 255)).toEqual(p.ink);
      expect(m(255, 255, 255, 255)).toEqual(p.accent);
      expect(Math.abs(lum(m(99, 101, 99, 255)) - lum(p.ink))).toBeGreaterThanOrEqual(60);
    });
  }
});
