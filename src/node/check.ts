/**
 * Checks NUI windows from the command line: for each window, exactly what the editor's Problems panel lists
 * (core/edit/lint.ts: the client checks, the layout's problems, and the house style when one is chosen), for CI.
 *
 *   pnpm check [--style ID|FILE] [--mobile] [--client CLIENT] [--fail-on warning|error] [--format text|json|github] FILE_OR_FOLDER...
 *
 * Inputs: window files (.jui, window JSON, a nui-preview dump, a project); a folder is searched (with its subfolders)
 * for .jui and .json files. Paths are taken from the folder pnpm was started in (`pnpm -C DIR check` too).
 *
 * Options:
 *   --style ID|FILE       a house style: a built-in one (layonara), a style file's id from nui-designer.ini's
 *                         `styles` (or $NUI_DESIGNER_STYLES), or a style file's path; default none, as in the editor
 *   --disable-rule ID     turn one of its rules off, or one of the mobile rules (repeat)
 *   --mobile              also run the mobile checks: what breaks on the iOS and Android clients (docs/MOBILE.md)
 *   --client CLIENT       lay the windows out as desktop (default), ios2, ios3 (iOS at density 2 or 3) or android, as
 *                         the editor's Client preview does; any but desktop turns --mobile on
 *   --ui-scale S          the GUI scale for --client (default 1)
 *   --fail-on LEVEL       exit 1 when anything at or above LEVEL is found: error (default), warning or info
 *   --format FORMAT       text (default), json (one JSON object on stdout) or github (GitHub Actions annotations
 *                         and a summary, also written to $GITHUB_STEP_SUMMARY when set)
 *   --canvas WxH          the screen the window is laid out on (default 1440x900, as the editor)
 *   --text-model MODEL    nuklear (default, as the client) or nui-preview
 *   --game DIR, --hak FILE, --hak-dir DIR --module-ifo FILE, --override DIR, --fallback, --theme ink|bronze|brass|verdigris|oxblood:
 *                         the resources, as for pnpm render (default: $NWN_ROOT, NWN_HAK_DIR and NWN_MODULE_IFO, else
 *                         nui-designer.ini). Without a game, the built-in skin: the checks that measure text with the
 *                         game's fonts or look for the game's textures are then approximate, and it says which.
 *
 * Exits 0 when nothing at or above --fail-on was found, 1 when something was, 2 on a bad option or no input.
 * A window file that cannot be read or is not a window is reported as an error of that file.
 */
import { appendFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { groupIssues } from "../core/edit/issues.js";
import { SEVERITY_RANK, type WindowIssue, windowFindings, windowIssues } from "../core/edit/lint.js";
import { openText, toNuiDocument } from "../core/edit/project.js";
import type { StyleRuleSet } from "../core/edit/style.js";
import { pathIndex } from "../core/edit/tree.js";
import type { Severity } from "../core/edit/validate.js";
import { THEMES } from "../core/skin/themes.js";
import { DEFAULT_CANVAS, renderView } from "../core/view.js";
import { errorText } from "../core/errors.js";
import { HakOrderError } from "./hakorder.js";
import { checkReadable, nodeCanvas } from "./fs.js";
import { type CliResourcesUsed, cliResources } from "./setup.js";
import { resolveStyle } from "./styles.js";
import { CLIENT_KINDS, type ClientKind, clientProfile } from "../core/mobile/client.js";
import { MOBILE_RULES, imageRiskOf } from "../core/mobile/lint.js";

/** Stops with a one-line message (no stack trace) and exit code 2. */
export class UsageError extends Error {}

export type Format = "text" | "json" | "github";

export interface WindowReport {
  file: string;
  name: string;
  issues: WindowIssue[];
}

/** The layout problems that depend on the game's fonts and textures, and what the built-in skin makes of them. */
export const NEEDS_GAME =
  "clipped text, clipped content, overflow, empty, tooltip off screen and combo list off screen are measured with the built-in skin's fonts, not the game's, so they are approximate; " +
  "missing image is reported for every texture the game or the haks would have; unknown font is checked against the built-in skin's fonts. " +
  "The other client checks, unsolvable sizes and the style rules do not depend on the game.";

/** Window files under a folder (subfolders too), sorted; a file is taken as it is. */
export function windowFiles(inputs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jui|json)$/i.test(e.name)) out.push(p);
    }
  };
  for (const i of inputs) {
    let st;
    try {
      st = statSync(i);
    } catch {
      throw new UsageError(`${i}: no such file or folder`);
    }
    if (st.isDirectory()) walk(i);
    else out.push(i);
  }
  return out;
}

/** The number of issues of each severity. */
export function counts(issues: readonly { severity: Severity }[]): Record<Severity, number> {
  const c: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const i of issues) c[i.severity]++;
  return c;
}

/** Whether any issue is at or above the level. */
export function fails(issues: readonly { severity: Severity }[], failOn: Severity): boolean {
  return issues.some((i) => SEVERITY_RANK[i.severity] <= SEVERITY_RANK[failOn]);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function countText(c: Record<Severity, number>): string {
  return [plural(c.error, "error"), plural(c.warning, "warning"), plural(c.info, "note")].join(", ");
}

/** "Button #ok", or "Label “Gold”, Label “Silver” and 3 more" for a group. */
function whereList(items: readonly WindowIssue[], max = 6): string {
  const w = items.map((i) => i.where);
  return w.length <= max ? w.join(", ") : `${w.slice(0, max).join(", ")} and ${w.length - max} more`;
}

function sourceText(source: string): string {
  return source.startsWith("style:") ? `style ${source.slice(6)}` : source;
}

/** The text report of one window: its counts, then one line per row of the Problems panel (identical notes grouped). */
export function textReport(r: WindowReport): string[] {
  const c = counts(r.issues);
  if (!r.issues.length) return [`${r.file}: no problems found`];
  const out = [`${r.file}: ${countText(c)}`];
  for (const g of groupIssues(r.issues)) {
    const first = g.items[0]!;
    const head = `  ${first.severity.padEnd(7)} ${first.kind} (${sourceText(first.source)})`;
    if (g.items.length === 1) out.push(`${head}: ${first.where}: ${first.text}`);
    else out.push(`${head}, ${g.items.length} places: ${first.text}`, `          in ${whereList(g.items)}`);
  }
  return out;
}

/** GitHub's workflow-command escaping: the message, and a property (which also escapes : and ,). */
const escData = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s: string) => escData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

const COMMAND: Record<Severity, string> = { error: "error", warning: "warning", info: "notice" };

/** One annotation per row of the Problems panel, on the window's file. */
export function githubAnnotations(r: WindowReport): string[] {
  return groupIssues(r.issues).map((g) => {
    const first = g.items[0]!;
    const title = `${r.name}: ${first.kind} (${sourceText(first.source)})`;
    const msg = g.items.length === 1 ? `${first.where}: ${first.text}` : `${first.text}\n${g.items.length} places: ${whereList(g.items, 12)}`;
    return `::${COMMAND[first.severity]} file=${escProp(r.file)},title=${escProp(title)}::${escData(msg)}`;
  });
}

/** A Markdown summary: one row per window with problems, then the totals. */
export function markdownSummary(reports: readonly WindowReport[], failOn: Severity, usedText: string[]): string {
  const all = reports.flatMap((r) => r.issues);
  const c = counts(all);
  const lines = [`### NUI check: ${fails(all, failOn) ? "failed" : "passed"}`, "", `${plural(reports.length, "window")} checked: ${countText(c)} (fails on ${failOn} and above).`, ""];
  const bad = reports.filter((r) => r.issues.length);
  if (bad.length) {
    lines.push("| Window | Errors | Warnings | Notes |", "|---|---:|---:|---:|");
    for (const r of bad) {
      const k = counts(r.issues);
      lines.push(`| \`${r.file}\` | ${k.error} | ${k.warning} | ${k.info} |`);
    }
    lines.push("");
  }
  lines.push(...usedText.map((u) => `- ${u}`));
  return lines.join("\n") + "\n";
}

/** What the run used, one line each. */
export function usedLines(used: CliResourcesUsed, skinFrom: string, style: string | null): string[] {
  const out: string[] = [];
  if (used.game) out.push(`game: ${used.game} (skin: ${skinFrom})`);
  else out.push(`game: none${used.noGame ? ` (${used.noGame})` : " (--fallback)"}: the built-in skin draws (${skinFrom}). ${NEEDS_GAME}`);
  if (used.haks.length) out.push(`haks: ${used.haks.length} from ${used.haksFrom}${used.missing.length ? ` (missing from the folder: ${used.missing.join(", ")})` : ""}`);
  else out.push(`haks: none${used.missing.length ? ` (none of ${used.missing.length} listed were in ${used.hakDir})` : ""}`);
  if (used.overrides.length) out.push(`override folders: ${used.overrides.join(", ")}`);
  out.push(`style: ${style ?? "none (--style to choose one)"}`);
  return out;
}

function parseCanvas(s: string): [number, number] {
  const m = /^(\d+)x(\d+)$/i.exec(s.trim());
  if (!m || !Number(m[1]) || !Number(m[2])) throw new UsageError(`--canvas ${s}: expected WIDTHxHEIGHT, e.g. 1440x900`);
  return [Number(m[1]), Number(m[2])];
}

function canRead(file: string): void {
  try {
    checkReadable(file);
  } catch (e) {
    throw new UsageError(`${file}: ${e instanceof Error && "code" in e && e.code === "ENOENT" ? "no such file" : "cannot read it"}`);
  }
}

function usage(): string {
  return readFileSync(new URL(import.meta.url)).toString().split("*/")[0]!.replace(/^\/\*\*?|^ \* ?/gm, "");
}

/** Runs the check; returns the exit code. Output goes through out (stdout) and err (stderr). */
export async function main(argv: string[], out: (s: string) => void = console.log, err: (s: string) => void = console.error): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      style: { type: "string" },
      "disable-rule": { type: "string", multiple: true },
      mobile: { type: "boolean" },
      client: { type: "string", default: "desktop" },
      "ui-scale": { type: "string", default: "1" },
      "fail-on": { type: "string", default: "error" },
      format: { type: "string", default: "text" },
      canvas: { type: "string", default: `${DEFAULT_CANVAS[0]}x${DEFAULT_CANVAS[1]}` },
      "text-model": { type: "string", default: "nuklear" },
      game: { type: "string" },
      hak: { type: "string", multiple: true },
      "hak-dir": { type: "string" },
      "module-ifo": { type: "string" },
      override: { type: "string", multiple: true },
      fallback: { type: "boolean" },
      theme: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    out(usage());
    return 0;
  }
  if (!positionals.length) {
    err(usage());
    return 2;
  }
  const format = values.format as Format;
  if (!["text", "json", "github"].includes(format)) throw new UsageError(`--format ${values.format}: expected text, json or github`);
  const failOn = values["fail-on"] as Severity;
  if (!(failOn in SEVERITY_RANK)) throw new UsageError(`--fail-on ${failOn}: expected error, warning or info`);
  // pnpm runs a script in the package's folder: paths are the caller's (INIT_CWD, which pnpm sets), as typed.
  const base = process.env.INIT_CWD ?? process.cwd();
  let style: StyleRuleSet | null = null;
  if (values.style !== undefined && values.style !== "none") {
    try {
      style = await resolveStyle(values.style, base);
    } catch (e) {
      throw new UsageError(e instanceof Error ? e.message : String(e));
    }
  }
  const clientKind = values.client as ClientKind;
  if (!CLIENT_KINDS.some((c) => c.kind === clientKind)) throw new UsageError(`--client ${values.client}: expected ${CLIENT_KINDS.map((c) => c.kind).join(", ")}`);
  const uiScale = Number(values["ui-scale"]);
  if (!(uiScale > 0)) throw new UsageError(`--ui-scale ${values["ui-scale"]}: expected a number above 0`);
  const client = clientKind === "desktop" ? null : clientProfile(clientKind, uiScale);
  const mobile = !!values.mobile || !!client;
  const disabled = new Set(values["disable-rule"] ?? []);
  for (const d of disabled) {
    if (mobile && MOBILE_RULES.rules.some((r) => r.id === d)) continue;
    if (!style) throw new UsageError(`--disable-rule ${d}: no --style chosen${mobile ? ` and no mobile rule of that id (${MOBILE_RULES.rules.map((r) => r.id).join(", ")})` : ""}`);
    if (!style.rules.some((r) => r.id === d)) throw new UsageError(`--disable-rule ${d}: ${style.id} has no such rule (${style.rules.map((r) => r.id).join(", ")})`);
  }
  const [cw, ch] = parseCanvas(values.canvas!);
  const textModel = values["text-model"];
  if (textModel !== "nuklear" && textModel !== "nui-preview") throw new UsageError(`--text-model ${textModel}: expected nuklear or nui-preview`);
  if (values.theme !== undefined && !THEMES.some((t) => t.id === values.theme)) throw new UsageError(`--theme ${values.theme}: expected ${THEMES.map((t) => t.id).join(", ")}`);
  if (!!values["hak-dir"] !== !!values["module-ifo"]) throw new UsageError("--hak-dir and --module-ifo go together");
  const at = (p: string | undefined) => (p === undefined ? undefined : resolve(base, p));
  const moduleIfo = at(values["module-ifo"]);
  if (moduleIfo) canRead(moduleIfo);
  const files = windowFiles(positionals.map((p) => resolve(base, p)));
  if (!files.length) throw new UsageError(`no .jui or .json files in ${positionals.join(", ")}`);

  const { res, used } = await cliResources(
    { game: at(values.game), hak: values.hak?.map((h) => resolve(base, h)), hakDir: at(values["hak-dir"]), moduleIfo, override: values.override?.map((o) => resolve(base, o)), fallback: values.fallback, theme: values.theme, textModel },
    canRead,
  );
  const usedText = [...usedLines(used, res.skinFrom, style?.id ?? null), ...res.warnings.map((w) => `warning: ${w}`)];
  const fonts = res.skin.fontList.map((f) => f.name);
  const imageRisk = mobile && !res.usingFallback ? imageRiskOf(res.resman) : null;
  // Where the run's notes go: stderr for json (stdout is the JSON), stdout otherwise.
  const info = format === "json" ? err : out;
  for (const u of usedText) info(format === "github" && u.startsWith("game: none") ? `::notice title=NUI check::${escData(u)}` : u);
  if (format !== "json") info("");

  const reports: WindowReport[] = [];
  for (const file of files) {
    const shown = relative(base, file) || file;
    const name = basename(file).replace(/(\.nuidesign)?\.(json|jui)$/i, "");
    let report: WindowReport;
    try {
      const doc = openText(readFileSync(file, "utf8"), name).doc;
      const r = await renderView(toNuiDocument(doc), res.skin, res.images, nodeCanvas, { canvasW: cw, canvasH: ch, crop: true, client });
      const findings = windowFindings({ win: doc.window, binds: doc.binds, name: doc.name, fonts, style, disabledRules: disabled, outlines: r.outlines, mobile, imageRisk });
      report = { file: shown, name: doc.name, issues: windowIssues(doc.window, doc.binds, r.problems, pathIndex(doc.window), findings) };
    } catch (e) {
      report = { file: shown, name, issues: [{ severity: "error", source: "input", kind: "not a window", text: `cannot check it: ${errorText(e)}`, path: null, where: "file" }] };
    }
    reports.push(report);
    if (format === "text") for (const l of textReport(report)) out(l);
    if (format === "github") for (const l of githubAnnotations(report)) out(l);
  }

  const all = reports.flatMap((r) => r.issues);
  const failed = fails(all, failOn);
  if (format === "json") {
    out(JSON.stringify({ used: { ...used, skin: res.skinFrom, style: style?.id ?? null, warnings: res.warnings }, failOn, failed, counts: counts(all), windows: reports.map((r) => ({ ...r, counts: counts(r.issues) })) }, null, 1));
  } else {
    if (format === "github") {
      out("::group::Every window's problems");
      for (const r of reports) for (const l of textReport(r)) out(l);
      out("::endgroup::");
    }
    out("");
    out(`${plural(reports.length, "window")} checked: ${countText(counts(all))}. ${failed ? `Failed: something at ${failOn} level or above.` : `Passed (fails on ${failOn} and above).`}`);
    if (format === "github" && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownSummary(reports, failOn, usedText));
  }
  return failed ? 1 : 0;
}

if (process.argv[1]?.endsWith("check.ts")) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      const usageError = e instanceof UsageError || e instanceof HakOrderError || (e instanceof Error && "code" in e && String(e.code).startsWith("ERR_PARSE_ARGS"));
      console.error(`check: ${e instanceof Error ? (usageError ? e.message : (e.stack ?? e.message)) : String(e)}`);
      process.exit(2);
    },
  );
}
