/**
 * Browser tests of the editor's main flows (not part of `pnpm test`): the built editor in headless Chromium
 * (Playwright). Build a small window from scratch (palette drag and clicks, properties, a bind, list presets,
 * reordering on the canvas, undo and redo), export it, save the project; select several elements (Ctrl+click, a box),
 * align and distribute them; import a dump, edit it, turn the house style
 * on; reload and continue from the autosave. Fails on any assertion and on any error in the page.
 *
 *   pnpm build && pnpm e2e [--out DIR] [--dump FILE]
 *
 * The imported window is fixtures/widgets.jui unless --dump names another (a local dump is never picked up by itself).
 *
 * The editor is served with its local API over a settings file in a temporary folder (serve.ts): its windows folder
 * is listed on the start screen. With the game (NWN_ROOT or nui-designer.ini) the canvas draws with the real skin: the
 * resources the windows need are copied to a temporary folder (minigame.ts), named as the game in that settings file,
 * loaded at start with no clicks, and deleted after. At the end the settings name an install (the mini game, or a fake
 * one) and the Game and haks dialog must show it; then, with the API off, the browser's pickers must be offered.
 * The window switcher (the name in the toolbar) is checked with the local API (the windows folder's files, Recent, a
 * question before unsaved changes go, the search) and without it (Recent only).
 * The screenshots (01-start, 02-building, 02b-arrange, 03-edit-<dump>, 04-export, 05-toolbar-<mode>-<width>) go to --out.
 *
 * Needs Playwright's Chromium (npx playwright-core install chromium).
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright-core";
import { openText, toNuiDocument } from "../src/core/edit/project.js";
import { checkDialog } from "./dialogs.js";
import { makeMiniGame } from "./minigame.js";
import { writeFakeInstall } from "./fakegame.js";
import { serveEditor } from "./serve.js";

const ROOT = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    out: { type: "string", default: join(ROOT, ".golden-out", "e2e") },
    // A window to import and edit: the repository's widgets fixture unless one is named, so a local dumps folder never
    // changes what the test checks. `--dump local/dumps/gods.json` adds the deity window's own checks.
    dump: { type: "string" },
    "no-game": { type: "boolean", default: false },
  },
});
const out = resolve(values.out!);
const dist = join(ROOT, "dist");
if (!existsSync(join(dist, "index.html"))) throw new Error("run pnpm build first");
mkdirSync(out, { recursive: true });
if (values.dump && !existsSync(values.dump)) throw new Error(`no such dump: ${values.dump}`);
const dumpFile = values.dump ?? join(ROOT, "fixtures", "widgets.jui");


const failures: string[] = [];
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

// The real skin, if there is a game: the resources the two windows need, in a temporary folder.
let mini: string | null = null;
const tmp = mkdtempSync(join(tmpdir(), "nuid-e2e-"));
if (!values["no-game"]) {
  const dump = openText(readFileSync(dumpFile, "utf8"), "dump").doc;
  mini = await makeMiniGame([toNuiDocument(dump), toNuiDocument(openText(readFileSync(join(ROOT, "fixtures", "widgets.jui"), "utf8"), "w").doc)], join(tmp, "game"));
  console.log(mini ? `game resources for the canvas: ${mini}` : "no game: the fallback skin");
}
// The test's own settings file and windows folder; the repository's nui-designer.ini is never read or written.
const iniPath = join(tmp, "nui-designer.ini");
const winDir = join(tmp, "windows");
mkdirSync(winDir);
// The repository's fixtures as a windows folder: enough windows that the window switcher shows its search box.
for (const f of ["widgets.jui", "layout.jui", "problems.jui", "options-window.jui", "drawlist.jui", "unsolvable.jui", "binds.json", "drawlist-client.json"]) copyFileSync(join(ROOT, "fixtures", f), join(winDir, f));
// A style file of the repository's (with its plugin), so the Style select lists a file's style.
writeFileSync(iniPath, `; the e2e's settings\n${mini ? `game = ${mini}\n` : ""}windows = ${winDir}\nstyles = ${join(ROOT, "styles", "example.json")}\n`);
const server = await serveEditor(dist, { iniPath });
const port = server.port;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
// The File System Access API's pickers cannot be driven headless: the editor's fallbacks (file inputs, downloads) are.
await ctx.addInitScript(() => {
  for (const k of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) delete (window as unknown as Record<string, unknown>)[k];
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const treeRows = () => page.locator(".tree-row:not(.window)");
/** The open window's name, on the window switcher's button in the toolbar. */
const docName = async () => ((await page.locator(".doc-switch-name").textContent()) ?? "").trim();
const settle = (ms = 400) => page.waitForTimeout(ms);
async function canvasReady() {
  await page.waitForSelector(".nui-canvas", { timeout: 15000 });
  await settle(300);
}
/** Waits (up to 8 s) until fn is true; returns whether it became true. */
async function until(fn: () => Promise<boolean>, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await page.waitForTimeout(150);
  }
  return false;
}
// Counts the clipped-text problems: a grouped row (identical notes) counts its members (data-count).
const clipped = () => page.locator(".problems-list li:not(.member)", { hasText: "clipped text" }).evaluateAll((els) => els.reduce((n, el) => n + Number(el.getAttribute("data-count") ?? 1), 0));
async function selectTree(text: string) {
  await page.locator(".tree-row", { hasText: text }).first().click();
  await settle(150);
}
async function selBox(p: Page) {
  const b = await p.locator(".ov-sel").boundingBox();
  if (!b) throw new Error("nothing selected on the canvas");
  return b;
}
/** With the game named in the settings file, the editor loads it at start, with no clicks. */
async function useGame() {
  if (!mini) return;
  const ok = await page
    .waitForFunction(() => document.querySelector<HTMLSelectElement>("select[aria-label=\"Window editor's skin\"]")?.value === "game", null, { timeout: 20000 })
    .then(() => true, () => false);
  check(ok, "the game named in nui-designer.ini is loaded at start with no clicks");
  await settle(600);
}

try {
  // --- an empty start ---------------------------------------------------------------------------------------------
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector(".start");
  check(await page.getByText("Design a NUI window").isVisible(), "the start screen shows");
  // The list comes with the local state, fetched after the start screen first draws: wait for it.
  const listed = await page
    .locator(".window-files .chip-btn", { hasText: "widgets" })
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true, () => false);
  check(listed, "the start screen lists the windows folder's files");
  await useGame();
  await page.screenshot({ path: join(out, "01-start.png") });

  // --- build a small window from scratch -------------------------------------------------------------------------
  await page.locator(".card", { hasText: "New window" }).click();
  await canvasReady();
  check((await treeRows().count()) === 1, "a new window is an empty column");
  // Drag a label from the palette onto the canvas.
  await page.locator(".tile[data-type=label]").dragTo(page.getByTestId("canvas-overlay"));
  await settle();
  check((await treeRows().count()) === 2 && (await page.locator(".tree-row", { hasText: "Label" }).count()) === 1, "a label dragged from the palette lands in the column");
  // Edit it in the properties panel.
  await selectTree("Label");
  await page.locator('.prop[data-prop="value"] textarea').fill("Choose your reward");
  await page.locator('.prop[data-prop="foreground_color"] button', { hasText: "Set" }).click();
  await page.locator('.prop[data-prop="foreground_color"] input[aria-label=r]').fill("222");
  await page.locator('.prop[data-prop="foreground_color"] input[aria-label=g]').fill("184");
  await page.locator('.prop[data-prop="foreground_color"] input[aria-label=b]').fill("80");
  await page.locator('.prop[data-prop="height"] input').fill("28");
  // A list (after the label), then a footer row with a spacer and a Close button.
  await page.locator(".tile[data-type=list]").click();
  await selectTree("List");
  await page.locator('.prop[data-prop="row_height"] input').fill("36");
  // With a container selected, a palette click adds into it: select the column for the footer row.
  await selectTree("Column");
  await page.locator(".tile[data-type=row]").click();
  await page.locator(".tile[data-type=button]").click();
  await page.locator(".tile[data-type=spacer]").click();
  await settle();
  const rows = await treeRows().allTextContents();
  check(rows.length === 7, `the tree has the column, label, list (and its cell), row, button and spacer (${rows.length})`);
  // The button: label, width.
  await selectTree("Button");
  await page.locator('.prop[data-prop="label"] input').fill("Close");
  await page.locator('.prop[data-prop="width"] button', { hasText: "Set" }).click();
  await page.locator('.prop[data-prop="width"] input').fill("110");
  await page.locator('.prop[data-prop="height"] input').fill("32");
  await page.locator('.prop[data-prop="id"] button', { hasText: "Set" }).click();
  await page.locator('.prop[data-prop="id"] input').fill("close_btn");
  await settle();
  // Reorder on the canvas: drag the Close button past the spacer, to the row's end (bottom right).
  const btn = await selBox(page);
  await selectTree("Spacer");
  const sp = await selBox(page);
  await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2);
  await page.mouse.down();
  await page.mouse.move(btn.x + btn.width / 2 + 20, btn.y + btn.height / 2, { steps: 4 });
  await page.mouse.move(sp.x + sp.width - 4, sp.y + sp.height / 2, { steps: 8 });
  check(await page.locator(".ov-drop").isVisible(), "dragging on the canvas shows where the element will land");
  await page.mouse.up();
  await settle();
  const after = await page.locator('.tree-row[data-path^="2/"] .t-type').allTextContents();
  check(after.join(",") === "Spacer,Button", `dragging the button on the canvas moved it after the spacer (${after.join(",")})`);
  // Bind the label's text, and fill the list.
  await selectTree("Label");
  await page.locator('.prop[data-prop="value"] button[aria-label^="Bind"]').click();
  await settle(200);
  check(await page.locator('.prop[data-prop="value"].bound').isVisible(), "the label's text is bound");
  check((await page.locator('.prop[data-prop="value"] .bind-name input').inputValue()) === "text", "the bind is named after the property");
  await page.locator(".right-tabs button", { hasText: "Binds" }).click();
  await page.getByRole("button", { name: /Fill 1 list with/ }).click();
  await settle();
  const sample = await page.locator('.bind-card[data-bind="row_count"] textarea').inputValue();
  check(sample === "20", `the list preset fills the row count (${sample})`);
  await page.locator(".right-tabs button", { hasText: "Properties" }).click();
  await selectTree("List");
  await settle(500);
  await page.screenshot({ path: join(out, "02-building.png") });

  // Undo and redo.
  const before = await treeRows().count();
  await page.locator(".tree").focus();
  await selectTree("Spacer");
  await page.keyboard.press("Delete");
  await settle(200);
  check((await treeRows().count()) === before - 1, "Delete removes the selection");
  await page.keyboard.press("Control+z");
  await settle(200);
  check((await treeRows().count()) === before, "Ctrl+Z undoes it");
  await page.keyboard.press("Control+Shift+z");
  await settle(200);
  check((await treeRows().count()) === before - 1, "Ctrl+Shift+Z redoes it");
  await page.keyboard.press("Control+z");
  await settle(200);

  // --- dialogs: native modal <dialog>s (focus in, Tab kept inside, Escape and the backdrop close, focus back) --------
  await selectTree("Spacer");
  const rowsBefore = await treeRows().count();
  const unchanged = async () => {
    await page.waitForTimeout(200);
    return (await treeRows().count()) === rowsBefore && (await page.locator(".props-title").textContent()) === "Spacer";
  };
  await checkDialog(page, check, {
    name: "Keyboard shortcuts",
    opener: "Keyboard shortcuts",
    open: () => page.locator("header").getByRole("button", { name: "Keyboard shortcuts" }).click(),
    shortcuts: async () => {
      for (const k of ["Delete", "Control+d", "Alt+g", "Control+z", "Alt+PageUp"]) await page.keyboard.press(k);
      const ok = await unchanged();
      // Ctrl+S still saves.
      const saving = page.waitForEvent("download", { timeout: 5000 });
      await page.keyboard.press("Control+s");
      check((await saving).suggestedFilename().length > 0, "Keyboard shortcuts: Ctrl+S still saves while it is open");
      return ok;
    },
  });
  check(await unchanged(), "Escape that closes a dialog does not also select the parent");
  await checkDialog(page, check, {
    name: "Paste JSON",
    opener: "File",
    open: async () => {
      await page.locator(".tb", { hasText: "File" }).click();
      await page.locator(".file-menu button", { hasText: "Paste JSON" }).click();
    },
    first: (p) => p.evaluate(() => document.activeElement?.tagName === "TEXTAREA"),
    shortcuts: async () => {
      for (const k of ["Control+z", "Alt+g", "Alt+u"]) await page.keyboard.press(k);
      return unchanged();
    },
  });
  await checkDialog(page, check, {
    name: /^Export “/,
    opener: /^Export$/,
    open: () => page.locator("header").getByRole("button", { name: "Export", exact: true }).click(),
    first: (p) => p.evaluate(() => document.activeElement?.classList.contains("on") === true && document.activeElement.textContent?.includes(".jui") === true),
    shortcuts: async () => {
      for (const k of ["Delete", "Control+z"]) await page.keyboard.press(k);
      return unchanged();
    },
  });
  await checkDialog(page, check, {
    name: "Game and haks",
    opener: "Game and haks",
    open: () => page.locator("header").getByRole("button", { name: "Game and haks" }).click(),
    first: (p) => p.evaluate(() => document.activeElement?.id === "res-game"),
  });

  // Wrap and unwrap.
  await selectTree("Label");
  await page.keyboard.press("Alt+g");
  await settle(200);
  check((await page.locator('.tree-row[data-path="0"] .t-type').textContent()) === "Group", "Alt+G wraps the label in a group");
  await page.keyboard.press("Alt+u");
  await settle(200);
  check((await page.locator('.tree-row[data-path="0"] .t-type').textContent()) === "Label", "Alt+U unwraps it");

  // --- resize on the canvas: handles, snapping, the read-out, one undo step, Escape, Shift, double-click, Alt+Arrow
  const propNum = (key: string, sub?: string) => page.locator(`.prop[data-prop="${key}"] input${sub ? `[aria-label=${sub}]` : ""}`).first().inputValue();
  const center = async (sel: string) => {
    const b = await page.locator(sel).boundingBox();
    if (!b) throw new Error(`no ${sel}`);
    return [b.x + b.width / 2, b.y + b.height / 2] as const;
  };
  /** Drags from a handle by (dx, dy) screen px; before releases, it runs mid (with the button still down). */
  const dragHandle = async (handle: string, dx: number, dy: number, mid?: () => Promise<void>) => {
    const [x, y] = await center(handle);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await settle(250);
    if (mid) await mid();
    await page.mouse.up();
    await settle(250);
  };
  check((await page.getByLabel("Grid step").inputValue()) === "4", "the grid step is 4 px by default");
  await page.locator(".tb.pct").click(); // 100 %: screen px are layout units
  await selectTree("Button");
  check((await page.locator(".ov-h").count()) === 3, "the selected element has three resize handles");
  check((await page.locator(".ov-h-e").evaluate((e) => getComputedStyle(e).cursor)) === "ew-resize", "the right edge handle has a resize cursor");
  // Right edge: 110 + 42 screen px at 100 % = 152 (snapped to 4). The read-out shows the size while dragging.
  let readout = "";
  await dragHandle(".ov-h-e", 42, 0, async () => {
    readout = (await page.getByTestId("resize-readout").textContent()) ?? "";
  });
  check(readout === "w 152", `the read-out next to the cursor shows the width while dragging (${readout})`);
  check((await propNum("width")) === "152", `dragging the right edge sets the width in the panel (${await propNum("width")})`);
  await page.keyboard.press("Control+z");
  await settle(200);
  check((await propNum("width")) === "110", "one Ctrl+Z takes the whole drag back");
  // Bottom edge, cancelled with Escape while dragging: the height comes back, and the selection stays.
  let during = "";
  await dragHandle(".ov-h-s", 0, 20, async () => {
    during = await propNum("height");
    await page.keyboard.press("Escape");
    await settle(150);
  });
  check(during === "52", `the layout follows the drag live (height ${during} while dragging)`);
  check((await propNum("height")) === "32" && (await page.locator(".props-title").textContent()) === "Button", "Escape cancels the drag and restores the height");
  // The corner with Shift: 1 px steps on both axes.
  await page.keyboard.down("Shift");
  await dragHandle(".ov-h-se", 13, 7);
  await page.keyboard.up("Shift");
  check((await propNum("width")) === "123" && (await propNum("height")) === "39", `Shift + the corner sizes in 1 px (${await propNum("width")} x ${await propNum("height")})`);
  // Double-click the right edge: the width is automatic again.
  await page.locator(".ov-h-e").dblclick();
  await settle(250);
  check(await page.locator('.prop[data-prop="width"].absent').isVisible(), "double-clicking the right edge clears the width");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await settle(200);
  check((await propNum("width")) === "110" && (await propNum("height")) === "32", "undo takes the double-click and the corner drag back, one step each");
  // Keyboard: Alt+Arrow by the grid step (to the next grid line), Shift+Alt by 1 px, one undo step a press.
  await page.locator(".tree").focus();
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Shift+Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowDown");
  await settle(200);
  check((await propNum("width")) === "113" && (await propNum("height")) === "36", `Alt+→, Shift+Alt+→ and Alt+↓ resize (${await propNum("width")} x ${await propNum("height")})`);
  check((await page.locator(".props-title").textContent()) === "Button", "Alt+arrows do not walk the tree");
  await page.getByLabel("Grid step").selectOption("8");
  await page.locator(".tree").focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await settle(200);
  check((await propNum("width")) === "112", `with an 8 px grid, Alt+← goes to the grid line below (${await propNum("width")})`);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
  await settle(200);
  check((await propNum("width")) === "110" && (await propNum("height")) === "32", "four Ctrl+Z take the four key presses back");
  // Alt+Arrow in a text field is the field's, not a resize.
  await page.locator('.prop[data-prop="label"] input').focus();
  await page.keyboard.press("Alt+ArrowRight");
  await settle(150);
  check((await propNum("width")) === "110", "Alt+arrows in a text field do not resize");
  // The window: its handles when nothing is selected; centred, so its edge moves half as far as its size changes.
  await page.locator(".tree-row.window").click();
  await settle(200);
  check(await page.locator(".ov-handles.window").isVisible(), "the window has resize handles when it is selected");
  const geoW = Number(await propNum("geometry", "w"));
  const geoH = Number(await propNum("geometry", "h"));
  await dragHandle(".ov-handles.window .ov-h-e", 20, 0);
  check(Number(await propNum("geometry", "w")) === geoW + 40, `dragging the window's edge sets its geometry width (${geoW} to ${await propNum("geometry", "w")})`);
  await page.locator(".tree").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await settle(200);
  check(Number(await propNum("geometry", "h")) === geoH + 8, `Alt+↓ makes the window taller by the grid step (${geoH} to ${await propNum("geometry", "h")})`);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await settle(200);
  check(Number(await propNum("geometry", "w")) === geoW && Number(await propNum("geometry", "h")) === geoH, "undo restores the window's size");
  // Moving still works from the body: the move shortcuts moved to Alt+Page Up / Page Down.
  await selectTree("Button");
  await page.locator(".tree").focus();
  await page.keyboard.press("Alt+PageUp");
  await settle(200);
  const moved = await page.locator('.tree-row[data-path^="2/"] .t-type').allTextContents();
  check(moved.join(",") === "Button,Spacer", `Alt+Page Up moves the button before the spacer (${moved.join(",")})`);
  await page.keyboard.press("Control+z");
  await settle(200);

  // --- zoom: the canvas is sized (not transformed), its pixels copied at whole zooms and smoothed between --------
  {
    const canvasState = () =>
      page.locator(".canvas-holder").evaluate((h) => {
        const c = h.querySelector("canvas")!;
        const b = c.getBoundingClientRect();
        return { k: b.width / c.width, rendering: getComputedStyle(c).imageRendering, pct: document.querySelector(".tb.pct")!.textContent };
      });
    await page.locator(".tb.pct").click();
    await settle(150);
    const at100 = await canvasState();
    check(at100.k === 1 && at100.rendering === "pixelated", `at 100 % one screen pixel per canvas pixel, copied (${JSON.stringify(at100)})`);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await settle(150);
    const at150 = await canvasState();
    check(at150.pct === "150%" && at150.k === 1.5 && at150.rendering === "auto", `150 % is smoothed (${JSON.stringify(at150)})`);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await settle(150);
    const at200 = await canvasState();
    check(at200.pct === "200%" && at200.k === 2 && at200.rendering === "pixelated", `200 % copies each pixel to 2 x 2 (${JSON.stringify(at200)})`);
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await settle(150);
    const fitted = await canvasState();
    check(fitted.pct === "100%" || fitted.pct === "200%" || Number.parseInt(fitted.pct ?? "") < 100, `Fit picks a whole zoom from 100 % up (${fitted.pct})`);
    await page.locator(".tb.pct").click();
    await settle(150);
  }

  // Export: the .jui is the window's JSON; the NWScript builds it.
  await page.keyboard.press("Control+e");
  await page.waitForSelector(".modal.export");
  const jui = JSON.parse(await page.getByTestId("export-code").textContent() ?? "{}");
  check(jui.version === 1 && jui.root?.type === "col" && jui.root.children.length === 3, "the .jui export is the window (a column of three)");
  check(jui.root?.children?.[0]?.value?.bind === "text" && jui.root.children[0].foreground_color?.r === 222, "the .jui keeps the bind and the colour");
  check(/"row_height": 36\.0/.test((await page.getByTestId("export-code").textContent()) ?? ""), "the .jui writes floats as floats");
  await page.locator(".modal .tabs button", { hasText: "NWScript" }).click();
  const nss = (await page.getByTestId("export-code").textContent()) ?? "";
  check(nss.includes('#include "nw_inc_nui"') && nss.includes("NuiWindow(") && nss.includes("NuiCreate(") && nss.includes('_BIND_TEXT = "text"') && nss.includes('_ID_CLOSE_BTN = "close_btn"'), "the NWScript export builds it with binds and ids as constants");
  const dl = page.waitForEvent("download");
  await page.locator(".modal").getByRole("button", { name: "Download" }).click();
  check((await dl).suggestedFilename().endsWith(".nss"), "the NWScript downloads as a .nss");
  await page.locator(".modal-head").getByRole("button", { name: "Close" }).click();
  // Save the project (a download without the File System Access API) and read it back.
  const saved = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const file = await (await saved).path();
  const project = JSON.parse(readFileSync(file!, "utf8"));
  check(project.format === "nwn-nui-designer/project" && project.binds.row_count === 20 && project.window.root.children.length === 3, "Ctrl+S saves the project with its sample values");

  // --- paste JSON (phase 1's viewer could) ---------------------------------------------------------------------
  await page.locator(".tb", { hasText: "File" }).click();
  await page.locator(".file-menu button", { hasText: "Paste JSON" }).click();
  await page.locator(".modal textarea").fill(JSON.stringify(JSON.stringify({ type: "col", children: [{ type: "label", value: "Pasted", height: 30 }] })));
  await page.getByRole("button", { name: "Open it" }).click();
  await canvasReady();
  check((await page.locator(".tree-row:not(.window) .t-text", { hasText: /^Pasted$/ }).count()) === 1, "pasted JSON (a quoted JsonDump of a layout) opens in a new window");

  // --- multi-select, align and distribute ----------------------------------------------------------------------
  // Three rows: a (after a 60 px spacer), b, and c, d, e (a 10 px spacer between c and d) for the gaps.
  {
    const b = (id: string, w: number) => ({ type: "button", id, label: id.toUpperCase(), value: null, width: w, height: 30 });
    const s = (w?: number) => (w === undefined ? { type: "spacer" } : { type: "spacer", width: w });
    const layout = {
      type: "col",
      children: [
        { type: "row", height: 36, children: [s(60), b("a", 100), s()] },
        { type: "row", height: 36, children: [b("b", 80), s()] },
        { type: "row", height: 36, children: [b("c", 40), s(10), b("d", 40), b("e", 40), s()] },
        s(),
      ],
    };
    await page.locator(".tb", { hasText: "File" }).click();
    await page.locator(".file-menu button", { hasText: "Paste JSON" }).click();
    await page.locator(".modal textarea").fill(JSON.stringify(layout));
    await page.getByRole("button", { name: "Open it" }).click();
    await canvasReady();
    const rowOf = (id: string) => page.locator(".tree-row", { hasText: `#${id}` }).first();
    const lefts = () => page.locator(".ov-sel.multi").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    await rowOf("a").click();
    await rowOf("b").click({ modifiers: ["Control"] });
    await settle(300);
    check((await page.locator(".tree-row.selected").count()) === 2 && (await page.locator(".tree-row.selected.key", { hasText: "#a" }).count()) === 1, "Ctrl+click in the tree selects a second element; the first is the key");
    check((await page.getByTestId("sel-key").count()) === 1 && (await page.getByTestId("sel-multi").count()) === 1, "the canvas outlines both, the key distinctly");
    check((await page.locator(".props-title").textContent()) === "2 elements" && (await page.getByTestId("arrange").isVisible()), "the properties panel shows the two and the arrange tools");
    const treeBefore = await treeRows().count();
    await page.keyboard.press("Alt+a");
    check(await until(async () => { const l = await lefts(); return l.length === 2 && l[0] === l[1]; }), "Alt+A lines the left edges up on the key's (a spacer before b)");
    check((await treeRows().count()) === treeBefore + 1, "align inserted one spacer");
    await page.locator(".tree").focus();
    await page.keyboard.press("Control+z");
    check(await until(async () => (await treeRows().count()) === treeBefore), "one Ctrl+Z takes the align back");
    // A box dragged from an empty place (the column's spacer below the rows) over c, d and e picks those three.
    await page.keyboard.press("Escape");
    await rowOf("c").click();
    const c = (await page.locator(".ov-sel").boundingBox())!;
    await rowOf("e").click();
    const e = (await page.locator(".ov-sel").boundingBox())!;
    await page.mouse.move(e.x + e.width + 6, e.y + e.height + 12);
    await page.mouse.down();
    await page.mouse.move(e.x, c.y + 10, { steps: 4 });
    await page.mouse.move(c.x - 1, c.y - 1, { steps: 4 });
    check(await page.getByTestId("select-box").isVisible(), "dragging from an empty place draws a selection box");
    await page.mouse.up();
    await settle(300);
    const picked = await page.locator(".tree-row.selected .t-id").allTextContents();
    check(picked.join(",") === "#c,#d,#e", `the box picks the buttons fully inside it, not the spacer between (${picked.join(",")})`);
    // Equal gaps: c to d is 14 (2 + 10 + 2), d to e 4; both become 9, through the spacers between.
    await page.locator(".arrange-btn[data-tool=dist-gaps-h]").click();
    const gaps = async () => {
      const r = await page.locator(".ov-sel.multi").evaluateAll((els) => els.map((x) => x.getBoundingClientRect()).sort((p, q) => p.left - q.left).map((x) => [x.left, x.right]));
      return r.length === 3 ? [r[1]![0]! - r[0]![1]!, r[2]![0]! - r[1]![1]!] : [];
    };
    check(await until(async () => { const g = await gaps(); return g.length === 2 && Math.abs(g[0]! - 9) < 0.01 && Math.abs(g[1]! - 9) < 0.01; }), "Equal gaps evens the gaps between c, d and e (9 px each)");
    // A tool that cannot run says why: align left within one row.
    const why = (await page.locator(".arrange-btn[data-tool=align-left]").getAttribute("title")) ?? "";
    check((await page.locator(".arrange-btn[data-tool=align-left]").getAttribute("aria-disabled")) === "true" && /side by side in one row/.test(why), "a tool that cannot run is marked and its tooltip says why");
    // Delete takes all three in one step; Escape clears a selection of several.
    const n = await treeRows().count();
    await page.keyboard.press("Delete");
    check(await until(async () => (await treeRows().count()) === n - 3), "Delete removes every selected element");
    await page.keyboard.press("Control+z");
    check(await until(async () => (await treeRows().count()) === n), "one Ctrl+Z brings them all back");
    await rowOf("a").click();
    await rowOf("b").click({ modifiers: ["Control"] });
    await page.keyboard.press("Escape");
    check(await until(async () => (await page.locator(".tree-row.selected").count()) === 1 && (await page.locator(".tree-row.window.selected").count()) === 1), "Escape clears a selection of several");
    await page.screenshot({ path: join(out, "02b-arrange.png") });
  }

  // --- import a dump, edit it -----------------------------------------------------------------------------------
  await page.getByTestId("import-input").setInputFiles(dumpFile);
  await canvasReady();
  await settle(800);
  const name = dumpFile.split("/").pop()!.replace(/\.[^.]+$/, "");
  check((await docName()) === name, `the dump opens (${name})`);
  const isGods = name === "gods";
  if (isGods) {
    await page.locator(".tree-row", { hasText: "#choose" }).first().click();
    await settle(200);
    check((await page.locator(".props-title").textContent()) === "Button", "selecting the choose button in the tree shows its properties");
    const tip = await page.locator('.prop[data-prop="disabled_tooltip"] .bind-name input').inputValue();
    check(tip === "choose_tip", "its bound disabled tooltip is shown as a bind");
    // Narrow the Close button: its text no longer fits, and the problems list says so. (The choose button is hidden
    // until a deity is chosen: its sample show_choose is false.)
    const clippedBefore = await clipped();
    await page.locator(".tree-row", { hasText: "#close_btn" }).first().click();
    await page.locator('.prop[data-prop="width"] input').fill("30");
    check(await until(async () => (await clipped()) > clippedBefore), "narrowing the button reports its clipped label");
    await page.locator(".tree").focus();
    await page.keyboard.press("Control+z");
    check(await until(async () => (await clipped()) === clippedBefore), "undo takes it back");
    // The house style.
    // (What they find depends on the server's current window, so it is reported, not checked; the widgets fixture's
    // run checks the rules themselves.)
    await page.locator("select[aria-label='Style rules']").selectOption("layonara");
    await settle(400);
    console.log(`note the Layonara style rules find ${await page.locator(".problems-list .p-src.style").count()} things in this dump`);
    await page.locator("select[aria-label='Style rules']").selectOption("");
    // Show the choose button as when a deity is chosen: its visible and enabled samples, in the properties panel.
    await page.locator(".tree-row", { hasText: "#choose" }).first().click();
    await page.locator('.prop[data-prop="visible"] .sample .switch').click();
    await page.locator('.prop[data-prop="enabled"] .sample .switch').click();
    check(await until(async () => (await page.locator(".ov-sel").count()) === 1), "a sample value change shows the hidden button on the canvas");
    await page.getByRole("button", { name: "Fit" }).click();
    await settle(800);
  } else if (name === "widgets") {
    // Identical notes share a row: the widgets fixture has two 40 px rows of controls.
    await page.locator("select[aria-label='Style rules']").selectOption("layonara");
    const group = page.locator(".problems-list li.group", { hasText: "36 px control rows" });
    check(await until(async () => (await group.count()) === 1 && (await group.getAttribute("data-count")) === "2"), "two identical style notes share one row");
    await group.click();
    check(await until(async () => (await page.locator(".problems-list li.member").count()) === 2), "the row opens to its two elements");
    await page.locator(".problems-list li.member").first().click();
    check(await until(async () => (await page.locator(".ov-sel").count()) >= 1), "an element of the group selects it on the canvas");
    await group.click();
    check(await until(async () => (await page.locator(".problems-list li.member").count()) === 0), "and folds again");
    // A style file from nui-designer.ini's styles is listed beside the built-in sets, its plugin's rule with it.
    check(await until(async () => (await page.locator("select[aria-label='Style rules'] option[value='example']").count()) === 1), "the Style select lists the style file of nui-designer.ini");
    await page.locator("select[aria-label='Style rules']").selectOption("example");
    check(await until(async () => (await page.locator(".problems-list li", { hasText: "36 px control rows" }).count()) > 0), "the style file's generic rules add their findings");
    await page.getByRole("button", { name: "Style rules" }).click();
    check(await until(async () => (await page.locator(".modal.rules", { hasText: "Not empty" }).count()) === 1), "its plugin's rule is in the rule list");
    await page.keyboard.press("Escape");
    await page.locator("dialog.modal").waitFor({ state: "detached", timeout: 5000 });
    await page.locator("select[aria-label='Style rules']").selectOption("");
    // The selected combo's open list, drawn on demand on top of the window (past it, if need be).
    const pixels = () => page.locator(".nui-canvas").evaluate((c) => (c as HTMLCanvasElement).toDataURL());
    await selectTree("Combo");
    await settle(300);
    const shut = await pixels();
    await page.getByTestId("open-list").check();
    check(await until(async () => (await pixels()) !== shut), "Open combo list draws the selected combo's list");
    await page.getByTestId("open-list").uncheck();
    check(await until(async () => (await pixels()) === shut), "and unticking it closes the list again");
  }
  await page.screenshot({ path: join(out, `03-edit-${name}.png`) });

  // --- the export dialog ---------------------------------------------------------------------------------------
  await page.keyboard.press("Control+e");
  await page.waitForSelector(".modal.export");
  await page.locator(".modal .tabs button", { hasText: "NWScript" }).click();
  await settle(300);
  // Show the code that builds the window, past the constants.
  await page.locator(".code").evaluate((el) => {
    const lines = (el.textContent ?? "").split("\n");
    const i = lines.findIndex((l) => l.startsWith("json ") && l.includes("()") && !l.endsWith(";"));
    el.scrollTop = Math.max(0, i - 2) * 18;
  });
  await settle(200);
  await page.screenshot({ path: join(out, "04-export.png") });
  await page.locator(".modal-head").getByRole("button", { name: "Close" }).click();

  // --- the toolbar fits from 1280 px wide, in both modes (nothing squeezed, no sideways scroll) ------------------
  const toolbarFits = () => page.locator(".toolbar").evaluate((e) => e.scrollWidth <= e.clientWidth);
  const atWidths = async (mode: string) => {
    for (const w of [1280, 1440, 1600]) {
      await page.setViewportSize({ width: w, height: 1000 });
      await settle(300);
      check(await toolbarFits(), `the toolbar fits at ${w} px (${mode})`);
      if (mode === "window") {
        // The canvas bar too: its checkboxes on one line each, nothing pushed out of sight.
        const bar = await page.locator(".canvas-bar").evaluate((e) => ({
          fits: e.scrollWidth <= e.clientWidth,
          oneLine: [...e.querySelectorAll("label")].every((l) => l.getBoundingClientRect().height < 24 && l.scrollWidth <= l.clientWidth + 1),
          width: e.clientWidth,
          items: [...e.children].map((c) => `${(c.textContent ?? "").trim().slice(0, 24)} ${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`),
        }));
        check(bar.fits && bar.oneLine, `the canvas bar fits at ${w} px, one line per checkbox (${JSON.stringify(bar)})`);
      }
      if (w !== 1280) await page.screenshot({ path: join(out, `05-toolbar-${mode}-${w}.png`) });
    }
  };
  await atWidths("window");
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator(".tb", { hasText: "File" }).click();
  const fm = await page.locator(".file-menu").boundingBox();
  check(fm && fm.y >= 40 && fm.x >= 0 && fm.x + fm.width <= 1280, "the File menu opens under its button, inside the page");
  await page.locator(".tb", { hasText: "File" }).click();
  const skinSelect = page.getByLabel("Window editor's skin");
  await page.getByRole("group", { name: "Editor" }).getByRole("button", { name: "Skin" }).click();
  await page.getByRole("button", { name: /Built-in: Bronze/ }).click();
  await page.waitForSelector(".skin-nav");
  await settle(800);
  check((await skinSelect.inputValue()) === "edited", "a skin being edited is what the window editor draws with");
  check(/draws with this skin too/.test((await page.getByTestId("window-skin").textContent()) ?? ""), "the skin editor says the window editor draws with it");
  // the full theme export needs the game's own original GUI: without one it says so and builds nothing; with the game
  // loaded at start (the mini game) it is ready to build (not run: its output is the game's textures)
  await page.locator("header").getByRole("button", { name: /Export skin/ }).click();
  await page.locator(".modal .tabs button", { hasText: "Full theme" }).click();
  const buildTheme = page.getByRole("button", { name: "Build the theme" });
  await buildTheme.waitFor();
  if (mini) {
    check((await page.getByTestId("theme-blocked").count()) === 0, "with the game, the full theme export is not blocked");
    check(await buildTheme.isEnabled(), "and its build button is enabled");
  } else {
    check(/No game loaded/.test((await page.getByTestId("theme-blocked").textContent()) ?? ""), "the full theme export says it needs the game");
    check(await buildTheme.isDisabled(), "and its build button is disabled");
  }
  check((await page.getByTestId("theme-light").count()) === 0, "Bronze is not a light skin: no warning");
  await page.keyboard.press("Escape");
  await page.locator("dialog.modal").waitFor({ state: "detached", timeout: 5000 });
  // "Open another skin": straight back to the start when nothing changed, asks first when something did
  const another = page.getByRole("button", { name: "Open another skin" });
  const leaveAsk = page.locator("dialog.modal.confirm");
  const reopenBronze = async () => {
    await page.getByRole("button", { name: /Built-in: Bronze/ }).click();
    await page.waitForSelector(".skin-nav");
    await settle(400);
  };
  await another.click();
  check(await until(async () => (await page.getByRole("button", { name: /Built-in: Bronze/ }).count()) > 0), "Open another skin with no changes goes straight to the start");
  check((await leaveAsk.count()) === 0, "and asks nothing");
  await reopenBronze();
  await page.locator("header").getByRole("button", { name: /Export skin/ }).click();
  await page.getByLabel("Skin name").fill("bronze_edit");
  await page.keyboard.press("Escape");
  await page.locator("dialog.modal").waitFor({ state: "detached", timeout: 5000 });
  await another.click();
  check(await until(async () => (await leaveAsk.count()) === 1), "with a change, Open another skin asks first");
  check(((await leaveAsk.locator("h2").textContent()) ?? "") === "Discard your changes to bronze_edit?", "naming the skin");
  await leaveAsk.getByRole("button", { name: "Cancel" }).click();
  await leaveAsk.waitFor({ state: "detached", timeout: 5000 });
  check((await page.locator(".skin-nav").count()) === 1 && (await page.getByLabel("Skin name").count()) === 0, "Cancel keeps the skin open");
  // saving the project counts: no question after it
  await page.locator("header").getByRole("button", { name: /Export skin/ }).click();
  await page.locator(".modal .tabs button", { hasText: "Project" }).click();
  const savedSkin = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download bronze_edit\.nuiskin\.json/ }).click();
  await savedSkin;
  await page.keyboard.press("Escape");
  await page.locator("dialog.modal").waitFor({ state: "detached", timeout: 5000 });
  await another.click();
  check(await until(async () => (await page.getByRole("button", { name: /Built-in: Bronze/ }).count()) > 0) && (await leaveAsk.count()) === 0, "after saving the project it leaves without asking");
  await reopenBronze();
  await page.locator("header").getByRole("button", { name: /Export skin/ }).click();
  await page.getByLabel("Skin name").fill("bronze_gone");
  await page.keyboard.press("Escape");
  await page.locator("dialog.modal").waitFor({ state: "detached", timeout: 5000 });
  await another.click();
  await leaveAsk.getByRole("button", { name: "Discard" }).click();
  check(await until(async () => (await page.getByRole("button", { name: /Built-in: Bronze/ }).count()) > 0), "Discard goes back to the start");
  await reopenBronze();
  await skinSelect.selectOption("ink");
  check(
    await until(async () => /draws with the built-in Ink and brass, not this skin/.test((await page.getByTestId("window-skin").textContent()) ?? "")),
    "after choosing Ink and brass in the toolbar, the skin editor says the window editor no longer draws with it",
  );
  await skinSelect.selectOption("edited");
  await settle(600);
  await atWidths("skin");
  await page.getByRole("group", { name: "Editor" }).getByRole("button", { name: "Window" }).click();
  await settle(300);

  // --- the autosave -------------------------------------------------------------------------------------------
  await settle(1200);
  await page.reload();
  await page.waitForSelector(".start");
  const cont = page.locator(".card.restore");
  check(await cont.isVisible(), "after a reload the start screen offers the autosave");
  await cont.click();
  await canvasReady();
  check((await docName()) === name, "continuing restores the last window");
  check((await page.getByLabel("Grid step").inputValue()) === "8", "the grid step chosen is remembered");

  // --- the settings file names an install: the dialog shows it, a bad path is refused, a window opens from the list
  const install = mini ?? writeFakeInstall(join(tmp, "fake-nwn"));
  writeFileSync(iniPath, `; the e2e's settings\ngame = ${install}\nwindows = ${winDir}\n`);
  await page.reload();
  await page.waitForSelector(".start");
  await page.locator("header").getByRole("button", { name: "Game and haks" }).click();
  const status = page.getByTestId("game-status");
  check(await until(async () => ((await status.textContent()) ?? "").includes(install)), "the dialog shows the install nui-designer.ini names");
  check((await page.locator("#res-game").inputValue()) === install, "the install select has it chosen");
  await page.screenshot({ path: join(out, "06-settings.png") });
  await page.locator("#res-game").selectOption({ label: "Custom path…" });
  await page.locator("#res-game-path").fill(join(tmp, "no-such-game"));
  await page.getByRole("button", { name: "Save to nui-designer.ini" }).click();
  check(await until(async () => (await page.locator("dialog .finding.error", { hasText: "no such folder" }).count()) > 0), "a custom path that is not an install is refused with a message");
  check(readFileSync(iniPath, "utf8").includes(`game = ${install}`), "a refused path is not written");
  await page.getByRole("button", { name: "Undo changes" }).click();
  await page.keyboard.press("Escape");
  await page.locator("dialog.modal").waitFor({ state: "detached", timeout: 5000 });
  await page.locator(".window-files .chip-btn", { hasText: "widgets" }).click();
  await canvasReady();
  check((await docName()) === "widgets", "a window from the start screen's list opens");

  // --- the window switcher: the windows folder, Recent, the question before unsaved changes go, the search ----------
  const switcher = page.getByRole("dialog", { name: "Switch window" });
  const nameBtn = page.locator(".doc-switch");
  const swItem = (text: string | RegExp) => switcher.locator("section[aria-label='Windows folder'] .sw-item", { hasText: text });
  await nameBtn.click();
  check(await switcher.locator("section[aria-label='Windows folder'] .sw-item").first().waitFor({ timeout: 5000 }).then(() => true, () => false), "the switcher lists the windows folder");
  const folderRows = await switcher.locator("section[aria-label='Windows folder'] .sw-item .sw-n").allTextContents();
  check(folderRows.join(",") === "binds,drawlist,drawlist-client,layout,options-window,problems,unsolvable,widgets", `sorted by name (${folderRows.join(",")})`);
  check((await swItem(/^widgets/).getAttribute("aria-current")) === "true", "the open window is marked in its folder");
  check(((await swItem(/^layout/).locator(".sw-t").textContent()) ?? "") === "Layout", "with each window's title");
  check(/This folder/.test((await switcher.locator("section[aria-label='Windows folder'] .sw-head").textContent()) ?? ""), "the folder of the open window is called This folder");
  check((await switcher.locator("section[aria-label='Recent windows'] .sw-item").count()) > 0, "windows opened before are under Recent");
  check(await page.getByLabel("Search windows").evaluate((e) => e === document.activeElement), "a long list has a search box, and it has focus");
  await page.keyboard.press("ArrowDown");
  check(await switcher.locator(".sw-item").first().evaluate((e) => e === document.activeElement), "ArrowDown walks from the search box to the first window");
  await page.keyboard.press("Delete");
  check((await docName()) === "widgets" && (await treeRows().count()) > 1, "Delete in the switcher deletes nothing in the window");
  await page.getByLabel("Search windows").focus();
  await page.screenshot({ path: join(out, "07-switcher.png") });
  const box = await switcher.boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 1600 && box.y >= 30, "the switcher opens under the name, inside the page");
  await page.keyboard.press("Escape");
  check(await switcher.waitFor({ state: "detached", timeout: 3000 }).then(() => true, () => false), "Escape closes it");
  check(await nameBtn.evaluate((e) => e === document.activeElement), "and gives focus back to the name");
  // A window with no changes: switched to with no question.
  await nameBtn.click();
  await swItem(/^layout/).click();
  check(await until(async () => (await docName()) === "layout"), "picking a window opens it");
  check((await page.locator("dialog.modal.confirm").count()) === 0, "a window with no changes is left without a question");
  // Rename (in the switcher), then switching asks; Cancel keeps it, the action opens the other one.
  await nameBtn.click();
  await page.getByLabel("Window name").fill("layout two");
  check((await docName()) === "layout two", "the window is renamed in the switcher");
  await swItem(/^problems/).click();
  const ask = page.locator("dialog.modal.confirm");
  check(await ask.waitFor({ timeout: 3000 }).then(() => true, () => false), "with unsaved changes, switching asks first (the app's dialog)");
  await ask.getByRole("button", { name: "Cancel" }).click();
  check((await docName()) === "layout two", "Cancel keeps the window");
  await nameBtn.click();
  await swItem(/^problems/).click();
  await ask.getByRole("button", { name: "Open problems" }).click();
  check(await until(async () => (await docName()) === "problems"), "the dialog's Open opens the other window");
  // The search: every word, name or title; Enter opens the first match.
  await nameBtn.click();
  await page.getByLabel("Search windows").fill("unsolv");
  await settle(150);
  const shown = await switcher.locator(".sw-item .sw-n").allTextContents();
  check(shown.length > 0 && shown.every((n) => n === "unsolvable"), `the search narrows the list (${shown.join(",")})`);
  await page.keyboard.press("Enter");
  check(await until(async () => (await docName()) === "unsolvable"), "Enter opens the first match");
  // Recent reopens a window from where it came from (problems: the windows folder).
  await nameBtn.click();
  await switcher.locator("section[aria-label='Recent windows'] .sw-item", { hasText: /^problems/ }).first().click();
  check(await until(async () => (await docName()) === "problems"), "a recent window opens again");
  // New window and Open… are at the bottom.
  await nameBtn.click();
  check(await switcher.getByRole("button", { name: /Open…/ }).isVisible(), "Open… is in the switcher");
  await switcher.getByRole("button", { name: /New window/ }).click();
  check(await until(async () => (await docName()) === "untitled"), "New window from the switcher starts one");
  // New window asks too when there are unsaved changes (the app's dialog, not the browser's).
  await page.locator(".tile[data-type=label]").click();
  await page.keyboard.press("Alt+n");
  check(await ask.waitFor({ timeout: 3000 }).then(() => true, () => false), "New window asks first when there are unsaved changes");
  await ask.getByRole("button", { name: "Start a new one" }).click();
  await settle(300);
  check((await treeRows().count()) === 1, "and starts a new one");

  // --- without the local API (a static build): the browser's pickers, and what "upload" means ---------------------
  server.api = false;
  await page.reload();
  await page.locator("header").getByRole("button", { name: "Game and haks" }).click();
  check(await page.getByRole("button", { name: /Pick NWN folder/ }).waitFor({ timeout: 5000 }).then(() => true, () => false), "without the local API the dialog offers the folder picker");
  check(await page.getByText("Nothing leaves this computer").isVisible(), "and says the browser's upload wording means nothing leaves the computer");
  await page.keyboard.press("Escape");
  await page.locator("dialog.modal").waitFor({ state: "detached", timeout: 5000 });
  // The switcher without the local API: Recent and Open… only, no folder, no error.
  await page.locator(".card.restore").click();
  await canvasReady();
  await nameBtn.click();
  await switcher.waitFor({ timeout: 3000 });
  check((await switcher.locator("section[aria-label='Windows folder']").count()) === 0 && (await switcher.getByText(/Set a windows folder/).count()) === 0, "without the local API the switcher lists no folder");
  check((await switcher.locator("section[aria-label='Recent windows'] .sw-item").count()) > 0, "but the recent windows");
  await switcher.locator("section[aria-label='Recent windows'] .sw-item", { hasText: /^widgets/ }).filter({ has: page.locator(".sw-tag", { hasText: "copy" }) }).first().click();
  check(await until(async () => (await docName()) === "widgets"), "and a kept copy opens without it");

  check(errors.length === 0, `no errors in the page${errors.length ? `: ${errors.join(" | ")}` : ""}`);
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
if (failures.length) process.exitCode = 1;
