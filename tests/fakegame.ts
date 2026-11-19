/**
 * A fake NWN:EE install for tests: what isGameDir and the resource manager need (data/nwn_base.key, a non-empty
 * data/ovr.bif) and an ovr/ folder, with no game files in it. The KEY is a valid empty KEY V1, so the game opens with
 * no resources: the skin then comes from ovr/ (when files are given) or the built-in one.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** An empty KEY V1: no BIFs, no resources (header only). */
export function emptyKey(): Uint8Array {
  const b = new Uint8Array(64);
  b.set(new TextEncoder().encode("KEY V1  "), 0);
  const v = new DataView(b.buffer);
  v.setUint32(16, 64, true); // file table offset
  v.setUint32(20, 64, true); // key table offset
  return b;
}

/** Writes a fake install at dir (made if needed); ovr holds loose files to put in ovr/. Returns dir. */
export function writeFakeInstall(dir: string, ovr: Record<string, Uint8Array | string> = {}): string {
  mkdirSync(join(dir, "data", "txpk"), { recursive: true });
  mkdirSync(join(dir, "ovr"), { recursive: true });
  writeFileSync(join(dir, "data", "nwn_base.key"), emptyKey());
  const bif = new Uint8Array(20);
  bif.set(new TextEncoder().encode("BIFFV1  "), 0);
  writeFileSync(join(dir, "data", "ovr.bif"), bif);
  for (const [n, d] of Object.entries(ovr)) writeFileSync(join(dir, "ovr", n), d);
  return dir;
}
