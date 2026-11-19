/**
 * Opens a set of resources the way the client layers them, for the browser and Node alike: the module's haks (the
 * first listed wins), loose override files, the game (ovr/, texture packs, keys); the skin from them, or the
 * fallback skin when there is no game or no skin.
 */
import type { TextModel } from "./font/font.js";
import type { CanvasFactory } from "./render/canvas.js";
import { Erf, Folder } from "./res/containers.js";
import { type BitmapDecoder, Images } from "./res/images.js";
import { type FileTree, ResMan } from "./res/resman.js";
import type { ByteSource } from "./res/source.js";
import { type FallbackSkin, fallbackLayer } from "./skin/fallback.js";
import { Skin } from "./skin/skin.js";
import { errorText } from "./errors.js";

export interface ResourceInputs {
  game?: FileTree | null;
  /** Hak (or ERF) files, best first: the module's hak list order. */
  haks?: ByteSource[];
  /** Loose files searched after the haks and before the game (a player's override folder, a skin being tried). */
  overrides?: ByteSource[];
  overridesLabel?: string;
  /** Use the fallback skin even with a game. */
  forceFallback?: boolean;
  /** The built-in skin's files (assets/skin/<theme>), loaded only when it is used. */
  fallbackSkin: () => Promise<FallbackSkin>;
  /** What to call it ("built-in skin: Ink and brass"). */
  fallbackLabel?: string;
  makeCanvas: CanvasFactory;
  decodeBitmap?: BitmapDecoder | null;
  textModel?: TextModel;
}

export interface Resources {
  resman: ResMan;
  images: Images;
  skin: Skin;
  warnings: string[];
  usingFallback: boolean;
  /** Where the skin came from. */
  skinFrom: string;
}

export async function openResourceSet(o: ResourceInputs): Promise<Resources> {
  const resman = new ResMan();
  const warnings: string[] = [];
  for (const h of o.haks ?? []) {
    try {
      resman.layers.push({ kind: "hak", container: await Erf.open(h) });
    } catch (e) {
      // The container's errors start with the file's name already.
      const m = errorText(e);
      warnings.push(m.startsWith(h.name) ? m : `${h.name}: ${m}`);
    }
  }
  if (o.overrides?.length) resman.layers.push({ kind: "override", container: new Folder(o.overridesLabel ?? "override", o.overrides) });
  if (o.game) {
    const g = await ResMan.gameLayers(o.game);
    resman.layers.push(...g.layers);
    warnings.push(...g.warnings);
  }
  let usingFallback = !o.game || !!o.forceFallback;
  let tml: Uint8Array | string | null = null;
  let skinFrom = "fallback skin";
  if (!usingFallback) {
    tml = await resman.get("nui_skin", "tml");
    if (tml) skinFrom = resman.where("nui_skin", "tml")?.container.label ?? "?";
    else {
      warnings.push("no nui_skin.tml in the game or the haks: using the fallback skin");
      usingFallback = true;
    }
  }
  if (usingFallback) {
    const fb = fallbackLayer(await o.fallbackSkin(), o.fallbackLabel);
    resman.layers.push({ kind: "memory", container: fb.container });
    tml = fb.tml;
    skinFrom = o.fallbackLabel ?? "fallback skin";
  }
  const skin = await Skin.load(tml!, resman, { model: o.textModel, makeCanvas: o.makeCanvas });
  for (const f of skin.missingFonts) warnings.push(`font "${f.name}": no ${f.resref}.ttf in the resources`);
  const images = new Images(resman, o.decodeBitmap ?? null);
  return { resman, images, skin, warnings, usingFallback, skinFrom };
}
