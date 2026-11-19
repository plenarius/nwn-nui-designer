/**
 * The export round trip, shared by tests/export.test.ts and `pnpm roundtrip`: a window is exported as a .jui and
 * read back, and the two must be the same model, the same layout (every element's rect, every problem) and the same
 * picture (every pixel).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type EditorDoc, openText, toNuiDocument, writeDump, writeProject } from "../src/core/edit/project.js";
import { writeJui } from "../src/core/edit/jui.js";
import { ctx2d } from "../src/core/render/canvas.js";
import type { Resources } from "../src/core/session.js";
import { renderView } from "../src/core/view.js";
import { nodeCanvas } from "../src/node/fs.js";

export const ROOT = join(import.meta.dirname, "..");

/** The committed fixtures and, when present, the local dumps (never committed). */
export function inputs(): { name: string; file: string; local: boolean }[] {
  const out: { name: string; file: string; local: boolean }[] = [];
  const fx = join(ROOT, "fixtures");
  for (const f of readdirSync(fx).sort()) if (/\.(jui|json)$/.test(f)) out.push({ name: f.replace(/\.[^.]+$/, ""), file: join(fx, f), local: false });
  const dumps = join(ROOT, "local", "dumps");
  if (existsSync(dumps)) for (const f of readdirSync(dumps).sort()) if (f.endsWith(".json")) out.push({ name: f.replace(/\.json$/, ""), file: join(dumps, f), local: true });
  return out;
}

export function load(file: string, name: string): EditorDoc {
  return openText(readFileSync(file, "utf8"), name).doc;
}

export interface RoundTrip {
  model: boolean;
  binds: boolean;
  rects: boolean;
  problems: boolean;
  pixels: boolean;
  /** Elements drawn, problems found, pixels compared. */
  elements: number;
  problemCount: number;
  pixelCount: number;
  juiBytes: number;
}

async function draw(doc: EditorDoc, res: Resources) {
  const r = await renderView(toNuiDocument(doc), res.skin, res.images, nodeCanvas, { crop: true });
  const c = ctx2d(r.canvas).getImageData(0, 0, r.canvas.width, r.canvas.height);
  return { r, data: c.data, w: r.canvas.width, h: r.canvas.height };
}

/** .jui out and back in (the binds go with the project and the dump formats, also checked). */
export async function roundTrip(doc: EditorDoc, res: Resources): Promise<RoundTrip> {
  const jui = writeJui(doc.window);
  const back = openText(jui, doc.name).doc;
  // The .jui carries the window only; the sample values travel in the project or a dump.
  const viaProject = openText(writeProject(doc)).doc;
  const viaDump = openText(writeDump(doc)).doc;
  const again = { ...back, binds: doc.binds, panes: doc.panes };
  const a = await draw(doc, res);
  const b = await draw(again, res);
  const rects = a.r.outlines.length === b.r.outlines.length && a.r.outlines.every((o, i) => o.path === b.r.outlines[i]!.path && o.rect.every((v, k) => v === b.r.outlines[i]!.rect[k]));
  const problems = JSON.stringify(a.r.problems.map((p) => [p.path, p.kind, p.text, p.rect])) === JSON.stringify(b.r.problems.map((p) => [p.path, p.kind, p.text, p.rect]));
  let pixels = a.w === b.w && a.h === b.h;
  if (pixels) for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) { pixels = false; break; }
  return {
    model: JSON.stringify(back.window) === JSON.stringify(doc.window) && sameJson(back.window, doc.window),
    binds: sameJson(viaProject, doc) && sameJson(viaDump.window, doc.window) && sameJson(viaDump.binds, doc.binds) && sameJson(viaDump.panes, doc.panes),
    rects,
    problems,
    pixels,
    elements: a.r.outlines.length,
    problemCount: a.r.problems.length,
    pixelCount: a.w * a.h,
    juiBytes: Buffer.byteLength(jui),
  };
}

function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}
