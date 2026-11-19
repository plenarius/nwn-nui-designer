/**
 * Install detection at the real default locations of the system it runs on (Windows, macOS or Linux): fake installs
 * are written where Steam, GOG and the Beamdog client put the game, and a hak folder in the real Documents (or
 * ~/.local/share) folder, then detectInstalls and detectHakDir are asked with no options, as the dev server asks them.
 *
 * It writes outside the repository (Program Files, /Applications, the registry on Windows), so it runs only when
 * NUID_REAL_INSTALLS=1 and CI=true: the "Install detection" job of .github/workflows/ci.yml, on throwaway runners. It
 * refuses to touch a folder that is already there, and removes what it made.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detectHakDir, detectInstalls, realPath, regQuery, userFolders } from "../src/node/detect.js";
import { confine } from "../src/node/localapi.js";
import { writeFakeInstall } from "./fakegame.js";

const enabled = process.env.NUID_REAL_INSTALLS === "1" && process.env.CI === "true";
const home = homedir();
const made: string[] = [];
const cleanups: (() => void)[] = [];

/** Makes dir (refusing one that exists: it could be a real install) and remembers the topmost folder it made. */
function fresh(path: string): string {
  const dir = resolve(path);
  if (!isAbsolute(path)) throw new Error(`${path}: not an absolute path`);
  if (existsSync(dir)) throw new Error(`${dir} already exists: not touching it`);
  let top = dir;
  while (!existsSync(parse(top).dir) && parse(top).dir !== top) top = parse(top).dir;
  mkdirSync(dir, { recursive: true });
  made.push(top);
  return dir;
}

const install = (dir: string) => writeFakeInstall(fresh(dir));
const GOG_NAME = "Neverwinter Nights Enhanced Edition";
const STEAM_GAME = join("steamapps", "common", "Neverwinter Nights");

afterAll(() => {
  for (const c of cleanups.reverse()) c();
  for (const d of made.reverse()) rmSync(d, { recursive: true, force: true });
});

const reg = (...args: string[]) => execFileSync("reg", args, { stdio: "ignore", windowsHide: true });

describe.runIf(enabled && process.platform === "win32")("install detection on Windows", () => {
  it("finds Steam (also a library on another drive, and Steam's registry path), GOG and Beamdog", () => {
    const pf86 = process.env["ProgramFiles(x86)"]!;
    const steamRoot = join(pf86, "Steam");
    const steam = install(join(steamRoot, STEAM_GAME));
    // A second Steam library on the runner's other drive (D: on GitHub's runners), listed as Steam lists it.
    const otherDrive = parse(process.env.RUNNER_TEMP || process.cwd()).root;
    const lib = join(otherDrive, "NuidSteamLibrary");
    const inLib = install(join(lib, STEAM_GAME));
    writeFileSync(
      join(steamRoot, "steamapps", "libraryfolders.vdf"),
      `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steamRoot.replace(/\\/g, "\\\\")}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${lib.replace(/\\/g, "\\\\")}"\n\t}\n}\n`,
    );
    // Steam writes its own folder to the registry in lower case with forward slashes: the same install, listed once.
    reg("add", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath", "/t", "REG_SZ", "/d", steamRoot.toLowerCase().replace(/\\/g, "/"), "/f");
    cleanups.push(() => reg("delete", "HKCU\\Software\\Valve\\Steam", "/f"));
    expect(regQuery("HKCU\\Software\\Valve\\Steam", "SteamPath")).toBe(steamRoot.toLowerCase().replace(/\\/g, "/"));
    const gog = install(join("C:\\GOG Games", GOG_NAME));
    const beamdog = install(join(process.env.APPDATA!, "Beamdog Client", "00829"));
    expect(detectInstalls()).toEqual([
      { path: realPath(steam), store: "Steam" },
      { path: realPath(inLib), store: "Steam" },
      { path: realPath(gog), store: "GOG" },
      { path: realPath(beamdog), store: "Beamdog" },
    ]);
  });

  it("finds the hak folder in Documents, also when Documents was moved (to OneDrive)", () => {
    const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";
    const before = regQuery(key, "Personal");
    expect(before, "the registry names the Documents folder").toBeTruthy();
    const docs = execFileSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('MyDocuments')"], { encoding: "utf8" }).trim();
    expect(userFolders()[0]).toBe(join(docs, "Neverwinter Nights"));
    const hak = fresh(join(docs, "Neverwinter Nights", "hak"));
    expect(detectHakDir()).toBe(hak);
    // Documents moved to OneDrive, as OneDrive's backup does it: the registry's value changes, ~/Documents stays.
    const moved = fresh(join(home, "OneDrive - Nuid Test", "Documents", "Neverwinter Nights", "hak"));
    reg("add", key, "/v", "Personal", "/t", "REG_EXPAND_SZ", "/d", "%USERPROFILE%\\OneDrive - Nuid Test\\Documents", "/f");
    cleanups.push(() => reg("add", key, "/v", "Personal", "/t", "REG_EXPAND_SZ", "/d", before!, "/f"));
    expect(detectHakDir()).toBe(moved);
  });

  it("serves files under a configured folder by any case or short name of it, and nothing through a junction out", () => {
    const root = fresh(join(process.env.RUNNER_TEMP || home, "Nuid Confine Root"));
    writeFileSync(join(root, "ok.tga"), "x");
    const outside = fresh(join(process.env.RUNNER_TEMP || home, "Nuid Outside"));
    writeFileSync(join(outside, "secret.txt"), "no");
    execFileSync("cmd", ["/c", "mklink", "/J", join(root, "junction"), outside], { stdio: "ignore" });
    expect(confine(root, "ok.tga")).toBe(join(realPath(root), "ok.tga"));
    expect(confine(root.toUpperCase(), "OK.TGA")).toBe(join(realPath(root), "ok.tga"));
    for (const bad of ["junction/secret.txt", "ok.tga::$DATA", "ok.tga:alt", "..\\Nuid Outside\\secret.txt", "C:/Windows/win.ini", "nul", "con"]) {
      expect(confine(root, bad), bad).toBeNull();
    }
  });
});

describe.runIf(enabled && process.platform === "darwin")("install detection on macOS", () => {
  it("finds Steam, the GOG app (in /Applications and ~/Applications) and Beamdog", () => {
    const steam = install(join(home, "Library", "Application Support", "Steam", STEAM_GAME));
    const gog = install(join("/Applications", `${GOG_NAME}.app`, "Contents", "Resources", "game"));
    const beamdog = install(join(home, "Library", "Application Support", "Beamdog Client", "00829"));
    expect(detectInstalls()).toEqual([
      { path: realPath(steam), store: "Steam" },
      { path: realPath(gog), store: "GOG" },
      { path: realPath(beamdog), store: "Beamdog" },
    ]);
  });

  it("lists an install once when a Steam library names it in another case (APFS ignores case)", () => {
    const steamRoot = join(home, "Library", "Application Support", "Steam");
    writeFileSync(join(steamRoot, "steamapps", "libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steamRoot.toLowerCase()}"\n\t}\n}\n`);
    expect(detectInstalls().filter((i) => i.store === "Steam")).toHaveLength(1);
  });

  it("finds the hak folder in ~/Documents", () => {
    const hak = fresh(join(home, "Documents", "Neverwinter Nights", "hak"));
    expect(detectHakDir()).toBe(hak);
  });

  it("serves files under a configured folder reached through /tmp's link, and by another case", () => {
    const root = fresh(join("/tmp", "nuid-confine-root"));
    writeFileSync(join(root, "ok.tga"), "x");
    expect(confine(root, "ok.tga")).toBe(join(realPath(root), "ok.tga"));
    expect(confine(root, "OK.TGA")).not.toBeNull();
    expect(confine(root, "ok.tga:x")).toBeNull();
  });
});

describe.runIf(enabled && process.platform === "linux")("install detection on Linux", () => {
  it("finds Steam (through ~/.steam's link once), GOG and Beamdog, and the hak folder", () => {
    const steam = install(join(home, ".local", "share", "Steam", STEAM_GAME));
    const gog = install(join(home, "GOG Games", GOG_NAME, "game"));
    const beamdog = install(join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "Beamdog Client", "00829"));
    expect(detectInstalls()).toEqual([
      { path: realPath(steam), store: "Steam" },
      { path: realPath(gog), store: "GOG" },
      { path: realPath(beamdog), store: "Beamdog" },
    ]);
    const hak = fresh(join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "Neverwinter Nights", "hak"));
    expect(detectHakDir()).toBe(hak);
  });
});
