/**
 * The editor's document, and its project file: the window's JSON, the sample bind values the canvas is drawn with,
 * pane layouts (nui-preview dumps carry them), the designer's notes and the export settings. A project is JSON:
 *
 *   {"format": "nwn-nui-designer/project", "version": 1, "name", "window", "binds", "panes", "notes", "export"}
 *
 * Open also takes everything the viewer takes (a .jui, JsonDump of a window, a nui-preview dump, a bare layout).
 */
import { InputError, parseJsonText, toDocument } from "../model/input.js";
import { type Binds, type JsonObject, type JsonValue, type NuiDocument, isObject } from "../model/types.js";

export const PROJECT_FORMAT = "nwn-nui-designer/project";
export const PROJECT_VERSION = 1;
export const PROJECT_EXT = ".nuidesign.json";

export interface ExportSettings {
  /** The .jui's resref (NuiCreateFromResRef's sResRef). */
  resref: string;
  /** The window id the NWScript opens it with. */
  windowId: string;
  /** The NWScript's file name (its resref), which is also its event script. */
  script: string;
  /** Prefix of the NWScript's functions and constants. */
  prefix: string;
}

export interface EditorDoc {
  name: string;
  window: JsonObject;
  /** Sample bind values: what the canvas draws with, and what the NWScript skeleton sets first. */
  binds: Binds;
  panes: Record<string, JsonObject>;
  notes: string;
  export: ExportSettings;
}

export type SourceKind = "project" | "jui" | "dump" | "layout";

/** Lower case letters, digits and _, at most n characters (resrefs, ids). */
export function slug(s: string, n = 16): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, n);
  return out || "window";
}

export function defaultExport(name: string): ExportSettings {
  const s = slug(name, 12);
  const prefix = s.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase()).replace(/_/g, "");
  return { resref: slug(name, 16), windowId: s, script: slug(`nui_${s}`, 16), prefix: /^[A-Za-z]/.test(prefix) ? prefix : `W${prefix}` };
}

export function fromNuiDocument(d: NuiDocument, notes = "", exp?: Partial<ExportSettings>): EditorDoc {
  return { name: d.name, window: d.window, binds: d.binds, panes: d.panes, notes, export: { ...defaultExport(d.name), ...exp } };
}

export function toNuiDocument(d: EditorDoc): NuiDocument {
  return { name: d.name, form: d.export.windowId, window: d.window, binds: d.binds, panes: d.panes };
}

/** Reads any accepted input; says what it was. */
export function openText(text: string, name = "window"): { doc: EditorDoc; kind: SourceKind } {
  const v = parseJsonText(text);
  if (isObject(v) && v.format === PROJECT_FORMAT) return { doc: readProject(v), kind: "project" };
  const nd = toDocument(v, name);
  let kind: SourceKind = "jui";
  if (isObject(v) && isObject(v.window)) kind = "dump";
  else if (isObject(v) && !("root" in v)) kind = "layout";
  return { doc: fromNuiDocument(nd), kind };
}

export function readProject(v: JsonObject): EditorDoc {
  if (typeof v.version === "number" && v.version > PROJECT_VERSION) {
    throw new InputError(`this project was saved by a newer version (format ${v.version}; this reads ${PROJECT_VERSION})`);
  }
  if (!isObject(v.window)) throw new InputError("the project has no window");
  const name = typeof v.name === "string" ? v.name : "window";
  const panes: Record<string, JsonObject> = {};
  if (isObject(v.panes)) for (const [k, p] of Object.entries(v.panes)) if (isObject(p)) panes[k] = p;
  const exp = isObject(v.export) ? v.export : {};
  const pick = (k: keyof ExportSettings) => (typeof exp[k] === "string" ? (exp[k] as string) : undefined);
  const d = defaultExport(name);
  return {
    name,
    window: v.window,
    binds: isObject(v.binds) ? (v.binds as Binds) : {},
    panes,
    notes: typeof v.notes === "string" ? v.notes : "",
    export: { resref: pick("resref") ?? d.resref, windowId: pick("windowId") ?? d.windowId, script: pick("script") ?? d.script, prefix: pick("prefix") ?? d.prefix },
  };
}

export function projectJson(d: EditorDoc): JsonObject {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: d.name,
    window: d.window,
    binds: d.binds,
    panes: d.panes,
    notes: d.notes,
    export: d.export as unknown as JsonValue,
  };
}

export function writeProject(d: EditorDoc): string {
  return JSON.stringify(projectJson(d), null, 1) + "\n";
}

/** The nui-preview dump format ({name, form, window, binds, panes}), for nui-preview and the viewer. */
export function writeDump(d: EditorDoc): string {
  return JSON.stringify({ name: d.name, form: d.export.windowId, window: d.window, binds: d.binds, panes: d.panes }, null, 1) + "\n";
}
