/**
 * The page's only bridge (sandboxed, context isolated): it tells the editor it runs in the desktop app. No Node and
 * no IPC reach the page; the editor talks to the local API over its own origin, as with `pnpm dev`.
 */
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("nuiDesigner", { desktop: true, platform: process.platform });
