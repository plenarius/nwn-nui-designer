/**
 * What the golden checks compare against: nwn-module's tools/nui-preview (Python), and uv to run it.
 *
 * The reference code is NUI_PREVIEW (a folder holding nui-preview's .py files) or, without it, extracted from the
 * nwn-module checkout at NWN_MODULE (default: ../nwn-module next to this repository) at its origin/ee.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadSettings } from "../src/node/settings.js";

const ROOT = resolve(import.meta.dirname, "..");

/** The nwn-module checkout the reference is taken from. */
export const moduleCheckout = (): string => resolve(ROOT, process.env.NWN_MODULE ?? join("..", "nwn-module"));

/**
 * The module's hak order (nasher's module.ifo.json): given (--module-ifo), else $NWN_MODULE_IFO, else module_ifo in
 * nui-designer.ini (src/node/settings.ts), else local/res/module.ifo.json, else the nwn-module checkout's at origin/ee (copied to .golden-out/module.ifo.json), the
 * same commit the reference code comes from, so a checkout on another branch cannot hand the two sides different haks
 * (DESIGN.md, "The golden check"). local/ is not in git, so a fresh clone or a worktree has none. tried lists the defaults looked
 * at, for a warning when there is none.
 */
export function findModuleIfo(given?: string): { ifo?: string; tried: string[] } {
  // loadSettings applies NWN_MODULE_IFO over the file's module_ifo.
  const explicit = given ?? loadSettings().moduleIfo;
  if (explicit) return { ifo: explicit, tried: [explicit] };
  const local = join(ROOT, "local/res/module.ifo.json");
  const mod = moduleCheckout();
  const tried = [local, `${mod} origin/ee:module.ifo.json`];
  if (existsSync(local)) return { ifo: local, tried };
  try {
    const json = execFileSync("git", ["-C", mod, "show", "origin/ee:module.ifo.json"], { maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    const out = join(ROOT, ".golden-out", "module.ifo.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, json);
    return { ifo: out, tried };
  } catch {
    return { tried };
  }
}

/** Exits with a message saying what is missing. */
export function die(what: string): never {
  console.error(what);
  process.exit(2);
}

/** Checks that uv is on PATH (it runs the Python side). */
export function requireUv(): void {
  try {
    execFileSync("uv", ["--version"], { stdio: "ignore" });
  } catch {
    die("the golden check runs nui-preview with uv, which is not on PATH: install it (https://docs.astral.sh/uv/)");
  }
}

/** The folder of nui-preview's Python files: NUI_PREVIEW, or extracted into out/nui-preview from NWN_MODULE. */
export function referenceCode(out: string): string {
  const given = process.env.NUI_PREVIEW;
  if (given) {
    if (!existsSync(join(given, "layout.py"))) die(`NUI_PREVIEW=${given}: no layout.py there (it should be nwn-module's tools/nui-preview)`);
    return given;
  }
  const mod = moduleCheckout();
  const ref = join(out, "nui-preview");
  mkdirSync(ref, { recursive: true });
  try {
    const tar = execFileSync("git", ["-C", mod, "archive", "origin/ee", "tools/nui-preview"], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
    execFileSync("tar", ["-x", "-C", ref, "--strip-components=2"], { input: tar });
  } catch {
    die(
      `no reference code: set NUI_PREVIEW to a folder with nwn-module's tools/nui-preview, or NWN_MODULE to an nwn-module checkout (tried ${mod}, branch origin/ee)`,
    );
  }
  return ref;
}

/** nwn-module's origin/ee as a short hash, for the report ("?" if unknown). */
export function referenceSha(): string {
  try {
    return execFileSync("git", ["-C", moduleCheckout(), "rev-parse", "--short", "origin/ee"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "?";
  }
}
