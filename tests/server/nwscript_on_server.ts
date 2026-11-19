/**
 * Proves the NWScript export on a real server: every fixture and local dump (and a window of every palette element)
 * is exported as NWScript, run by nwn-module's test server, and the JSON the game builds is compared with the
 * designer's .jui export of the same window.
 *
 *   pnpm nss:server --module <nwn-module checkout> [--keep]
 *
 * It writes its scripts into that checkout's tests/nss (nuid_*.nss and the test u_nuid_check.nss), runs
 * `tests/run.sh --filter '^u_nuid_check$'` (which builds the test module, boots the server in rootless Docker and
 * runs the one test), reads the windows back from the server log (run.sh joins the NUIDUMP lines into
 * tests/.run/nui/), compares, and removes its scripts again (unless --keep). Use a worktree of its own: never a
 * checkout another session works in. run.sh needs LAYONARA_HAK_DIR and LAYONARA_TLK (see nwn-module tests/README.md).
 *
 * Numbers are compared as NWScript floats (32-bit): JsonFloat(0.1) is 0.10000000149011612 in the game's JSON.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ELEMENTS, newWindow } from "../../src/core/edit/catalog.js";
import { writeJui } from "../../src/core/edit/jui.js";
import { jsonEqual, nwscriptOptions, writeNwscript } from "../../src/core/edit/nwscript.js";
import { addElement } from "../../src/core/edit/ops.js";
import { type EditorDoc, defaultExport } from "../../src/core/edit/project.js";
import { inputs, load } from "../roundtrip.js";

const { values } = parseArgs({ options: { module: { type: "string" }, keep: { type: "boolean", default: false }, "no-run": { type: "boolean", default: false } } });
if (!values.module) throw new Error("--module: an nwn-module checkout (a worktree of its own)");
const mod = resolve(values.module);
const nssDir = join(mod, "tests", "nss");
if (!existsSync(join(mod, "tests", "run.sh"))) throw new Error(`${mod} is not an nwn-module checkout`);

let palette: EditorDoc = { name: "palette", window: newWindow(), binds: {}, panes: {}, notes: "", export: defaultExport("palette") };
for (const spec of ELEMENTS) palette = addElement(palette, { parent: [], index: 999 }, spec.make()).doc;
const docs = [palette, ...inputs().map((x) => load(x.file, x.name))];

/** The scripts: one include and one runner per window, and the test that runs them one after another. */
const written: string[] = [];
const write = (name: string, text: string) => {
  writeFileSync(join(nssDir, name), text, "latin1");
  written.push(join(nssDir, name));
};
write(
  "nuid_dump.nss",
  `/// Writes a JSON dump to the server log in chunks, as u_nui_dump does: NUIDUMP <name> <i>/<n> <text>~
void NuidDump(string sName, json j)
{
    string sText = JsonDump(j);
    int nLength = GetStringLength(sText);
    int nChunks = (nLength + 899) / 900;
    int i;
    for (i = 0; i < nChunks; i++)
        WriteTimestampedLogEntry("NUIDUMP " + sName + " " + IntToString(i + 1) + "/" + IntToString(nChunks) + " " +
                                 GetSubString(sText, i * 900, 900) + "~");
}
`,
);
docs.forEach((d, i) => {
  const o = { ...nwscriptOptions(d, false), prefix: `Nuid${i}`, script: `nuid_i${i}`, windowId: `nuid${i}` };
  write(`nuid_i${i}.nss`, writeNwscript(d.window, o));
  write(`nuid_r${i}.nss`, `#include "nuid_dump"\n#include "nuid_i${i}"\n\nvoid main();\n\nvoid main()\n{\n    NuidDump("nuid${i}", Nuid${i}_Window());\n}\n`);
});
write(
  "u_nuid_check.nss",
  `/// nwn-nui-designer's check of its NWScript export (not a test: run it by name). Each window is built by its own
/// script run (nuid_r<i>), so no window shares another's instruction budget, and dumped to the log.
#include "inc_test"

void main();

void Build(int i)
{
    ExecuteScript("nuid_r" + IntToString(i), GetModule());
    if (i + 1 < ${docs.length})
        AssignCommand(Test_Context(), DelayCommand(0.1, Build(i + 1)));
    else
    {
        Assert(TRUE, "${docs.length} windows built");
        Test_Done();
    }
}

void main()
{
    Test_Async(300.0);
    AssignCommand(Test_Context(), DelayCommand(0.1, Build(0)));
}
`,
);
console.log(`${written.length} scripts written to ${nssDir}`);

const out = join(mod, "tests", ".run", "nui");
try {
  if (!values["no-run"]) {
    execFileSync(join(mod, "tests", "run.sh"), ["--filter", "^u_nuid_check$", "--no-retry"], { cwd: mod, stdio: "inherit", env: process.env });
  }
} catch (e) {
  console.error(`run.sh failed: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (!values.keep) for (const f of written) rmSync(f, { force: true });
}

// Compare.
let bad = 0;
const rows: string[] = [];
docs.forEach((d, i) => {
  const f = join(out, `nuid${i}.json`);
  if (!existsSync(f)) {
    bad++;
    rows.push(`| ${d.name} | not dumped |`);
    return;
  }
  const game = JSON.parse(readFileSync(f, "utf8"));
  const jui = JSON.parse(writeJui(d.window));
  const same = jsonEqual(game, jui, true);
  if (!same) bad++;
  rows.push(`| ${d.name} | ${same ? "identical" : "DIFFERENT"} |`);
});
console.log(["| window | the game's JSON vs the .jui |", "|---|---|", ...rows].join("\n"));
console.log(`${docs.length - bad} of ${docs.length} identical${existsSync(out) ? ` (dumps in ${out}: ${readdirSync(out).filter((x) => x.startsWith("nuid")).length})` : ""}`);
if (bad) process.exitCode = 1;
