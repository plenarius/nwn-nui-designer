/**
 * The window's element tree: select, collapse, drag to reorder or re-nest (drop before, after or into a row, column,
 * group or list), drop palette entries, and a context menu with the tree edits. Ctrl/Cmd-click toggles a row in the
 * selection, Shift-click selects the rows from the key element (the first picked, marked "key") to the one clicked.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { specOf } from "../../core/edit/catalog.js";
import { type DropTarget, type ElemPath, cellOf, containerKind, elemLabel, getElem, isPrefix, kidsOf, moveRefusal, refusal, samePath, typeOf } from "../../core/edit/tree.js";
import type { Severity } from "../../core/edit/validate.js";
import type { JsonObject } from "../../core/model/types.js";
import { PALETTE_MIME } from "./Canvas.js";
import { type Selection, has, toggle, treeRange } from "../../core/edit/selection.js";
import { Icon, typeIcon } from "./icons.js";

export interface TreeActions {
  duplicate(p: ElemPath): void;
  remove(p: ElemPath): void;
  wrap(p: ElemPath, kind: "row" | "col" | "group"): void;
  unwrap(p: ElemPath): void;
  nudge(p: ElemPath, d: -1 | 1): void;
  copy(p: ElemPath): void;
  paste(target: DropTarget): void;
  move(from: ElemPath, to: DropTarget): void;
  add(type: string, to: DropTarget): void;
}

interface Row {
  path: ElemPath;
  elem: JsonObject;
  depth: number;
  cell: string | null;
}

let dragged: ElemPath | null = null;

/** The DOM id of a tree row (aria-activedescendant points at the selected one). */
const rowId = (key: string) => `tree-row-${key === "" ? "root" : key.replace(/\//g, "-")}`;

export function Tree({ win, panes = {}, sels, onSelect, onSels, issues, actions }: { win: JsonObject; panes?: Record<string, JsonObject>; sels: Selection; onSelect(p: ElemPath | null): void; onSels(s: Selection): void; issues: Map<string, { n: number; worst: Severity }>; actions: TreeActions }) {
  // The key element (the first selected) is where the keyboard walks from.
  const sel = sels[0] ?? null;
  const multi = sels.length > 1;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<{ key: string; zone: "before" | "after" | "inside"; refused: string | null } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; path: ElemPath } | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const rec = (e: JsonObject, path: ElemPath, depth: number, cell: string | null) => {
      out.push({ path, elem: e, depth, cell });
      if (collapsed.has(path.join("/"))) return;
      const isList = typeOf(e) === "list";
      kidsOf(e).forEach((c, i) => {
        const info = isList ? cellOf(e, i) : null;
        rec(c, [...path, i], depth + 1, info ? `cell ${info.width ? info.width : "auto"}${info.variable ? ", grows" : ""}` : null);
      });
    };
    if (win.root && typeof win.root === "object") rec(win.root as JsonObject, [], 0, null);
    return out;
  }, [win, collapsed]);

  // Keep the selection visible: expand its ancestors and scroll to it.
  useEffect(() => {
    if (!sel) return;
    setCollapsed((c) => {
      let changed = false;
      const n = new Set(c);
      for (let i = 0; i < sel.length; i++) {
        if (n.delete(sel.slice(0, i).join("/"))) changed = true;
      }
      return changed ? n : c;
    });
    const el = list.current?.querySelector(`[data-path="${sel.join("/")}"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  }, [sel]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const zoneOf = (e: React.DragEvent, row: Row): "before" | "after" | "inside" => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    const container = !!containerKind(row.elem);
    if (!row.path.length) return "inside";
    if (container && f > 0.28 && f < 0.72) return "inside";
    return f < 0.5 ? "before" : "after";
  };
  const targetOf = (row: Row, zone: "before" | "after" | "inside"): DropTarget =>
    zone === "inside" ? { parent: row.path, index: kidsOf(row.elem).length } : { parent: row.path.slice(0, -1), index: row.path[row.path.length - 1]! + (zone === "after" ? 1 : 0) };

  const paletteType = (e: React.DragEvent) => {
    const t = Array.from(e.dataTransfer.types).find((x) => x.startsWith(PALETTE_MIME));
    return t ? t.slice(PALETTE_MIME.length) : null;
  };

  const onDragOver = (e: React.DragEvent, row: Row) => {
    const type = paletteType(e);
    if (!type && !dragged) return;
    e.preventDefault();
    const zone = zoneOf(e, row);
    const target = targetOf(row, zone);
    let refused: string | null;
    if (dragged) refused = moveRefusal(win, dragged, target);
    else {
      const parent = getElem(win, target.parent);
      refused = parent ? refusal(parent, specOf(type!)?.make() ?? { type: type! }) : "no such element";
    }
    e.dataTransfer.dropEffect = refused ? "none" : dragged ? "move" : "copy";
    setOver({ key: row.path.join("/"), zone, refused });
  };
  const onDrop = (e: React.DragEvent, row: Row) => {
    e.preventDefault();
    const type = paletteType(e);
    const zone = zoneOf(e, row);
    const target = targetOf(row, zone);
    setOver(null);
    if (dragged) {
      const from = dragged;
      dragged = null;
      if (!moveRefusal(win, from, target)) actions.move(from, target);
    } else if (type) actions.add(type, target);
  };

  const keyDown = (e: React.KeyboardEvent) => {
    // Alt (resize, move), Ctrl and Meta arrows are the editor's shortcuts, not the tree's walk.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const i = rows.findIndex((r) => samePath(r.path, sel));
    if (e.key === "ArrowDown" && i < rows.length - 1) onSelect(rows[i + 1]!.path);
    else if (e.key === "ArrowUp") onSelect(i > 0 ? rows[i - 1]!.path : null);
    else if (e.key === "ArrowLeft" && sel) {
      const k = sel.join("/");
      const r = rows[i];
      if (r && containerKind(r.elem) && kidsOf(r.elem).length && !collapsed.has(k)) setCollapsed((c) => new Set(c).add(k));
      else if (sel.length) onSelect(sel.slice(0, -1));
    } else if (e.key === "ArrowRight" && sel) {
      setCollapsed((c) => {
        const n = new Set(c);
        n.delete(sel.join("/"));
        return n;
      });
    } else return;
    e.preventDefault();
  };

  return (
    <div
      className="tree"
      ref={list}
      role="tree"
      aria-label="Elements"
      aria-multiselectable="true"
      aria-activedescendant={rowId(sel ? sel.join("/") : "window")}
      tabIndex={0}
      onKeyDown={keyDown}
      data-testid="tree"
      onDragEnd={() => {
      dragged = null;
      setOver(null);
    }}>
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- focus stays on the tree, which handles the keys and points at this row (aria-activedescendant) */}
      <div id={rowId("window")} role="treeitem" aria-selected={sels.length === 0} aria-level={1} className={`tree-row window${sels.length === 0 ? " selected" : ""}`} onClick={() => onSelect(null)} data-path="window">
        <Icon name="window" />
        <span className="t-type">Window</span>
        <span className="t-text">{typeof win.title === "string" ? win.title : win.title === false ? "(no title bar)" : "{bound title}"}</span>
        {issues.get("window") && <IssueBadge {...issues.get("window")!} />}
      </div>
      {rows.map((row) => {
        const key = row.path.join("/");
        const container = !!containerKind(row.elem);
        const kids = kidsOf(row.elem).length;
        const isOver = over?.key === key;
        const issue = issues.get(key);
        const text = elemLabel(row.elem);
        return (
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- as the window's row above
          <div
            key={key}
            id={rowId(key)}
            role="treeitem"
            aria-selected={has(sels, row.path)}
            aria-level={row.depth + 2}
            aria-expanded={container && kids ? !collapsed.has(key) : undefined}
            data-path={key}
            className={`tree-row${has(sels, row.path) ? " selected" : ""}${multi && samePath(row.path, sel) ? " key" : ""}${!multi && sel && row.path.length > sel.length && isPrefix(sel, row.path) ? " inside-sel" : ""}${isOver ? ` drop-${over!.zone}${over!.refused ? " refused" : ""}` : ""}`}
            style={{ paddingLeft: 8 + row.depth * 14 }}
            draggable={row.path.length > 0}
            onDragStart={(e) => {
              dragged = row.path;
              e.dataTransfer.setData("text/plain", typeOf(row.elem));
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => onDragOver(e, row)}
            onDragLeave={() => isOver && setOver(null)}
            onDrop={(e) => onDrop(e, row)}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) onSels(toggle(sels, row.path));
              else if (e.shiftKey) onSels(treeRange(sels, row.path, rows.map((r) => r.path)));
              else onSelect(row.path);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              // On one of several selected, the menu acts on all of them.
              if (!(multi && has(sels, row.path))) onSelect(row.path);
              setMenu({ x: e.clientX, y: e.clientY, path: row.path });
            }}
            title={isOver && over!.refused ? over!.refused : undefined}
          >
            {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the mouse's fold toggle; the keyboard folds with the tree's Left and Right */}
            <span
              aria-hidden="true"
              className={`t-chev${container && kids ? "" : " none"}`}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((c) => {
                  const n = new Set(c);
                  if (n.has(key)) n.delete(key);
                  else n.add(key);
                  return n;
                });
              }}
            >
              {container && kids ? <Icon name={collapsed.has(key) ? "chevron" : "chevronDown"} size={12} /> : null}
            </span>
            <Icon name={typeIcon(typeOf(row.elem))} />
            <span className="t-type">{specOf(typeOf(row.elem))?.title ?? typeOf(row.elem)}</span>
            {typeof row.elem.id === "string" && row.elem.id && <span className="t-id">#{row.elem.id}</span>}
            {text && <span className="t-text">{text}</span>}
            {Array.isArray(row.elem.draw_list) && row.elem.draw_list.length > 0 && <span className="t-chip" title="Draw-list items">✎{row.elem.draw_list.length}</span>}
            {row.cell && <span className="t-chip">{row.cell}</span>}
            {typeOf(row.elem) === "group" && typeof row.elem.id === "string" && row.elem.id in panes && (
              <span className="t-chip pane" title="The dump swaps another layout into this group (Ui_SwapPane / NuiSetGroupLayout): the canvas draws that pane, the tree shows the group's own child">
                pane swapped in
              </span>
            )}
            {multi && samePath(row.path, sel) && <span className="t-key" title="The key element: Match size and Align measure against it">key</span>}
            {issue && <IssueBadge {...issue} />}
            {isOver && over!.refused && <span className="t-refused">{over!.refused}</span>}
          </div>
        );
      })}
      {menu && (
        <div className="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          {(() => {
            const p = menu.path;
            const e = getElem(win, p);
            const root = !p.length;
            // On one of several selected rows the menu acts on the whole selection: what works on one at a time says so.
            const many = multi && has(sels, p);
            const one = many ? `Works on one element at a time (${sels.length} are selected)` : undefined;
            const item = (label: string, keys: string, fn: () => void, disabled = false, why?: string) => (
              <button key={label} disabled={disabled} title={disabled ? why : undefined} onClick={() => {
                setMenu(null);
                fn();
              }}>
                <span>{label}</span>
                <kbd>{keys}</kbd>
              </button>
            );
            const rootIn = many ? sels.some((x) => !x.length) : root;
            return [
              ...(many ? [<div key="n" className="menu-note">{sels.length} selected</div>] : []),
              item("Duplicate", "Ctrl+D", () => actions.duplicate(p), rootIn, "the root cannot be duplicated"),
              item("Copy", "Ctrl+C", () => actions.copy(p), many, one),
              item("Paste inside", "", () => actions.paste({ parent: p, index: kidsOf(e).length }), many || !containerKind(e), one),
              item("Paste after", "Ctrl+V", () => actions.paste({ parent: p.slice(0, -1), index: p[p.length - 1]! + 1 }), many || root, one),
              <hr key="h1" />,
              item("Wrap in row", "Alt+R", () => actions.wrap(p, "row"), many, one),
              item("Wrap in column", "Alt+C", () => actions.wrap(p, "col"), many, one),
              item("Wrap in group", "Alt+G", () => actions.wrap(p, "group"), many, one),
              item("Unwrap", "Alt+U", () => actions.unwrap(p), many || !containerKind(e), one),
              <hr key="h2" />,
              item("Move up", "Alt+PgUp", () => actions.nudge(p, -1), rootIn),
              item("Move down", "Alt+PgDn", () => actions.nudge(p, 1), rootIn),
              item("Delete", "Del", () => actions.remove(p), rootIn, "the root cannot be deleted"),
            ];
          })()}
        </div>
      )}
    </div>
  );
}

function IssueBadge({ n, worst }: { n: number; worst: Severity }) {
  return (
    <span className={`t-issue ${worst}`} title={`${n} problem${n === 1 ? "" : "s"}`}>
      <Icon name={worst === "info" ? "info" : worst === "warning" ? "warning" : "error"} size={12} />
      {n}
    </span>
  );
}
