// The canvas zoom: its steps, the fitted zoom, and when the canvas's pixels are copied (crisp) or resampled (smooth).
import { describe, expect, it } from "vitest";
import { ZOOM_STEPS, fitZoom, wholeRatio, zoomIn, zoomOut, zoomRendering } from "../src/app/editor/zoom.js";

describe("zoom", () => {
  it("copies pixels at whole device pixels per canvas pixel, and smooths any other ratio", () => {
    expect(zoomRendering(1)).toBe("pixelated");
    expect(zoomRendering(2)).toBe("pixelated");
    expect(zoomRendering(3)).toBe("pixelated");
    expect(zoomRendering(1.56)).toBe("auto");
    expect(zoomRendering(1.5)).toBe("auto");
    expect(zoomRendering(0.5)).toBe("auto");
    // A HiDPI screen: 100 % is two device pixels each, 150 % three; 125 % at ratio 2 is 2.5.
    expect(zoomRendering(1, 2)).toBe("pixelated");
    expect(zoomRendering(1.5, 2)).toBe("pixelated");
    expect(zoomRendering(0.5, 2)).toBe("pixelated");
    expect(zoomRendering(1.25, 2)).toBe("auto");
    // Windows at 125 %: 100 % is 1.25 device pixels, resampled; 0.8 would be 1.
    expect(zoomRendering(1, 1.25)).toBe("auto");
    expect(wholeRatio(0.8, 1.25)).toBe(1);
  });

  it("steps through whole zooms from 100 %", () => {
    expect(ZOOM_STEPS.filter((s) => s >= 1 && Number.isInteger(s))).toEqual([1, 2, 3, 4]);
    expect(zoomIn(1)).toBe(1.5);
    expect(zoomIn(1.5)).toBe(2);
    expect(zoomIn(2)).toBe(3);
    expect(zoomIn(4)).toBe(4);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomOut(0.25)).toBe(0.25);
    // From a zoom between steps (Ctrl + wheel), to the next step either way.
    expect(zoomIn(1.56)).toBe(2);
    expect(zoomOut(1.56)).toBe(1.5);
  });

  it("fits at a whole ratio from 100 % up, and as it is below", () => {
    expect(fitZoom(1.56)).toBe(1);
    expect(fitZoom(2.7)).toBe(2);
    expect(fitZoom(0.999)).toBe(1);
    expect(fitZoom(0.8)).toBe(0.8);
    expect(fitZoom(0.1)).toBe(0.25);
    // Ratio 2: 1.56 is 3.12 device pixels, so 1.5 (3).
    expect(fitZoom(1.56, 2)).toBe(1.5);
    expect(fitZoom(0.4, 2)).toBe(0.4);
  });
});
