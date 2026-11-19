/**
 * The skin round trip, shared by tests/skin.test.ts and `pnpm skin:roundtrip`: a skin project is exported as a hak
 * (and as a zip of loose files), read back with the designer's ERF reader, and must be the same model (the .tml text,
 * its values, every own file) and draw the same pictures (a window and the widget-states sheet, every pixel).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openText, toNuiDocument } from "../src/core/edit/project.js";
import { ctx2d } from "../src/core/render/canvas.js";
import { Erf } from "../src/core/res/containers.js";
import { MemorySource } from "../src/core/res/source.js";
import { TYPE_EXT } from "../src/core/res/restype.js";
import { readStoredZip } from "../src/core/res/zip.js";
import type { Resources } from "../src/core/session.js";
import { skinResources } from "../src/core/skin/preview.js";
import { type SkinProject, data, exportHak, exportZip, fromGameSkin, fromOpenSkin, fromResources, planExport } from "../src/core/skin/project.js";
import { preloadSkinImages, widgetSheet } from "../src/core/skin/sheet.js";
import { BRONZE, CLEAN } from "../src/core/skin/gen/style.js";
import type { ThemeId } from "../src/core/skin/themes.js";
import { renderView } from "../src/core/view.js";
import { nodeCanvas } from "../src/node/fs.js";
import { findGame, openResources } from "../src/node/setup.js";

export const ROOT = join(import.meta.dirname, "..");

export function openSkinFiles(theme: ThemeId = "bronze"): Record<string, Uint8Array> {
  const dir = join(ROOT, "assets", "skin", theme);
  return Object.fromEntries(readdirSync(dir).map((f) => [f, new Uint8Array(readFileSync(join(dir, f)))]));
}

export const bronzeProject = () => fromOpenSkin(openSkinFiles("bronze"), BRONZE);
export const inkProject = () => fromOpenSkin(openSkinFiles("ink"), CLEAN, "Ink and brass", "nuid_ink_skin");

/** The skins to round-trip: Bronze always; the game's skin and Layonara's when they are on this machine. */
export async function roundTripSkins(): Promise<{ name: string; project: SkinProject; base: Resources }[]> {
  const out: { name: string; project: SkinProject; base: Resources }[] = [];
  out.push({ name: "ink", project: inkProject(), base: await openResources({ fallback: true }) });
  out.push({ name: "bronze", project: bronzeProject(), base: await openResources({ fallback: true, theme: "bronze" }) });
  const game = findGame();
  if (game) {
    const base = await openResources({ game });
    const tml = await base.resman.get("nui_skin", "tml");
    if (tml) out.push({ name: "game", project: fromGameSkin(tml, "the game"), base });
    const layo = layonaraSkin();
    if (layo) {
      const p = await fromResources("nwn-haks origin/64bit", "files", Object.entries(layo).map(([f, d]) => [f.replace(/\.[^.]+$/, ""), f.replace(/^.*\./, ""), async () => d] as [string, string, () => Promise<Uint8Array>]), "layo_skin");
      out.push({ name: "layonara", project: p, base });
    }
  }
  return out;
}

/**
 * Layonara's nui_skin.tml and its font from nwn-haks origin/64bit (local only, never committed): a real server's skin,
 * kept as an example of a custom skin to round-trip. Another server would read its own skin the same way.
 */
export function layonaraSkin(): Record<string, Uint8Array> | null {
  const haks = join(ROOT, "..", "nwn-haks");
  if (!existsSync(join(haks, ".git"))) return null;
  try {
    const show = (p: string) => new Uint8Array(execFileSync("git", ["-C", haks, "show", `origin/64bit:${p}`], { maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
    const tml = show("config/ini/nui_skin.tml");
    const out: Record<string, Uint8Array> = { "nui_skin.tml": tml };
    const fonts = [...new TextDecoder().decode(tml).matchAll(/resref\s*=\s*"([^"]+)"/g)].map((m) => m[1]!.toLowerCase());
    for (const f of new Set(fonts)) {
      try {
        out[`${f}.ttf`] = show(`config/ini/${f}.ttf`);
      } catch {
        /* a game font */
      }
    }
    return out;
  } catch {
    return null;
  }
}

export async function drawWindow(file: string, res: Resources): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const doc = openText(readFileSync(file, "utf8"), "w").doc;
  const r = await renderView(toNuiDocument(doc), res.skin, res.images, nodeCanvas, { crop: true });
  const c = ctx2d(r.canvas).getImageData(0, 0, r.canvas.width, r.canvas.height);
  return { w: r.canvas.width, h: r.canvas.height, data: c.data };
}

export async function drawSheet(res: Resources) {
  await preloadSkinImages(res.skin, res.images);
  return widgetSheet(res.skin, res.images, { makeCanvas: nodeCanvas });
}

/** A hak's resources as a skin project (as the editor's "Start from a hak" reads it). */
export async function projectFromHak(hak: Uint8Array, name: string): Promise<SkinProject> {
  const erf = await Erf.open(new MemorySource(name, hak));
  const entries = [...erf.entries()].map(([r, t]) => [r, TYPE_EXT[t] ?? "", () => erf.get(r, t)] as [string, string, () => Promise<Uint8Array | null>]);
  return fromResources(name, "hak", entries, name.replace(/\.[^.]+$/, ""));
}

export interface SkinRoundTrip {
  tml: boolean;
  values: boolean;
  files: boolean;
  zip: boolean;
  window: boolean;
  sheet: boolean;
  leftOut: string[];
  hakBytes: number;
  pixels: number;
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v: number, i: number) => v === b[i]);

export async function skinRoundTrip(p: SkinProject, base: Resources, window: string): Promise<SkinRoundTrip> {
  const plan = planExport(p, base.resman);
  const hak = exportHak(plan, p.name);
  const back = await projectFromHak(hak, `${p.name}.hak`);
  // Only the files the skin uses travel; compare those.
  const exported = new Set(plan.items.map((i) => i.file));
  const ownUsed = Object.keys(p.files).filter((f) => exported.has(f)).sort();
  const files = ownUsed.length === Object.keys(back.files).length && ownUsed.every((f) => back.files[f] && same(back.files[f]!.data, p.files[f]!.data));
  const zipped = readStoredZip(exportZip(plan));
  const zip = plan.items.every((i) => zipped.some((z) => z.name === `${i.resref}.${i.ext}` && same(z.data, i.data)));
  const ra = await skinResources(base, p, { makeCanvas: nodeCanvas });
  const rb = await skinResources(base, back, { makeCanvas: nodeCanvas });
  const wa = await drawWindow(window, ra);
  const wb = await drawWindow(window, rb);
  const sa = await drawSheet(ra);
  const sb = await drawSheet(rb);
  return {
    tml: back.tml === p.tml,
    values: JSON.stringify(data(back)) === JSON.stringify(data(p)),
    files,
    zip,
    window: wa.w === wb.w && wa.h === wb.h && same(wa.data, wb.data),
    sheet: same(sa.data, sb.data),
    leftOut: plan.leftOut.map((l) => l.name),
    hakBytes: hak.length,
    pixels: wa.data.length / 4 + sa.data.length / 4,
  };
}
