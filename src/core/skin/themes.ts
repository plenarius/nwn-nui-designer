/**
 * The designer's built-in skins (assets/skin/<id>/), used when no game folder is loaded or when asked for. All six are
 * the procedural open skin (CC0 textures and nui_skin.tml under the game's texture names, unmodified OFL fonts), six
 * directions to give an idea or a starting point:
 *
 * - "ink", B "Ink and brass" with Brawler Regular: the default;
 * - "bronze", A "Bronze" with Philosopher Bold: close to the stock look;
 * - "brass", "verdigris", "oxblood": the steampunk shortlist S1 to S3, all three shipped;
 * - "winter", W "Winter steel" with Philosopher Bold and Cinzel Decorative: cold navy and silver.
 *
 * D "Iron" stays a generator preset only. docs/OPEN-SKIN.md has the decisions and their history.
 */
import { BRASS, BRONZE, CLEAN, OXBLOOD, type Style, VERDIGRIS, WINTER } from "./gen/style.js";

export type ThemeId = "ink" | "bronze" | "brass" | "verdigris" | "oxblood" | "winter";

export interface Theme {
  id: ThemeId;
  title: string;
  /** One line on the look and its fonts (the skin editor's start cards, the README's table). */
  look: string;
  style: Style;
  /** The hak `pnpm skin hak` builds for it (at most 16 characters). */
  hak: string;
}

export const THEMES: Theme[] = [
  { id: "ink", title: "Ink and brass", look: "Flat dark panels, a thin brass line, Brawler.", style: CLEAN, hak: "nuid_ink_skin" },
  { id: "bronze", title: "Bronze", look: "Close to the stock look: bronze rims, cloudy blue, Philosopher Bold.", style: BRONZE, hak: "nuid_bronze_skin" },
  { id: "brass", title: "Brass and soot", look: "Soot-black brushed metal in a lit brass pipe, ember copper, Old Standard TT and Rye.", style: BRASS, hak: "nuid_brass_skin" },
  { id: "verdigris", title: "Verdigris and paper", look: "Aged paper and sepia ink in a verdigris copper pipe, Spectral and Federant.", style: VERDIGRIS, hak: "nuid_verdi_skin" },
  { id: "oxblood", title: "Oxblood and rivets", look: "Oxblood leather in a riveted brass band, Zilla Slab and Cinzel Decorative.", style: OXBLOOD, hak: "nuid_oxbld_skin" },
  { id: "winter", title: "Winter steel", look: "Deep navy panels, a thin silver rule, ice-blue selection, Philosopher and Cinzel Decorative.", style: WINTER, hak: "nuid_wintr_skin" },
];

export const DEFAULT_THEME: ThemeId = "ink";

export const themeOf = (id: string | null | undefined): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]!;
