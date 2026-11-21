/** The game executable, where the client's built-in names (pnpm old-gui inventory) come from. */
import { existsSync } from "node:fs";
import { join } from "node:path";

/** The game executable: the client's built-in names come from it. */
export function findClient(game: string): string | null {
  const c = [
    "bin/linux-x86/nwmain-linux",
    "bin/win32/nwmain.exe",
    "bin/macos/nwmain.app/Contents/MacOS/nwmain",
    "bin/linux-arm64/nwmain-linux",
  ].map((p) => join(game, p));
  return c.find((p) => existsSync(p)) ?? null;
}
