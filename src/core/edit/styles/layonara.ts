/**
 * Layonara's house style, built in: styles/layonara.json (a style file of generic rules, generic.ts) bundled with the
 * editor and the check command. It ships as an example of a style file to copy and adapt (README, "Your own house
 * style").
 */
import json from "../../../../styles/layonara.json" with { type: "json" };
import { parseStyleDef } from "./generic.js";

export const LAYONARA = parseStyleDef(json, "styles/layonara.json").set;

/** The longest tooltip in Layonara's style. */
export const TOOLTIP_MAX = json.rules["tooltip-length"].max;

export { frameOf, isCloseButton } from "./generic.js";
