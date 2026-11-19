/**
 * How long the editor takes to redraw after a small edit (not part of `pnpm test`): the built editor in headless
 * Chromium, a window dump imported, the window selected, then Alt+Down and Alt+Up pressed in turn (the window's height
 * by one grid step). Each press's main-thread busy time is CDP Performance.getMetrics' TaskDuration from the key press
 * until the new drawing is up and the page has been quiet for --quiet ms (so the debounced autosave is counted).
 *
 *   pnpm build && pnpm bench:redraw [--dump FILE]... [--presses 40] [--path P] [--calls] [--no-game]
 *   pnpm exec vite build --minify false && pnpm bench:redraw --dump local/dumps/gods.json --profile DIR
 *
 * --path P nudges the element at tree path P (as the tree's data-path, e.g. 0/1) instead of the window: its width,
 * Alt+Right and Alt+Left.
 *
 * --profile writes a V8 CPU profile of --profile-presses presses (open it in Chrome DevTools' Performance panel) and
 * prints where the time went: self time per function and per area (see AREAS). Function names need an unminified
 * build. --calls also counts the canvases made and the Canvas 2D calls (with their time) per press.
 *
 * With the game (NWN_ROOT, NWN_HAK_DIR) the window is drawn with the real skin, as in pnpm e2e (minigame.ts). Headless
 * Chromium draws canvases in software: see docs/GAPS.md, "Speed", for which numbers carry over to a browser with a GPU.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type CDPSession, type Page } from "playwright-core";
import { openText, toNuiDocument } from "../src/core/edit/project.js";
import { makeMiniGame } from "./minigame.js";
import { serveEditor } from "./serve.js";

const ROOT = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    dump: { type: "string", multiple: true },
    presses: { type: "string", default: "40" },
    quiet: { type: "string", default: "900" },
    "no-game": { type: "boolean", default: false },
    profile: { type: "string" },
    "profile-presses": { type: "string", default: "10" },
    calls: { type: "boolean", default: false },
    path: { type: "string" },
    dist: { type: "string", default: join(ROOT, "dist") },
  },
});
const dumps = (values.dump?.length ? values.dump : ["gods.json", "furnplace@acts-arrange.json"].map((d) => join(ROOT, "local", "dumps", d))).map((d) => resolve(d));
for (const d of dumps) if (!existsSync(d)) throw new Error(`no dump ${d}`);
const presses = Number(values.presses);
const quiet = Number(values.quiet);
const dist = resolve(values.dist!);
if (!existsSync(join(dist, "index.html"))) throw new Error("run pnpm build first");

// No local API: the game comes through the browser's pickers, the fallback a static build uses.
const server = await serveEditor(dist);
const port = server.port;

const tmp = mkdtempSync(join(tmpdir(), "nuid-bench-"));
let mini: string | null = null;
if (!values["no-game"]) {
  const docs = dumps.map((d) => toNuiDocument(openText(readFileSync(d, "utf8"), "dump").doc));
  mini = await makeMiniGame(docs, join(tmp, "game"));
  console.log(mini ? "game resources: the real skin" : "no game: the built-in skin");
}

/** Counts the canvases made and times the Canvas 2D calls that matter (--calls). */
function instrument() {
  const w = window as unknown as { __calls: Record<string, [number, number]> };
  w.__calls = {};
  const note = (k: string, t: number) => {
    const c = (w.__calls[k] ??= [0, 0]);
    c[0]++;
    c[1] += t;
  };
  const ce = document.createElement.bind(document);
  document.createElement = ((tag: string, o?: ElementCreationOptions) => {
    if (tag === "canvas") note("createElement(canvas)", 0);
    return ce(tag, o);
  }) as typeof document.createElement;
  const P = CanvasRenderingContext2D.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of ["getImageData", "putImageData", "drawImage", "fillRect", "createImageData"]) {
    const f = P[m]!;
    P[m] = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
      const t0 = performance.now();
      const r = f.apply(this, a);
      note(m, performance.now() - t0);
      // Each drawing pass starts by copying the screen's background (view.ts, screen) over the whole canvas.
      const src = a[0] as { width?: number; height?: number } | undefined;
      if (m === "drawImage" && a.length === 3 && a[1] === 0 && a[2] === 0 && src?.width === this.canvas.width && src?.height === this.canvas.height) note("drawing passes (renderView)", 0);
      return r;
    };
  }
}

async function metric(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

/** Presses key and waits until the canvas has been replaced and the page has then been quiet for `quiet` ms. */
async function press(page: Page, key: string) {
  await page.evaluate(() => {
    const c = document.querySelector(".nui-canvas") as (HTMLCanvasElement & { __old?: boolean }) | null;
    if (c) c.__old = true;
  });
  await page.keyboard.press(key);
  await page.waitForFunction(() => {
    const c = document.querySelector(".nui-canvas") as (HTMLCanvasElement & { __old?: boolean }) | null;
    return c && !c.__old;
  }, null, { timeout: 30000, polling: 5 });
  await page.waitForTimeout(quiet);
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : NaN;
};
const ms = (s: number) => (s * 1000).toFixed(1);

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
}
interface Profile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
}

/**
 * Areas of the editor a sample is put in: the first rule that matches the stack, read from the sampled function
 * outwards (so a glyph blend inside textLayer counts as the blend, the textLayer around it as text).
 */
const AREAS: [string, (f: ProfileNode["callFrame"]) => boolean][] = [
  ["canvas: getImageData/putImageData", (f) => /^(getImageData|putImageData)$/.test(f.functionName)],
  ["canvas: drawImage", (f) => f.functionName === "drawImage"],
  ["canvas: fillRect/fillStyle", (f) => /^(fillRect|set fillStyle)$/.test(f.functionName)],
  ["canvas: other native", (f) => /^(createImageData|getContext|createElement|replaceChildren|set width|set height)$/.test(f.functionName)],
  ["software blend (alphaCompositeInPlace)", (f) => f.functionName === "alphaCompositeInPlace"],
  ["text layers (textLayer, maxFilter3)", (f) => /^(textLayer|maxFilter3)$/.test(f.functionName)],
  ["glyph masks (lineMask, resizeMask)", (f) => /^(lineMask|resizeMask|glyph)$/.test(f.functionName)],
  ["hasPartialAlpha", (f) => f.functionName === "hasPartialAlpha"],
  ["imageToCanvas", (f) => f.functionName === "imageToCanvas"],
  ["skin slices (nineSlice, resample)", (f) => /nineSlice|resample|resize[A-Z]|slice/i.test(f.functionName) && /index|render|slice/.test(f.url)],
  ["drawBackground", (f) => f.functionName === "drawBackground"],
  ["layout (kiwi solve)", (f) => /\b(solve|layoutWindow|Solver)\b/.test(f.functionName) || /kiwi/.test(f.url)],
  ["validation (validateWindow, style)", (f) => /^(validateWindow|checkStyle|styleFindings)$/.test(f.functionName)],
  ["autosave (writeProject, IndexedDB)", (f) => /^(writeProject|writeAutosave|stringify)$/.test(f.functionName)],
  ["renderer (other)", (f) => /^(window|element|renderView)$/.test(f.functionName)],
  ["React (render, commit)", (f) => /react/.test(f.url)],
  ["garbage collection", (f) => f.functionName === "(garbage collector)"],
];

function breakdown(p: Profile) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const self = new Map<string, number>();
  const area = new Map<string, number>();
  let busy = 0;
  p.samples.forEach((id, i) => {
    const dt = (p.timeDeltas[i + 1] ?? 0) / 1000;
    const leaf = byId.get(id)!;
    if (leaf.callFrame.functionName === "(idle)" || leaf.callFrame.functionName === "(program)") return;
    busy += dt;
    const fn = `${leaf.callFrame.functionName || "(anonymous)"} ${basename(leaf.callFrame.url)}:${leaf.callFrame.lineNumber + 1}`;
    self.set(fn, (self.get(fn) ?? 0) + dt);
    let a = "other";
    for (let n: ProfileNode | undefined = leaf; n; n = byId.get(parent.get(n.id) ?? -1)) {
      const hit = AREAS.find(([, m]) => m(n!.callFrame));
      if (hit) {
        a = hit[0];
        break;
      }
    }
    area.set(a, (area.get(a) ?? 0) + dt);
  });
  return { busy, self, area };
}

const browser = await chromium.launch();
try {
  for (const dump of dumps) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => {
      for (const k of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) delete (window as unknown as Record<string, unknown>)[k];
    });
    // tsx's transform names functions with __name, which the page does not have.
    if (values.calls) await ctx.addInitScript({ content: `var __name = (f) => f; (${instrument.toString()})();` });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${port}/`);
    await page.waitForSelector(".start");
    if (mini) {
      await page.getByRole("button", { name: "Game and haks" }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: /Pick NWN folder/ }).click();
      await (await chooser).setFiles(mini);
      await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("select[aria-label=\"Window editor's skin\"]")?.value === "game", null, { timeout: 30000 });
      await page.keyboard.press("Escape");
      await page.locator("dialog.modal").waitFor({ state: "detached", timeout: 5000 });
    }
    await page.getByTestId("import-input").setInputFiles(dump);
    await page.waitForSelector(".nui-canvas", { timeout: 30000 });
    await page.waitForTimeout(1500);
    // The window (its height changes), or with --path an element (its width: Alt+Right, Alt+Left).
    await page.locator(values.path ? `.tree-row[data-path="${values.path}"]` : ".tree-row.window").click();
    await page.locator(".tree").focus();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Performance.enable");
    // Two presses to warm up (caches, JIT).
    const keys = values.path ? ["Alt+ArrowRight", "Alt+ArrowLeft"] : ["Alt+ArrowDown", "Alt+ArrowUp"];
    for (const k of keys) await press(page, k);

    const task: number[] = [];
    const script: number[] = [];
    const layout: number[] = [];
    const style: number[] = [];
    const calls: Record<string, [number, number]> = {};
    for (let i = 0; i < presses; i++) {
      if (values.calls) await page.evaluate(() => ((window as unknown as { __calls: object }).__calls = {}));
      const a = await metric(cdp);
      await press(page, keys[i % 2]!);
      const b = await metric(cdp);
      task.push(b.TaskDuration! - a.TaskDuration!);
      script.push(b.ScriptDuration! - a.ScriptDuration!);
      layout.push(b.LayoutDuration! - a.LayoutDuration!);
      style.push(b.RecalcStyleDuration! - a.RecalcStyleDuration!);
      if (values.calls) {
        const c = await page.evaluate(() => (window as unknown as { __calls: Record<string, [number, number]> }).__calls);
        for (const [k, [n, t]] of Object.entries(c)) {
          const s = (calls[k] ??= [0, 0]);
          s[0] += n;
          s[1] += t;
        }
      }
    }
    const name = basename(dump).replace(/\.[^.]+$/, "");
    console.log(`\n${name}: ${presses} presses, median per press (ms): busy ${ms(median(task))}, script ${ms(median(script))}, layout ${ms(median(layout))}, style ${ms(median(style))} (min ${ms(Math.min(...task))}, max ${ms(Math.max(...task))})`);
    if (values.calls) {
      console.log("  per press: calls, ms");
      for (const [k, [n, t]] of Object.entries(calls)) console.log(`  ${k.padEnd(24)} ${(n / presses).toFixed(1).padStart(8)} ${(t / presses).toFixed(2).padStart(8)}`);
    }

    if (values.profile) {
      const n = Number(values["profile-presses"]);
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
      await cdp.send("Profiler.start");
      for (let i = 0; i < n; i++) await press(page, keys[i % 2]!);
      const { profile } = (await cdp.send("Profiler.stop")) as { profile: Profile };
      mkdirSync(resolve(values.profile), { recursive: true });
      const file = join(resolve(values.profile), `${name}.cpuprofile`);
      writeFileSync(file, JSON.stringify(profile));
      const { busy, self, area } = breakdown(profile);
      console.log(`  profile (${file}): ${(busy / n).toFixed(1)} ms busy per press in JS-visible samples`);
      console.log("  by area (ms per press, share):");
      for (const [k, t] of [...area].sort((x, y) => y[1] - x[1])) console.log(`    ${k.padEnd(40)} ${(t / n).toFixed(1).padStart(7)} ${((100 * t) / busy).toFixed(1).padStart(5)} %`);
      console.log("  top self time (ms per press):");
      for (const [k, t] of [...self].sort((x, y) => y[1] - x[1]).slice(0, 25)) console.log(`    ${(t / n).toFixed(1).padStart(7)}  ${k}`);
    }
    if (errors.length) console.log(`  page errors: ${errors.join("; ")}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
