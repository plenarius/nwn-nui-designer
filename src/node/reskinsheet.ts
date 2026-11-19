/**
 * The reskin's contact sheets: per texture, the stock picture and the new one side by side over a checkerboard (so
 * alpha shows), small textures enlarged with hard pixels, a red name where a check failed. Local files for the user
 * to look at: they show the user's own game art, so they never belong in a repository.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { RGBAImage } from "../core/res/image.js";
import type { Preview } from "../core/reskin/reskin.js";
import type { Group } from "../core/reskin/textures.js";
import type { ReskinPalette } from "../core/reskin/palette.js";
import { hex } from "../core/reskin/palette.js";

const CELL_W = 300;
const CELL_H = 190;
const LABEL = 18;
const PAD = 10;

function fit(w: number, h: number): [number, number] {
  let s = Math.min(CELL_W / w, (CELL_H - LABEL) / h);
  if (s >= 1) s = Math.floor(s); // whole-pixel enlargement for small art
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

function checker(ctx: SKRSContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "#6a6a6a";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#8a8a8a";
  for (let yy = 0; yy < h; yy += 8) for (let xx = (yy / 8) % 2 ? 8 : 0; xx < w; xx += 16) ctx.fillRect(x + xx, y + yy, Math.min(8, w - xx), Math.min(8, h - yy));
}

function draw(ctx: SKRSContext2D, im: RGBAImage, x: number, y: number): void {
  const c = createCanvas(im.width, im.height);
  const cx = c.getContext("2d");
  const id = cx.createImageData(im.width, im.height);
  id.data.set(im.data);
  cx.putImageData(id, 0, 0);
  const [w, h] = fit(im.width, im.height);
  checker(ctx, x, y, w, h);
  ctx.imageSmoothingEnabled = w < im.width;
  ctx.drawImage(c, x, y, w, h);
}

/** One sheet of previews (two columns of before | after pairs), as PNG bytes. */
export function contactSheet(title: string, previews: Preview[], palette: ReskinPalette): Uint8Array {
  const cols = 2;
  const rows = Math.ceil(previews.length / cols);
  const pairW = 2 * CELL_W + 3 * PAD;
  const head = 64;
  const W = cols * pairW + PAD;
  const H = head + rows * (CELL_H + PAD) + PAD;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#1b1b1b";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#eeeeee";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(title, PAD, 24);
  ctx.font = "12px sans-serif";
  ctx.fillText("stock (left) and reskinned (right), each over a checkerboard; red: a check failed (see report.md)", PAD, 42);
  const sw: [string, number[]][] = [
    ["ink", palette.ink],
    ["raised", palette.raised],
    ["button", palette.button],
    ["pressed", palette.activeLo],
    ["pressed hi", palette.active],
    ["accent", palette.accent],
    ["glow", palette.glow],
    ["mark", palette.mark],
  ];
  sw.forEach(([n, col], i) => {
    const x = W - (sw.length - i) * 74;
    ctx.fillStyle = hex(col);
    ctx.fillRect(x, 8, 18, 18);
    ctx.fillStyle = "#cccccc";
    ctx.fillText(n, x + 22, 21);
  });
  previews.forEach((p, i) => {
    const x = PAD + (i % cols) * pairW;
    const y = head + Math.floor(i / cols) * (CELL_H + PAD);
    ctx.fillStyle = p.ok ? "#dddddd" : "#ff5050";
    ctx.font = "13px monospace";
    ctx.fillText(`${p.name}  ${p.before.width}x${p.before.height}`, x, y + 13);
    draw(ctx, p.before, x, y + LABEL);
    draw(ctx, p.after, x + CELL_W + PAD, y + LABEL);
  });
  return new Uint8Array(c.toBuffer("image/png"));
}

/** The contact sheets' titles, one sheet per group. */
export const GROUP_TITLES: Record<Group, string> = {
  swatch: "colour swatch strips",
  frame: "in-game frames, buttons and controls",
  pregame: "character select, pre-game and creation wizard",
  control: "scrollbar, arrow buttons and slider (redrawn)",
};

/** One contact sheet per group, contact-<group>.png in dir; returns the files written. */
export function writeContactSheets(dir: string, title: string, previews: Preview[], palette: ReskinPalette): string[] {
  const groups = new Map<Group, Preview[]>();
  for (const p of previews) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  const out: string[] = [];
  for (const [g, list] of groups) {
    const file = join(dir, `contact-${g}.png`);
    writeFileSync(file, contactSheet(`${title}: ${GROUP_TITLES[g]}`, list, palette));
    out.push(file);
  }
  return out;
}
