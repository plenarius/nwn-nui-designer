/**
 * The original GUI's `.gui` layouts: GFF files (type "GUI ") that place panel models on each other's hook nodes. Each
 * object names its model (Obj_ResRef), its parent (Obj_Parent, a tag) and the parent's hook node (Obj_Parent_Hook),
 * a position, and a label with a font (AurString_Font).
 */
import { type GffStruct, readGff } from "../res/gff.js";

export interface GuiObject {
  tag: string;
  /** The model, lower case ("" for none). */
  model: string;
  /** The parent's tag ("" for the root). */
  parent: string;
  hook: string;
  type: number;
  x: number;
  y: number;
  z: number;
  layer: number;
  /** The label's font, lower case ("" for none), its text and string reference. */
  font: string;
  text: string;
  strref: number;
  checked: boolean;
}

export interface GuiLayout {
  name: string;
  objects: GuiObject[];
  /** Every other string value, as [label, value]: names a layout may hold besides models and fonts. */
  strings: [string, string][];
}

const PLACED = new Set(["Obj_ResRef", "Obj_Parent", "Obj_Parent_Hook", "Obj_Tag", "AurString_Font", "AurString_Text"]);

/** Reads a .gui; a GFF of another type, or a damaged file, throws. */
export function readGuiLayout(name: string, bytes: Uint8Array): GuiLayout {
  const gff = readGff(bytes);
  if (gff.fileType.trim().toUpperCase() !== "GUI") throw new Error(`${name}: a GFF of type "${gff.fileType.trim()}", not a .gui`);
  const objects: GuiObject[] = [];
  const strings: [string, string][] = [];
  const str = (s: GffStruct, k: string) => {
    const v = s.get(k);
    return typeof v === "string" ? v : "";
  };
  const num = (s: GffStruct, k: string, d = 0) => {
    const v = s.get(k);
    return typeof v === "number" ? v : d;
  };
  const visit = (s: GffStruct, inherited: string) => {
    const label = s.get("Obj_Caption");
    const lab = label && !Array.isArray(label) && typeof label === "object" ? label : null;
    const tag = str(s, "Obj_Tag");
    if (s.has("Obj_Tag") || s.has("Obj_ResRef")) {
      objects.push({
        tag,
        model: str(s, "Obj_ResRef").toLowerCase(),
        parent: s.has("Obj_Parent") ? str(s, "Obj_Parent") : inherited,
        hook: str(s, "Obj_Parent_Hook"),
        type: num(s, "Obj_Type"),
        x: num(s, "Obj_X"),
        y: num(s, "Obj_Y"),
        z: num(s, "Obj_Z"),
        layer: num(s, "Obj_Layer"),
        font: lab ? str(lab, "AurString_Font").toLowerCase() : str(s, "AurString_Font").toLowerCase(),
        text: lab ? str(lab, "AurString_Text") : str(s, "AurString_Text"),
        strref: lab ? num(lab, "Obj_StrRef", 0xffffffff) : num(s, "Obj_StrRef", 0xffffffff),
        checked: num(s, "Obj_Checked") !== 0,
      });
    }
    for (const e of s.entries()) {
      if (typeof e.value === "string" && e.value && !PLACED.has(e.label)) strings.push([e.label, e.value]);
      if (Array.isArray(e.value)) for (const c of e.value) visit(c, tag);
      else if (e.value && typeof e.value === "object" && e.label !== "Obj_Caption") visit(e.value, tag);
      else if (e.value && typeof e.value === "object") {
        for (const le of e.value.entries()) if (typeof le.value === "string" && le.value && !PLACED.has(le.label)) strings.push([le.label, le.value]);
      }
    }
  };
  visit(gff.root(), "");
  return { name: name.toLowerCase(), objects, strings };
}

/** The models a layout places and the fonts its labels use (lower case, sorted, no duplicates). */
export function layoutRefs(l: GuiLayout): { models: string[]; fonts: string[] } {
  const models = new Set<string>();
  const fonts = new Set<string>();
  for (const o of l.objects) {
    if (o.model) models.add(o.model);
    if (o.font) fonts.add(o.font);
  }
  return { models: [...models].sort(), fonts: [...fonts].sort() };
}
