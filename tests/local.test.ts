/**
 * The local settings (nui-designer.ini), install detection and the dev server's local API: the INI reader and
 * writer, the Steam, GOG and Beamdog folders on each system (fake installs in a temporary folder), and that the file
 * endpoint never serves anything outside the configured folders.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { type AddressInfo } from "node:net";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectHakDir, detectInstalls, expandWindowsEnv, gameIn, isGameDir, notGameReason, parseRegQuery, steamLibraries, userFolders, windowsDocuments } from "../src/node/detect.js";
import { confine, localApi, localState, windowFileTitle } from "../src/node/localapi.js";
import { EMPTY_SETTINGS, loadSettings, parseIni, resolvePath, updateIni } from "../src/node/settings.js";
import { HttpTree } from "../src/app/local.js";
import { Key } from "../src/core/res/containers.js";
import { MemorySource } from "../src/core/res/source.js";
import { emptyKey, writeFakeInstall } from "./fakegame.js";
import { makeErf, makeGff } from "./gffbuild.js";
import { RES_TYPES } from "../src/core/res/restype.js";

let tmp: string;
beforeAll(() => {
  // The native real path, as detection reports installs: macOS's tmpdir is behind a /var link, Windows' may be an 8.3 name.
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "nuid-local-")));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const dir = (...p: string[]) => {
  const d = join(tmp, ...p);
  mkdirSync(d, { recursive: true });
  return d;
};

describe("nui-designer.ini", () => {
  it("reads keys, comments, lists, quotes and sections", () => {
    const { settings, unknown } = parseIni(
      [
        "; a comment",
        "# another",
        "[paths]",
        "game = ~/Games/Neverwinter Nights",
        "hak_dir=/srv/haks  ",
        "overrides = a, b",
        "overrides = \"c, with a comma\"",
        "haks = Top_Hak, base",
        "windows = local/dumps",
        "colour = blue",
        "not a key line",
      ].join("\r\n"),
    );
    expect(settings).toEqual({
      game: "~/Games/Neverwinter Nights",
      hak_dir: "/srv/haks",
      module_ifo: "",
      overrides: ["a", "b", "c, with a comma"],
      haks: ["Top_Hak", "base"],
      windows: "local/dumps",
      styles: [],
    });
    expect(unknown).toEqual(["colour"]);
  });

  it("writes values in place and keeps comments, unknown keys and order", () => {
    const before = ["; my settings", "game = /old", "# the haks", "hak_dir = /h", "colour = blue", "overrides = x", "overrides = y", ""].join("\n");
    const after = updateIni(before, { ...EMPTY_SETTINGS, game: "/new game", hak_dir: "", overrides: ["p, q", "r"], windows: "w" });
    expect(after).toBe(["; my settings", "game = /new game", "# the haks", "colour = blue", 'overrides = "p, q"', "overrides = r", "", "windows = w", ""].join("\n"));
    // What it writes reads back the same.
    expect(parseIni(after).settings).toEqual({ ...EMPTY_SETTINGS, game: "/new game", overrides: ["p, q", "r"], windows: "w" });
    expect(updateIni("", { ...EMPTY_SETTINGS, haks: ["a", "b"] })).toBe("haks = a, b\n");
  });

  it("resolves ~ and relative paths, and the environment beats the file", () => {
    // Absolute on this system: "/abs" on Linux and macOS, "C:\\abs" style on Windows (resolve adds the drive).
    const abs = (p: string) => resolve(p);
    const homeU = abs("/home/u");
    const repo = abs("/repo");
    expect(resolvePath("~/x", repo, homeU)).toBe(join(homeU, "x"));
    expect(resolvePath("~\\x", repo, homeU)).toBe(join(homeU, "x"));
    expect(resolvePath("~", repo, homeU)).toBe(homeU);
    expect(resolvePath("a/b", repo, homeU)).toBe(join(repo, "a", "b"));
    expect(resolvePath(abs("/abs"), repo, homeU)).toBe(abs("/abs"));
    const ini = join(dir("ini"), "s.ini");
    writeFileSync(ini, `game = ~/g\nhak_dir = ${abs("/h")}\nmodule_ifo = ${abs("/m.json")}\nhaks = A.hak, b\n`);
    const s = loadSettings({ iniPath: ini, env: { NWN_HAK_DIR: abs("/env-haks") }, home: homeU });
    expect([s.game, s.gameFrom, s.hakDir, s.hakDirFrom, s.moduleIfo, s.haks]).toEqual([join(homeU, "g"), "ini", abs("/env-haks"), "env", abs("/m.json"), ["a", "b"]]);
    const none = loadSettings({ iniPath: join(tmp, "missing.ini"), env: {} });
    expect([none.iniExists, none.game, none.overrides]).toEqual([false, null, []]);
  });
});

describe("install detection", () => {
  it("checks installs the way isGameDir does", () => {
    const g = writeFakeInstall(dir("check", "game"));
    expect(isGameDir(g)).toBe(true);
    expect(notGameReason(g)).toBeNull();
    expect(notGameReason(dir("check", "empty"))).toMatch(/no data\/nwn_base\.key/);
    expect(notGameReason(join(tmp, "nowhere"))).toMatch(/no such folder/);
    // The empty KEY the fake install has is a valid one.
    return expect(Key.open(new MemorySource("nwn_base.key", emptyKey()), () => null)).resolves.toBeTruthy();
  });

  it("finds Steam installs on Linux, in extra library folders and in the Flatpak's", () => {
    const home = dir("linux", "home");
    const steam = dir("linux", "home", ".local", "share", "Steam");
    const lib = dir("linux", "games");
    writeFileSync(
      join(dir("linux", "home", ".local", "share", "Steam", "steamapps"), "libraryfolders.vdf"),
      `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${lib}"\n\t\t"label"\t\t""\n\t}\n}\n`,
    );
    expect(steamLibraries(steam)).toEqual([steam, lib]);
    const inLib = writeFakeInstall(join(lib, "steamapps", "common", "Neverwinter Nights"));
    const flatpak = writeFakeInstall(join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam", "steamapps", "common", "Neverwinter Nights"));
    // A folder without data (a half-uninstalled game) is not an install.
    dir("linux", "home", ".local", "share", "Steam", "steamapps", "common", "Neverwinter Nights", "data");
    expect(detectInstalls({ platform: "linux", home, env: {} })).toEqual([
      { path: inLib, store: "Steam" },
      { path: flatpak, store: "Steam" },
    ]);
  });

  it("lists an install reached through Steam's links once, under its real path", () => {
    const home = dir("linuxlinks");
    const real = writeFakeInstall(join(home, ".local", "share", "Steam", "steamapps", "common", "Neverwinter Nights"));
    dir("linuxlinks", ".steam");
    symlinkSync(join(home, ".local", "share", "Steam"), join(home, ".steam", "steam"));
    symlinkSync(join(home, ".local", "share", "Steam"), join(home, ".steam", "root"));
    expect(detectInstalls({ platform: "linux", home, env: {} })).toEqual([{ path: real, store: "Steam" }]);
  });

  it("finds GOG (game/ subfolder) and Beamdog installs on Linux, and the user's hak folder", () => {
    const home = dir("linux2");
    const gog = writeFakeInstall(join(home, "GOG Games", "Neverwinter Nights Enhanced Edition", "game"));
    const bd = writeFakeInstall(join(home, ".config", "Beamdog Client", "00829"));
    dir("linux2", ".config", "Beamdog Client", "00785"); // another game: not NWN:EE data
    expect(detectInstalls({ platform: "linux", home, env: {} })).toEqual([
      { path: gog, store: "GOG" },
      { path: bd, store: "Beamdog" },
    ]);
    expect(detectHakDir({ platform: "linux", home, env: {} })).toBeNull();
    const hak = dir("linux2", ".local", "share", "Neverwinter Nights", "hak");
    expect(detectHakDir({ platform: "linux", home, env: {} })).toBe(hak);
    // An empty or relative XDG folder is ignored (the spec says so), not taken relative to the current folder.
    expect(detectHakDir({ platform: "linux", home, env: { XDG_DATA_HOME: "", XDG_CONFIG_HOME: "rel" } })).toBe(hak);
    expect(detectInstalls({ platform: "linux", home, env: { XDG_CONFIG_HOME: "" } }).map((i) => i.store)).toEqual(["GOG", "Beamdog"]);
  });

  it("finds installs on macOS, inside the app bundle too", () => {
    const home = dir("mac");
    const steam = writeFakeInstall(join(home, "Library", "Application Support", "Steam", "steamapps", "common", "Neverwinter Nights"));
    const app = writeFakeInstall(join(home, "Applications", "Neverwinter Nights Enhanced Edition.app", "Contents", "Resources", "game"));
    expect(gameIn(join(home, "Applications", "Neverwinter Nights Enhanced Edition.app"))).toBe(app);
    expect(detectInstalls({ platform: "darwin", home, env: {} }).filter((i) => i.path.startsWith(tmp))).toEqual([
      { path: steam, store: "Steam" },
      { path: app, store: "GOG" },
    ]);
    const hak = dir("mac", "Documents", "Neverwinter Nights", "hak");
    expect(detectHakDir({ platform: "darwin", home, env: {} })).toBe(hak);
  });

  it("finds installs on Windows from Program Files and APPDATA", () => {
    const home = dir("win", "user");
    const pf86 = dir("win", "pf86");
    const steam = writeFakeInstall(join(pf86, "Steam", "steamapps", "common", "Neverwinter Nights"));
    const appdata = dir("win", "user", "AppData", "Roaming");
    const bd = writeFakeInstall(join(appdata, "Beamdog Client", "00829"));
    const env = { "ProgramFiles(x86)": pf86, ProgramFiles: dir("win", "pf"), APPDATA: appdata };
    expect(detectInstalls({ platform: "win32", home, env }).filter((i) => i.path.startsWith(tmp))).toEqual([
      { path: steam, store: "Steam" },
      { path: bd, store: "Beamdog" },
    ]);
    const hak = dir("win", "user", "OneDrive", "Documents", "Neverwinter Nights", "hak");
    expect(detectHakDir({ platform: "win32", home, env })).toBe(hak);
  });

  it("reads the Windows registry's answers: Steam's path, a moved Documents folder", () => {
    const out = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n    Personal    REG_EXPAND_SZ    %USERPROFILE%\\OneDrive - Contoso\\Documents\r\n\r\n";
    expect(parseRegQuery(out, "Personal")).toBe("%USERPROFILE%\\OneDrive - Contoso\\Documents");
    expect(parseRegQuery(out, "personal")).toBe("%USERPROFILE%\\OneDrive - Contoso\\Documents");
    expect(parseRegQuery(out, "AppData")).toBeNull();
    expect(parseRegQuery("    Size    REG_DWORD    0x10\r\n", "Size")).toBeNull();
    expect(expandWindowsEnv("%userprofile%\\x\\%NOPE%", { USERPROFILE: "C:\\Users\\u" })).toBe("C:\\Users\\u\\x\\%NOPE%");
    const registry = (key: string, value: string) => (key.endsWith("User Shell Folders") && value === "Personal" ? "%USERPROFILE%\\OneDrive - Contoso\\Documents" : null);
    const home = "C:\\Users\\u";
    // The registry's folder first, then OneDrive's, then ~/Documents; a test pretending to be on Windows never asks the real registry.
    expect(windowsDocuments(home, {}, registry)).toEqual(["C:\\Users\\u\\OneDrive - Contoso\\Documents", join(home, "OneDrive", "Documents"), join(home, "Documents")]);
    expect(userFolders({ platform: "win32", home, env: { NWN_HOME: "N" }, registry })[0]).toBe("N");
    if (process.platform !== "win32") expect(userFolders({ platform: "win32", home, env: {} })).toEqual([join(home, "OneDrive", "Documents", "Neverwinter Nights"), join(home, "Documents", "Neverwinter Nights")]);
  });
});

describe("the file endpoint stays inside its folders", () => {
  it("rejects traversal, absolute paths and symlinks that lead out", () => {
    const root = dir("confine", "root");
    const outside = dir("confine", "outside");
    writeFileSync(join(root, "ok.tga"), "x");
    dir("confine", "root", "sub");
    writeFileSync(join(root, "sub", "deep.tga"), "y");
    writeFileSync(join(outside, "secret.txt"), "no");
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
    symlinkSync(outside, join(root, "linkdir"));
    symlinkSync(join(root, "ok.tga"), join(root, "inside-link.tga"));
    expect(confine(root, "ok.tga")).toBe(join(root, "ok.tga"));
    expect(confine(root, "sub/deep.tga")).toBe(join(root, "sub", "deep.tga"));
    expect(confine(root, "inside-link.tga")).toBe(join(root, "ok.tga"));
    for (const bad of ["../outside/secret.txt", "sub/../../outside/secret.txt", "sub/../ok.tga", "./ok.tga", join(outside, "secret.txt"), "/etc/passwd", "C:/x", "sub\\deep.tga", "", "sub/", "a\0b", "link.txt", "linkdir/secret.txt", "sub", "missing.tga"]) {
      expect(confine(root, bad), bad).toBeNull();
    }
  });
});

describe("the local API", () => {
  let base: string;
  let server: ReturnType<typeof createServer>;
  let ini: string;
  let game: string;
  let hakDir: string;
  beforeAll(async () => {
    game = writeFakeInstall(dir("api", "game"), { "nui_skin.tml": "x = 1\n" });
    hakDir = dir("api", "hak");
    writeFileSync(join(hakDir, "Top.hak"), "0123456789");
    writeFileSync(join(hakDir, "other.hak"), "z");
    writeFileSync(join(dir("api", "outside"), "secret.txt"), "no");
    symlinkSync(join(tmp, "api", "outside", "secret.txt"), join(hakDir, "escape.hak"));
    const win = dir("api", "windows");
    writeFileSync(join(win, "a.jui"), "{}");
    writeFileSync(join(win, "notes.txt"), "-");
    ini = join(dir("api", "repo"), "nui-designer.ini");
    writeFileSync(ini, `; mine\ngame = ${game}\nhak_dir = ${hakDir}\nhaks = top, missing\nwindows = ${win}\n`);
    const api = localApi({ iniPath: ini, env: {}, detect: false });
    server = createServer((req, res) => api(req, res, () => res.writeHead(404).end()));
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((ok, fail) => {
      const req = request(base + path, { method: init.method ?? "GET", headers: init.headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => ok({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on("error", fail);
      req.end(init.body);
    });
  const json = async (path: string) => JSON.parse((await call(path)).body.toString());

  it("reports the settings, the game's files, the haks in order and the windows", async () => {
    const st = await json("/api/local/state");
    expect(st.game.path).toBe(game);
    expect(st.game.from).toBe("ini");
    expect(st.game.files.map((f: { path: string }) => f.path)).toEqual(["data/nwn_base.key", "data/ovr.bif", "ovr/nui_skin.tml"]);
    expect(st.order.from).toBe("haks");
    expect(st.haks).toEqual([
      { name: "top", file: "Top.hak", size: 10, found: true },
      { name: "missing", found: false },
    ]);
    expect(st.available).toEqual(["escape", "other", "top"]);
    expect(st.windows.files.map((f: { path: string }) => f.path)).toEqual(["a.jui"]);
    // The browser's view of the game: the same files, case-insensitive.
    const tree = new HttpTree(st.game.path, "game", st.game.files);
    expect(tree.file("DATA/NWN_BASE.KEY")?.size).toBe(64);
    expect(tree.list("ovr").map((f) => f.name)).toEqual(["nui_skin.tml"]);
  });

  it("serves byte ranges of a configured folder's files", async () => {
    const r = await call("/api/local/file?root=hak&path=Top.hak", { headers: { range: "bytes=2-5" } });
    expect(r.status).toBe(206);
    expect(r.headers["content-range"]).toBe("bytes 2-5/10");
    expect(r.body.toString()).toBe("2345");
    const whole = await call("/api/local/file?root=game&path=ovr/nui_skin.tml");
    expect([whole.status, whole.body.toString()]).toEqual([200, "x = 1\n"]);
    expect((await call("/api/local/file?root=hak&path=Top.hak", { headers: { range: "bytes=20-30" } })).status).toBe(416);
  });

  it("lists the windows folder with each window's title, for the window switcher", async () => {
    const win = join(tmp, "api", "windows");
    writeFileSync(join(win, "shop.jui"), readFileSync(resolve(import.meta.dirname, "..", "fixtures", "widgets.jui")));
    writeFileSync(join(win, "bound.json"), JSON.stringify({ version: 1, title: { bind: "t" }, root: { type: "col", children: [] } }));
    try {
      const r = await json("/api/local/windows");
      expect(r.windows.path).toBe(win);
      // a.jui ("{}") is no window: listed by name, without a title; a bound title is not a title.
      expect(r.windows.files).toEqual([
        { path: "a.jui", size: 2 },
        { path: "bound.json", size: expect.any(Number) },
        { path: "shop.jui", size: expect.any(Number), title: "Every widget" },
      ]);
      // Cached by modification time and size: a changed file is read again.
      writeFileSync(join(win, "shop.jui"), JSON.stringify({ version: 1, title: "Shop", root: { type: "col", children: [] } }));
      expect(windowFileTitle(join(win, "shop.jui"))).toBe("Shop");
    } finally {
      rmSync(join(win, "shop.jui"));
      rmSync(join(win, "bound.json"));
    }
  });

  it("refuses paths outside the folders, unknown roots and other hosts", async () => {
    for (const q of [
      "root=hak&path=../outside/secret.txt",
      "root=hak&path=%2E%2E%2Foutside%2Fsecret.txt",
      `root=hak&path=${encodeURIComponent(join(tmp, "api", "outside", "secret.txt"))}`,
      "root=hak&path=escape.hak",
      "root=ovr:0&path=x",
      "root=home&path=.bashrc",
      "root=windows&path=../repo/nui-designer.ini",
    ]) {
      expect((await call(`/api/local/file?${q}`)).status, q).toBe(404);
    }
    expect((await call("/api/local/state", { headers: { host: "evil.example:80" } })).status).toBe(403);
  });

  it("checks settings before writing them, then keeps the file's comments", async () => {
    const put = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) => call("/api/local/settings", { method: "PUT", headers, body: JSON.stringify(body) });
    expect((await put({ game }, { "content-type": "text/plain" })).status).toBe(403);
    expect((await put({ game }, { "content-type": "application/json", origin: "http://evil.example" })).status).toBe(403);
    const bad = JSON.parse((await put({ game: join(tmp, "api", "hak") })).body.toString());
    expect(bad.saved).toBe(false);
    expect(bad.errors.game).toMatch(/not an NWN:EE install/);
    expect(readFileSync(ini, "utf8")).toContain("haks = top, missing");
    const ok = await put({ game, hak_dir: hakDir, haks: ["other.hak", "top"], overrides: [], windows: "" });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body.toString()).state.haks.map((h: { name: string }) => h.name)).toEqual(["other", "top"]);
    expect(readFileSync(ini, "utf8")).toBe(`; mine\ngame = ${game}\nhak_dir = ${hakDir}\nhaks = other, top\n`);
  });

  it("takes the hak order from a .mod or a binary module.ifo, and refuses a damaged one", async () => {
    const put = (body: unknown) => call("/api/local/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const ifo = makeGff("IFO ", [{ label: "Mod_HakList", list: [[{ label: "Mod_Hak", str: "Top" }], [{ label: "Mod_Hak", str: "gone" }], [{ label: "Mod_Hak", str: "other" }]] }]);
    const mod = join(dir("api", "module"), "my module.mod");
    writeFileSync(mod, makeErf([["module", RES_TYPES.ifo!, ifo]]));
    writeFileSync(join(dir("api", "module"), "module.ifo"), ifo);
    for (const [file, format] of [[mod, "mod"], [join(tmp, "api", "module", "module.ifo"), "ifo"]] as const) {
      const r = JSON.parse((await put({ game, hak_dir: hakDir, module_ifo: file })).body.toString());
      expect(r.saved, file).toBe(true);
      expect(r.state.order).toEqual({ from: "module_ifo", path: file, format });
      expect(r.state.haks.map((h: { name: string; found: boolean }) => [h.name, h.found])).toEqual([["top", true], ["gone", false], ["other", true]]);
    }
    const cut = join(tmp, "api", "module", "cut.mod");
    writeFileSync(cut, makeErf([["module", RES_TYPES.ifo!, ifo]]).subarray(0, 200));
    const bad = JSON.parse((await put({ game, hak_dir: hakDir, module_ifo: cut })).body.toString());
    expect(bad.saved).toBe(false);
    expect(bad.errors.module_ifo).toBe(`${cut}: a MOD file without a module.ifo in it`);
  });

  it("uses the first detected install when the file names no game", async () => {
    const empty = join(dir("api", "repo2"), "nui-designer.ini");
    const home = dir("api", "home");
    const found = writeFakeInstall(join(home, ".steam", "steam", "steamapps", "common", "Neverwinter Nights"));
    const st = await localState({ iniPath: empty, env: {}, detect: { platform: "linux", home, env: {} } });
    expect(st.game?.path).toBe(found);
    expect(st.game?.from).toBe("detected");
    expect(st.ini.exists).toBe(false);
  });
});
