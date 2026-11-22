/**
 * The window as a point-based client (iOS) builds it, for the mobile preview: a copy of the window JSON with what
 * iOS multiplies by the size factor fd = d multiplied, whatever the GUI scale (NUI-MOBILE-020): every element's
 * margin, the default 2 included (NUI-MOBILE-021), each list's row_height (NUI-MOBILE-022), its template's cell
 * widths, never narrower than the drawn minimum (NUI-MOBILE-023, -024), and every draw-list coordinate and size and
 * line thickness (NUI-MOBILE-025; nui_touch.nss divides the thickness too). Sizes, fonts and glyphs stay as they are.
 * The window's position is multiplied by fp = d / s instead (preview.ts). The renderer does the rest (the window position, the list inset and row spacing, the
 * frame: render.ts, RenderClient), so the desktop path is never touched.
 *
 * The copies are kept per (window, binds, client) so the layout cache (layout.ts) finds the same objects on every
 * redraw, and each copy maps back to the element it was made from (the editor's outlines and problems name those).
 */
import { marginOf } from "../layout/layout.js";
import { type Binds, type JsonObject, type JsonValue, isObject } from "../model/types.js";
import type { ClientProfile } from "./client.js";

/** The draw-list keys that hold coordinates or sizes, multiplied on iOS (NUI-MOBILE-025). Not image_region (texels);
 * line_thickness is multiplied on its own. */
export const DRAW_COORD_KEYS = ["rect", "points", "a", "b", "c", "ctrl0", "ctrl1", "radius"] as const;

/** NuiList's row height when the JSON has none (NUI-LIST-001). */
export const DEFAULT_ROW_HEIGHT = 25;

export interface PointWindow {
  window: JsonObject;
  binds: Binds;
  /** Each copied element to the element it was made from. */
  original: Map<JsonObject, JsonObject>;
  /** The other way. */
  copyOf: Map<JsonObject, JsonObject>;
}

/** A number, a {x, y, w, h} or {x, y} object, or an array of them, multiplied by f (anything else as it is). */
export function scaleGeom(v: JsonValue | undefined, f: number): JsonValue | undefined {
  if (typeof v === "number") return v * f;
  if (Array.isArray(v)) return v.map((x) => scaleGeom(x, f) as JsonValue);
  if (isObject(v) && typeof v.bind !== "string") {
    const o: JsonObject = { ...v };
    for (const k of ["x", "y", "w", "h"]) if (typeof o[k] === "number") o[k] = (o[k] as number) * f;
    return o;
  }
  return v;
}

interface Transformed {
  window: JsonObject;
  original: Map<JsonObject, JsonObject>;
  copyOf: Map<JsonObject, JsonObject>;
  /** Binds that hold draw-list coordinates: their values are multiplied too. */
  geomBinds: Set<string>;
}

/** The copies per window and client: the same objects on every redraw, so the layout cache keeps working. */
const cache = new WeakMap<JsonObject, Map<string, Transformed>>();

/** The window as iOS builds it (null when the client is desktop-like: draw the window itself). */
export function pointWindow(win: JsonObject, binds: Binds, p: ClientProfile): PointWindow | null {
  if (!p.pointBased) return null;
  const key = `${p.fd} ${p.minCell}`;
  let byClient = cache.get(win);
  if (!byClient) cache.set(win, (byClient = new Map()));
  let t = byClient.get(key);
  if (!t) byClient.set(key, (t = transform(win, p)));
  const outBinds: Binds = { ...binds };
  for (const b of t.geomBinds) if (b in binds) outBinds[b] = scaleGeom(binds[b], p.fd) as JsonValue;
  return { window: t.window, binds: outBinds, original: t.original, copyOf: t.copyOf };
}

function transform(win: JsonObject, p: ClientProfile): Transformed {
  const f = p.fd;
  const original = new Map<JsonObject, JsonObject>();
  const copyOf = new Map<JsonObject, JsonObject>();
  const geomBinds = new Set<string>();

  const item = (it: JsonValue): JsonValue => {
    if (!isObject(it)) return it;
    const o: JsonObject = { ...it };
    for (const k of DRAW_COORD_KEYS) {
      const v = o[k];
      if (v === undefined) continue;
      if (isObject(v) && typeof v.bind === "string") geomBinds.add(v.bind);
      else o[k] = scaleGeom(v, f)!;
    }
    if (typeof o.line_thickness === "number") o.line_thickness *= f;
    return o;
  };

  const elem = (e: JsonObject): JsonObject => {
    const o: JsonObject = { ...e };
    const m = marginOf(e);
    if (m > 0) o.margin = m * f;
    if (Array.isArray(e.children)) o.children = e.children.map((c) => (isObject(c) ? elem(c) : c));
    if (Array.isArray(e.draw_list)) o.draw_list = e.draw_list.map(item);
    if (e.type === "list") {
      o.row_height = (typeof e.row_height === "number" ? e.row_height : DEFAULT_ROW_HEIGHT) * f;
      if (Array.isArray(e.row_template)) {
        o.row_template = e.row_template.map((c) => {
          if (!Array.isArray(c) || !c.length || !isObject(c[0])) return c;
          const w = typeof c[1] === "number" ? c[1] : 0;
          const cell: JsonValue[] = [...c];
          cell[0] = elem(c[0]);
          if (c.length > 1) cell[1] = Math.max(w * f, p.minCell);
          return cell;
        });
      }
    }
    original.set(o, e);
    copyOf.set(e, o);
    return o;
  };

  const window: JsonObject = { ...win };
  if (isObject(win.root)) window.root = elem(win.root);
  return { window, original, copyOf, geomBinds };
}
