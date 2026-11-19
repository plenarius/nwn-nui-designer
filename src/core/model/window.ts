/**
 * What a window's JSON turns on in its chrome, as the client's JsonWindow::Initialize reads it
 * (docs/CLIENT-BEHAVIOUR.md#window-frame). A bound key starts in the state below and follows the bind once it is set;
 * the designer takes the bind's sample value when it has one.
 *
 * | key            | true               | false   | null               | missing | bind, no sample   |
 * |----------------|--------------------|---------|--------------------|---------|-------------------|
 * | collapsed      | button, collapsed  | none    | button, expanded   | none    | button, expanded  |
 * | closable       | shown              | hidden  | shown              | shown   | shown             |
 * | border         | drawn              | none    | none               | drawn   | none              |
 * | transparent    | no background      | opaque  | opaque             | opaque  | opaque            |
 * | accepts_input  | on                 | off     | on                 | on      | on                |
 * | resizable      | yes                | no      | yes (docs)         | yes     | yes               |
 *
 * The title bar is hidden only when the title is empty and both buttons are off. A title of false (or null) is empty.
 */
import { type Binds, type JsonValue, isObject } from "./types.js";
import { truthy } from "../render/values.js";

export interface WindowChrome {
  /** The close button. */
  close: boolean;
  /** The collapse button. */
  collapse: boolean;
  /** The window opens collapsed: only its title bar shows. */
  collapsed: boolean;
  /** The title as a value (a string, a number, a strref object), or null when it is empty. */
  title: JsonValue | null;
  /** The title bar. */
  header: boolean;
  border: boolean;
  transparent: boolean;
  acceptsInput: boolean;
  resizable: boolean;
}

type Read = { kind: "missing" } | { kind: "value"; value: JsonValue } | { kind: "unset bind" };

/** A key's value: the JSON's own, a bind's sample, or neither. */
function read(win: Record<string, unknown>, key: string, binds: Binds): Read {
  if (!(key in win)) return { kind: "missing" };
  const v = win[key] as JsonValue;
  if (isObject(v) && typeof v.bind === "string") {
    return v.bind in binds ? { kind: "value", value: binds[v.bind]! } : { kind: "unset bind" };
  }
  return { kind: "value", value: v };
}

/** A key that is on unless false (closable, accepts_input, resizable). */
function onUnlessFalse(r: Read): boolean {
  return r.kind !== "value" || r.value !== false;
}

export function windowChrome(win: Record<string, unknown>, binds: Binds = {}): WindowChrome {
  const c = read(win, "collapsed", binds);
  // A bind always shows the button, whatever its value (win.collapsed is then the bind object); a static value shows
  // it unless false.
  const collapse = c.kind !== "missing" && win.collapsed !== false;
  const collapsed = collapse && c.kind === "value" && c.value !== null && truthy(c.value);
  const close = onUnlessFalse(read(win, "closable", binds));
  const b = read(win, "border", binds);
  const border = b.kind === "missing" || (b.kind === "value" && truthy(b.value));
  const t = read(win, "transparent", binds);
  const transparent = t.kind === "value" && truthy(t.value);
  const ti = read(win, "title", binds);
  const tv = ti.kind === "value" ? ti.value : null;
  const title = tv === null || tv === false || tv === "" ? null : tv;
  return {
    close,
    collapse,
    collapsed,
    title,
    header: title !== null || close || collapse,
    border,
    transparent,
    acceptsInput: onUnlessFalse(read(win, "accepts_input", binds)),
    resizable: onUnlessFalse(read(win, "resizable", binds)),
  };
}

/**
 * One axis of a window's position (the client's geometry code at GUI scale 1): -1 centres the window on the screen, -2
 * puts its corner at the mouse, -3 centres it on the mouse; anything below 0 is clamped to 0. The designer has no
 * mouse: it takes the canvas centre (so -3 draws as -1, and -2 puts the corner in the middle).
 */
export function windowPosition(v: number, size: number, screen: number): number {
  let p: number;
  if (v === -1) p = screen / 2 - size / 2;
  else if (v === -2) p = screen / 2;
  else if (v === -3) p = screen / 2 - size / 2;
  else p = v;
  return Math.max(0, p);
}
