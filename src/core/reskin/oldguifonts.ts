/**
 * The old GUI's fonts from a skin: the skin's text font (its "(default)" [[fonts]] entry) copied under the three names
 * the client draws the original GUI with (fnt_maintext, fnt_default, fnt_default_hr), so both GUIs use one font.
 * Only a font whose licence allows it to be shipped: an OFL font of the built-in skins (its licence text travels with
 * it), or a font of the user's whose own name table says it is under the SIL Open Font License, the Apache License or
 * the Ubuntu Font Licence, or in the public domain, and that does not forbid embedding.
 */
import { parseFace } from "../font/font.js";
import type { SkinFile, SkinProject } from "../skin/project.js";
import { OLD_GUI_FONTS } from "../oldgui/roles.js";

export const OLD_GUI_FONT_NAMES = Object.keys(OLD_GUI_FONTS) as (keyof typeof OLD_GUI_FONTS)[];

/** Licences, as a font's name table states them, that allow a font to be shipped in a hak. */
const FREE = /open font licen[cs]e|\bOFL\b|apache licen[cs]e|ubuntu font licen[cs]e|public domain|CC0|creative commons zero/i;

/** The resref of the skin's text font: its "(default)" [[fonts]] entry. */
export function skinTextFont(tml: string): string | null {
  for (const block of tml.split(/^\s*\[\[fonts\]\]\s*$/m).slice(1)) {
    const body = block.split(/^\s*\[/m)[0] ?? "";
    const name = /^\s*name\s*=\s*"([^"]*)"/m.exec(body)?.[1];
    const resref = /^\s*resref\s*=\s*"([^"]*)"/m.exec(body)?.[1];
    if (name === "(default)" && resref) return resref.toLowerCase();
  }
  return null;
}

export interface LicenceVerdict {
  ok: boolean;
  /** Why, in a few words. */
  why: string;
}

/** Whether a skin's font may be shipped. */
export function fontLicence(f: SkinFile, resref: string): LicenceVerdict {
  if (f.licence === "ofl") return { ok: true, why: "SIL Open Font License 1.1 (its text travels with it)" };
  let face;
  try {
    face = parseFace(f.data, resref);
  } catch (e) {
    return { ok: false, why: `not a font the designer can read (${e instanceof Error ? e.message : String(e)})` };
  }
  const names = face.ot.names as Record<string, Record<string, Record<string, string>>>;
  const text = ["license", "licenseURL"].flatMap((k) => ["windows", "macintosh", "unicode"].flatMap((p) => Object.values(names[p]?.[k] ?? {}))).join(" ");
  // OS/2 fsType 2: restricted licence embedding, the font may not be passed on
  const fsType = face.ot.tables.os2?.fsType ?? 0;
  if ((fsType & 0x000f) === 2) return { ok: false, why: "its OS/2 table says restricted licence embedding: it may not be passed on" };
  if (FREE.test(text)) return { ok: true, why: `its own licence: ${text.slice(0, 80)}` };
  return { ok: false, why: text ? `its licence is not one known to allow shipping it (${text.slice(0, 80)})` : "it states no licence: ship it only if you know its terms allow it, under the three names yourself" };
}

export class FontExportError extends Error {}

export interface OldGuiFonts {
  /** The skin's font the three are copies of. */
  source: string;
  why: string;
  /** "fnt_maintext.ttf" etc. to the font's bytes. */
  files: Record<string, Uint8Array>;
}

/** The skin's text font under the old GUI's three font names; throws a FontExportError when it can't be shipped. */
export function oldGuiFonts(p: SkinProject): OldGuiFonts {
  const resref = skinTextFont(p.tml);
  if (!resref) throw new FontExportError("the skin names no text font (no [[fonts]] entry named \"(default)\"): the old GUI keeps the game's fonts");
  const f = p.files[`${resref}.ttf`];
  if (!f) throw new FontExportError(`the skin's text font ${resref} is not one of its own files (a game font?): the old GUI keeps the game's fonts`);
  const v = fontLicence(f, resref);
  if (!v.ok) throw new FontExportError(`${resref}.ttf: ${v.why}. The old GUI keeps the game's fonts`);
  return { source: resref, why: v.why, files: Object.fromEntries(OLD_GUI_FONT_NAMES.map((n) => [`${n}.ttf`, f.data])) };
}
