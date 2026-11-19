/**
 * The README's screenshots, regenerated: the built editor in headless Chromium (Playwright, as `pnpm smoke`), drawn
 * with the built-in skins only. The editor is served with no game (a settings file of its own, no install search),
 * so no Beamdog art can reach a picture; each shot checks that the skin select is a built-in skin before it is taken.
 *
 *   pnpm build && pnpm screenshots [--dumps DIR] [--out DIR] [--help-window] [--only NAME,...]
 *
 * The windows: fixtures/problems.jui, and from --dumps (default local/dumps/, made by nwn-module's
 * `tests/run.sh --nui`) Layonara's furniture window, `furnplace@acts-arrange.json`, used with permission: text and
 * buttons, no images. Dumps are never committed; without it fixtures/layout.jui stands in. --help-window adds
 * skins-help.png, the five skins on Layonara's help window (`help-crafting.json`), for review: it is not in the README. A window that shows an
 * image is refused, as its art could be the game's. The `pnpm check` shot runs the real command and draws its output
 * as a terminal. The PNGs go to docs/screenshots/, through `oxipng` when it is on the PATH. --only writes just the named
 * pictures (`--only arrange`), leaving the others as they are (they may have been made from a dump this machine lacks).
 *
 * arrange.png: fixtures/layout.jui with three buttons of three rows selected (the key, Padded row, outlined in amber) and
 * their left edges aligned (Alt+A), the arrange tools in the properties panel.
 *
 * Every shot is at device pixel ratio 1 and the canvas at 100 %, so each game pixel is one PNG pixel (a zoom like
 * 156 % has the browser resample the canvas and blurs its text). The UI text is in Inter when it is installed.
 *
 * Needs Playwright's Chromium (npx playwright-core install chromium).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Locator, type Page } from "playwright-core";
import { THEMES, type ThemeId } from "../src/core/skin/themes.js";
import { serveEditor } from "../tests/serve.js";

const ROOT = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    dumps: { type: "string", default: join(ROOT, "local", "dumps") },
    out: { type: "string", default: join(ROOT, "docs", "screenshots") },
    "help-window": { type: "boolean" },
    only: { type: "string" },
  },
});
const out = resolve(values.out!);
const only = values.only ? values.only.split(",").map((n) => n.trim()) : null;
/** Whether the picture called name is to be written (--only). */
const want = (name: string) => !only || only.includes(name);
const dumps = resolve(values.dumps!);
const dist = join(ROOT, "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("run pnpm build first");
mkdirSync(out, { recursive: true });

const fixture = (n: string) => join(ROOT, "fixtures", n);
const dump = (n: string, fallback: string) => {
  const p = join(dumps, `${n}.json`);
  if (existsSync(p)) return p;
  console.warn(`no ${relative(ROOT, p)}: ${basename(fallback)} stands in`);
  return fallback;
};
const MAIN = dump("furnplace@acts-arrange", fixture("layout.jui"));
const PROBLEMS = fixture("problems.jui");
const HELP = values["help-window"] ? join(dumps, "help-crafting.json") : null;
if (HELP && !existsSync(HELP)) throw new Error(`--help-window: no ${relative(ROOT, HELP)}`);
/** The images a window shows: every element or draw-list item of an image type, by its value (a resref or a bind). */
function images(v: unknown, acc: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) images(x, acc);
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.type === "string" && /image/.test(o.type)) acc.push(JSON.stringify(o.value ?? o.image ?? null));
    for (const x of Object.values(o)) images(x, acc);
  }
  return acc;
}
for (const f of [MAIN, PROBLEMS, ...(HELP ? [HELP] : [])]) {
  // problems.jui's one image names a texture nobody has: it draws as the missing-image outline.
  const shown = images(JSON.parse(readFileSync(f, "utf8"))).filter((i) => !i.includes("no_such_image"));
  if (shown.length) throw new Error(`${relative(ROOT, f)} shows images (${shown.slice(0, 3).join(", ")}): pick a window of text and controls`);
}

// No game, no install search: only the built-in skins can draw. The windows folder is the repository's fixtures (for
// the window switcher's picture), copied to a temporary folder.
const tmp = mkdtempSync(join(tmpdir(), "nuid-shots-"));
const iniPath = join(tmp, "nui-designer.ini");
const winDir = join(tmp, "windows");
mkdirSync(winDir);
for (const f of readdirSync(join(ROOT, "fixtures"))) if (/\.(jui|json)$/.test(f)) copyFileSync(fixture(f), join(winDir, f));
writeFileSync(iniPath, `; the screenshots' settings: no game\nwindows = ${winDir}\n`);

// The dump holds the binds of an empty arranging session (no piece picked, so every control is disabled). The
// pictures show the window at work instead: a piece picked, values as the module formats them (furn_i_place.nss).
// Only a temporary copy changes; the dump stays as it was.
const SAMPLES: Record<string, Record<string, unknown>> = {
  "furnplace@acts-arrange": {
    fp_title: "Arranging: Oak table",
    fp_has: true,
    fp_angle: "90 deg",
    fp_scale: "1.00",
    fp_height: "0.00 m",
    fp_styles: true,
    fp_style: "Dark oak",
    fp_status: "12 of 300 pieces placed",
  },
};
function withSamples(file: string): string {
  const samples = SAMPLES[basename(file).replace(/\.json$/, "")];
  if (!samples) return file;
  const doc = JSON.parse(readFileSync(file, "utf8")) as { binds?: Record<string, unknown> };
  doc.binds = { ...doc.binds, ...samples };
  const copy = join(tmp, basename(file));
  writeFileSync(copy, JSON.stringify(doc));
  return copy;
}
const WINDOW = withSamples(MAIN);
const server = await serveEditor(dist, { iniPath });

// The editor's UI font is system-ui, so the pictures would show whatever sans the machine defaults to. With Inter
// installed (rsms/inter), the pages use it instead: the same pictures on any machine that has it.
const inter = !!spawnSync("fc-list", ["Inter Variable"], { encoding: "utf8" }).stdout?.trim();
if (!inter) console.warn("Inter is not installed: the editor's UI text is in the system's default sans");
const uiFont = inter ? ':root { font-family: "Inter Variable", system-ui, sans-serif !important; }' : "";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true, colorScheme: "dark" });
await ctx.addInitScript(() => {
  for (const k of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) delete (window as unknown as Record<string, unknown>)[k];
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const settle = (ms = 500) => page.waitForTimeout(ms);
const written: string[] = [];

async function until(fn: () => Promise<boolean>, ms = 15000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await page.waitForTimeout(150);
  }
  return false;
}
/** A hash of the window canvas's pixels, to wait for a redraw. */
const canvasHash = () =>
  page.evaluate(() => {
    const c = document.querySelector("canvas.nui-canvas") as HTMLCanvasElement | null;
    if (!c) return "";
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 7) h = (Math.imul(h, 31) + d[i]!) | 0;
    return `${c.width}x${c.height}:${h}`;
  });
const skinSelect = () => page.getByLabel("Window editor's skin");
/** Never a picture with the game's skin: the select must name a built-in one (in skin mode, the skin being edited). */
async function assertBuiltIn() {
  const v = await skinSelect().inputValue();
  if (![...THEMES.map((t) => t.id as string), "project"].includes(v)) throw new Error(`the skin select is "${v}", not a built-in skin`);
  const game = await skinSelect().locator("option[value=game]").evaluate((o) => (o as HTMLOptionElement).disabled);
  if (!game) throw new Error("a game is loaded: the screenshots must not have one");
}
async function shot(name: string, target: Page | Locator = page, clip?: { x: number; y: number; width: number; height: number }) {
  if (!want(name)) return;
  await assertBuiltIn();
  // The "Opened ..." notes would cover the properties panel.
  await page.addStyleTag({ content: ".toasts { display: none !important; }" });
  const path = join(out, `${name}.png`);
  if (target === page) await page.screenshot({ path, clip });
  else await (target as Locator).screenshot({ path });
  written.push(path);
}
async function open(file: string) {
  await page.getByTestId("import-input").setInputFiles(file);
  await page.waitForSelector("canvas.nui-canvas", { timeout: 20000 });
  await until(async () => (await canvasHash()) !== "");
  await actualSize();
  await settle(800);
}
/**
 * 100 %: one screen pixel per canvas pixel, as the game draws the window. (A fitted zoom like 156 % has the browser
 * resample the canvas, which blurs its text.) Checks that the canvas is shown at its own size.
 */
async function actualSize() {
  await page.getByTitle("Actual size (0)").click();
  await until(async () => (await page.getByTitle("Actual size (0)").innerText()) === "100%");
  const c = await page.locator("canvas.nui-canvas").evaluate((el: HTMLCanvasElement) => {
    const b = el.getBoundingClientRect();
    return { w: el.width, h: el.height, bw: b.width, bh: b.height, dpr: window.devicePixelRatio };
  });
  if (c.dpr !== 1 || c.bw !== c.w || c.bh !== c.h) throw new Error(`the canvas is not shown 1:1: ${JSON.stringify(c)}`);
}
async function setSkin(v: ThemeId) {
  if ((await skinSelect().inputValue()) === v) return;
  const before = await canvasHash();
  await skinSelect().selectOption(v);
  await until(async () => (await canvasHash()) !== before);
  await settle(800);
}
const mode = (m: "Window" | "Skin") => page.getByRole("group", { name: "Editor" }).getByRole("button", { name: m }).click();
/** The window as drawn, at 1:1: the canvas's own pixels, without the zoom, the selection or the problem markers. */
async function windowPng(): Promise<Buffer> {
  await assertBuiltIn();
  const url = await page.locator("canvas.nui-canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png"));
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
}

/** Scrolls the export preview so the line that starts with `start` is at its top. */
async function scrollCodeTo(start: RegExp) {
  const ok = await page.getByTestId("export-code").evaluate((pre, src) => {
    const re = new RegExp(src, "m");
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    let text = "";
    const nodes: [Text, number][] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push([n as Text, text.length]);
      text += n.textContent;
    }
    const m = re.exec(text);
    if (!m) return false;
    const [node, at] = nodes.filter(([, o]) => o <= m.index).at(-1)!;
    const range = document.createRange();
    range.setStart(node, m.index - at);
    const box = range.getBoundingClientRect();
    let sc: Element | null = pre;
    while (sc && sc.scrollHeight <= sc.clientHeight) sc = sc.parentElement;
    if (!sc) return false;
    // One line above it (its doc comment) shows in full, with a little room.
    sc.scrollTop += box.top - sc.getBoundingClientRect().top - box.height - 14;
    return true;
  }, start.source);
  if (!ok) throw new Error(`no line ${start} in the export preview`);
  await settle(200);
}

/** Two pictures side by side with a caption under each, drawn by the browser into one PNG. */
async function sideBySide(name: string, a: Buffer, aLabel: string, b: Buffer, bLabel: string) {
  if (!want(name)) return;
  const p = await ctx.newPage();
  const img = (buf: Buffer, label: string) =>
    `<figure><img src="data:image/png;base64,${buf.toString("base64")}"><figcaption>${label}</figcaption></figure>`;
  await p.setContent(`<!doctype html><style>
    body { margin: 0; background: #16161a; font: 15px system-ui, sans-serif; color: #cfc8b8; }
    ${uiFont}
    main { display: inline-flex; gap: 20px; padding: 20px; align-items: flex-start; }
    figure { margin: 0; } img { display: block; } figcaption { margin-top: 8px; text-align: center; }
  </style><main>${img(a, aLabel)}${img(b, bLabel)}</main>`);
  await p.locator("main").screenshot({ path: join(out, `${name}.png`) });
  written.push(join(out, `${name}.png`));
  await p.close();
}

/** Pictures in a grid of `cols` columns, the last row centred, a caption under each. */
async function grid(name: string, items: [Buffer, string][], cols: number) {
  if (!want(name)) return;
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 2400, height: 1600 });
  const fig = ([buf, label]: [Buffer, string]) => `<figure><img src="data:image/png;base64,${buf.toString("base64")}"><figcaption>${label}</figcaption></figure>`;
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(`<div class="row">${items.slice(i, i + cols).map(fig).join("")}</div>`);
  await p.setContent(`<!doctype html><style>
    body { margin: 0; background: #16161a; font: 15px system-ui, sans-serif; color: #cfc8b8; }
    ${uiFont}
    main { display: inline-flex; flex-direction: column; gap: 20px; padding: 20px; }
    .row { display: flex; gap: 20px; justify-content: center; align-items: flex-start; }
    figure { margin: 0; } img { display: block; } figcaption { margin-top: 8px; text-align: center; }
  </style><main>${rows.join("")}</main>`);
  await p.locator("main").screenshot({ path: join(out, `${name}.png`) });
  written.push(join(out, `${name}.png`));
  await p.close();
}
/** The open window drawn with each built-in skin, in THEMES' order; the editor is left on Ink and brass. */
async function everySkin(): Promise<[Buffer, string][]> {
  const shots: [Buffer, string][] = [];
  for (const t of THEMES) {
    await setSkin(t.id);
    shots.push([await windowPng(), t.title]);
  }
  await setSkin("ink");
  return shots;
}

// The check runs without a game too: none of the variables that would name one.
const checkEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NWN_")));

/** `pnpm check` run for real, drawn as a terminal. */
async function terminal(name: string, runs: { args: string[] }[]) {
  if (!want(name)) return;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const blocks = runs.map(({ args }) => {
    const r = spawnSync("pnpm", ["-s", "check", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...checkEnv, NUI_DESIGNER_INI: iniPath, NO_COLOR: "1" },
    });
    const text = (r.stdout + r.stderr).replace(/^\$ tsx .*\n/m, "").replace(/^.*ELIFECYCLE.*$/m, "").replaceAll(iniPath, "nui-designer.ini").trimEnd();
    const body = esc(text)
      .replace(/^(game|haks|style):/gm, '<span class="k">$1:</span>')
      .replace(/\b(\d+ errors?)\b/g, '<span class="e">$1</span>')
      .replace(/\b(\d+ warnings?)\b/g, '<span class="w">$1</span>')
      .replace(/^(\s+)(error)\b/gm, '$1<span class="e">$2</span>')
      .replace(/^(\s+)(warning)\b/gm, '$1<span class="w">$2</span>')
      .replace(/(Passed[^\n]*)/g, '<span class="ok">$1</span>')
      .replace(/(Failed[^\n]*)/g, '<span class="e">$1</span>');
    return `<div class="cmd"><span class="pr">$</span> pnpm check ${esc(args.join(" "))}</div><pre>${body}</pre><div class="exit">exit ${r.status}</div>`;
  });
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1180, height: 900 });
  await p.setContent(`<!doctype html><style>
    body { margin: 0; background: #16161a; }
    .term { width: 1100px; margin: 20px; background: #0d0d10; border: 1px solid #2c2c33; border-radius: 8px; overflow: hidden;
      font: 13px/1.5 "JetBrains Mono", "DejaVu Sans Mono", monospace; color: #d6d3cc; }
    .bar { background: #1e1e24; padding: 7px 12px; display: flex; gap: 7px; }
    .bar i { width: 11px; height: 11px; border-radius: 50%; background: #3a3a42; }
    .in { padding: 12px 16px; }
    pre { margin: 0 0 4px; white-space: pre-wrap; word-break: break-word; font: inherit; }
    .cmd { color: #f2efe8; } .pr { color: #e2b45c; } .k { color: #8fb7d9; } .e { color: #f07a6a; } .w { color: #e6c15c; }
    .ok { color: #8fd18f; } .exit { color: #77746c; margin-bottom: 14px; }
  </style><div class="term"><div class="bar"><i></i><i></i><i></i></div><div class="in">${blocks.join("")}</div></div>`);
  await p.locator(".term").screenshot({ path: join(out, `${name}.png`) });
  written.push(join(out, `${name}.png`));
  await p.close();
}

/** Thrown when every picture --only names is written: the rest is skipped. */
class Done extends Error {}

try {
  await page.goto(`http://localhost:${server.port}/`);
  if (uiFont) await page.addStyleTag({ content: uiFont });
  await page.waitForSelector(".start");

  // The editor: the furniture window, a button selected, Ink and brass (the default without a game).
  await open(WINDOW);
  if ((await skinSelect().inputValue()) !== "ink") throw new Error("without a game the editor should start with Ink and brass");
  // The Style row's ">" button: its size chip lands right of the status line, over nothing. (Not a bottom-row button:
  // those are a pane, drawn but not in the tree.)
  const next = page.locator(".tree-row", { hasText: "#var_next" });
  await ((await next.count()) ? next.first() : page.locator(".tree-row:not(.window)").nth(2)).click();
  if ((await next.count()) && (await page.locator(".ov-sel").count()) !== 1) throw new Error("the selected button is not drawn");
  await settle();
  await shot("editor");

  // Multi-select and align: three buttons of three rows of the layout fixture, Padded row the key, left edges aligned.
  if (want("arrange")) {
    await open(fixture("layout.jui"));
    const row = (t: string) => page.locator(".tree-row", { hasText: t }).first();
    // The key first: its tag goes above it, over the empty room between two rows.
    await row("Padded row").click();
    await row("Centred").click({ modifiers: ["Control"] });
    await row("Two").click({ modifiers: ["Control"] });
    await page.keyboard.press("Alt+a");
    if (!(await until(async () => (await page.locator(".ov-sel.multi").count()) === 3))) throw new Error("the three buttons are not selected");
    const lefts = await page.locator(".ov-sel.multi").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
    if (new Set(lefts).size !== 1) throw new Error(`the left edges are not aligned (${lefts.join(", ")})`);
    await page.mouse.move(0, 899);
    await settle();
    await shot("arrange");
    await open(WINDOW);
  }
  if (only && only.every((n) => written.some((w) => basename(w) === `${n}.png`))) throw new Done();

  // The window switcher: the open window's name, the recent windows and the windows folder (the fixtures).
  await page.locator(".doc-switch").click();
  const sw = page.getByRole("dialog", { name: "Switch window" });
  await sw.locator("section[aria-label='Windows folder'] .sw-item").first().waitFor({ timeout: 10000 });
  await settle(300);
  const swBox = (await sw.boundingBox())!;
  await shot("switcher", page, { x: 0, y: 0, width: Math.ceil(swBox.x + swBox.width + 24), height: Math.ceil(swBox.y + swBox.height + 16) });
  await page.keyboard.press("Escape");
  await sw.waitFor({ state: "detached" });

  // The window export: the four formats, the .jui and the NWScript previews.
  await page.keyboard.press("Escape");
  await page.locator("header").getByRole("button", { name: "Export", exact: true }).click();
  await page.waitForSelector(".modal.export");
  await settle();
  await shot("export-jui", page.locator("dialog.modal"));
  await page.locator(".modal .tabs button", { hasText: "NWScript" }).click();
  await settle();
  // The builder calls of the window's first column, not the constants at the top.
  await scrollCodeTo(/^json \w+_Col1\(\)$/);
  await shot("export-nwscript", page.locator("dialog.modal"));
  await page.keyboard.press("Escape");
  await settle(300);

  // The five built-in skins on the same window, then on the help window.
  await grid("skins-compare", await everySkin(), 3);
  if (HELP) {
    await open(HELP);
    await grid("skins-help", await everySkin(), 3);
  }

  // The problems list and its markers on the canvas: a taller page, so every row of the list shows.
  await page.setViewportSize({ width: 1440, height: 1240 });
  // The panel stops at 230 px and scrolls; here it shows every row.
  const uncap = await page.addStyleTag({ content: ".problems { max-height: none !important; }" });
  await open(PROBLEMS);
  await page.keyboard.press("Escape");
  await page.locator(".problems-list li").first().waitFor();
  await settle();
  // Then as short as the window and the whole list allow: the stage keeps 24 px above and below the window.
  const box = async (sel: string) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`no ${sel}`);
    return b;
  };
  for (let i = 0; i < 3; i++) {
    const [stage, wrap] = [await box(".stage"), await box(".canvas-wrap")];
    const spare = stage.height - wrap.height - 48;
    if (Math.abs(spare) < 4) break;
    await page.setViewportSize({ width: 1440, height: Math.round(page.viewportSize()!.height - spare) });
    await actualSize();
    await settle();
  }
  const [center, list] = [await box("main.center"), await page.locator(".problems-list").evaluate((e) => ({ bottom: e.getBoundingClientRect().bottom, full: e.scrollHeight <= e.clientHeight + 1 }))];
  if (!list.full) throw new Error("the problems list scrolls");
  await shot("problems", page, { ...center, height: Math.min(center.height, list.bottom - center.y + 8) });
  await uncap.evaluate((e) => (e as Element).remove());
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(WINDOW);

  // The skin editor on Ink and brass: the button keys and the widget-states sheet, the export, the generator.
  await mode("Skin");
  await page.waitForSelector(".skin-start");
  await page.getByRole("button", { name: /Built-in: Ink and brass/ }).click();
  await page.waitForSelector(".skin-nav");
  await page.locator(".skin-nav .nav-item", { hasText: /^Button$/ }).click();
  await until(async () => (await page.locator(".key-card[data-key='button.normal'] .nine canvas").count()) > 0);
  // The sheet is 1000 x 900 and shows at 100 %: a page wide and tall enough for all of it.
  await page.setViewportSize({ width: 1700, height: 1060 });
  await page.locator(".center-tabs button", { hasText: "Widget states" }).click();
  await until(async () => (await page.locator("canvas.sheet").count()) > 0);
  await settle(800);
  const sheet = await page.locator(".sheet-stage").evaluate((e) => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight);
  if (!sheet) throw new Error("the widget-states sheet does not fit its stage");
  await shot("skin-editor-states");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.locator("header").getByRole("button", { name: /Export skin/ }).click();
  await page.waitForSelector("dialog.modal");
  await settle();
  await shot("export-skin", page.locator("dialog.modal"));
  await page.keyboard.press("Escape");
  await settle(300);

  await page.locator(".skin-nav .nav-item", { hasText: "Generator" }).click();
  await page.locator(".center-tabs button", { hasText: "Window" }).click();
  await until(async () => (await canvasHash()) !== "");
  await settle(800);
  await shot("skin-generator");

  // One generator change: the brass line and the amber accent turned teal, before and after.
  const before = await windowPng();
  const g = page.locator(".generator");
  const h0 = await canvasHash();
  for (const [label, hex] of [["outer", "#123b3a"], ["middle", "#2f8f87"], ["inner", "#7fd6cc"], ["glow", "#62f0dc"]] as const) {
    const f = g.getByLabel(label, { exact: true });
    if (await f.count()) await f.first().fill(hex);
  }
  // The fills: window (0), title bar (1), buttons (2), pressed and selected (3).
  await g.getByLabel("top", { exact: true }).nth(3).fill("#1d6b64");
  await g.getByLabel("bottom", { exact: true }).nth(3).fill("#0e3a36");
  if (!(await until(async () => (await canvasHash()) !== h0))) throw new Error("the generator change did not redraw the window");
  await settle(1000);
  const after = await windowPng();
  await sideBySide("skin-generator-change", before, "Ink and brass", after, "The same skin, its rim and accent colours changed in the generator");

  // `pnpm check`: a clean window, then one with findings that fails on warnings.
  await terminal("check", [{ args: ["fixtures/drawlist-client.json"] }, { args: ["--fail-on", "warning", "fixtures/problems.jui"] }]);

  if (errors.length) throw new Error(`errors in the page: ${errors.slice(0, 3).join(" | ")}`);
} catch (e) {
  if (!(e instanceof Done)) throw e;
  if (errors.length) throw new Error(`errors in the page: ${errors.slice(0, 3).join(" | ")}`, { cause: e });
} finally {
  await browser.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}

// Smaller files: oxipng when it is installed (lossless).
const hasOxipng = spawnSync("oxipng", ["--version"]).status === 0;
if (hasOxipng) execFileSync("oxipng", ["-o", "4", "--strip", "safe", "-q", ...written]);
else console.warn("oxipng is not on the PATH: the PNGs are not optimised");
const total = written.reduce((n, f) => n + statSync(f).size, 0);
for (const f of written) console.log(`${relative(ROOT, f)}  ${(statSync(f).size / 1024).toFixed(0)} KB`);
console.log(`${written.length} screenshots, ${(total / 1024).toFixed(0)} KB`);
