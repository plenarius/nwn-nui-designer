/**
 * pnpm old-gui previews and the frame check: every screen of the original GUI drawn from the user's own game, stock
 * beside the theme, and the theme's frames compared with the stock's. The pictures show the user's game art: local
 * files only, never committed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Canvas as NapiCanvas, GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { type Collection, collectOldGui } from "../core/oldgui/collect.js";
import { type FrameFindings, checkFrames } from "../core/oldgui/preview/frames.js";
import type { Canvas, Tex, TexSource } from "../core/oldgui/preview/render.js";
import type { PlacedText, Scene } from "../core/oldgui/preview/scene.js";
import { type Screen, Screens } from "../core/oldgui/preview/screens.js";
import { decodeGuiTexture } from "../core/oldgui/texture.js";
import { readTxi } from "../core/oldgui/txi.js";
import type { ResMan } from "../core/res/resman.js";
import { Tlk } from "../core/res/tlk.js";

export interface PreviewWorld {
  collection: Collection;
  screens: Screens;
  stock: TexSource;
  /** The theme's textures (a folder of files under the stock names), the stock where it has none. */
  theme: (dir: string) => TexSource;
  /** The font family registered for the labels (the game's fnt_default), or a generic one. */
  font: string;
}

const txiFlags = (bytes: Uint8Array | null | undefined): { nearest: boolean; clamp: number } => {
  if (!bytes) return { nearest: false, clamp: 0 };
  const t = readTxi(new TextDecoder("latin1").decode(bytes));
  return { nearest: !t.filter, clamp: t.clamp };
};

/** Everything the previews read: the models and layouts, the strings, the stock textures and the game's font. */
export async function previewWorld(resman: ResMan, game: string, collection?: Collection): Promise<PreviewWorld> {
  const c = collection ?? (await collectOldGui(resman));
  const tlkPath = join(game, "lang", "en", "data", "dialog.tlk");
  let tlk: Tlk | null = null;
  try {
    if (existsSync(tlkPath)) tlk = new Tlk(new Uint8Array(readFileSync(tlkPath)));
  } catch {
    tlk = null;
  }
  // the textures are read once each, then kept
  const raw = new Map<string, { bytes: Uint8Array; ext: string } | null>();
  const txis = new Map<string, Uint8Array | null>();
  for (const name of c.textures.keys()) {
    const f = await resman.getAny(name, ["dds", "tga"]);
    raw.set(name, f ? { bytes: f[0], ext: f[1] } : null);
    txis.set(name, (await resman.get(name, "txi")) ?? null);
  }
  const fetchStock = async (name: string) => {
    if (!raw.has(name)) {
      const f = await resman.getAny(name, ["dds", "tga"]);
      raw.set(name, f ? { bytes: f[0], ext: f[1] } : null);
      txis.set(name, (await resman.get(name, "txi")) ?? null);
    }
  };
  // icons the screens swap in (spell icons, level medallions, Player List icons)
  for (const n of ["ir_cantrips", "ir_level1", "ir_level2", "ir_level3", "ir_level4", "ir_level5", "ir_level6", "ir_level789", "is_firebal", "is_acidarrow", "is_burnhands", "is_magvest", "is_mirrimage", "is_bless", "is_barkskin", "is_clarirty", "is_aid", "is_bullstr", "ir_partychat", "ir_leave", "ir_invite", "ir_transleader", "ir_boot", "ir_ban"]) await fetchStock(n);
  const cache = new Map<string, Tex | null>();
  const stock: TexSource = (name) => {
    if (cache.has(name)) return cache.get(name)!;
    const r = raw.get(name);
    let t: Tex | null = null;
    if (r) {
      try {
        t = { img: decodeGuiTexture(r.bytes, r.ext), ...txiFlags(txis.get(name)) };
      } catch {
        t = null;
      }
    }
    cache.set(name, t);
    return t;
  };
  const theme = (dir: string): TexSource => {
    const tc = new Map<string, Tex | null>();
    return (name) => {
      if (tc.has(name)) return tc.get(name)!;
      let t: Tex | null = null;
      for (const ext of ["dds", "tga"]) {
        const p = join(dir, `${name}.${ext}`);
        if (!existsSync(p)) continue;
        const txiPath = join(dir, `${name}.txi`);
        const txi = existsSync(txiPath) ? new Uint8Array(readFileSync(txiPath)) : txis.get(name);
        t = { img: decodeGuiTexture(new Uint8Array(readFileSync(p)), ext), ...txiFlags(txi) };
        break;
      }
      t ??= stock(name);
      tc.set(name, t);
      return t;
    };
  };
  let font = "sans-serif";
  const ttf = await resman.getAny("fnt_default", ["ttf"]);
  if (ttf && GlobalFonts.register(Buffer.from(ttf[0]), "nwn-old-gui")) font = "nwn-old-gui";
  const screens = new Screens({
    models: (n) => c.parsed.get(n.toLowerCase()) ?? null,
    layout: (n) => c.layouts.get(n.toLowerCase())?.layout ?? null,
    layouts: () => [...c.layouts.keys()],
    text: (s) => tlk?.get(s) ?? "",
  });
  return { collection: c, screens, stock, theme, font };
}

function toPng(cv: Canvas, texts: PlacedText[], font: string): NapiCanvas {
  const c = createCanvas(cv.w, cv.h);
  const ctx = c.getContext("2d");
  const id = ctx.createImageData(cv.w, cv.h);
  for (let i = 0; i < cv.w * cv.h; i++) {
    for (let k = 0; k < 3; k++) id.data[i * 4 + k] = Math.round(Math.min(255, Math.max(0, cv.d[i * 4 + k]!)));
    id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  for (const t of texts) {
    ctx.font = `${t.size}px "${font}"`;
    let s = t.s;
    if (ctx.measureText(s).width > t.w && t.w > 10) {
      while (s.length > 3 && ctx.measureText(`${s}…`).width > t.w) s = s.slice(0, -1);
      s += "…";
    }
    const m = ctx.measureText(s);
    const th = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    ctx.fillStyle = `rgb(${t.col.map((v) => Math.round(v)).join(",")})`;
    ctx.fillText(s, t.x + (t.w - m.width) * t.ah, t.y + (t.h - th) * t.av + m.actualBoundingBoxAscent);
  }
  return c;
}

/** A screen drawn with the stock textures and with the theme's (the same bounds). */
export interface DrawnPair {
  stock: { cv: Canvas; texts: PlacedText[] };
  theme: { cv: Canvas; texts: PlacedText[] };
}

export function drawPair(w: PreviewWorld, sc: Scene, themeTex: TexSource): DrawnPair {
  const b = sc.bounds();
  return { stock: sc.draw(w.stock, b), theme: sc.draw(themeTex, b) };
}

/** The screen stock | theme side by side, with titles, as PNG bytes. */
export function previewPair(w: PreviewWorld, sc: Scene | DrawnPair, themeTex: TexSource, title: string, labels: [string, string] = ["stock", "theme"]): Uint8Array {
  const d = "stock" in sc ? sc : drawPair(w, sc, themeTex);
  const pa = toPng(d.stock.cv, d.stock.texts, w.font);
  const pt = toPng(d.theme.cv, d.theme.texts, w.font);
  const pad = 10;
  const lab = 44;
  const out = createCanvas(Math.max(pa.width * 2 + pad * 3, 420), pa.height + lab + pad * 2);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#101012";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = "#e6dcc8";
  ctx.font = `15px "${w.font}"`;
  ctx.fillText(title, pad, 18);
  ctx.font = `13px "${w.font}"`;
  [pa, pt].forEach((p, i) => {
    const x = pad + i * (pa.width + pad);
    ctx.drawImage(p, x, lab + pad);
    ctx.fillText(labels[i]!, x, 40);
  });
  return new Uint8Array(out.toBuffer("image/png"));
}

/** The frame check on one screen: the stock and theme renders compared (text is never in the canvases). */
export function screenFrames(w: PreviewWorld, sc: Scene | DrawnPair, themeTex: TexSource, glow: readonly number[], overlay = false): FrameFindings & { size: [number, number] } {
  const d = "stock" in sc ? sc : drawPair(w, sc, themeTex);
  return { ...checkFrames(d.stock.cv, d.theme.cv, glow, overlay), size: [d.stock.cv.w, d.stock.cv.h] };
}

export function overlayPng(f: FrameFindings & { size: [number, number] }): Uint8Array | null {
  if (!f.overlay) return null;
  const c = createCanvas(f.size[0], f.size[1]);
  const ctx = c.getContext("2d");
  const id = ctx.createImageData(f.size[0], f.size[1]);
  id.data.set(f.overlay);
  ctx.putImageData(id, 0, 0);
  return new Uint8Array(c.toBuffer("image/png"));
}

export type { Screen };

/** One line per screen of the frame check. */
export interface FrameLine {
  key: string;
  missing: number;
  stray: number;
  ends: number;
  spurs: number;
  /** Where (the first few boxes and points). */
  where: string;
}

/** The frame check on every screen (or those named), each screen's overlay passed to `out` when given. */
export function frameCheck(
  w: PreviewWorld,
  themeTex: TexSource,
  glow: readonly number[],
  only: string[] | null,
  out?: (key: string, png: Uint8Array) => void,
  progress?: (done: number, total: number, key: string) => void,
  drawn?: (key: string, d: DrawnPair) => void,
): FrameLine[] {
  const list = w.screens.all().filter((s) => !only || only.includes(s.key));
  const lines: FrameLine[] = [];
  list.forEach((s, i) => {
    progress?.(i, list.length, s.key);
    const d = drawPair(w, s.make(), themeTex);
    drawn?.(s.key, d);
    const f = screenFrames(w, d, themeTex, glow, !!out);
    if (out) out(s.key, overlayPng(f)!);
    const box = (r: number[]) => `${r[0]},${r[1]}-${r[2]},${r[3]}`;
    const pt = (p: [number, number]) => `${p[0]},${p[1]}`;
    const where = [
      f.missing.length ? `missing ${f.missing.slice(0, 3).map(box).join(" ")}` : "",
      f.stray.length ? `stray ${f.stray.slice(0, 3).map(box).join(" ")}` : "",
      f.ends.length ? `ends ${f.ends.slice(0, 3).map(pt).join(" ")}` : "",
      f.spurs.length ? `spurs ${f.spurs.slice(0, 3).map(pt).join(" ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    lines.push({ key: s.key, missing: f.missing.length, stray: f.stray.length, ends: f.ends.length, spurs: f.spurs.length, where });
  });
  return lines;
}
