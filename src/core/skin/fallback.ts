/**
 * The built-in skins: used when no game folder is loaded (or when asked for), since this project cannot ship
 * Beamdog's skin, textures or fonts. Each is an open skin in assets/skin/<theme>/ (themes.ts; docs/OPEN-SKIN.md):
 * "ink", B "Ink and brass" with Brawler Regular, the default; "bronze", A
 * "Bronze" with Philosopher Bold; and the steampunk three, "brass", "verdigris" and "oxblood". Each has a
 * nui_skin.tml that sets every key the client reads, procedural textures under the game's names (nui_windowh,
 * nui_button_n, ...; a hak that replaces one still takes effect) plus a few nuio_* of its own, and unmodified OFL
 * fonts: its text font "(default)", JetBrains Mono "(monospace)" and, in the steampunk three, a "display" font.
 *
 * The files are built by `pnpm skin ship` (src/core/skin/gen); the textures and nui_skin.tml are CC0, the fonts OFL
 * (each folder's LICENSE). Each platform loads them (src/app/platform.ts, src/node/setup.ts) and hands them here.
 */
import { MemoryContainer } from "../res/containers.js";
import { RES_TYPES, splitResName } from "../res/restype.js";

/** The fallback skin's files by name: "nui_skin.tml", "nui_windowh.tga", "nuio_philo_b.ttf", ... */
export type FallbackSkin = Record<string, Uint8Array>;

/** File names in assets/skin that are resources (the licence and provenance texts are not). */
export const isFallbackSkinFile = (name: string): boolean => /\.(tml|tga|ttf)$/i.test(name);

/** The fallback skin's resources and its nui_skin.tml. */
export function fallbackLayer(files: FallbackSkin, label = "built-in skin"): { container: MemoryContainer; tml: Uint8Array } {
  const c = new MemoryContainer(label);
  for (const [name, data] of Object.entries(files)) {
    const r = isFallbackSkinFile(name) ? splitResName(name) : null;
    if (r) c.set(r[0], r[1], data);
  }
  const tml = files["nui_skin.tml"];
  if (!tml) throw new Error("the fallback skin (assets/skin) has no nui_skin.tml");
  if (!c.has("nui_skin", RES_TYPES.tml!)) c.set("nui_skin", RES_TYPES.tml!, tml);
  return { container: c, tml };
}
