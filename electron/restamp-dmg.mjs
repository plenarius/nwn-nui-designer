// After the disk image is notarized and stapled (release.yml), its bytes have changed: this puts its new SHA-512 and
// size into latest-mac.yml, so the update file describes what is published. (The updater itself downloads the zip.)
//
//   node electron/restamp-dmg.mjs release
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "release";
const yml = join(dir, "latest-mac.yml");
let text = readFileSync(yml, "utf8");
for (const name of readdirSync(dir).filter((n) => n.endsWith(".dmg"))) {
  const bytes = readFileSync(join(dir, name));
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  const entry = new RegExp(`(- url: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n\\s+sha512: )\\S+(\\n\\s+size: )\\d+`);
  if (!entry.test(text)) {
    console.log(`${name}: not in latest-mac.yml`);
    continue;
  }
  text = text.replace(entry, `$1${sha512}$2${bytes.length}`);
  console.log(`${name}: ${bytes.length} bytes, sha512 ${sha512}`);
}
writeFileSync(yml, text);
