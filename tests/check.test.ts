// pnpm check (src/node/check.ts) and the problem list it shares with the editor (src/core/edit/lint.ts). Runs on the
// fixtures with the built-in skin: no game, no haks.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as N from "../src/core/model/nui.js";
import type { JsonObject } from "../src/core/model/types.js";
import { describeElem, windowFindings, windowIssues } from "../src/core/edit/lint.js";
import { LAYONARA } from "../src/core/edit/styles/layonara.js";
import { pathIndex } from "../src/core/edit/tree.js";
import type { Problem } from "../src/core/render/render.js";
import { UsageError, fails, githubAnnotations, main, windowFiles } from "../src/node/check.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures");
const saved: Record<string, string | undefined> = {};
let dir: string;

beforeAll(() => {
  // No game, no haks, whatever this machine has configured.
  for (const k of ["NWN_ROOT", "NWN_HAK_DIR", "NWN_MODULE_IFO", "NUI_DESIGNER_INI", "GITHUB_STEP_SUMMARY"]) saved[k] = process.env[k];
  delete process.env.NWN_ROOT;
  delete process.env.NWN_HAK_DIR;
  delete process.env.NWN_MODULE_IFO;
  delete process.env.GITHUB_STEP_SUMMARY;
  process.env.NUI_DESIGNER_INI = "/dev/null";
  dir = mkdtempSync(join(tmpdir(), "nuid-check-"));
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

/** Runs pnpm check's main with the arguments; returns the exit code and what it printed. */
async function run(...args: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, (s) => out.push(s), (s) => err.push(s));
  return { code, out, err };
}

const fine = (): JsonObject => N.NuiWindow(N.NuiCol([N.NuiHeight(N.NuiRow([N.NuiWidth(N.NuiLabel("Hello", 0, 0), 120)]), 36)]), "T", N.NuiRect(-1, -1, 300, 200), false);

describe("the problem list (core/edit/lint.ts)", () => {
  it("puts the layout's problems and the findings in one list, worst first, each element named as the panel names it", () => {
    const win = N.NuiWindow(N.NuiCol([N.NuiId(N.NuiButton("Go"), "go"), N.NuiLabel("Gold", 0, 0)]), "T", N.NuiRect(-1, -1, 300, 200), true);
    const root = win.root as JsonObject;
    const button = (root.children as JsonObject[])[0]!;
    const problems: Problem[] = [{ path: "/col/button", kind: "clipped text", text: "x", rect: [0, 0, 1, 1], elem: button }, { path: "/col", kind: "unsolvable size", text: "y", rect: [0, 0, 1, 1] }];
    const findings = windowFindings({ win, binds: {}, name: "t", style: LAYONARA });
    const issues = windowIssues(win, {}, problems, pathIndex(win), findings);
    expect(issues[0]).toMatchObject({ severity: "error", source: "layout", kind: "unsolvable size", where: "/col", path: null });
    expect(issues.find((i) => i.kind === "clipped text")).toMatchObject({ severity: "warning", where: "Button #go", path: [0] });
    expect(issues.some((i) => i.source === "style:layonara" && i.kind === "Fixed size")).toBe(true);
    expect(describeElem(win, [1])).toBe("Label “Gold”");
    expect(describeElem(win, null)).toBe("window");
    // Not drawn yet: only the findings.
    expect(windowIssues(win, {}, null, new Map(), findings).every((i) => i.source !== "layout")).toBe(true);
  });

  it("takes the style's window keys and turned-off rules", () => {
    const win = { ...N.NuiWindow(N.NuiCol([]), "T", N.NuiRect(-1, -1, 300, 200), true), user_data: {} };
    expect(windowFindings({ win, binds: {}, name: "t" }).some((f) => f.kind === "unknown key")).toBe(true);
    expect(windowFindings({ win, binds: {}, name: "t", style: LAYONARA }).some((f) => f.kind === "unknown key")).toBe(false);
    expect(windowFindings({ win, binds: {}, name: "t", style: LAYONARA, disabledRules: new Set(["fixed-size"]) }).some((f) => f.kind === "Fixed size")).toBe(false);
  });
});

// Its own timeout: every test runs the whole command, which opens the skin anew and draws each window with it.
describe("pnpm check", { timeout: 30_000 }, () => {
  it("finds windows in folders, sorted, .jui and .json only", () => {
    writeFileSync(join(dir, "notes.txt"), "x");
    writeFileSync(join(dir, "b.json"), JSON.stringify(fine()));
    writeFileSync(join(dir, "a.jui"), JSON.stringify(fine()));
    expect(windowFiles([dir]).map((f) => f.slice(dir.length + 1))).toEqual(["a.jui", "b.json"]);
    expect(() => windowFiles([join(dir, "nope")])).toThrow(UsageError);
  });

  it("takes paths from the folder pnpm was started in (INIT_CWD), as pnpm -C DIR check does", async () => {
    const was = process.env.INIT_CWD;
    process.env.INIT_CWD = FIX;
    try {
      const r = await run("--fallback", "layout.jui");
      expect(r.out.join("\n")).toMatch(/^layout\.jui: /m);
    } finally {
      if (was === undefined) delete process.env.INIT_CWD;
      else process.env.INIT_CWD = was;
    }
  });

  it("says what it used, and which checks the built-in skin makes approximate", async () => {
    const r = await run("--fallback", join(dir, "a.jui"));
    expect(r.code).toBe(0);
    expect(r.out[0]).toMatch(/^game: none \(--fallback\): the built-in skin draws/);
    expect(r.out[0]).toMatch(/clipped text.*approximate/);
    expect(r.out).toContain("haks: none");
    expect(r.out).toContain("style: none (--style to choose one)");
    expect(r.out.join("\n")).toMatch(/a\.jui: no problems found/);
  });

  it("exits 1 only for findings at or above --fail-on", async () => {
    // problems.jui has warnings and no errors; unsolvable.jui has an error.
    const p = join(FIX, "problems.jui");
    expect((await run("--fallback", p)).code).toBe(0);
    expect((await run("--fallback", "--fail-on", "warning", p)).code).toBe(1);
    expect((await run("--fallback", join(FIX, "unsolvable.jui"))).code).toBe(1);
    expect(fails([{ severity: "info" }], "warning")).toBe(false);
    expect(fails([{ severity: "info" }], "info")).toBe(true);
  });

  it("fails a combo with a tooltip, whatever the style, and says to put the tooltip on its label", async () => {
    const f = join(dir, "combo-tip.jui");
    const combo = N.NuiTooltip(N.NuiId(N.NuiCombo([N.NuiComboEntry("One", 0), N.NuiComboEntry("Two", 1)], 0), "pick"), "Choose one");
    writeFileSync(f, JSON.stringify(N.NuiWindow(N.NuiCol([N.NuiHeight(N.NuiRow([N.NuiWidth(N.NuiLabel("Pick", 0, 0), 80), combo]), 36)]), "T", N.NuiRect(-1, -1, 300, 200), false)));
    const r = await run("--fallback", f);
    expect(r.code).toBe(1);
    expect(r.out.join("\n")).toMatch(/combo tooltip \(client\): Combo box #pick: .*on the combo's label instead/);
  });

  it("lists what the editor's Problems panel lists, grouped the same way", async () => {
    const r = await run("--fallback", "--style", "layonara", join(FIX, "widgets.jui"));
    const text = r.out.join("\n");
    expect(text).toMatch(/widgets\.jui: 0 errors, \d+ warnings, \d+ notes/);
    expect(text).toMatch(/missing image \(layout\), \d+ places/);
    expect(text).toMatch(/At most 1000 x 720 \(style layonara\): window:/);
  });

  it("reports the options window's overflow and both scrollbars (docs/CLIENT-BEHAVIOUR.md#default-sizes)", async () => {
    // Layonara's options window: options given 284 wide, its two entries 150 + 4 each.
    const r = await run("--fallback", "--fail-on", "warning", join(FIX, "options-window.jui"));
    const text = r.out.join("\n");
    expect(r.code).toBe(1);
    expect(text).toMatch(/overflow \(layout\): Options #op_theme: its 2 entries are 308 wide .* it has 284/);
    expect(text).toMatch(/the content is 412 wide, the window has 392: the client shows a horizontal scrollbar/);
    expect(text).toMatch(/the content is 72 high, the horizontal scrollbar leaves 54 of 72: the client shows a vertical scrollbar/);
    // The same window as first reported: a Theme label and the options, then a Close with no size of its own.
    const plain = N.NuiWindow(
      N.NuiWidth(N.NuiHeight(N.NuiCol([N.NuiRow([N.NuiLabel("Theme", 1, 0), N.NuiOptions(0, ["Ink and brass", "Classic"], 0)]), N.NuiButton("Close")]), 72), 392),
      "Options",
      N.NuiRect(-1, -1, 408, 121),
      false,
    );
    const f = join(dir, "options-plain.jui");
    writeFileSync(f, JSON.stringify(plain));
    const t = (await run("--fallback", f)).out.join("\n");
    expect(t).toMatch(/the content is 97 high, the window has 72: the client shows a vertical scrollbar/);
  });

  it("writes JSON with what it used, the counts and every issue", async () => {
    const r = await run("--fallback", "--format", "json", "--style", "layonara", join(FIX, "unsolvable.jui"));
    const j = JSON.parse(r.out.join("\n"));
    expect(j.failed).toBe(true);
    expect(j.used).toMatchObject({ game: null, style: "layonara", haks: [] });
    expect(j.windows[0].counts.error).toBe(1);
    expect(j.windows[0].issues[0]).toMatchObject({ severity: "error", kind: "unsolvable size", source: "layout" });
    // The notes about what it used go to stderr, so stdout stays JSON.
    expect(r.err.some((l) => l.startsWith("game: none"))).toBe(true);
  });

  it("writes GitHub annotations on the window's file, escaped, and a summary", async () => {
    const summary = join(dir, "summary.md");
    process.env.GITHUB_STEP_SUMMARY = summary;
    try {
      const r = await run("--fallback", "--format", "github", "--fail-on", "warning", join(FIX, "problems.jui"));
      expect(r.code).toBe(1);
      expect(r.out[0]).toMatch(/^::notice title=NUI check::game: none/);
      const ann = r.out.filter((l) => /^::(error|warning|notice) file=/.test(l));
      expect(ann.length).toBeGreaterThan(3);
      expect(ann.every((l) => /file=fixtures\/problems\.jui,title=problems%3A /.test(l))).toBe(true);
      expect(r.out.at(-1)).toMatch(/Failed: something at warning level or above/);
      const { readFileSync } = await import("node:fs");
      expect(readFileSync(summary, "utf8")).toMatch(/### NUI check: failed[\s\S]*\| `fixtures\/problems\.jui` \| 0 \| \d+ \|/);
    } finally {
      delete process.env.GITHUB_STEP_SUMMARY;
    }
    const lines = githubAnnotations({ file: "a,b:c.json", name: "w", issues: [{ severity: "warning", source: "client", kind: "k", text: "50%\nnext", path: null, where: "window" }] });
    expect(lines).toEqual(["::warning file=a%2Cb%3Ac.json,title=w%3A k (client)::window: 50%25%0Anext"]);
  });

  it("reports a file that is not a window as an error of that file, and refuses bad options", async () => {
    writeFileSync(join(dir, "broken.json"), "{ not json");
    const r = await run("--fallback", join(dir, "broken.json"));
    expect(r.code).toBe(1);
    expect(r.out.join("\n")).toMatch(/broken\.json: 1 error[\s\S]*not a window \(input\): file: cannot check it/);
    await expect(run("--format", "xml", join(dir, "a.jui"))).rejects.toThrow(/--format xml/);
    await expect(run("--fail-on", "fatal", join(dir, "a.jui"))).rejects.toThrow(/--fail-on fatal/);
    await expect(run("--style", "nope", join(dir, "a.jui"))).rejects.toThrow(/--style nope/);
    await expect(run("--style", "layonara", "--disable-rule", "nope", join(dir, "a.jui"))).rejects.toThrow(/no such rule/);
    expect((await run()).code).toBe(2);
  });
});
