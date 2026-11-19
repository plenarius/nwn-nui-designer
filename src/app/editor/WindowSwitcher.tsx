/**
 * The window switcher: the open window's name in the toolbar is a button, and this is what it opens. The name (to
 * rename the window), the windows opened lately in this browser, the windows folder's files with their titles (with
 * the local API and a `windows` folder in nui-designer.ini), a search box when the list is long, and New window and
 * Open… at the bottom. Escape or a press outside closes it; the arrow keys walk the list.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WindowList } from "../local.js";
import { Icon } from "./icons.js";
import { type RecentWindow, SEARCH_FROM, baseName, byName, matches } from "./switcher.js";

export type SwitchTo = { kind: "recent"; recent: RecentWindow } | { kind: "folder"; path: string };

export interface WindowSwitcherProps {
  at: { left: number; top: number };
  /** The button that opened it (a press on it toggles, so it is not "outside"; focus goes back to it). */
  anchor: HTMLElement | null;
  name: string;
  onRename(name: string): void;
  /** The open window's recent key (it is marked in the folder and left out of Recent). */
  current: string | null;
  recent: RecentWindow[];
  /** The windows folder: "loading", its list, or null (no local API, or no folder set). */
  folder: WindowList | null | "loading";
  /** The local API is there, so a windows folder can be set (Game and haks). */
  canSetFolder: boolean;
  onPick(to: SwitchTo): void;
  onNew(): void;
  onOpen(): void;
  onSetFolder(): void;
  onClose(): void;
}

const SOURCE_TAG: Record<RecentWindow["source"]["kind"], [string, string]> = {
  windows: ["folder", "From the windows folder: opens the file as it is now"],
  handle: ["file", "A file opened with Open…: opens it as it is now (the browser may ask to read it again)"],
  copy: ["copy", "Dropped, imported, pasted or a sample: opens the copy this browser kept when it was opened"],
};

export function WindowSwitcher(p: WindowSwitcherProps) {
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const close = useRef(p.onClose);
  close.current = p.onClose;
  const anchorRef = useRef(p.anchor);
  anchorRef.current = p.anchor;

  const recent = p.recent.filter((r) => r.key !== p.current);
  const files = p.folder && p.folder !== "loading" && !p.folder.error ? byName(p.folder.files) : [];
  const total = recent.length + files.length;
  const search = total > SEARCH_FROM;
  const shownRecent = recent.filter((r) => matches(q, r.name, r.title));
  const shownFiles = files.filter((f) => matches(q, baseName(f.path), f.title));

  // A press outside closes it (the opening button toggles it itself).
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || p.anchor?.contains(t)) return;
      close.current();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [p.anchor]);

  // Focus: the search box, or the first window, or New window.
  useLayoutEffect(() => {
    const b = box.current;
    (b?.querySelector<HTMLElement>(".sw-search") ?? b?.querySelector<HTMLElement>(".sw-item") ?? b?.querySelector<HTMLElement>(".sw-foot button"))?.focus();
    // Only when it opens, and when the search box first appears (the folder's list arrived).
  }, [search]);

  // Escape closes it (and not also the selection's parent: the editor's own keys listen on the window), the arrow keys
  // walk the search box, the windows and the two buttons at the bottom.
  useEffect(() => {
    const b = box.current;
    if (!b) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        anchorRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (document.activeElement?.closest(".sw-name")) return;
      const all = [...b.querySelectorAll<HTMLElement>(".sw-search, .sw-item, .sw-foot button")];
      const i = all.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
    };
    b.addEventListener("keydown", onKey);
    return () => b.removeEventListener("keydown", onKey);
  }, []);

  const row = (key: string, name: string, rawTitle: string | undefined, onClick: () => void, extra?: { tag?: [string, string]; current?: boolean }) => {
    // A title that only repeats the name (a pasted layout is titled "pasted") is not shown twice.
    const title = rawTitle && rawTitle !== name ? rawTitle : undefined;
    return (
    <button key={key} className={`sw-item${extra?.current ? " current" : ""}`} aria-current={extra?.current || undefined} onClick={onClick} title={title ? `${name}: ${title}` : name}>
      <Icon name="window" size={13} />
      <span className="sw-n">{name}</span>
      {title && <span className="sw-t">{title}</span>}
      {extra?.tag && (
        <span className="sw-tag" title={extra.tag[1]}>
          {extra.tag[0]}
        </span>
      )}
      {extra?.current && <span className="sw-tag">open</span>}
    </button>
    );
  };

  const folderName = p.folder && p.folder !== "loading" ? p.folder.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : "";

  return (
    <div ref={box} className="menu switcher" role="dialog" aria-label="Switch window" style={{ position: "fixed", left: p.at.left, top: p.at.top }}>
      <label className="sw-name">
        <span>Name</span>
        <input value={p.name} onChange={(e) => p.onRename(e.target.value)} aria-label="Window name" spellCheck={false} />
      </label>
      {search && <input className="sw-search" type="search" placeholder={`Search ${total} windows`} aria-label="Search windows" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        box.current?.querySelector<HTMLElement>(".sw-item")?.click();
      }} />}
      <div className="sw-list">
        {shownRecent.length > 0 && (
          <section aria-label="Recent windows">
            <div className="sw-head">Recent in this browser</div>
            {shownRecent.map((r) => row(r.key, r.name, r.title, () => p.onPick({ kind: "recent", recent: r }), { tag: SOURCE_TAG[r.source.kind] }))}
          </section>
        )}
        {p.folder === "loading" ? (
          <div className="sw-note muted" role="status">Reading the windows folder…</div>
        ) : p.folder ? (
          <section aria-label="Windows folder">
            <div className="sw-head" title={p.folder.path}>
              {p.current?.startsWith("windows:") ? "This folder" : "Windows folder"} <span className="sw-path">{folderName}</span>
            </div>
            {p.folder.error ? (
              <div className="sw-note finding error small">{p.folder.error}</div>
            ) : files.length === 0 ? (
              <div className="sw-note muted">No .jui or .json files</div>
            ) : (
              shownFiles.map((f) => row(`windows:${f.path}`, baseName(f.path), f.title, () => p.onPick({ kind: "folder", path: f.path }), { current: p.current === `windows:${f.path}` }))
            )}
          </section>
        ) : p.canSetFolder ? (
          <button className="sw-note" onClick={p.onSetFolder}>
            Set a windows folder (Game and haks) to list your module's windows here
          </button>
        ) : null}
        {q && shownRecent.length + shownFiles.length === 0 && <div className="sw-note muted">No window matches “{q}”</div>}
        {!q && total === 0 && p.folder !== "loading" && !p.folder && <div className="sw-note muted">Windows you open are listed here.</div>}
      </div>
      <div className="sw-foot">
        <button onClick={p.onNew}><Icon name="new" size={14} /><span>New window</span><kbd>Alt+N</kbd></button>
        <button onClick={p.onOpen}><Icon name="open" size={14} /><span>Open…</span><kbd>Ctrl+O</kbd></button>
      </div>
    </div>
  );
}
