/**
 * The mobile checks: what works on the desktop and breaks on the iOS or Android client, each citing its rule in the
 * nwn-nui-spec (spec/mobile.md, NUI-MOBILE-0xx). Optional: the editor runs them when "Check for mobile clients" is on
 * or the preview client is not the desktop, `pnpm check --mobile` on the command line, and each rule can be turned off
 * like a style rule (its id in the disabled rules). They join the problem list as source "mobile" (lint.ts).
 *
 * They read the JSON only, plus (for the images) where the game's resources come from, when there is a game.
 */
import { marginOf } from "../layout/layout.js";
import { type JsonObject, type JsonValue, isObject } from "../model/types.js";
import type { ResMan } from "../res/resman.js";
import { CLIENT_PROBE } from "../res/images.js";
import { type StyleContext, type StyleRule, type StyleRuleSet, valueOf } from "../edit/style.js";
import { type ElemPath, kidsOf, typeOf } from "../edit/tree.js";
import type { Finding } from "../edit/validate.js";
import { MOBILE } from "./client.js";

/** The rule set's source in the problem list. */
export const MOBILE_SOURCE = "mobile";

/** Whether a resref draws black on iOS and Android: its winning type is a TGA that only the base game has. */
export type ImageRisk = (resref: string) => boolean;

export interface MobileContext extends StyleContext {
  /** With a game: tells base-game TGA-only images (NUI-MOBILE-050). Without one, images are not checked. */
  imageRisk?: ImageRisk | null;
}

const SPEC = "https://github.com/plenarius/nwn-nui-spec/blob/main/spec/mobile.md";

/**
 * Every element whose margin the layout uses, with its path: children of rows and columns, and list template cells.
 * The top element of a solver (the window's root, a group's child) is not placed by its margin, so it is left out.
 */
function placedElems(root: JsonObject, fn: (e: JsonObject, path: ElemPath) => void): void {
  const rec = (e: JsonObject, path: ElemPath, placed: boolean) => {
    if (placed) fn(e, path);
    const t = typeOf(e);
    kidsOf(e).forEach((c, i) => rec(c, [...path, i], t !== "group"));
  };
  rec(root, [], false);
}

/** Every element with its path. */
function eachElem(root: JsonObject, fn: (e: JsonObject, path: ElemPath) => void): void {
  const rec = (e: JsonObject, path: ElemPath) => {
    fn(e, path);
    kidsOf(e).forEach((c, i) => rec(c, [...path, i]));
  };
  rec(root, []);
}

const rootOf = (ctx: StyleContext): JsonObject | null => (isObject(ctx.win.root) ? ctx.win.root : null);

const margin: StyleRule = {
  id: "mobile-margin",
  title: "Margin on iOS",
  summary: "Every element's margin, the default 2 included, is multiplied by the screen density on iOS (3 on an iPhone): give every element margin 0 and make gaps with spacers (NUI-MOBILE-021, -060).",
  check(ctx, report) {
    const root = rootOf(ctx);
    if (!root) return;
    placedElems(root, (e, path) => {
      const m = marginOf(e);
      if (m <= 0) return;
      const set = typeof e.margin === "number" && e.margin >= 0;
      report(
        path,
        `margin ${m}${set ? "" : " (the default)"} is ${m * MOBILE.measuredDensity} on an iPhone (density ${MOBILE.measuredDensity}): a fixed row or column that fits it here is refused there, "Error constructing window" (NUI-MOBILE-021). Set margin 0 and make the gap with a spacer, or export with portable margins`,
        "warning",
        "margin",
      );
    });
  },
};

const centred: StyleRule = {
  id: "mobile-centred",
  title: "Centred window on iOS",
  summary: "A window at -1 (centred) or -2 / -3 (at the mouse) lands clamped in the bottom-right corner on iOS, often mostly off-screen: place it explicitly (NUI-MOBILE-027, -060).",
  check(ctx, report) {
    const g = valueOf(ctx, ctx.win.geometry);
    if (!isObject(g)) return;
    const odd = (["x", "y"] as const).filter((k) => g[k] === -1 || g[k] === -2 || g[k] === -3);
    if (!odd.length) return;
    report(
      null,
      `geometry ${odd.map((k) => `${k} = ${g[k]}`).join(", ")}: on iOS the client works the position out in pixels and reads it as points, so the window lands in the bottom-right corner, mostly off-screen (NUI-MOBILE-027). Place it explicitly, at a position divided by the player's density factor (nui_touch.nss, NuiTouch_Rect)`,
      "warning",
      "geometry",
    );
  },
};

const thinCell: StyleRule = {
  id: "mobile-thin-cell",
  title: "Thin list cell on iOS",
  summary: `A fixed list template cell narrower than ${MOBILE.thinCell} is drawn about ${MOBILE.minCellPx} px wide on iOS and pushes the others: space cells with the list's inset or the cell's content (NUI-MOBILE-024, -060).`,
  check(ctx, report) {
    const root = rootOf(ctx);
    if (!root) return;
    eachElem(root, (e, path) => {
      if (typeOf(e) !== "list" || !Array.isArray(e.row_template)) return;
      let i = -1;
      for (const c of e.row_template) {
        if (!Array.isArray(c) || !isObject(c[0])) continue;
        i++;
        const w = typeof c[1] === "number" ? c[1] : 0;
        const variable = c.length > 2 ? Boolean(c[2]) : true;
        if (variable || w >= MOBILE.thinCell) continue;
        const what = typeOf(c[0]) === "spacer" ? "spacer cell" : "cell";
        report(
          [...path, i],
          `a ${what} ${w} wide: iOS never draws a list cell narrower than about ${MOBILE.minCellPx} px, so it takes more room than here and pushes the other cells right (NUI-MOBILE-024). ${what === "spacer cell" ? "Drop it, and" : "Widen it, or"} space the cells with the list's inset or the cells' content`,
          "warning",
          "row_template",
        );
      }
    });
  },
};

const scaling: StyleRule = {
  id: "mobile-scaling",
  title: "Scale lists and drawings per player",
  summary: "List row heights, template cell widths and draw-list coordinates are multiplied by the density on iOS: divide them by the player's factor when the window is built (NUI-MOBILE-022, -023, -025, -060).",
  check(ctx, report) {
    const root = rootOf(ctx);
    if (!root) return;
    const what = new Set<string>();
    eachElem(root, (e) => {
      if (typeOf(e) === "list") {
        what.add("list row heights");
        if (Array.isArray(e.row_template) && e.row_template.some((c) => Array.isArray(c) && c.length > 1 && !(c.length > 2 && c[2]))) what.add("fixed cell widths");
      }
      if (Array.isArray(e.draw_list) && e.draw_list.length) what.add("draw-list coordinates");
    });
    if (!what.size) return;
    report(
      null,
      `its ${[...what].join(", ")} are right on the desktop and Android, and multiplied by the density on iOS (3 times on an iPhone; NUI-MOBILE-022, -023, -025). Build the window per player: measure the client once (the density probe) and divide them by its factor, as nui_touch.nss's NuiTouch_Layout does (NUI-MOBILE-060)`,
      "info",
    );
  },
};

/** The image resrefs an element shows: an image's value, an image button's label, a draw-list image's image. */
function imageRefs(ctx: StyleContext, e: JsonObject): { key: string; ref: string }[] {
  const out: { key: string; ref: string }[] = [];
  const add = (key: string, v: JsonValue | undefined) => {
    const r = valueOf(ctx, v);
    for (const x of Array.isArray(r) ? r : [r]) if (typeof x === "string" && x) out.push({ key, ref: x.toLowerCase() });
  };
  const t = typeOf(e);
  if (t === "image") add("value", e.value);
  if (t === "button_image") add("label", e.label);
  if (Array.isArray(e.draw_list)) for (const it of e.draw_list) if (isObject(it) && it.type === 5) add("draw_list", it.image);
  return out;
}

const images: StyleRule = {
  id: "mobile-tga",
  title: "Base-game TGA image on mobile",
  summary: "A base-game image that exists only as a TGA draws as a black box in NUI on iOS and Android: ship a copy of it in a hak (NUI-MOBILE-050, -051). Needs the game.",
  check(ctx, report) {
    const risk = (ctx as MobileContext).imageRisk;
    const root = rootOf(ctx);
    if (!risk || !root) return;
    eachElem(root, (e, path) => {
      const seen = new Set<string>();
      for (const { key, ref } of imageRefs(ctx, e)) {
        if (seen.has(ref) || !risk(ref)) continue;
        seen.add(ref);
        report(path, `"${ref}" is a base-game TGA (no DDS, JPG or hak copy): it draws as a black box on iOS and Android (NUI-MOBILE-050). Ship a byte-identical copy in a hak, which draws everywhere (NUI-MOBILE-051)`, "warning", key);
      }
    });
  },
};

/** The mobile rule set. Shaped as a style rule set, so the editor lists and turns its rules off the same way. */
export const MOBILE_RULES: StyleRuleSet = {
  id: MOBILE_SOURCE,
  name: "Mobile clients",
  description: "What breaks on the iOS and Android clients, from the measurements of the nwn-nui-spec (one iPhone at density 3 and one Android tablet).",
  source: SPEC,
  rules: [margin, centred, thinCell, scaling, images],
};

/** The mobile findings of a window, rules in `disabled` left out. */
export function mobileFindings(ctx: MobileContext, disabled: ReadonlySet<string> = new Set()): Finding[] {
  const out: Finding[] = [];
  for (const r of MOBILE_RULES.rules) {
    if (disabled.has(r.id)) continue;
    r.check(ctx, (path, text, severity = "warning", key) => out.push({ severity, source: MOBILE_SOURCE, kind: r.title, text, path, key }));
  }
  return out;
}

/** The game's own layers (what a module's haks and loose files are not). */
const GAME_LAYERS = new Set(["game-ovr", "texture-pack", "key"]);

/**
 * With a game: whether an image name draws black on mobile clients. The client picks the type first, the last of
 * wbm, gif, png, tga, jpg, dds found in any layer (NUI-IMAGE-010); the name is at risk when that type is TGA and
 * the first layer with the TGA is the game's own (NUI-MOBILE-050). A hak's TGA draws (NUI-MOBILE-051).
 */
export function imageRiskOf(resman: ResMan): ImageRisk {
  const memo = new Map<string, boolean>();
  return (resref) => {
    const r = resref.toLowerCase();
    let v = memo.get(r);
    if (v === undefined) {
      const win = [...CLIENT_PROBE].reverse().find((ext) => resman.has(r, ext));
      v = win === "tga" && GAME_LAYERS.has(resman.where(r, "tga")!.kind);
      memo.set(r, v);
    }
    return v;
  };
}
