/**
 * The window editor: a palette and the element tree on the left, the canvas (drawn by the core as the client lays the
 * window out) in the middle with the problems under it, the selection's properties, the binds' sample values and the
 * notes on the right. All state is the editor's history (src/app/editor/useEditor.ts); the core does the work.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STYLE_RULE_SETS } from "../core/edit/styles/index.js";
import { windowFindings, windowIssues } from "../core/edit/lint.js";
import { newWindow, specOf } from "../core/edit/catalog.js";
import { addElement, deleteElement, duplicateElement, moveElement, nudge, unwrapElement, wrapElement } from "../core/edit/ops.js";
import { type EditorDoc, PROJECT_EXT, defaultExport, writeProject } from "../core/edit/project.js";
import { type DropTarget, type ElemPath, containerKind, getElem, kidsOf, refusal } from "../core/edit/tree.js";
import { type Measure, measured } from "../core/edit/arrange.js";
import { deleteMany, duplicateMany, nudgeMany, nudgeRefusal, removeRefusal } from "../core/edit/multi.js";
import { has, siblingRange, toggle } from "../core/edit/selection.js";
import { toNuiDocument } from "../core/edit/project.js";
import { layoutView } from "../core/view.js";
import { runTool, toolForKey } from "./editor/ArrangePanel.js";
import type { Finding } from "../core/edit/validate.js";
import { DEFAULT_GRID, GRID_STEPS, elementSize, resizeElement, resizeWindow, stepSize, windowSize } from "../core/edit/resize.js";
import type { TextModel } from "../core/font/font.js";
import { DEFAULT_CANVAS } from "../core/view.js";
import type { JsonObject } from "../core/model/types.js";
import { BindsPanel } from "./editor/BindsPanel.js";
import { Canvas, type Rendered } from "./editor/Canvas.js";
import { Icon } from "./editor/icons.js";
import { Palette } from "./editor/Palette.js";
import { ProblemsPanel, type Issue } from "./editor/ProblemsPanel.js";
import { Properties } from "./editor/Properties.js";
import { Modal, useTopModal } from "./editor/Modal.js";
import { ResourcesDialog } from "./editor/ResourcesDialog.js";
import { Tree } from "./editor/Tree.js";
import { clearAutosave, loadLocal, openFile, readHandle, readRecent, saveFile, saveLocal, writeRecent } from "./editor/files.js";
import { type SwitchTo, WindowSwitcher } from "./editor/WindowSwitcher.js";
import { type RecentWindow, type WindowSource, addRecent, baseName, sourceKey } from "./editor/switcher.js";
import { useEditor } from "./editor/useEditor.js";
import { useDevicePixelRatio } from "./editor/useDpr.js";
import { clampZoom, fitZoom, zoomIn, zoomOut } from "./editor/zoom.js";
import { pressable } from "./editor/a11y.js";
import { useResources } from "./editor/useResources.js";
import { type LocalState, type WindowList, allStyleSets, fetchWindowList, fetchWindowText, loadLocalStyles } from "./local.js";
import type { StyleRuleSet } from "../core/edit/style.js";
import { openText as openDocText } from "../core/edit/project.js";
import type { SkinNav, SkinView } from "./skin/SkinMode.js";
import { useSkin } from "./skin/useSkin.js";
import { DEFAULT_THEME, THEMES, themeOf } from "../core/skin/themes.js";
import { errorText } from "../core/errors.js";

// The skin editor and its export dialog load on first use: they and what only they use are a separate chunk.
const SkinMode = lazy(() => import("./skin/SkinMode.js").then((m) => ({ default: m.SkinMode })));
const SkinExportDialog = lazy(() => import("./skin/SkinExportDialog.js").then((m) => ({ default: m.SkinExportDialog })));

// The export dialog brings the .jui and NWScript writers.
const ExportDialog = lazy(() => import("./editor/ExportDialog.js").then((m) => ({ default: m.ExportDialog })));

const SAMPLES = import.meta.glob("../../fixtures/*.{jui,json}", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

interface Settings {
  canvasW: number;
  canvasH: number;
  scale: number;
  zoom: number;
  textModel: TextModel;
  fallback: boolean;
  markers: boolean;
  outlines: boolean;
  style: string | null;
  disabledRules: string[];
  rows: number;
  rightTab: "props" | "binds" | "notes";
  problemsOpen: boolean;
  /** 2: the drawing mode is gone and the text model's default is "nuklear" (checked against an in-game screenshot). */
  v: number;
  /** Which editor: the window, or the skin and fonts. */
  area: "window" | "skin";
  skinNav: SkinNav;
  skinView: SkinView;
  /** Draw the window editor's canvas with the skin being edited. */
  skinLive: boolean;
  /** The built-in skin, a themes.ts id: "ink" (Ink and brass, the default), "bronze", "brass", "verdigris" or "oxblood". */
  theme: string;
  /** The grid step sizes snap to on the canvas (2, 4 or 8). */
  grid: number;
  /** Draw the selected combo's open list on the canvas. */
  openList: boolean;
}

const DEFAULTS: Settings = {
  canvasW: DEFAULT_CANVAS[0],
  canvasH: DEFAULT_CANVAS[1],
  scale: 1,
  zoom: 1,
  textModel: "nuklear",
  fallback: false,
  markers: true,
  outlines: false,
  style: null,
  disabledRules: [],
  rows: 20,
  rightTab: "props",
  problemsOpen: true,
  v: 2,
  area: "window",
  skinNav: "button",
  skinView: "window",
  skinLive: true,
  theme: DEFAULT_THEME,
  grid: DEFAULT_GRID,
  openList: false,
};

/** Saved settings, with the text model reset to the new default if they were saved before it changed. */
function loadSettings(): Settings {
  const s = loadLocal("nui-editor-settings", DEFAULTS) as Settings & { mode?: unknown; lookup?: unknown };
  delete s.mode;
  delete s.lookup;
  const merged = { ...DEFAULTS, ...s };
  return s.v === DEFAULTS.v ? merged : { ...merged, textModel: DEFAULTS.textModel, v: DEFAULTS.v };
}

const SCREENS: [number, number][] = [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
];

const CANVAS_SKIN_TITLE =
  "The skin the window editor draws with: the game's (with a game folder, Game and haks), a built-in open skin (Ink and brass by default), or the skin being edited in the skin editor. The skin editor's own preview always draws with the skin being edited.";

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const set = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v })), []);
  useEffect(() => saveLocal("nui-editor-settings", settings), [settings]);
  const ed = useEditor();
  const r = useResources({ textModel: settings.textModel, fallback: settings.fallback, theme: settings.theme });
  // The style files of nui-designer.ini's `styles`, as rule sets beside the built-in ones.
  const [fileStyles, setFileStyles] = useState<StyleRuleSet[]>([]);
  const [styleErrors, setStyleErrors] = useState<string[]>([]);
  useEffect(() => {
    if (!r.local) return;
    let live = true;
    void loadLocalStyles(r.local).then(({ sets, errors }) => {
      if (!live) return;
      setFileStyles(sets);
      setStyleErrors(errors);
    });
    return () => {
      live = false;
    };
  }, [r.local]);
  const styleSets = useMemo(() => allStyleSets(STYLE_RULE_SETS, fileStyles), [fileStyles]);
  const sk = useSkin(r.res, settings.textModel);
  const skinArea = settings.area === "skin";
  /** What the window editor draws with: the skin being edited, when there is one and it is on. */
  const canvasRes = sk.project && settings.skinLive && sk.preview ? sk.preview : r.res;
  /** The toolbar's "Window editor's skin": the skin being edited, the game's skin, or a built-in skin's id. */
  const canvasSkin = sk.project && settings.skinLive ? "edited" : r.res && !r.res.usingFallback ? "game" : settings.theme;
  const chooseCanvasSkin = (v: string) =>
    setSettings((s) =>
      v === "edited"
        ? { ...s, skinLive: true }
        : v === "game"
          ? { ...s, skinLive: false, fallback: false }
          : // A built-in skin; with a game folder, the same as "Built-in skin even with a game" (Game and haks).
            { ...s, skinLive: false, theme: v, fallback: !!r.game },
    );
  const [sample, setSample] = useState<EditorDoc | null>(null);
  useEffect(() => {
    if (!skinArea || sample) return;
    const k = Object.keys(SAMPLES).find((x) => x.endsWith("/widgets.jui"));
    if (k) void SAMPLES[k]!().then((t) => setSample(openDocText(t, "widgets").doc));
  }, [skinArea, sample]);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"export" | "skin-export" | "resources" | "keys" | "rules" | "paste" | null>(null);
  const [pasted, setPasted] = useState("");
  const [bindFocus, setBindFocus] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [menuAt, setMenuAt] = useState({ left: 0, top: 0 });
  // The window switcher (the name in the toolbar): where it opens, the windows folder's list, the recent windows, the
  // open window's recent key, and the question before an unsaved window is left.
  const [switcher, setSwitcher] = useState<{ left: number; top: number } | null>(null);
  const [folder, setFolder] = useState<WindowList | null | "loading">(null);
  const [recent, setRecent] = useState<RecentWindow[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<{ title: string; action: string; go(): void } | null>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void readRecent<RecentWindow>().then(setRecent);
  }, []);
  // The switcher belongs to the open window: it closes when the window does, or when the skin editor shows.
  const hasDoc = !!ed.doc;
  useEffect(() => {
    if (!hasDoc || skinArea) setSwitcher(null);
  }, [hasDoc, skinArea]);
  // A dialog opened from the File menu gives focus back to the File button (the menu item is gone by then).
  const fileButton = useRef<HTMLButtonElement>(null);
  const topModal = useTopModal();
  const [dropFile, setDropFile] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const doc = ed.doc;
  const fonts = useMemo(() => canvasRes?.skin.fontList.map((f) => f.name) ?? [], [canvasRes]);
  // The arrange tools lay the window out as the canvas does (the renderer's dry pass), with the canvas's skin and screen.
  const measure = useMemo<Measure | null>(() => {
    if (!canvasRes) return null;
    return (d) => {
      const laid = layoutView(toNuiDocument(d), canvasRes.skin, canvasRes.images, { canvasW: settings.canvasW, canvasH: settings.canvasH });
      return measured(d.window, laid.outlines, laid.problems);
    };
  }, [canvasRes, settings.canvasW, settings.canvasH]);

  // Findings: the client's rules, and the house style's when one is on. The problem list is core/edit/lint.ts', the
  // same as `pnpm check` prints.
  const findings: Finding[] = useMemo(() => {
    if (!doc) return [];
    return windowFindings({
      win: doc.window,
      binds: doc.binds,
      name: doc.name,
      fonts,
      style: styleSets.find((x) => x.id === settings.style) ?? null,
      disabledRules: new Set(settings.disabledRules),
      outlines: rendered && rendered.window === doc.window ? rendered.outlines : undefined,
    });
  }, [doc, fonts, settings.style, settings.disabledRules, rendered, styleSets]);

  const issues: Issue[] = useMemo(() => {
    if (!doc) return [];
    const drawn = rendered && rendered.window === doc.window ? rendered : null;
    return windowIssues(doc.window, doc.binds, drawn?.problems ?? null, drawn?.pathOf ?? new Map(), findings);
  }, [doc, rendered, findings]);

  const treeIssues = useMemo(() => {
    const m = new Map<string, { n: number; worst: Issue["severity"] }>();
    for (const i of issues) {
      const k = i.path ? i.path.join("/") : "window";
      const x = m.get(k) ?? { n: 0, worst: "info" as const };
      x.n++;
      if (i.severity === "error" || (i.severity === "warning" && x.worst === "info")) x.worst = i.severity;
      m.set(k, x);
    }
    return m;
  }, [issues]);

  // --- actions ----------------------------------------------------------------------------------------------

  /** Where a new element goes: into the selected container, or after the selected element, or at the root's end. */
  const insertionPoint = useCallback(
    (elem: JsonObject): DropTarget => {
      if (!doc) return { parent: [], index: 0 };
      const sel = ed.sel ?? [];
      const e = getElem(doc.window, sel);
      if (e && containerKind(e) && !refusal(e, elem)) return { parent: sel, index: kidsOf(e).length };
      if (sel.length) return { parent: sel.slice(0, -1), index: sel[sel.length - 1]! + 1 };
      const root = doc.window.root as JsonObject;
      if (containerKind(root) === "group" && kidsOf(root).length === 1) return { parent: [0], index: kidsOf(kidsOf(root)[0]).length };
      return { parent: [], index: kidsOf(root).length };
    },
    [doc, ed.sel],
  );
  const addType = useCallback(
    (type: string, to?: DropTarget) => {
      const spec = specOf(type) ?? (type === "drawing" ? specOf("drawing") : null);
      const elem = type === "drawing" ? (specOf("drawing") ?? spec)!.make() : spec?.make();
      if (!elem) return;
      ed.apply((d) => addElement(d, to ?? insertionPoint(elem), elem));
    },
    [ed, insertionPoint],
  );
  const remove = (p: ElemPath | null) => p && p.length && ed.apply((d) => deleteElement(d, p));
  // On the whole selection when several are selected (and p, if given, is one of them); else on p alone.
  const onSelection = (p: ElemPath | null) => ed.multi && (!p || has(ed.sels, p));
  const removeSel = (p: ElemPath | null = ed.sel) => {
    if (!onSelection(p)) return remove(p);
    const why = removeRefusal(ed.sels);
    if (why) return ed.toast(why, "error");
    ed.apply((d) => deleteMany(d, ed.sels));
  };
  const duplicateSel = (p: ElemPath | null = ed.sel) => {
    if (!onSelection(p)) return p && p.length && ed.apply((d) => duplicateElement(d, p));
    const why = removeRefusal(ed.sels);
    if (why) return ed.toast(why, "error");
    ed.apply((d) => duplicateMany(d, ed.sels));
  };
  const nudgeSel = (dd: -1 | 1, p: ElemPath | null = ed.sel) => {
    if (!onSelection(p)) return p && ed.apply((d) => nudge(d, p, dd));
    ed.apply((d) => nudgeMany(d, ed.sels, dd));
  };
  /** A single-element tool tried with several selected: says so instead. */
  const oneOnly = (what: string) => {
    if (!ed.multi) return false;
    ed.toast(`${what} works on one element at a time, and ${ed.sels.length} are selected. Press Esc, then pick one.`, "info");
    return true;
  };
  const paste = async (to?: DropTarget) => {
    const e = await ed.takeClipboard();
    if (!e) return ed.toast("Nothing to paste: copy an element first", "info");
    ed.apply((d) => addElement(d, to ?? insertionPoint(e), e));
  };

  /**
   * Leaving the open window for another (New window, the switcher): asks first when it has edits not saved to a file,
   * as the autosave keeps only the window that is open.
   */
  const leaveThen = (title: string, action: string, go: () => void) => {
    setMenu(false);
    setSwitcher(null);
    if (ed.dirty && ed.canUndo) setLeaving({ title, action, go });
    else go();
  };
  const newDoc = () =>
    leaveThen("Start a new window?", "Start a new one", () => {
      const name = "untitled";
      ed.load({ name, window: newWindow("New window"), binds: {}, panes: {}, notes: "", export: defaultExport(name) });
      setCurrent(null);
    });
  /** Opens a window's text; with its source, it goes to the top of the switcher's recent windows. */
  const openText = (text: string, name: string, handle: Parameters<typeof ed.openFromText>[2] = null, source: WindowSource | null = null) => {
    try {
      const { kind, doc: opened } = ed.openFromText(text, baseName(name), handle);
      ed.toast(`Opened ${name} (${kind === "project" ? "project" : kind === "dump" ? "nui-preview dump" : kind === "layout" ? "a layout, in a new window" : "window JSON"})`, "ok");
      const key = source ? sourceKey(source, name) : null;
      setCurrent(key);
      if (source && key) {
        const title = typeof opened.window.title === "string" && opened.window.title.trim() ? opened.window.title.trim() : undefined;
        const entry: RecentWindow = { key, name: baseName(name), title, openedAt: Date.now(), source };
        setRecent((l) => {
          const next = addRecent(l, entry);
          void writeRecent(next);
          return next;
        });
      }
    } catch (e) {
      ed.toast(`${name}: ${errorText(e)}`, "error");
    }
  };
  const open = async () => {
    setMenu(false);
    setSwitcher(null);
    try {
      const f = await openFile();
      if (f) openText(f.text, f.name, f.handle, f.handle ? { kind: "handle", handle: f.handle } : { kind: "copy", text: f.text });
    } catch (e) {
      ed.toast(errorText(e), "error");
    }
  };
  /** A window from the switcher: read again from where it came from, then opened as Open would. */
  const switchTo = (to: SwitchTo) => {
    const name = to.kind === "folder" ? baseName(to.path) : to.recent.name;
    leaveThen(`Open “${name}”?`, `Open ${name}`, async () => {
      try {
        if (to.kind === "folder") return openText(await fetchWindowText(to.path), to.path, null, { kind: "windows", path: to.path });
        const s = to.recent.source;
        if (s.kind === "windows") openText(await fetchWindowText(s.path), s.path, null, s);
        else if (s.kind === "handle") openText(await readHandle(s.handle), s.handle.name, s.handle, s);
        else openText(s.text, to.recent.key.slice("copy:".length), null, s);
      } catch (e) {
        ed.toast(`${name}: ${errorText(e)}${to.kind === "recent" && to.recent.source.kind !== "copy" ? " (moved, renamed or deleted?)" : ""}`, "error");
      }
    });
  };
  const toggleSwitcher = (el: HTMLElement) => {
    if (switcher) return setSwitcher(null);
    const rect = el.getBoundingClientRect();
    setSwitcher({ left: Math.max(4, Math.min(rect.left, window.innerWidth - 364)), top: rect.bottom + 4 });
    if (!r.local) return setFolder(null);
    setFolder("loading");
    void fetchWindowList().then(setFolder);
  };
  const save = async (as = false) => {
    setMenu(false);
    if (!doc) return;
    try {
      const h = await saveFile(writeProject(doc), `${doc.name}${PROJECT_EXT}`, as ? null : ed.handle, [{ description: "NUI Designer project", accept: { "application/json": [PROJECT_EXT, ".json"] } }]);
      if (h === "cancelled") return;
      if (h) ed.setHandle(h);
      ed.markSaved(doc);
      ed.toast(h ? `Saved to ${h.name}` : `Downloaded ${doc.name}${PROJECT_EXT}`, "ok");
    } catch (e) {
      ed.toast(`Saving failed: ${errorText(e)}`, "error");
    }
  };

  const zoomTo = useCallback((z: number) => set("zoom", clampZoom(z)), [set]);
  const dpr = useDevicePixelRatio();
  const fit = () => {
    const st = document.querySelector(".stage");
    if (!st || !rendered) return;
    const [, , w, h] = rendered.windowRect;
    const s = settings.scale;
    zoomTo(fitZoom(Math.min((st.clientWidth - 48) / ((w + 24) * s), (st.clientHeight - 48) / ((h + 24) * s)), dpr));
  };

  /** One step of the selection's (null: the window's) width or height, as one undo step. */
  const resizeByKey = (axis: "w" | "h", dir: 1 | -1, free: boolean) => {
    if (!doc) return;
    const sel = ed.sel;
    const grid = settings.grid;
    if (ed.multi) {
      // Each selected element steps from its own size, in one undo step.
      const drawnOf = (p: ElemPath) => (rendered && rendered.window === doc.window ? rendered.placed.get(p.join("/"))?.rect : undefined);
      const key = axis === "w" ? "width" : "height";
      const missing = ed.sels.find((p) => !drawnOf(p) && typeof getElem(doc.window, p)?.[key] !== "number");
      if (missing) return ed.toast("One of them isn't drawn right now, so it can't be resized from here. Type its size in the properties.", "info");
      ed.apply((d) => {
        let out = d;
        for (const p of ed.sels) {
          const elem = getElem(d.window, p);
          if (!elem || !p.length) continue;
          const drawn = drawnOf(p);
          const [w, h] = elementSize(elem, drawn ? [drawn[2], drawn[3]] : [0, 0]);
          out = resizeElement(out, p, axis === "w" ? { w: stepSize(w, dir, grid, free) } : { h: stepSize(h, dir, grid, free) });
        }
        return out;
      });
      return;
    }
    if (!sel) {
      const [w, h] = windowSize(doc);
      ed.apply((d) => resizeWindow(d, axis === "w" ? { w: stepSize(w, dir, grid, free) } : { h: stepSize(h, dir, grid, free) }));
      return;
    }
    const elem = getElem(doc.window, sel);
    const drawn = rendered && rendered.window === doc.window ? rendered.placed.get(sel.join("/"))?.rect : undefined;
    if (!elem) return;
    if (!drawn && typeof elem[axis === "w" ? "width" : "height"] !== "number") return ed.toast("It is not drawn: type its size in the properties", "info");
    const [w, h] = elementSize(elem, drawn ? [drawn[2], drawn[3]] : [0, 0]);
    ed.apply((d) => resizeElement(d, sel, axis === "w" ? { w: stepSize(w, dir, grid, free) } : { h: stepSize(h, dir, grid, free) }));
  };

  const toasts = (into: HTMLElement | null) => {
    const list = (
      <div className="toasts" role="status" aria-live="polite">
        {ed.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} title="Dismiss" {...pressable(() => ed.dismissToast(t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    );
    return into ? createPortal(list, into) : list;
  };

  // --- keyboard ---------------------------------------------------------------------------------------------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    // An open dialog (a native modal <dialog>) closes itself on Escape, through its cancel event.
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const typing = isTyping(e.target);
    // Behind an open dialog the window is not edited (Delete in the shortcuts list must not delete the selection), and
    // Escape is left to the dialog; only Ctrl+S still saves.
    if ((dialog || leaving) && !(mod && k === "s")) return;
    // In the window switcher (a popover, not a dialog) its own keys work: Delete on a listed window must not delete the
    // selection. Save, Open and New window still do.
    if (e.target instanceof Element && e.target.closest(".switcher") && !(mod && (k === "s" || k === "o")) && !(e.altKey && k === "n")) return;
    if (mod && k === "s") {
      e.preventDefault();
      void save(e.shiftKey);
      return;
    }
    if (mod && k === "o") {
      e.preventDefault();
      void open();
      return;
    }
    if (mod && k === "e" && skinArea && sk.project) {
      e.preventDefault();
      setDialog("skin-export");
      return;
    }
    if (mod && k === "e" && doc) {
      e.preventDefault();
      setDialog("export");
      return;
    }
    if (skinArea) {
      if (!typing && mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) sk.redo();
        else sk.undo();
      } else if (!typing && mod && k === "y") {
        e.preventDefault();
        sk.redo();
      } else if (k === "?" && !typing) setDialog("keys");
      return;
    }
    if (e.altKey && k === "n") {
      e.preventDefault();
      newDoc();
      return;
    }
    if (typing || !doc) return;
    const sel = ed.sel;
    if (mod && k === "z") {
      e.preventDefault();
      if (e.shiftKey) ed.redo();
      else ed.undo();
    } else if (mod && k === "y") {
      e.preventDefault();
      ed.redo();
    } else if (toolForKey(e)) {
      // Alt+A / H / D, Alt+W / V / S: align; Alt+Shift+H / V: equal gaps (by the key's position, `code`, so macOS's
      // Option characters do not matter).
      e.preventDefault();
      if (!ed.multi) ed.toast("Select two or more elements to align or distribute them (Ctrl+click or Shift+click)", "info");
      else runTool(ed, toolForKey(e)!, measure);
    } else if ((k === "delete" || k === "backspace") && sel?.length) {
      e.preventDefault();
      removeSel();
    } else if (mod && k === "d" && sel?.length) {
      e.preventDefault();
      duplicateSel();
    } else if (mod && k === "c" && sel) {
      if (oneOnly("Copy")) return;
      ed.copy(sel);
      ed.toast("Copied", "ok");
    } else if (mod && k === "x" && sel?.length) {
      if (oneOnly("Cut")) return;
      ed.copy(sel);
      remove(sel);
    } else if (mod && k === "v") {
      e.preventDefault();
      if (oneOnly("Paste")) return;
      void paste();
    } else if (e.altKey && sel && (k === "r" || k === "c" || k === "g")) {
      e.preventDefault();
      if (oneOnly("Wrap")) return;
      ed.apply((d) => wrapElement(d, sel, k === "r" ? "row" : k === "c" ? "col" : "group"));
    } else if (e.altKey && k === "u" && sel) {
      e.preventDefault();
      if (oneOnly("Unwrap")) return;
      ed.apply((d) => unwrapElement(d, sel));
    } else if (e.altKey && (k === "pageup" || k === "pagedown") && sel?.length) {
      e.preventDefault();
      nudgeSel(k === "pageup" ? -1 : 1);
    } else if (e.altKey && !mod && k.startsWith("arrow")) {
      // Alt+Arrow: the selection's (or the window's) width or height, by the grid step; with Shift by 1 px.
      e.preventDefault();
      resizeByKey(k === "arrowleft" || k === "arrowright" ? "w" : "h", k === "arrowright" || k === "arrowdown" ? 1 : -1, e.shiftKey);
    } else if (k === "escape") {
      // Several selected: Esc clears the selection. One: its parent (Esc again walks up to the window).
      if (ed.multi) ed.setSel(null);
      else if (sel?.length) ed.setSel(sel.slice(0, -1));
      else ed.setSel(null);
    } else if (!mod && (k === "=" || k === "+")) zoomTo(zoomIn(settings.zoom));
    else if (!mod && k === "-") zoomTo(zoomOut(settings.zoom));
    else if (!mod && k === "0") zoomTo(1);
    else if (k === "?") setDialog("keys");
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // A file dropped anywhere opens it.
  const onFileDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    setDropFile(false);
    const f = e.dataTransfer.files[0]!;
    const t = await f.text();
    openText(t, f.name, null, { kind: "copy", text: t });
  };

  const errors = issues.filter((i) => i.severity === "error").length;
  const saveState = ed.dirty ? (ed.autosavedAt ? "autosaved" : "unsaved") : ed.handle ? `saved · ${ed.handle.name}` : "saved";
  const styleSet = styleSets.find((x) => x.id === settings.style) ?? null;

  return (
    <div
      className={`app${doc || (skinArea && sk.project) ? "" : " empty"}`}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setDropFile(true);
        }
      }}
      onDragLeave={(e) => e.target === e.currentTarget && setDropFile(false)}
      onDrop={onFileDrop}
    >
      <header className="toolbar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="3" width="20" height="18" rx="3" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
            <path d="M2 8h20" stroke="var(--accent)" strokeWidth="1.6" />
            <rect x="5" y="11" width="6" height="7" rx="1" fill="var(--accent)" opacity=".85" />
            <path d="M13 12h6M13 15h6M13 18h4" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="brand-name">NUI Designer</span>
        </div>
        <div className="seg area-switch" role="group" aria-label="Editor">
          <button className={!skinArea ? "on" : ""} aria-pressed={!skinArea} onClick={() => set("area", "window")}>
            <Icon name="window" size={13} /> Window
          </button>
          <button className={skinArea ? "on" : ""} aria-pressed={skinArea} onClick={() => set("area", "skin")}>
            <Icon name="brush" size={13} /> Skin
          </button>
        </div>
        <div className="menu-wrap">
          <button
            ref={fileButton}
            className="tb"
            onClick={(e) => {
              // The toolbar scrolls sideways (overflow-x: auto), which clips anything absolutely placed below it, so the
              // menu is fixed to the viewport at the button's corner.
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuAt({ left: rect.left, top: rect.bottom + 4 });
              setMenu(!menu);
            }}
            aria-haspopup="menu"
          >
            File <Icon name="chevronDown" size={12} />
          </button>
          {menu && (
            <div className="menu file-menu" style={{ position: "fixed", left: menuAt.left, top: menuAt.top }} onPointerLeave={() => setMenu(false)}>
              <button onClick={newDoc}><Icon name="new" size={14} /><span>New window</span><kbd>Alt+N</kbd></button>
              <button onClick={open}><Icon name="open" size={14} /><span>Open…</span><kbd>Ctrl+O</kbd></button>
              <label className="menu-item">
                <Icon name="import" size={14} />
                <span>Import a file…</span>
                <kbd>.jui .json</kbd>
                <input type="file" accept=".jui,.json,.txt" hidden onChange={async (e) => {
                  const f = e.target.files?.[0];
                  setMenu(false);
                  if (f) {
                    const t = await f.text();
                    openText(t, f.name, null, { kind: "copy", text: t });
                  }
                  e.target.value = "";
                }} />
              </label>
              <button onClick={() => { setMenu(false); fileButton.current?.focus(); setDialog("paste"); }}><Icon name="copy" size={14} /><span>Paste JSON…</span><kbd /></button>
              <hr />
              <button disabled={!doc} onClick={() => save(false)}><Icon name="save" size={14} /><span>Save</span><kbd>Ctrl+S</kbd></button>
              <button disabled={!doc} onClick={() => save(true)}><Icon name="save" size={14} /><span>Save as…</span><kbd>Ctrl+Shift+S</kbd></button>
              <button disabled={!doc} onClick={() => { setMenu(false); fileButton.current?.focus(); setDialog("export"); }}><Icon name="export" size={14} /><span>Export…</span><kbd>Ctrl+E</kbd></button>
              <hr />
              <button disabled={!doc} onClick={() => { setMenu(false); ed.close(); setCurrent(null); }}><Icon name="close" size={14} /><span>Close</span><kbd /></button>
            </div>
          )}
        </div>
        <div className="tb-group">
          <button className="tb icon" disabled={skinArea ? !sk.canUndo : !ed.canUndo} onClick={skinArea ? sk.undo : ed.undo} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /></button>
          <button className="tb icon" disabled={skinArea ? !sk.canRedo : !ed.canRedo} onClick={skinArea ? sk.redo : ed.redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Icon name="redo" /></button>
        </div>
        {doc && !skinArea && (
          <div className="docname">
            <button ref={nameButton} className="tb doc-switch" onClick={(e) => toggleSwitcher(e.currentTarget)} aria-haspopup="dialog" aria-expanded={!!switcher} title={`${doc.name} (${saveState}): switch to another window, or rename this one`}>
              <span className="doc-switch-name">{doc.name || "untitled"}</span>
              <Icon name="chevronDown" size={12} />
            </button>
            <span className={`saved${ed.dirty ? " dirty" : ""}`} title={ed.autosavedAt ? `Autosaved in this browser at ${new Date(ed.autosavedAt).toLocaleTimeString()}` : undefined}>
              {saveState}
            </span>
          </div>
        )}
        <div className="tb-spacer" />
        {(doc || skinArea) && (
          <>
            <div className="tb-group zoom">
              <button className="tb icon" onClick={() => zoomTo(zoomOut(settings.zoom))} title="Zoom out (-)" aria-label="Zoom out"><Icon name="zoomOut" /></button>
              <button className="tb pct" onClick={() => zoomTo(1)} title="Actual size (0)">{Math.round(settings.zoom * 100)}%</button>
              <button className="tb icon" onClick={() => zoomTo(zoomIn(settings.zoom))} title="Zoom in (+)" aria-label="Zoom in"><Icon name="zoomIn" /></button>
              <button className="tb icon" onClick={fit} title="Fit the window" aria-label="Fit"><Icon name="fit" /></button>
            </div>
            <label className="tb-field" title="NUI scale (the game's UI scale)">
              <span className="tb-label">UI scale</span>
              <select aria-label="UI scale" value={settings.scale} onChange={(e) => set("scale", Number(e.target.value))}>
                {[1, 1.25, 1.5, 1.75, 2].map((s) => <option key={s} value={s}>{s.toFixed(2)}</option>)}
              </select>
            </label>
            <label className="tb-field" title="The screen the window is centred on">
              <span className="tb-label">Screen</span>
              <select aria-label="Screen size" value={`${settings.canvasW}x${settings.canvasH}`} onChange={(e) => {
                const [w, h] = e.target.value.split("x").map(Number);
                setSettings((s) => ({ ...s, canvasW: w!, canvasH: h! }));
              }}>
                {SCREENS.map(([w, h]) => <option key={w} value={`${w}x${h}`}>{w} × {h}</option>)}
                {!SCREENS.some(([w, h]) => w === settings.canvasW && h === settings.canvasH) && <option value={`${settings.canvasW}x${settings.canvasH}`}>{settings.canvasW} × {settings.canvasH}</option>}
              </select>
            </label>
            {!skinArea && <label className="tb-field" title="House style rules (optional)">
              <span className="tb-label">Style</span>
              <select value={settings.style ?? ""} onChange={(e) => set("style", e.target.value || null)} aria-label="Style rules" title={styleErrors.length ? `Style files that could not be loaded:\n${styleErrors.join("\n")}` : undefined}>
                <option value="">No style rules</option>
                {styleSets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                {settings.style && !styleSets.some((s) => s.id === settings.style) && <option value={settings.style}>{settings.style} (not loaded)</option>}
              </select>
            </label>}
            {!skinArea && <label className="tb-field" title="Grid: sizes dragged on the canvas, and Alt+Arrow keys, snap to this step (hold Shift for 1 px)">
              <span className="tb-label">Grid</span>
              <select value={settings.grid} onChange={(e) => set("grid", Number(e.target.value))} aria-label="Grid step">
                {GRID_STEPS.map((g) => <option key={g} value={g}>{g} px</option>)}
              </select>
            </label>}
            {styleSet && !skinArea && <button className="tb icon" title="Choose the style rules" onClick={() => setDialog("rules")} aria-label="Style rules"><Icon name="rules" /></button>}
          </>
        )}
        <label className="tb-field" title={CANVAS_SKIN_TITLE}>
          <span className="tb-label">{skinArea ? "Window editor" : "Drawn with"}</span>
          <select value={canvasSkin} onChange={(e) => chooseCanvasSkin(e.target.value)} aria-label="Window editor's skin">
            <option value="game" disabled={!r.game}>
              {r.game ? "Game skin" : "Game skin (none)"}
            </option>
            <optgroup label="Built-in">
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </optgroup>
            {sk.project && (
              <optgroup label="Skin editor">
                <option value="edited">Skin being edited</option>
              </optgroup>
            )}
          </select>
        </label>
        <button className={`tb icon${r.game ? "" : " hint"}`} onClick={() => setDialog("resources")} title="Game and haks: the game folder, haks and loose files the canvases draw with" aria-label="Game and haks">
          <Icon name="folder" />
        </button>
        <button className="tb icon" onClick={() => setDialog("keys")} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><Icon name="keyboard" /></button>
        {skinArea ? (
          sk.project && (
            <button className="tb primary" onClick={() => setDialog("skin-export")} title="Export the skin (Ctrl+E)">
              <Icon name="export" size={14} /> Export skin
            </button>
          )
        ) : (
          doc && (
            <button className="tb primary" onClick={() => setDialog("export")} title="Export (Ctrl+E)">
              <Icon name="export" size={14} /> Export
            </button>
          )
        )}
      </header>

      {skinArea ? (
        <Suspense fallback={<main className="lazy-loading" role="status">Loading the skin editor…</main>}>
        <SkinMode
          r={r}
          sk={sk}
          doc={doc}
          sample={doc ?? sample}
          nav={settings.skinNav}
          setNav={(n) => set("skinNav", n)}
          view={settings.skinView}
          setView={(v) => set("skinView", v)}
          canvas={{ canvasW: settings.canvasW, canvasH: settings.canvasH, scale: settings.scale, zoom: settings.zoom }}
          textModel={settings.textModel}
          setTextModel={(m) => set("textModel", m)}
          theme={settings.theme}
          windowSkin={canvasSkin === "edited" ? null : canvasSkin === "game" ? "the game's skin" : `the built-in ${themeOf(canvasSkin).title}`}
          toast={ed.toast}
          onZoom={zoomTo}
        />
        </Suspense>
      ) : !doc ? (
        <Start
          onNew={newDoc}
          onOpen={open}
          onImport={() => fileInput.current?.click()}
          onPaste={() => setDialog("paste")}
          autosave={ed.autosave}
          onRestore={() => ed.autosave && openText(ed.autosave.project, ed.autosave.name)}
          onForget={async () => {
            await clearAutosave();
            window.location.reload();
          }}
          onSample={async (k) => {
            const t = await SAMPLES[k]!();
            openText(t, k.split("/").pop()!, null, { kind: "copy", text: t });
          }}
          windows={r.local?.windows ?? null}
          onWindow={async (p) => {
            try {
              openText(await fetchWindowText(p), p, null, { kind: "windows", path: p });
            } catch (e) {
              ed.toast(errorText(e), "error");
            }
          }}
        />
      ) : (
        <>
          <aside className="left">
            <div className="pane palette-pane">
              <div className="pane-head">Elements</div>
              <Palette onAdd={(t) => addType(t)} />
            </div>
            <div className="pane tree-pane">
              <div className="pane-head">
                <span>Tree</span>
                <span className="pane-tools">
                  {(() => {
                    // With several selected: move, duplicate and delete act on all of them; wrap and unwrap on one only.
                    const one = ed.multi ? ` · works on one element at a time (${ed.sels.length} are selected)` : "";
                    const moveWhy = (dd: -1 | 1) => (ed.multi ? nudgeRefusal(doc, ed.sels, dd) : null);
                    const rootIn = ed.sels.some((p) => !p.length);
                    return (
                      <>
                        <button className="icon-btn" title={`Move up (Alt+Page Up)${moveWhy(-1) ? ` · ${moveWhy(-1)}` : ""}`} disabled={!ed.sel?.length || !!moveWhy(-1)} onClick={() => nudgeSel(-1)}><Icon name="up" size={14} /></button>
                        <button className="icon-btn" title={`Move down (Alt+Page Down)${moveWhy(1) ? ` · ${moveWhy(1)}` : ""}`} disabled={!ed.sel?.length || !!moveWhy(1)} onClick={() => nudgeSel(1)}><Icon name="down" size={14} /></button>
                        <button className="icon-btn" title={`Wrap in a row (Alt+R)${one}`} disabled={!ed.sel || ed.multi} onClick={() => ed.sel && ed.apply((d) => wrapElement(d, ed.sel!, "row"))}><Icon name="row" size={14} /></button>
                        <button className="icon-btn" title={`Wrap in a column (Alt+C)${one}`} disabled={!ed.sel || ed.multi} onClick={() => ed.sel && ed.apply((d) => wrapElement(d, ed.sel!, "col"))}><Icon name="col" size={14} /></button>
                        <button className="icon-btn" title={`Wrap in a group (Alt+G)${one}`} disabled={!ed.sel || ed.multi} onClick={() => ed.sel && ed.apply((d) => wrapElement(d, ed.sel!, "group"))}><Icon name="group" size={14} /></button>
                        <button className="icon-btn" title={`Unwrap (Alt+U)${one}`} disabled={!ed.sel || ed.multi || !containerKind(getElem(doc.window, ed.sel))} onClick={() => ed.sel && ed.apply((d) => unwrapElement(d, ed.sel!))}><Icon name="unwrap" size={14} /></button>
                        <button className="icon-btn" title={`Duplicate (Ctrl+D)${ed.multi ? ` · all ${ed.sels.length}` : ""}`} disabled={!ed.sel?.length || rootIn} onClick={() => duplicateSel()}><Icon name="copy" size={14} /></button>
                        <button className="icon-btn danger" title={`Delete (Del)${ed.multi ? ` · all ${ed.sels.length}` : ""}`} disabled={!ed.sel?.length || rootIn} onClick={() => removeSel()}><Icon name="trash" size={14} /></button>
                      </>
                    );
                  })()}
                </span>
              </div>
              <Tree
                win={doc.window}
                panes={doc.panes}
                sels={ed.sels}
                onSelect={ed.setSel}
                onSels={ed.setSels}
                issues={treeIssues}
                actions={{
                  duplicate: (p) => duplicateSel(p),
                  remove: (p) => removeSel(p),
                  wrap: (p, k) => ed.apply((d) => wrapElement(d, p, k)),
                  unwrap: (p) => ed.apply((d) => unwrapElement(d, p)),
                  nudge: (p, dd) => nudgeSel(dd, p),
                  copy: (p) => ed.copy(p),
                  paste: (t) => void paste(t),
                  move: (from, to) => ed.apply((d) => moveElement(d, from, to)),
                  add: (t, to) => addType(t, to),
                }}
              />
            </div>
          </aside>
          <main className="center">
            <Canvas
              doc={doc}
              res={canvasRes}
              settings={{ canvasW: settings.canvasW, canvasH: settings.canvasH, scale: settings.scale, zoom: settings.zoom, markers: settings.markers, outlines: settings.outlines, grid: settings.grid, openList: settings.openList }}
              sels={ed.sels}
              findings={findings}
              onSelect={ed.setSel}
              onPick={(p, how) => ed.setSels(how === "toggle" ? toggle(ed.sels, p) : siblingRange(ed.sels, p))}
              onBox={(ps, add) => ed.setSels(add ? [...ed.sels, ...ps.filter((p) => !has(ed.sels, p))] : ps)}
              onMove={(from, to) => ed.apply((d) => moveElement(d, from, to))}
              onAdd={(t, to) => addType(t, to)}
              onLive={ed.live}
              onLiveEnd={ed.endLive}
              onApply={(fn) => ed.apply(fn)}
              onRendered={setRendered}
              onZoom={zoomTo}
              onError={setDrawError}
            />
            <div className="canvas-bar">
              <label className="inline"><input type="checkbox" checked={settings.markers} onChange={(e) => set("markers", e.target.checked)} /> Problem markers</label>
              <label className="inline"><input type="checkbox" checked={settings.outlines} onChange={(e) => set("outlines", e.target.checked)} /> Row and column outlines</label>
              <label className="inline" title="Draw the selected combo's list as the client opens it: below the combo, never clipped to the window or the screen"><input type="checkbox" data-testid="open-list" checked={settings.openList} onChange={(e) => set("openList", e.target.checked)} /> Open combo list</label>
              {drawError && <span className="finding error">{drawError}</span>}
              <span className="tb-spacer" />
              {rendered && (
                <span className="muted small bar-readout" title={`window ${rendered.windowRect[2]} × ${rendered.windowRect[3]} · ${rendered.outlines.length} drawn elements`}>
                  window {rendered.windowRect[2]} × {rendered.windowRect[3]} · {rendered.outlines.length} drawn
                </span>
              )}
            </div>
            <ProblemsPanel issues={issues} onSelect={(p) => ed.setSel(p)} open={settings.problemsOpen} setOpen={(o) => set("problemsOpen", o)} />
          </main>
          <aside className="right">
            <div className="tabs right-tabs" role="tablist" aria-label="Panels">
              <button role="tab" aria-selected={settings.rightTab === "props"} className={settings.rightTab === "props" ? "on" : ""} onClick={() => set("rightTab", "props")}>Properties</button>
              <button role="tab" aria-selected={settings.rightTab === "binds"} className={settings.rightTab === "binds" ? "on" : ""} onClick={() => set("rightTab", "binds")}>
                Binds <span className="tab-count">{Object.keys(doc.binds).length || ""}</span>
              </button>
              <button role="tab" aria-selected={settings.rightTab === "notes"} className={settings.rightTab === "notes" ? "on" : ""} onClick={() => set("rightTab", "notes")}>Notes</button>
            </div>
            <div className="right-body">
              {settings.rightTab === "props" && (
                <Properties doc={doc} ed={ed} fonts={fonts} findings={findings} measure={measure} onShowBind={(n) => {
                  set("rightTab", "binds");
                  setBindFocus(n);
                }} />
              )}
              {settings.rightTab === "binds" && <BindsPanel doc={doc} ed={ed} fonts={fonts} focus={bindFocus} rows={settings.rows} setRows={(n) => set("rows", n)} />}
              {settings.rightTab === "notes" && (
                <div className="notes">
                  <p className="muted small">Notes for whoever picks this window up next. They are saved in the project, not in the exports.</p>
                  <textarea value={doc.notes} placeholder="What it is for, what is still open, the longest real values…" onChange={(e) => ed.apply((d) => ({ ...d, notes: e.target.value }), "notes")} />
                </div>
              )}
            </div>
          </aside>
        </>
      )}

      <input ref={fileInput} data-testid="import-input" type="file" accept=".jui,.json,.txt" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (f) {
          const t = await f.text();
          openText(t, f.name, null, { kind: "copy", text: t });
        }
        e.target.value = "";
      }} />

      {switcher && doc && !skinArea && (
        <WindowSwitcher
          at={switcher}
          anchor={nameButton.current}
          name={doc.name}
          onRename={(n) => ed.apply((d) => ({ ...d, name: n }), "name")}
          current={current}
          recent={recent}
          folder={folder}
          canSetFolder={!!r.local}
          onPick={switchTo}
          onNew={newDoc}
          onOpen={() => void open()}
          onSetFolder={() => {
            setSwitcher(null);
            setDialog("resources");
          }}
          onClose={() => setSwitcher(null)}
        />
      )}
      {leaving && doc && (
        <Modal title={leaving.title} icon="warning" className="confirm" onClose={() => setLeaving(null)}>
          <div className="modal-body">
            <p>“{doc.name}” has changes that are not saved to a file. The autosave keeps only the window that is open, so they go when another one opens. Save it first (Ctrl+S) to keep them.</p>
            <div className="row-btns confirm-btns">
              <span className="spacer" />
              <button onClick={() => setLeaving(null)} data-autofocus>
                Cancel
              </button>
              <button className="primary" onClick={() => {
                const go = leaving.go;
                setLeaving(null);
                go();
              }}>
                {leaving.action}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog === "skin-export" && sk.project && (
        <Suspense fallback={<LoadingModal title="Export the skin" onClose={() => setDialog(null)} />}>
          <SkinExportDialog project={sk.project} resman={r.res?.resman ?? null} findings={sk.findings} onClose={() => setDialog(null)} onRename={(n) => sk.apply((p) => ({ ...p, name: n }), "name")} onSaved={sk.markSaved} />
        </Suspense>
      )}
      {dialog === "export" && doc && (
        <Suspense fallback={<LoadingModal title={`Export “${doc.name}”`} onClose={() => setDialog(null)} />}>
          <ExportDialog doc={doc} ed={ed} onClose={() => setDialog(null)} problems={errors} />
        </Suspense>
      )}
      {dialog === "resources" && <ResourcesDialog r={r} s={settings} set={set} onClose={() => setDialog(null)} />}
      {dialog === "keys" && <Shortcuts onClose={() => setDialog(null)} />}
      {dialog === "paste" && (
        <Modal title="Paste JSON" icon="copy" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <p className="muted small">A window's JSON (a .jui, or JsonDump of an NuiWindow from a log, quoted or not), a nui-preview dump, a project, or a bare layout element.</p>
            <textarea className="mono" rows={14} value={pasted} data-autofocus aria-label="JSON" onChange={(e) => setPasted(e.target.value)} spellCheck={false} />
            <div className="row-btns">
              <button className="primary" disabled={!pasted.trim()} onClick={() => {
                openText(pasted, "pasted", null, { kind: "copy", text: pasted });
                setDialog(null);
                setPasted("");
              }}>Open it</button>
            </div>
          </div>
        </Modal>
      )}
      {dialog === "rules" && styleSet && (
        <Modal title={`${styleSet.name} style rules`} icon="rules" className="rules" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <p className="muted">{styleSet.description}{styleSet.source ? ` From ${styleSet.source}.` : ""}</p>
            {styleSet.rules.map((rule, i) => (
              <label key={rule.id} className="rule">
                <input type="checkbox" data-autofocus={i === 0 || undefined} checked={!settings.disabledRules.includes(rule.id)} onChange={(e) => set("disabledRules", e.target.checked ? settings.disabledRules.filter((x) => x !== rule.id) : [...settings.disabledRules, rule.id])} />
                <span><b>{rule.title}</b><br /><span className="muted small">{rule.summary}</span></span>
              </label>
            ))}
          </div>
        </Modal>
      )}
      {dropFile && <div className="file-drop">Drop a project, a .jui or a dump to open it</div>}
      {/* Over an open dialog the toasts go inside it: outside they would be under its backdrop, and inert. */}
      {toasts(topModal)}
    </div>
  );
}

function Start({ onNew, onOpen, onImport, onPaste, autosave, onRestore, onForget, onSample, windows, onWindow }: { onNew(): void; onOpen(): void; onImport(): void; onPaste(): void; autosave: { name: string; savedAt: number } | null; onRestore(): void; onForget(): void; onSample(k: string): void; windows: LocalState["windows"]; onWindow(path: string): void }) {
  const ago = (t: number) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 90) return "a minute ago";
    if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
    if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
    return new Date(t).toLocaleDateString();
  };
  return (
    <div className="start">
      <div className="start-inner">
        <h1>Design a NUI window</h1>
        <p className="lead">
          Lay out a Neverwinter Nights: Enhanced Edition window and see it the way the client draws it: the same layout solver, the same skin, its problems
          as you go. Then export the <code>.jui</code> or the NWScript that builds it.
        </p>
        <div className="start-cards">
          <button className="card primary" onClick={onNew}>
            <Icon name="new" size={22} />
            <b>New window</b>
            <span>An empty column in a 480 × 360 window</span>
          </button>
          <button className="card" onClick={onOpen}>
            <Icon name="open" size={22} />
            <b>Open…</b>
            <span>A project, a .jui, window JSON or a nui-preview dump</span>
          </button>
          <button className="card" onClick={onImport}>
            <Icon name="import" size={22} />
            <b>Import a file…</b>
            <span>Or drop one anywhere on this page, or <span className="link-ish" role="button" tabIndex={0} onKeyDown={pressable(onPaste).onKeyDown} onClick={(e) => { e.stopPropagation(); onPaste(); }}>paste its JSON</span></span>
          </button>
          {autosave && (
            <button className="card restore" onClick={onRestore}>
              <Icon name="undo" size={22} />
              <b>Continue “{autosave.name}”</b>
              <span>Autosaved {ago(autosave.savedAt)} in this browser</span>
            </button>
          )}
        </div>
        <div className="features">
          <div>
            <b>Drawn as the client draws it</b>
            <span>The client's layout solver (a Kiwi port that matches it to the pixel), your game's skin, fonts and haks.</span>
          </div>
          <div>
            <b>Problems as you go</b>
            <span>Clipped text, overflow, sizes the client refuses, values it will not read, and, if you want it, a house style.</span>
          </div>
          <div>
            <b>Binds with sample values</b>
            <span>Bind any property NUI lets you bind, and stress the layout: long text, empty values, a full list.</span>
          </div>
          <div>
            <b>.jui and NWScript</b>
            <span>The JSON NuiCreateFromResRef loads, or readable nw_inc_nui code that builds exactly the same window.</span>
          </div>
        </div>
        {windows && (
          <div className="window-files" aria-label="Your windows">
            <span className="muted" title={windows.path}>Your windows ({windows.path}):</span>
            {windows.error ? (
              <span className="finding error small">{windows.error}</span>
            ) : windows.files.length ? (
              windows.files.map((f) => (
                <button key={f.path} className="chip-btn" onClick={() => onWindow(f.path)}>
                  {f.path.replace(/(\.nuidesign)?\.(jui|json)$/i, "")}
                </button>
              ))
            ) : (
              <span className="muted small">no .jui or .json files</span>
            )}
          </div>
        )}
        <div className="samples">
          <span className="muted">Or start from a sample:</span>
          {Object.keys(SAMPLES)
            .sort()
            .map((k) => (
              <button key={k} className="chip-btn" onClick={() => onSample(k)}>
                {k.split("/").pop()!.replace(/\.(jui|json)$/, "")}
              </button>
            ))}
        </div>
        {autosave && (
          <button className="link small forget" onClick={onForget}>
            Forget the autosave
          </button>
        )}
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
  ["Ctrl+S / Ctrl+Shift+S", "Save / save as"],
  ["Ctrl+O", "Open"],
  ["Alt+N", "New window"],
  ["Ctrl+E", "Export"],
  ["Delete", "Delete the selection"],
  ["Ctrl+D", "Duplicate"],
  ["Ctrl+C / Ctrl+X / Ctrl+V", "Copy / cut / paste (after the selection, or into it)"],
  ["Alt+R / Alt+C / Alt+G", "Wrap in a row / column / group"],
  ["Alt+U", "Unwrap"],
  ["Alt+Page Up / Alt+Page Down", "Move up / down"],
  ["Alt+← / Alt+→", "Narrower / wider by the grid step (the window when nothing is selected)"],
  ["Alt+↑ / Alt+↓", "Shorter / taller by the grid step"],
  ["Shift+Alt+arrows", "The same by 1 px"],
  ["Shift (dragging a handle)", "Resize in 1 px steps"],
  ["Ctrl+click / Shift+click", "Add to or take from the selection / select a range (the first selected is the key)"],
  ["Drag from an empty place", "Select what is fully inside the box (a row's background or a spacer counts as empty)"],
  ["Alt+A / Alt+H / Alt+D", "Align left edges / centres / right edges to the key (across rows)"],
  ["Alt+W / Alt+V / Alt+S", "Align top edges / middles / bottom edges to the key (across columns)"],
  ["Alt+Shift+H / Alt+Shift+V", "Equal gaps in a row / column"],
  ["Esc", "Close the dialog, cancel a drag, clear a selection of several, or select the parent"],
  ["↑ ↓ ← →", "Walk the tree (when it has focus)"],
  ["+ / − / 0", "Zoom in / out / 100%"],
  ["Ctrl+wheel", "Zoom"],
];

function Shortcuts({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Keyboard shortcuts" icon="keyboard" className="keys" onClose={onClose}>
      <div className="modal-body">
        <table>
          <tbody>
            {SHORTCUTS.map(([k, v]) => (
              <tr key={k}>
                <td><kbd>{k}</kbd></td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** A lazy-loaded dialog while its code loads: the same dialog, already open (Escape and the backdrop close it). */
function LoadingModal({ title, onClose }: { title: string; onClose(): void }) {
  return (
    <Modal title={title} icon="export" className="export" onClose={onClose}>
      <div className="modal-body muted" role="status">Loading…</div>
    </Modal>
  );
}
