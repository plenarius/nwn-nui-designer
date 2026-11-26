/**
 * Bundles the desktop app's main process and preload into dist-electron/ (`pnpm app:bundle`): one file each, with the
 * local API and electron-updater inside, so the packaged app needs no node_modules.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { type BuildOptions, build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");
const out = join(ROOT, "dist-electron");
mkdirSync(out, { recursive: true });

const common: BuildOptions = { bundle: true, platform: "node", target: "node22", external: ["electron"], logLevel: "info" };
await build({
  ...common,
  entryPoints: [join(ROOT, "electron", "main.ts")],
  outfile: join(out, "main.mjs"),
  format: "esm",
  // The bundled CommonJS packages (electron-updater) call require for Node's own modules.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
// A sandboxed preload must be CommonJS.
await build({ ...common, entryPoints: [join(ROOT, "electron", "preload.ts")], outfile: join(out, "preload.cjs"), format: "cjs" });
copyFileSync(join(ROOT, "electron", "build", "icon.png"), join(out, "icon.png"));
