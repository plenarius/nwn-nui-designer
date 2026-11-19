/**
 * The window switcher's lists (WindowSwitcher.tsx): the recently opened windows, kept in this browser, and the windows
 * folder's files. Pure functions, so the rules are tested without a browser.
 */
import type { FileHandle } from "./files.js";

/** Where a window was opened from, which says how to open it again. */
export type WindowSource =
  /** A file of the windows folder (the local API's root "windows"). */
  | { kind: "windows"; path: string }
  /** A file opened with the File System Access API: its handle (the browser may ask again to read it). */
  | { kind: "handle"; handle: FileHandle }
  /** Dropped, imported, pasted or a sample: a copy of the text as it was opened. */
  | { kind: "copy"; text: string };

export interface RecentWindow {
  /** One entry per file: "windows:<path>", "file:<name>" or "copy:<name>". */
  key: string;
  /** The file's name without its extension. */
  name: string;
  /** The window's title, when it is a string. */
  title?: string;
  openedAt: number;
  source: WindowSource;
}

/** How many recent windows are kept. */
export const RECENT_MAX = 12;
/** A copy bigger than this is not kept (the list lives in IndexedDB, read whole). */
export const COPY_MAX_CHARS = 2 << 20;
/** Above this many entries the switcher shows its search box. */
export const SEARCH_FROM = 8;

/** A file's name without the extensions Open reads. */
export const baseName = (file: string) => file.slice(file.lastIndexOf("/") + 1).replace(/(\.nuidesign)?\.(json|jui|txt)$/i, "");

export function sourceKey(s: WindowSource, file: string): string {
  return s.kind === "windows" ? `windows:${s.path}` : s.kind === "handle" ? `file:${file}` : `copy:${file}`;
}

/**
 * The list with entry first (replacing the one with its key), at most max long. A copy too big to keep is left out,
 * and so is an older entry of its key.
 */
export function addRecent(list: readonly RecentWindow[], entry: RecentWindow, max = RECENT_MAX): RecentWindow[] {
  const rest = list.filter((r) => r.key !== entry.key);
  const keep = entry.source.kind !== "copy" || entry.source.text.length <= COPY_MAX_CHARS;
  return (keep ? [entry, ...rest] : rest).slice(0, max);
}

/** Does a row match the search (every word, in its name or title, ignoring case)? */
export function matches(query: string, name: string, title?: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${name} ${title ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The windows folder's files sorted by name (ignoring case, numbers in order). */
export function byName<T extends { path: string }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => baseName(a.path).localeCompare(baseName(b.path), undefined, { sensitivity: "base", numeric: true }));
}
