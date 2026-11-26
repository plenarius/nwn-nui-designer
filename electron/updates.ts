/**
 * Updates from the GitHub releases (electron-updater). Nothing is downloaded until the user says so: a new version is
 * offered in a dialog, downloaded on Download, and installed on Restart now or when the app next quits.
 */
import { type BrowserWindow, app, dialog } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let busy = false;
/** Versions declined this run: the periodic check does not ask again. */
const declined = new Set<string>();

/** Checks for a new version; `manual` (the menu) also says when there is none, and why a check failed. */
export async function checkForUpdates(win: BrowserWindow | null, manual = false): Promise<void> {
  if (busy || !app.isPackaged || process.env.NUI_DESIGNER_NO_UPDATES) return;
  busy = true;
  const show = (o: Electron.MessageBoxOptions) => (win ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o));
  try {
    const r = await autoUpdater.checkForUpdates();
    const v = r?.isUpdateAvailable ? r.updateInfo.version : null;
    if (!v || (!manual && declined.has(v))) {
      if (manual) await show({ type: "info", message: "You have the latest version", detail: `${app.getName()} ${app.getVersion()}`, buttons: ["OK"] });
      return;
    }
    const ask = await show({
      type: "info",
      message: `${app.getName()} ${v} is available`,
      detail: `You have ${app.getVersion()}. Download it now? Nothing changes until you restart the app.`,
      buttons: ["Download", "Not now"],
      defaultId: 0,
      cancelId: 1,
    });
    if (ask.response !== 0) {
      declined.add(v);
      return;
    }
    await autoUpdater.downloadUpdate();
    const now = await show({
      type: "info",
      message: `${app.getName()} ${v} is ready`,
      detail: "Restart now to install it, or it installs when you quit.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (now.response === 0) autoUpdater.quitAndInstall();
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.warn(`update check: ${why}`);
    if (manual) await show({ type: "warning", message: "Could not check for updates", detail: why, buttons: ["OK"] });
  } finally {
    busy = false;
  }
}

/** A check soon after start, then twice a day while the app stays open. */
export function watchForUpdates(win: () => BrowserWindow | null): void {
  setTimeout(() => void checkForUpdates(win()), 5_000);
  setInterval(() => void checkForUpdates(win()), 12 * 60 * 60 * 1000).unref();
}
