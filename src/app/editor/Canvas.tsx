/**
 * The canvas: the window drawn by the core as the client lays it out, with the editor's overlay on top: the hovered
 * element, the selected one (its margin, its own box, its padding), problem markers, and the insertion mark while
 * dragging (an element to reorder it, or a palette entry to add one). The selection (or the window, when nothing is
 * selected) has resize handles: right edge, bottom edge and corner, snapped to the grid step (Shift: 1 px).
 *
 * Several elements can be selected: Ctrl/Cmd-click toggles one, Shift-click takes the siblings between the key element
 * (the first picked, outlined more strongly) and the one clicked, and a box dragged from an empty place (outside the
 * elements, a row's or column's background, or a spacer: they draw nothing) picks what is drawn fully inside it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { specOf } from "../../core/edit/catalog.js";
import { type DropHit, type Placed, dropAt, elementAt, placements } from "../../core/edit/drop.js";
import type { EditorDoc } from "../../core/edit/project.js";
import { DEFAULT_GRID, type SizeChange, dragSize, elementSize, resizeElement, resizeWindow, windowSize } from "../../core/edit/resize.js";
import { toNuiDocument } from "../../core/edit/project.js";
import { type DropTarget, type ElemPath, getElem, pathIndex, samePath, typeOf } from "../../core/edit/tree.js";
import { type Selection, boxSelect } from "../../core/edit/selection.js";
import type { Finding } from "../../core/edit/validate.js";
import { type Rect, defaultMargin, marginOf, paddingOf } from "../../core/layout/layout.js";
import type { JsonObject } from "../../core/model/types.js";
import { useDevicePixelRatio } from "./useDpr.js";
import { clampZoom, zoomRendering } from "./zoom.js";
import { type Outline, type Problem } from "../../core/render/render.js";
import { editorProblems } from "../../core/edit/issues.js";
import type { Resources } from "../../core/session.js";
import { renderView } from "../../core/view.js";
import { browserCanvas } from "../platform.js";
import { Icon, typeIcon } from "./icons.js";
import { layoutSeverity } from "./ProblemsPanel.js";
import { errorText } from "../../core/errors.js";

export const PALETTE_MIME = "application/x-nui-palette-";

export interface CanvasSettings {
  canvasW: number;
  canvasH: number;
  scale: number;
  zoom: number;
  markers: boolean;
  outlines: boolean;
  /** The grid step sizes snap to, in layout units (default 4). */
  grid?: number;
  /** Draw the selected combo's open list (as the client opens it, below the combo, past the window if need be). */
  openList?: boolean;
}

export interface Rendered {
  outlines: Outline[];
  problems: Problem[];
  pathOf: Map<JsonObject, ElemPath>;
  placed: Map<string, Placed>;
  /** The window that was drawn (the doc's window object at the time). */
  window: JsonObject;
  windowRect: Rect;
}

interface Props {
  doc: EditorDoc;
  res: Resources | null;
  settings: CanvasSettings;
  /** The selected elements, the key first ([]: the window). */
  sels: Selection;
  findings: Finding[];
  onSelect(p: ElemPath | null): void;
  /** Ctrl/Cmd-click (toggle) or Shift-click (range) on an element. */
  onPick?(p: ElemPath, how: "toggle" | "range"): void;
  /** A box dragged on the canvas picked these (add: Ctrl/Cmd or Shift held, they join the selection). */
  onBox?(paths: ElemPath[], add: boolean): void;
  onMove(from: ElemPath, to: DropTarget): void;
  onAdd(type: string, to: DropTarget): void;
  /**
   * A resize in progress: the document as fn makes it from the one before the drag (shown, not yet an undo step).
   * Without it (a preview that cannot be edited) there are no resize handles.
   */
  onLive?(fn: (d: EditorDoc) => EditorDoc): void;
  /** The drag ended: commit makes it one undo step, else the size before the drag comes back. */
  onLiveEnd?(commit: boolean): void;
  /** A one-step edit (double-clicking a handle clears the size). */
  onApply?(fn: (d: EditorDoc) => EditorDoc): void;
  onRendered(r: Rendered): void;
  onZoom(z: number): void;
  onError(text: string | null): void;
}

type Handle = "e" | "s" | "se";
const HANDLES: Handle[] = ["e", "s", "se"];
const HANDLE_TITLE: Record<Handle, string> = {
  e: "Drag to set the width (Shift: 1 px steps). Double-click: automatic width",
  s: "Drag to set the height (Shift: 1 px steps). Double-click: automatic height",
  se: "Drag to set the width and height (Shift: 1 px steps). Double-click: automatic size",
};
const WINDOW_HANDLE_TITLE: Record<Handle, string> = {
  e: "Drag to set the window's width (Shift: 1 px steps)",
  s: "Drag to set the window's height (Shift: 1 px steps)",
  se: "Drag to set the window's size (Shift: 1 px steps)",
};

interface Resize {
  /** The element, or null for the window. */
  path: ElemPath | null;
  handle: Handle;
  x: number;
  y: number;
  start: [number, number];
  /** 2 on an axis where the window's drawing is centred in the stage (its edge moves half as far as its size changes). */
  factor: [number, number];
  /** The size now, and the pointer (for the read-out). */
  size: [number, number];
  cx: number;
  cy: number;
}

export function Canvas({ doc, res, settings, sels, findings, onSelect, onPick, onBox, onMove, onAdd, onLive, onLiveEnd, onApply, onRendered, onZoom, onError }: Props) {
  const sel = sels.length === 1 ? sels[0]! : null;
  const holder = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ w: number; h: number; ox: number; oy: number; s: number; r: Rendered } | null>(null);
  const [hover, setHover] = useState<ElemPath | null>(null);
  const [drop, setDrop] = useState<DropHit | null>(null);
  const drag = useRef<{ path: ElemPath; x: number; y: number; active: boolean } | null>(null);
  // A box being dragged from an empty place: where it started (document units) and the pointer now.
  const boxStart = useRef<{ path: ElemPath | null; x: number; y: number; cx: number; cy: number; add: boolean; active: boolean } | null>(null);
  const [boxRect, setBoxRect] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState<ElemPath | null>(null);
  const [resize, setResize] = useState<Resize | null>(null);
  const z = settings.zoom;
  const dpr = useDevicePixelRatio();

  // The selected combo, when its open list is to be drawn.
  const selElem = sel ? getElem(doc.window, sel) : null;
  const openCombo = settings.openList && selElem && typeOf(selElem) === "combo" ? selElem : null;

  // Draw: after each change, briefly debounced so typing does not queue up renders.
  useEffect(() => {
    if (!res) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await renderView(toNuiDocument(doc), res.skin, res.images, browserCanvas, {
          canvasW: settings.canvasW,
          canvasH: settings.canvasH,
          crop: true,
          scale: settings.scale,
          openCombo,
        });
        if (cancelled) return;
        const c = r.canvas as unknown as HTMLCanvasElement;
        c.className = "nui-canvas";
        holder.current?.replaceChildren(c);
        const pathOf = pathIndex(doc.window);
        const rendered: Rendered = { outlines: r.outlines, problems: r.problems, pathOf, placed: placements(r.outlines, pathOf), window: doc.window, windowRect: r.windowRect };
        setView({ w: c.width, h: c.height, ox: r.origin[0], oy: r.origin[1], s: r.scale, r: rendered });
        onRendered(rendered);
        onError(null);
      } catch (e) {
        onError(`drawing failed: ${errorText(e)}`);
      }
    }, 40);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // onRendered and onError are stable enough: the render depends on the document and the settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.window, doc.binds, doc.panes, res, settings.canvasW, settings.canvasH, settings.scale, openCombo]);

  // Canvas pixels in the document's coordinates, and back.
  const toDoc = useCallback(
    (e: { clientX: number; clientY: number }): [number, number] | null => {
      if (!view || !holder.current) return null;
      const b = holder.current.getBoundingClientRect();
      return [(e.clientX - b.left) / (view.s * z) + view.ox, (e.clientY - b.top) / (view.s * z) + view.oy];
    },
    [view, z],
  );
  const box = useCallback(
    (r: Rect, grow = 0): React.CSSProperties => {
      if (!view) return { display: "none" };
      const k = view.s * z;
      return { left: (r[0] - view.ox - grow) * k, top: (r[1] - view.oy - grow) * k, width: (r[2] + 2 * grow) * k, height: (r[3] + 2 * grow) * k };
    },
    [view, z],
  );

  // While a size is dragged the last drawing stays up (the handles stay under the pointer) until the next one is ready.
  const current = view && (view.r.window === doc.window || resize) ? view.r : null;
  const hit = useCallback((x: number, y: number) => (current ? elementAt(current.outlines, current.pathOf, x, y) : null), [current]);

  // An empty place: outside every element, the root, a row's or column's background or a spacer (they draw nothing;
  // a spacer with a draw list does).
  const empty = (path: ElemPath | null) => {
    if (!path || !path.length) return true;
    const e = getElem(doc.window, path);
    const t = typeOf(e);
    return t === "row" || t === "col" || (t === "spacer" && !(Array.isArray(e?.draw_list) && e.draw_list.length));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toDoc(e);
    if (!p) return;
    const path = hit(p[0], p[1]);
    const mod = e.ctrlKey || e.metaKey;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (empty(path)) {
      // A click selects it (the window, outside); a drag draws a box.
      boxStart.current = { path, x: p[0], y: p[1], cx: e.clientX, cy: e.clientY, add: mod || e.shiftKey, active: false };
      return;
    }
    if (mod && path) return onPick?.(path, "toggle");
    if (e.shiftKey && path) return onPick?.(path, "range");
    onSelect(path);
    if (path && path.length) drag.current = { path, x: e.clientX, y: e.clientY, active: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toDoc(e);
    if (!p) return;
    const b = boxStart.current;
    if (b) {
      if (!b.active && Math.hypot(e.clientX - b.cx, e.clientY - b.cy) > 5) b.active = true;
      if (b.active) setBoxRect([Math.min(b.x, p[0]), Math.min(b.y, p[1]), Math.abs(p[0] - b.x), Math.abs(p[1] - b.y)]);
      return;
    }
    const d = drag.current;
    if (d) {
      if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
        d.active = true;
        setDragging(d.path);
      }
      if (d.active && current) setDrop(dropAt(doc.window, current.placed, p[0], p[1], d.path, null));
      return;
    }
    setHover(hit(p[0], p[1]));
  };
  const endDrag = (commit: boolean) => {
    const b = boxStart.current;
    if (b) {
      boxStart.current = null;
      setBoxRect(null);
      if (!commit) return;
      if (!b.active) {
        // A click on an empty place: Ctrl/Shift keep the selection; else it selects what was clicked (the window).
        if (!b.add) onSelect(b.path && b.path.length ? b.path : null);
        return;
      }
      if (current && boxRect) onBox?.(boxSelect(doc.window, current.placed, boxRect), b.add);
      return;
    }
    const d = drag.current;
    drag.current = null;
    setDragging(null);
    if (d?.active && commit && drop && !drop.refused) onMove(d.path, drop.target);
    setDrop(null);
  };

  // Palette drops (HTML drag and drop; the type is in the drag's MIME type, readable during dragover).
  const paletteType = (e: React.DragEvent): string | null => {
    const t = Array.from(e.dataTransfer.types).find((x) => x.startsWith(PALETTE_MIME));
    return t ? t.slice(PALETTE_MIME.length) : null;
  };
  const made = useMemo(() => new Map<string, JsonObject>(), []);
  const onDragOver = (e: React.DragEvent) => {
    const t = paletteType(e);
    const p = toDoc(e);
    if (!t || !p || !current) return;
    e.preventDefault();
    let elem = made.get(t);
    if (!elem) made.set(t, (elem = specOf(t)?.make() ?? { type: t }));
    const h = dropAt(doc.window, current.placed, p[0], p[1], null, elem);
    e.dataTransfer.dropEffect = h && !h.refused ? "copy" : "none";
    setDrop(h);
  };
  const onDrop = (e: React.DragEvent) => {
    const t = paletteType(e);
    e.preventDefault();
    if (t && drop && !drop.refused) onAdd(t, drop.target);
    setDrop(null);
  };

  // Resizing: a handle's pointerdown starts it; moves, the button's release and Escape are followed on the window.
  const startResize = (e: React.PointerEvent, handle: Handle, path: ElemPath | null, rect: Rect) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    let start: [number, number];
    let factor: [number, number] = [1, 1];
    if (path) {
      const elem = getElem(doc.window, path);
      if (!elem) return;
      start = elementSize(elem, [rect[2], rect[3]]);
    } else {
      start = windowSize(doc);
      // The drawing is cropped to the window and centred in the stage while it fits: the edge then moves half as far.
      const st = stage.current;
      if (st) factor = [st.scrollWidth <= st.clientWidth ? 2 : 1, st.scrollHeight <= st.clientHeight ? 2 : 1];
    }
    setHover(null);
    setResize({ path, handle, x: e.clientX, y: e.clientY, start, factor, size: start, cx: e.clientX, cy: e.clientY });
  };
  const clearSize = (e: React.MouseEvent, handle: Handle, path: ElemPath | null) => {
    e.stopPropagation();
    if (!path) return;
    onApply?.((d) => resizeElement(d, path, { w: handle === "s" ? undefined : null, h: handle === "e" ? undefined : null }));
  };
  const resizing = useRef<{ move(e: PointerEvent): void; end(commit: boolean): void }>({ move() {}, end() {} });
  resizing.current = {
    move(e) {
      const r = resize;
      if (!r) return;
      const kk = view ? view.s * z : 1;
      const free = e.shiftKey;
      const grid = settings.grid ?? DEFAULT_GRID;
      const w = r.handle !== "s" ? dragSize(r.start[0], e.clientX - r.x, kk, grid, free, r.factor[0]) : r.start[0];
      const h = r.handle !== "e" ? dragSize(r.start[1], e.clientY - r.y, kk, grid, free, r.factor[1]) : r.start[1];
      const change: SizeChange = { w: r.handle !== "s" ? w : undefined, h: r.handle !== "e" ? h : undefined };
      if (w !== r.size[0] || h !== r.size[1]) onLive?.((d) => (r.path ? resizeElement(d, r.path, change) : resizeWindow(d, change)));
      setResize({ ...r, size: [w, h], cx: e.clientX, cy: e.clientY });
    },
    end(commit) {
      if (!resize) return;
      onLiveEnd?.(commit);
      setResize(null);
    },
  };
  const isResizing = resize !== null;
  useEffect(() => {
    if (!isResizing) return;
    const move = (e: PointerEvent) => resizing.current.move(e);
    const up = () => resizing.current.end(true);
    const cancel = () => resizing.current.end(false);
    // Escape cancels the drag, and only that (the editor's own Escape would select the parent).
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      resizing.current.end(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
    };
  }, [isResizing]);

  // Ctrl + wheel zooms.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      onZoom(clampZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [z, onZoom]);

  // The selected element: its first drawn rect, and the others (list rows) faintly.
  const selRects = useMemo(() => {
    if (!current || !sel) return [];
    return current.outlines.filter((o) => o.visible && samePath(current.pathOf.get(o.elem), sel)).map((o) => o.rect);
  }, [current, sel]);
  // Several selected: each one's rect, the key's marked.
  const multiRects = useMemo(() => {
    if (!current || sels.length < 2) return [];
    return sels.map((p, i) => ({ p, key: i === 0, rect: current.placed.get(p.join("/"))?.rect })).filter((x): x is { p: ElemPath; key: boolean; rect: Rect } => !!x.rect);
  }, [current, sels]);
  const hoverRect = current && hover && !sels.some((s) => samePath(hover, s)) ? current.placed.get(hover.join("/"))?.rect : null;
  const hoverElem = hover ? getElem(doc.window, hover) : null;

  // Markers: one per element with problems (the worst severity), numbered by count.
  const markers = useMemo(() => {
    if (!current || !settings.markers) return [];
    const by = new Map<string, { path: ElemPath; n: number; worst: "error" | "warning" | "info"; texts: string[] }>();
    const add = (path: ElemPath | null, sev: "error" | "warning" | "info", text: string) => {
      if (!path) return;
      const k = path.join("/");
      const m = by.get(k) ?? { path, n: 0, worst: "info" as const, texts: [] };
      m.n++;
      m.texts.push(text);
      if (sev === "error" || (sev === "warning" && m.worst === "info")) m.worst = sev;
      by.set(k, m);
    };
    for (const p of editorProblems(current.problems, doc.window, doc.binds)) add(p.elem ? (current.pathOf.get(p.elem) ?? null) : null, layoutSeverity(p.kind), `${p.kind}: ${p.text}`);
    for (const f of findings) add(f.path, f.severity, `${f.kind}: ${f.text}`);
    return [...by.values()].map((m) => ({ ...m, rect: current.placed.get(m.path.join("/"))?.rect })).filter((m) => m.rect);
  }, [current, findings, settings.markers, doc]);

  const k = view ? view.s * z : 1;
  // The handles: on the selected element (its first drawn rect), or on the window when nothing is selected.
  const handleRect: Rect | null = sels.length > 1 ? null : sel ? (selRects[0] ?? null) : current ? current.windowRect : null;
  const handlePath = sel;
  const showHandles = !!onLive && !!handleRect && !dragging && (!resize || samePath(resize.path, handlePath));
  const margin = selElem ? marginOf(selElem) : 0;
  const padding = selElem ? paddingOf(selElem) : 0;

  return (
    <div className="stage" ref={stage} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}>
      <div className="stage-inner">
        <div className="canvas-wrap" style={view ? { width: view.w * z, height: view.h * z } : undefined}>
          {/* The canvas is sized, not transformed: its pixels are copied when the zoom is a whole number of device pixels each. */}
          <div ref={holder} className="canvas-holder" data-rendering={zoomRendering(z, dpr)} style={view ? { width: view.w * z, height: view.h * z, imageRendering: zoomRendering(z, dpr) } : undefined} />
          {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer selection and dragging on the drawn window; the keyboard selects and moves in the tree */}
          <div
            className={`overlay${dragging ? " dragging" : ""}${resize ? ` resizing-${resize.handle}` : ""}`}
            data-testid="canvas-overlay"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => endDrag(true)}
            onPointerCancel={() => endDrag(false)}
            onPointerLeave={() => !drag.current && setHover(null)}
            onKeyDown={(e) => e.key === "Escape" && endDrag(false)}
          >
            {settings.outlines && current && current.outlines.filter((o) => o.visible && o.isSpan).map((o, i) => <div key={i} className="ov-span" style={box(o.rect)} />)}
            {hoverRect && (
              <div className="ov-hover" style={box(hoverRect)}>
                <span className="ov-tag">{typeOf(hoverElem!)}{hoverElem?.id ? ` '${String(hoverElem.id)}'` : ""}</span>
              </div>
            )}
            {selRects.slice(1).map((r, i) => <div key={i} className="ov-row" style={box(r)} />)}
            {selRects[0] && (
              <>
                <div className="ov-margin" style={{ ...box(selRects[0], margin), borderWidth: Math.max(1, margin * k) }} />
                {padding > 0 && <div className="ov-padding" style={{ ...box(selRects[0]), borderWidth: padding * k }} />}
                <div className="ov-sel" style={box(selRects[0])}>
                  <span className="ov-tag sel">
                    <Icon name={typeIcon(typeOf(selElem!))} size={12} />
                    {typeOf(selElem!)}
                    {selElem?.id ? ` '${String(selElem.id)}'` : ""} · {fmt(selRects[0][2])} × {fmt(selRects[0][3])}
                    {selElem && margin !== defaultMargin(selElem.type) ? ` · margin ${fmt(margin)}` : ""}
                    {padding ? ` · padding ${fmt(padding)}` : ""}
                  </span>
                </div>
              </>
            )}
            {multiRects.map(({ p, key, rect }) => {
              const e = getElem(doc.window, p);
              return (
                <div key={p.join("/")} className={`ov-sel multi${key ? " key" : ""}`} style={box(rect)} data-testid={key ? "sel-key" : "sel-multi"}>
                  {key && (
                    <span className="ov-tag key">
                      <Icon name={typeIcon(typeOf(e))} size={12} />
                      key · {typeOf(e)}
                      {e?.id ? ` '${String(e.id)}'` : ""} · {sels.length} selected
                    </span>
                  )}
                </div>
              );
            })}
            {boxRect && <div className="ov-box" style={box(boxRect)} data-testid="select-box" />}
            {showHandles && (
              <div className={`ov-handles${handlePath ? "" : " window"}`} style={box(handleRect!)} data-testid="resize-handles">
                {HANDLES.map((h) => (
                  <div
                    key={h}
                    className={`ov-h ov-h-${h}${resize?.handle === h ? " on" : ""}`}
                    data-handle={h}
                    title={(handlePath ? HANDLE_TITLE : WINDOW_HANDLE_TITLE)[h]}
                    onPointerDown={(e) => startResize(e, h, handlePath, handleRect!)}
                    onDoubleClick={(e) => clearSize(e, h, handlePath)}
                  />
                ))}
              </div>
            )}
            {markers.map((m) => (
              <div key={m.path.join("/")} className={`ov-marker ${m.worst}`} style={markerPos(box(m.rect!))} title={m.texts.join("\n")}>
                {m.n}
              </div>
            ))}
            {drop && (
              <>
                <div className={`ov-drop-box${drop.refused ? " refused" : ""}`} style={box(drop.box)} />
                <div className={`ov-drop${drop.refused ? " refused" : ""}`} style={box(drop.mark)} />
                {drop.refused && (
                  <div className="ov-refused" style={markerPos(box(drop.box), true)}>
                    {drop.refused}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {!res && <div className="stage-note">Loading the skin…</div>}
      {dragging && <div className="stage-note">Drop to move · Esc to cancel</div>}
      {boxRect && <div className="stage-note">Selects what is fully inside · Ctrl or Shift adds to the selection</div>}
      {resize && <div className="stage-note">Shift: 1 px steps · Esc to cancel</div>}
      {resize && (
        <div className="ov-readout" data-testid="resize-readout" style={{ left: resize.cx + 14, top: resize.cy + 16 }}>
          {resize.handle === "s" ? `h ${fmt(resize.size[1])}` : resize.handle === "e" ? `w ${fmt(resize.size[0])}` : `${fmt(resize.size[0])} × ${fmt(resize.size[1])}`}
        </div>
      )}
    </div>
  );
}

function fmt(v: number): string {
  return String(Math.round(v * 10) / 10);
}

function markerPos(b: React.CSSProperties, below = false): React.CSSProperties {
  const left = Number(b.left ?? 0);
  const top = Number(b.top ?? 0);
  const width = Number(b.width ?? 0);
  return below ? { left, top: top + Number(b.height ?? 0) + 4 } : { left: left + width - 9, top: top - 9 };
}
