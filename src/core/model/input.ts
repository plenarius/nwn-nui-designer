/**
 * What the viewer opens, in whatever form it comes: a .jui file (a window's JSON, loaded in game with
 * NuiCreateFromResRef), JsonDump of an NuiWindow (the same JSON, maybe pretty-printed or as a quoted JSON string from a
 * log), nui-preview's dump {name, form, window, binds, panes}, or a bare layout element.
 */
import { type Binds, type JsonObject, type JsonValue, type NuiDocument, isObject } from "./types.js";
import { errorText } from "../errors.js";

export class InputError extends Error {}

/** Parses text as JSON; a JSON string that itself holds JSON (a JsonDump copied with its quotes) is parsed again. */
export function parseJsonText(text: string): JsonValue {
  let v: JsonValue;
  try {
    v = JSON.parse(text.replace(/^﻿/, "")) as JsonValue;
  } catch (e) {
    throw new InputError(`not JSON: ${errorText(e)}`);
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("{")) return parseJsonText(t);
  }
  return v;
}

/** Turns any of the accepted forms into a document. name is used when the input has none (a file's name). */
export function toDocument(v: JsonValue, name = "window"): NuiDocument {
  if (!isObject(v)) throw new InputError("expected a JSON object: a window, a .jui, or a nui-preview dump");
  if (isObject(v.window) && ("binds" in v || "form" in v || "panes" in v)) {
    const binds = isObject(v.binds) ? (v.binds as Binds) : {};
    const panes: Record<string, JsonObject> = {};
    if (isObject(v.panes)) for (const [k, p] of Object.entries(v.panes)) if (isObject(p)) panes[k] = p;
    return {
      name: typeof v.name === "string" ? v.name : name,
      form: typeof v.form === "string" ? v.form : name,
      window: v.window,
      binds,
      panes,
    };
  }
  if ("root" in v) return { name, form: name, window: v, binds: {}, panes: {} };
  if (typeof v.type === "string") {
    // A bare layout: shown in a window of its own, as nui-preview does.
    return {
      name,
      form: name,
      window: { root: v, geometry: { x: -1, y: -1, w: 600, h: 400 }, title: name },
      binds: {},
      panes: {},
    };
  }
  throw new InputError('no "root" (a window), "window" (a dump) or "type" (a layout) in this JSON');
}

export function loadDocument(text: string, name = "window"): NuiDocument {
  return toDocument(parseJsonText(text), name);
}

/** The document as the dump format (what the viewer saves, with the binds as edited). */
export function toDumpJson(doc: NuiDocument): JsonObject {
  return { name: doc.name, form: doc.form, window: doc.window, binds: doc.binds, panes: doc.panes };
}
