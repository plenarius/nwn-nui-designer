/**
 * Files in the browser: the File System Access API where there is one (Chromium: open a project, save it back to the
 * same file), a file <input> and a download elsewhere. The autosave lives in IndexedDB; every access is wrapped, so a
 * private window or blocked storage only loses the autosave.
 */

export interface OpenedFile {
  name: string;
  text: string;
  /** The file's handle, when the File System Access API opened it (Save writes back to it). */
  handle: FileHandle | null;
}

export interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
}

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

type Win = Window & {
  showOpenFilePicker?: (o: object) => Promise<FileHandle[]>;
  showSaveFilePicker?: (o: object) => Promise<FileHandle>;
};

export const hasFileSystemAccess = typeof window !== "undefined" && "showOpenFilePicker" in window && "showSaveFilePicker" in window;

const ANY_WINDOW: PickerType[] = [{ description: "NUI window, project or dump", accept: { "application/json": [".json", ".jui"] } }];

function aborted(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** Asks for a file. null if the user cancelled. */
export async function openFile(types: PickerType[] = ANY_WINDOW): Promise<OpenedFile | null> {
  const w = window as Win;
  if (hasFileSystemAccess && w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ id: "nui-designer-open", types, multiple: false });
      if (!h) return null;
      const f = await h.getFile();
      return { name: f.name, text: await f.text(), handle: h };
    } catch (e) {
      if (aborted(e)) return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = Object.values(types[0]?.accept ?? {}).flat().join(",") || "*";
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text(), handle: null } : null);
    };
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** Saves text: to handle if given, else a new file (a picker, or a download). Returns the handle written, if any. */
export async function saveFile(text: string, suggestedName: string, handle: FileHandle | null, types?: PickerType[], mime = "application/json"): Promise<FileHandle | null | "cancelled"> {
  const w = window as Win;
  if (handle) {
    const out = await handle.createWritable();
    await out.write(text);
    await out.close();
    return handle;
  }
  if (hasFileSystemAccess && w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ id: "nui-designer-save", suggestedName, types });
      const out = await h.createWritable();
      await out.write(text);
      await out.close();
      return h;
    } catch (e) {
      if (aborted(e)) return "cancelled";
      throw e;
    }
  }
  download(text, suggestedName, mime);
  return null;
}

export function download(text: string, name: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Bytes as a download (the .nss in cp1252). */
export function downloadBytes(bytes: Uint8Array, name: string, mime = "text/plain"): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A string as cp1252 bytes (what the NWScript compiler reads); characters outside it become "?". */
export function cp1252(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  const map: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out[n++] = c < 0x80 || (c >= 0xa0 && c < 0x100) ? c : (map[c] ?? 0x3f);
  }
  return out.slice(0, n);
}

// --- the autosave ---------------------------------------------------------------------------------------------

const DB = "nwn-nui-designer";
const STORE = "autosave";
/** The recently opened windows (version 2), for the window switcher (switcher.ts). */
const RECENT = "recent";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = () => {
        for (const s of [STORE, RECENT]) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

export interface Autosave {
  /** The project JSON. */
  project: string;
  name: string;
  savedAt: number;
}

export async function writeAutosave(a: Autosave): Promise<boolean> {
  try {
    const db = await idb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(a, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function readAutosave(): Promise<Autosave | null> {
  try {
    const db = await idb();
    const v = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get("current");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const a = v as Autosave | undefined;
    return a && typeof a.project === "string" ? a : null;
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete("current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* no storage */
  }
}

// --- the recently opened windows --------------------------------------------------------------------------------

/** The list of recent windows (switcher.ts' RecentWindow[]), one record; [] when there is no storage. */
export async function readRecent<T>(): Promise<T[]> {
  try {
    const db = await idb();
    const v = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(RECENT, "readonly");
      const req = tx.objectStore(RECENT).get("list");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/** Stores the list (a file's handle is kept as is: IndexedDB can hold one). */
export async function writeRecent<T>(list: T[]): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(RECENT, "readwrite");
      tx.objectStore(RECENT).put(list, "list");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* no storage: the switcher lists no recent windows */
  }
}

/** A file's text again from its handle, asking for read access if the browser forgot it (needs a click). */
export async function readHandle(h: FileHandle): Promise<string> {
  const p = h as FileHandle & { queryPermission?(o: object): Promise<string>; requestPermission?(o: object): Promise<string> };
  if (p.queryPermission && (await p.queryPermission({ mode: "read" })) !== "granted" && p.requestPermission) {
    if ((await p.requestPermission({ mode: "read" })) !== "granted") throw new Error(`${h.name}: the browser was not allowed to read it`);
  }
  return (await h.getFile()).text();
}

/** localStorage, wrapped (settings only). */
export function loadLocal<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...def, ...(JSON.parse(v) as T) } : def;
  } catch {
    return def;
  }
}

export function saveLocal(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* no storage */
  }
}
