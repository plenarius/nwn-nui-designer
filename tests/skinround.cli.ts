/**
 * `pnpm skin:roundtrip`: every skin on this machine (Bronze; the game's skin and Layonara's from nwn-haks origin/64bit
 * when they are here) exported as a hak and read back, compared (the .tml, its values, the own files, a zip of loose
 * files, a window and the widget sheet pixel for pixel). Pass a window file to draw that one (default: the deity dump
 * local/dumps/gods.json, else fixtures/widgets.jui).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, roundTripSkins, skinRoundTrip } from "./skinround.js";

const window = process.argv[2] ?? (existsSync(join(ROOT, "local", "dumps", "gods.json")) ? join(ROOT, "local", "dumps", "gods.json") : join(ROOT, "fixtures", "widgets.jui"));
let bad = 0;
for (const s of await roundTripSkins()) {
  const r = await skinRoundTrip(s.project, s.base, window);
  const ok = r.tml && r.values && r.files && r.zip && r.window && r.sheet;
  if (!ok) bad++;
  console.log(
    `${ok ? "same" : "DIFFERS"}  ${s.name.padEnd(9)} tml ${r.tml} values ${r.values} files ${r.files} zip ${r.zip} window ${r.window} sheet ${r.sheet}` +
      ` | hak ${r.hakBytes} B, ${Object.keys(s.project.files).length} own files, ${r.leftOut.length} left out, ${r.pixels} px compared`,
  );
}
process.exit(bad ? 1 : 0);
