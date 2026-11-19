/**
 * The resources a skin project draws with: its own files over the base resources (the game and haks, or the
 * fallback skin), and its nui_skin.tml as the skin. The window editor's canvas and the widget sheet take the result
 * like any other resource set, so an edit redraws everything with the edited skin.
 */
import type { TextModel, FontFace } from "../font/font.js";
import type { CanvasFactory } from "../render/canvas.js";
import { type BitmapDecoder, Images } from "../res/images.js";
import { ResMan } from "../res/resman.js";
import type { Resources } from "../session.js";
import { type SkinProject, projectLayer } from "./project.js";
import { Skin } from "./skin.js";

export interface PreviewOptions {
  makeCanvas: CanvasFactory;
  decodeBitmap?: BitmapDecoder | null;
  textModel?: TextModel;
  /** Parsed fonts kept between redraws. */
  faceCache?: Map<string, FontFace>;
}

export async function skinResources(base: Resources, p: SkinProject, o: PreviewOptions): Promise<Resources> {
  const resman = new ResMan();
  resman.layers = [{ kind: "memory", container: projectLayer(p) }, ...base.resman.layers];
  const skin = await Skin.load(p.tml, resman, { model: o.textModel, makeCanvas: o.makeCanvas, faceCache: o.faceCache });
  const images = new Images(resman, o.decodeBitmap ?? base.images.decodeBitmap);
  const warnings = skin.missingFonts.map((f) => `font "${f.name}": no ${f.resref}.ttf`);
  return { resman, images, skin, warnings, usingFallback: base.usingFallback, skinFrom: `skin editor: ${p.name}` };
}
