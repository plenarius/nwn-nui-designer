/**
 * Smoke test of the packaged desktop app (not part of `pnpm test`): starts it with a fresh config folder, attaches over
 * the DevTools protocol, and checks that the editor draws, the local API answers through the app's origin (state,
 * a settings save into the config folder), and remote content is refused. Opens a sample and saves a screenshot.
 *
 *   pnpm app:dist && pnpm app:smoke [--app PATH] [--out FILE]
 *
 * PATH is the AppImage or the unpacked executable (default release/linux-unpacked/nwn-nui-designer). Linux needs a
 * display: xvfb-run in CI.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Browser, chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    app: { type: "string", default: join(ROOT, "release", "linux-unpacked", "nwn-nui-designer") },
    out: { type: "string", default: join(ROOT, ".golden-out", "app", "window.png") },
  },
});
const appPath = resolve(values.app!);
if (!existsSync(appPath)) throw new Error(`no app at ${appPath}: run pnpm app:dist first`);
const out = resolve(values.out!);
mkdirSync(dirname(out), { recursive: true });

const failures: string[] = [];
const check = (ok: unknown, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A config folder of the test's own (the app's settings file goes there), and a windows folder for the settings save.
const tmp = mkdtempSync(join(tmpdir(), "nuid-app-"));
const config = join(tmp, "config");
const winDir = join(tmp, "windows");
mkdirSync(winDir);
copyFileSync(join(ROOT, "fixtures", "widgets.jui"), join(winDir, "widgets.jui"));

const env: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: config, NUI_DESIGNER_NO_UPDATES: "1", APPIMAGE_EXTRACT_AND_RUN: "1", TMPDIR: tmp };
for (const k of ["NUI_DESIGNER_INI", "NWN_ROOT", "NWN_HAK_DIR", "NWN_MODULE_IFO", "NUI_DESIGNER_STYLES"]) delete env[k];
// No setuid sandbox helper in an AppImage or a CI container. Its own process group, so stopping it stops every process
// it started (the AppImage runtime, Electron's helpers).
const child: ChildProcess = spawn(appPath, ["--no-sandbox", "--remote-debugging-port=0"], { env, stdio: ["ignore", "ignore", "pipe"], detached: true });
const exited = new Promise<void>((ok) => child.once("exit", () => ok()));
const signal = (sig: NodeJS.Signals) => {
  try {
    process.kill(-child.pid!, sig);
  } catch {
    /* gone */
  }
};
// The AppImage runtime lists every file it extracts (into TMPDIR: the test's folder, removed at the end).
const NOISE = /^(File exists|\/.*\/appimage_extracted_)/;
let browser: Browser | null = null;

try {
  const ws = await new Promise<string>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("the app did not open DevTools in 60 s")), 60_000);
    let buf = "";
    child.stderr!.on("data", (c: Buffer) => {
      for (const line of c.toString().split("\n")) if (line && !NOISE.test(line)) process.stderr.write(`${line}\n`);
      buf += c.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        ok(m[1]!);
      }
    });
    void exited.then(() => fail(new Error(`the app exited (${child.exitCode})`)));
  });
  browser = await chromium.connectOverCDP(`http://${new URL(ws).host}`);
  const find = () => browser!.contexts()[0]?.pages().find((p) => p.url().startsWith("app://"));
  const deadline = Date.now() + 30_000;
  let page = find();
  while (!page && Date.now() < deadline) {
    await sleep(250);
    page = find();
  }
  if (!page) throw new Error("no app:// page");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  check(page.url().startsWith("app://nui-designer/"), `the window shows the editor (${page.url()})`);
  await page.locator("header.toolbar").waitFor({ timeout: 30_000 });
  check((await page.locator(".brand-name").textContent()) === "NUI Designer", "the editor's toolbar is drawn");

  const state = await page.evaluate(async () => (await fetch("./api/local/state")).json());
  check(state.version === 1, "the local API answers /api/local/state through the app's origin");
  check(typeof state.ini?.path === "string" && state.ini.path.startsWith(config), `the settings file is in the config folder (${state.ini?.path})`);

  const saved = await page.evaluate(
    async (windows) => (await fetch("./api/local/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ windows }) })).json(),
    winDir,
  );
  check(saved.saved === true && saved.state?.windows?.files?.some((f: { path: string }) => f.path === "widgets.jui"), "a settings save lists the windows folder");
  check(existsSync(state.ini.path) && readFileSync(state.ini.path, "utf8").includes(`windows = ${winDir}`), "the save wrote nui-designer.ini");

  const remote = await page.evaluate(async () => {
    try {
      await fetch("https://example.com/");
      return "loaded";
    } catch {
      return "refused";
    }
  });
  check(remote === "refused", "remote content is refused");

  // A sample on the canvas: the editor draws a window (with its own open skin: there is no game here).
  await page.getByRole("button", { name: "widgets", exact: true }).click();
  await page.locator("canvas").first().waitFor({ timeout: 30_000 });
  await sleep(1500);
  await page.screenshot({ path: out });
  console.log(`screenshot: ${out}`);
  check(errors.length === 0, `no errors in the page${errors.length ? `: ${errors.join("; ")}` : ""}`);
} catch (e) {
  failures.push(e instanceof Error ? e.message : String(e));
  console.log(`FAIL ${failures[failures.length - 1]}`);
} finally {
  await Promise.race([browser?.close().catch(() => {}), sleep(5_000)]);
  signal("SIGTERM");
  await Promise.race([exited, sleep(10_000)]);
  signal("SIGKILL");
  rmSync(tmp, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
console.log("app smoke: all passed");
process.exit(0);
