/**
 * The desktop app: the built editor and its local API (server.ts) in a window, with updates from the GitHub releases
 * (updates.ts). The settings file is nui-designer.ini in the user's config folder (app.getPath("userData")), unless
 * NUI_DESIGNER_INI names another; its relative paths are relative to its own folder. Install detection and the
 * environment variables are the same as `pnpm dev`'s.
 */
import { BrowserWindow, Menu, type MenuItemConstructorOptions, app, protocol, session, shell } from "electron";
import { dirname, join } from "node:path";
import { INI_NAME, iniPath } from "../src/node/settings.js";
import { type PageServer, TOKEN_HEADER, servePage } from "./server.js";
import { checkForUpdates, watchForUpdates } from "./updates.js";

const SCHEME = "app";
const HOST = "nui-designer";
const HOME = `${SCHEME}://${HOST}/`;
const REPO = "https://github.com/plenarius/nwn-nui-designer";
/** What the page may ask for: the clipboard (Paste JSON) and the browser's file pickers. */
const PERMISSIONS = new Set(["clipboard-read", "clipboard-sanitized-write", "fileSystem", "fullscreen"]);

// One origin for the page whatever port the server gets, so its storage (autosave, recent windows) survives restarts.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let server: PageServer | null = null;

const external = (url: string) => {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
};

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: "#121115",
    title: app.getName(),
    ...(process.platform === "linux" ? { icon: join(import.meta.dirname, "icon.png") } : {}),
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => (win = null));
  // Links to other sites open in the browser; the window never leaves the editor.
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(HOME)) return;
    e.preventDefault();
    external(url);
  });
  void win.loadURL(HOME);
}

function menu(): void {
  // Windows and Linux: no menu bar, so no accelerator can take a key the editor uses (Alt+R, Ctrl+Z...).
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const t: MenuItemConstructorOptions[] = [
    {
      label: app.getName(),
      submenu: [{ role: "about" }, { label: "Check for Updates…", click: () => void checkForUpdates(win, true) }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }],
    },
    // The editor sees Cmd+Z, Cmd+C... first; the menu acts only on what it leaves (text fields).
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
    { role: "help", submenu: [{ label: "Project Page", click: () => external(REPO) }, { label: "Report a Problem", click: () => external(`${REPO}/issues`) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => server?.close());

void app.whenReady().then(async () => {
  // The default file is in the config folder; NUI_DESIGNER_INI still wins, as for `pnpm dev`.
  const ini = process.env.NUI_DESIGNER_INI ? undefined : join(app.getPath("userData"), INI_NAME);
  server = await servePage(join(app.getAppPath(), "dist"), { iniPath: ini, base: dirname(iniPath({ iniPath: ini })) });
  const srv = server;
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url);
    if (url.host !== HOST) return new Response(null, { status: 404 });
    const headers = new Headers(req.headers);
    // The server checks its own Host; the page's origin is this scheme, so no other site can reach the handler.
    headers.delete("host");
    headers.delete("origin");
    headers.set(TOKEN_HEADER, srv.token);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    const r = await fetch(srv.origin + url.pathname + url.search, { method: req.method, headers, body, redirect: "manual" });
    return new Response(r.body, { status: r.status, headers: r.headers });
  });
  // No remote content: the page and everything it loads come from the app.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (_d, cb) => cb({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(PERMISSIONS.has(permission)));
  app.on("web-contents-created", (_e, wc) => wc.on("will-attach-webview", (ev) => ev.preventDefault()));
  menu();
  createWindow();
  app.on("activate", () => {
    if (!win) createWindow();
  });
  watchForUpdates(() => win);
});
