/**
 * Browser tests of the skin and font editor (not part of `pnpm test`): the built editor in headless Chromium.
 * Start from the open Bronze skin; restyle a button (upload a PNG as its texture: converted to TGA, sliced with the
 * key's margins, drawn on the window and the widget sheet); upload a font (listed, its coverage shown); tweak the
 * generator live (a green Bronze on the deity window); export a hak and read it back (the designer's ERF reader:
 * the .tml, the uploaded texture as TGA, the font, the licence note, no game file). Fails on any assertion and any
 * error in the page.
 *
 *   pnpm build && pnpm e2e:skin [--out DIR] [--dump FILE]
 *
 * With the game (NWN_ROOT) the window's own images come from it (minigame.ts, a temporary
 * folder deleted after) and "Your game's skin" is tried too. Screenshots go to --out (default
 * phase3/ in $OUT_DIR, else .out/phase3 at the repository root): never commit them, they can show the game's art.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createCanvas } from "@napi-rs/canvas";
import { chromium } from "playwright-core";
import { openText, toNuiDocument } from "../src/core/edit/project.js";
import { Erf } from "../src/core/res/containers.js";
import { RES_TYPES } from "../src/core/res/restype.js";
import { MemorySource } from "../src/core/res/source.js";
import { decodeTga } from "../src/core/res/tga.js";
import { checkDialog } from "./dialogs.js";
import { makeMiniGame } from "./minigame.js";
import { serveEditor } from "./serve.js";

const ROOT = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    out: { type: "string", default: join(process.env.OUT_DIR ?? join(ROOT, ".out"), "phase3") },
    dump: { type: "string", default: join(ROOT, "local", "dumps", "gods.json") },
    "no-game": { type: "boolean", default: false },
  },
});
const out = resolve(values.out!);
const dist = join(ROOT, "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("run pnpm build first");
mkdirSync(out, { recursive: true });
const dumpFile = existsSync(values.dump!) ? values.dump! : join(ROOT, "fixtures", "widgets.jui");

// No local API: the game comes through the browser's pickers, the fallback a static build uses.
const server = await serveEditor(dist);
const port = server.port;

const failures: string[] = [];
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const tmp = mkdtempSync(join(tmpdir(), "nuid-skin-e2e-"));
// Holds game files when there is a game: removed however the run ends.
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
// A button texture: a 3 px green rim on a dark field (drawn here, ours).
const png = join(tmp, "my_button.png");
{
  const c = createCanvas(64, 24);
  const x = c.getContext("2d");
  x.fillStyle = "#0b1a0e";
  x.fillRect(0, 0, 64, 24);
  for (const [i, col] of ["#0d3b16", "#2f8c3f", "#8fe39b"].entries()) {
    x.strokeStyle = col;
    x.strokeRect(i + 0.5, i + 0.5, 63 - 2 * i, 23 - 2 * i);
  }
  writeFileSync(png, c.toBuffer("image/png"));
}
// A font to upload: the open skin's Philosopher Bold under a name of its own (OFL).
const ttf = join(tmp, "philo_test.ttf");
copyFileSync(join(ROOT, "assets", "skin", "bronze", "nuio_philo_b.ttf"), ttf);

let mini: string | null = null;
if (!values["no-game"]) {
  const dump = openText(readFileSync(dumpFile, "utf8"), "dump").doc;
  mini = await makeMiniGame([toNuiDocument(dump), toNuiDocument(openText(readFileSync(join(ROOT, "fixtures", "widgets.jui"), "utf8"), "w").doc)], join(tmp, "game"));
  console.log(mini ? `game resources for the canvas: ${mini}` : "no game: the fallback skin");
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
await ctx.addInitScript(() => {
  for (const k of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) delete (window as unknown as Record<string, unknown>)[k];
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const settle = (ms = 400) => page.waitForTimeout(ms);
async function until(fn: () => Promise<boolean>, ms = 10000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await page.waitForTimeout(150);
  }
  return false;
}
/** A hash of the window canvas's pixels (to see that it redrew). */
const canvasHash = () =>
  page.evaluate(() => {
    const c = document.querySelector("canvas.nui-canvas") as HTMLCanvasElement | null;
    if (!c) return "";
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 7) h = (Math.imul(h, 31) + d[i]!) | 0;
    return `${c.width}x${c.height}:${h}`;
  });

try {
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector(".start");

  // --- the built-in skins, no game folder: Ink and brass by default, Bronze from the toolbar --------------------------
  await page.getByTestId("import-input").setInputFiles(dumpFile);
  await page.waitForSelector("canvas.nui-canvas", { timeout: 20000 });
  await settle(800);
  const builtin = page.getByLabel("Window editor's skin");
  check((await builtin.inputValue()) === "ink", "without a game the window editor draws with the built-in Ink and brass");
  check(await builtin.locator("option[value=game]").evaluate((o) => (o as HTMLOptionElement).disabled), "the game's skin cannot be chosen without a game folder");
  await until(async () => (await canvasHash()) !== "");
  const inkHash = await canvasHash();
  await page.screenshot({ path: join(out, "06-ink-deity-no-game.png") });
  await builtin.selectOption("bronze");
  check(await until(async () => (await canvasHash()) !== inkHash, 15000), "switching to Bronze redraws the window");
  await settle(600);
  await page.screenshot({ path: join(out, "07-theme-switch-bronze.png") });
  check(
    (await builtin.locator("optgroup[label=Built-in] option").allTextContents()).join("|") === "Ink and brass|Bronze|Brass and soot|Verdigris and paper|Oxblood and rivets|Winter steel",
    "the switch offers the six built-in skins, Ink and brass first",
  );
  await builtin.selectOption("ink");
  check(await until(async () => (await canvasHash()) === inkHash, 15000), "and back to Ink and brass, the same pixels");
  await page.getByRole("group", { name: "Editor" }).getByRole("button", { name: "Skin" }).click();
  await page.waitForSelector(".skin-start");
  check((await page.locator(".skin-start .card", { hasText: "Built-in:" }).count()) === 6, "the skin editor can start from any of the six built-in skins");
  await page.getByRole("group", { name: "Editor" }).getByRole("button", { name: "Window" }).click();

  if (mini) {
    await page.getByRole("button", { name: "Game and haks" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /Pick NWN folder/ }).click();
    await (await chooser).setFiles(mini);
    await page.waitForFunction(() => document.querySelector<HTMLSelectElement>("select[aria-label=\"Window editor's skin\"]")?.value === "game", null, { timeout: 20000 });
    await page.mouse.click(5, 5);
    await page.locator("dialog.modal").waitFor({ state: "detached", timeout: 5000 });
    await settle(300);
  }
  // The deity window (or a fixture) in the window editor: the skin editor draws it.
  await page.getByTestId("import-input").setInputFiles(dumpFile);
  await page.waitForSelector("canvas.nui-canvas", { timeout: 20000 });
  await settle(600);

  // --- the skin mode, from Bronze ------------------------------------------------------------------------------------
  await page.getByRole("group", { name: "Editor" }).getByRole("button", { name: "Skin" }).click();
  await page.waitForSelector(".skin-start");
  check(await page.getByText("Restyle every NUI window").isVisible(), "the skin mode starts with its choices");
  check((await page.getByRole("button", { name: /Your game's skin/ }).isEnabled()) === !!mini, "the game's skin is offered only with a game folder");
  if (mini) {
    await page.getByRole("button", { name: /Your game's skin/ }).click();
    await page.waitForSelector(".skin-nav");
    check(await page.getByText(/the game's skin/).first().isVisible(), "the game's skin opens for editing");
    await page.getByRole("button", { name: "Start again" }).click();
  }
  await page.getByRole("button", { name: /Built-in: Bronze/ }).click();
  await page.waitForSelector(".skin-nav");
  await page.locator(".skin-nav .nav-item", { hasText: /^Button$/ }).click();
  await until(async () => (await page.locator(".key-card[data-key='button.normal'] .nine canvas").count()) > 0);
  check(await page.locator(".key-card[data-key='button.hover'] .chip", { hasText: "9-slice 7,7,7,7" }).isVisible(), "button.hover shows its 7 px margins");
  await until(async () => (await canvasHash()) !== "");
  const before = await canvasHash();

  // --- restyle a button: upload a PNG as button.normal's texture -----------------------------------------------------
  const card = page.locator(".key-card[data-key='button.normal']");
  await card.getByLabel("button.normal texture", { exact: true }).fill("my_button");
  await page.getByTestId("upload-button.normal").setInputFiles(png);
  await until(async () => (await card.locator("text=64 × 24").count()) > 0);
  check(await card.locator("text=64 × 24").isVisible(), "the upload became the texture (64 × 24), with its nine-slice preview");
  check(await until(async () => (await canvasHash()) !== before), "the window redrew with the new button");
  await page.locator(".key-card[data-key='button.normal']").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "01-skin-button-keys.png") });

  // A colour where only an image works: the checker says so on the card.
  await page.locator(".key-card[data-key='button.active']").getByLabel("button.active texture", { exact: true }).fill("#FF000080");
  check(await until(async () => (await page.locator(".key-card[data-key='button.active'] .finding.error", { hasText: "only an image works" }).count()) > 0), "a colour in a 9-slice key is an error");
  await page.locator(".key-card[data-key='button.active']").getByLabel("button.active texture", { exact: true }).fill("nui_button_a");

  // --- the widget-states sheet ---------------------------------------------------------------------------------------
  await page.locator(".center-tabs button", { hasText: "Widget states" }).click();
  check(await until(async () => (await page.locator("canvas.sheet").evaluate((c: HTMLCanvasElement) => c.width)) === 1000), "the widget-states sheet draws");
  await settle(300);
  await page.screenshot({ path: join(out, "02-widget-states.png") });

  // --- upload a font --------------------------------------------------------------------------------------------------
  await page.locator(".skin-nav .nav-item", { hasText: "Fonts" }).click();
  await page.getByTestId("font-upload").setInputFiles(ttf);
  check(await until(async () => (await page.locator("ol.fonts li", { hasText: "philo_test" }).count()) === 1), "the uploaded font is listed");
  await page.getByLabel("Font font_size").fill("24");
  await page.getByLabel("Code page").selectOption("cp1250");
  check(await until(async () => (await page.locator(".missing-glyphs span").count()) > 0), "its coverage lists missing glyphs (cp1250)");
  check(await page.getByText(/Nuklear \(the client's\)/).isVisible(), "the text model is labelled as the client's");
  await settle(400);
  await page.screenshot({ path: join(out, "03-font-panel.png") });

  // --- the generator: a green Bronze, live, on the window --------------------------------------------------------------
  await page.locator(".skin-nav .nav-item", { hasText: "Generator" }).click();
  await page.locator(".center-tabs button", { hasText: "Window" }).click();
  await until(async () => (await canvasHash()) !== "");
  const beforeGreen = await canvasHash();
  const g = page.locator(".generator");
  for (const [label, hex] of [
    ["outer", "#0c2610"],
    ["middle", "#2e7a3a"],
    ["inner", "#8ad694"],
    ["glow", "#9cff7a"],
  ] as const) {
    await g.getByLabel(label, { exact: true }).fill(hex);
  }
  // The fills: window (0), buttons (1), pressed and selected (2), the small tiles (3).
  await g.getByLabel("top", { exact: true }).nth(2).fill("#1f5a2c");
  await g.getByLabel("bottom", { exact: true }).nth(2).fill("#0f3518");
  await g.getByLabel("top", { exact: true }).nth(3).fill("#b6dcae");
  await g.getByLabel("bottom", { exact: true }).nth(3).fill("#5e8a58");
  check(await until(async () => (await canvasHash()) !== beforeGreen, 15000), "the window redraws with the regenerated textures");
  await settle(800);
  await page.screenshot({ path: join(out, "04-bronze-green-deity.png") });

  // --- the export dialog: a native modal <dialog> ----------------------------------------------------------------------
  const top = g.getByLabel("top", { exact: true }).nth(3);
  await checkDialog(page, check, {
    name: "Export the skin",
    opener: /Export skin/,
    open: () => page.locator("header").getByRole("button", { name: /Export skin/ }).click(),
    first: (p) => p.evaluate(() => document.activeElement?.classList.contains("on") === true && document.activeElement.textContent?.includes(".hak") === true),
    shortcuts: async () => {
      for (const k of ["Control+z", "Control+z", "Control+y"]) await page.keyboard.press(k);
      await settle(300);
      return (await top.inputValue()) === "#b6dcae";
    },
  });

  // --- export a hak ---------------------------------------------------------------------------------------------------
  await page.getByRole("button", { name: /Export skin/ }).click();
  await page.getByLabel("Skin name").fill("green_skin");
  check(await page.locator(".export-files code", { hasText: "my_button.tga" }).isVisible(), "the export lists the uploaded texture as a TGA");
  check(await page.locator(".export-files code", { hasText: "philo_test.ttf" }).isVisible(), "the export lists the uploaded font");
  await settle(200);
  await page.screenshot({ path: join(out, "05-export-dialog.png") });
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download green_skin\.hak/ }).click();
  const hakPath = join(tmp, "green_skin.hak");
  await (await dl).saveAs(hakPath);
  const erf = await Erf.open(new MemorySource("green_skin.hak", new Uint8Array(readFileSync(hakPath))));
  const names = [...erf.entries()].map(([n, t]) => `${n}.${Object.entries(RES_TYPES).find(([, v]) => v === t)?.[0]}`);
  check(erf.fileType === "HAK ", "the download is a HAK");
  for (const n of ["nui_skin.tml", "my_button.tga", "philo_test.ttf", "nuid_skin_lic.txt", "nui_button_h.tga"]) check(names.includes(n), `the hak holds ${n}`);
  const tml = new TextDecoder().decode((await erf.get("nui_skin", RES_TYPES.tml!))!);
  check(/\[button\][^[]*normal = "my_button"/.test(tml), "its nui_skin.tml points button.normal at the upload");
  check(/resref = "philo_test"[\s\S]*font_size = 24\.0/.test(tml), "and lists the font at 24 px");
  const tex = decodeTga((await erf.get("my_button", RES_TYPES.tga!))!);
  check(tex.width === 64 && tex.height === 24 && tex.data[3] === 255, "the uploaded PNG went in as a 64 × 24 32-bit TGA");
  check(!names.some((n) => /^(fnt_maintext|jbmonoreg)\./.test(n)), "no game file in the hak");
  check(errors.length === 0, `no errors in the page${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
} catch (e) {
  failures.push(String(e));
  console.error(e);
  await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
} finally {
  await browser.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${failures.length ? `${failures.length} failed` : "all passed"}; screenshots in ${out}`);
process.exit(failures.length ? 1 : 0);
