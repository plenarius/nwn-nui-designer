/**
 * The editor's state: the document's history (every edit is a step), the selection, the clipboard, the file it was
 * opened from, and the autosave. Edits go through apply(), which turns refused edits (EditError) into a toast.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type HistoryState, canRedo, canUndo, preview, push, redo, startHistory, undo } from "../../core/edit/history.js";
import type { Result } from "../../core/edit/ops.js";
import { type EditorDoc, openText, writeProject } from "../../core/edit/project.js";
import { type ElemPath, getElem } from "../../core/edit/tree.js";
import { type Selection as Sels, stillThere } from "../../core/edit/selection.js";
import { writeElement } from "../../core/edit/jui.js";
import { isObject, type JsonObject } from "../../core/model/types.js";
import { type FileHandle, type Autosave, readAutosave, writeAutosave } from "./files.js";
import { errorText } from "../../core/errors.js";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "ok";
}

export type Selection = ElemPath | null;

/** A Result that may select several elements and carry a note for the user (the arrange and multi tools). */
type AnyResult = Result & { selectMany?: ElemPath[]; note?: string };

let toastId = 0;

export function useEditor() {
  const [hist, setHist] = useState<HistoryState<EditorDoc> | null>(null);
  // The selection: the elements picked, the key (first picked) first; [] is the window. Not in the undo history.
  const [sels, setSels] = useState<Sels>([]);
  const sel: Selection = sels[0] ?? null;
  const setSel = useCallback((p: Selection) => setSels(p ? [p] : []), []);
  const [handle, setHandle] = useState<FileHandle | null>(null);
  const [savedDoc, setSavedDoc] = useState<EditorDoc | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [autosave, setAutosave] = useState<Autosave | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<number | null>(null);
  const clipboard = useRef<JsonObject | null>(null);
  const doc = hist?.present ?? null;
  // The history as of the last edit (edits in one event see each other's results).
  const histRef = useRef(hist);
  histRef.current = hist;

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++toastId;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);

  // The last session, offered on the start screen.
  useEffect(() => {
    readAutosave().then(setAutosave);
  }, []);

  // Autosave (debounced): every change, into IndexedDB.
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(async () => {
      if (await writeAutosave({ project: writeProject(doc), name: doc.name, savedAt: Date.now() })) setAutosavedAt(Date.now());
    }, 700);
    return () => clearTimeout(t);
  }, [doc]);

  const load = useCallback((d: EditorDoc, h: FileHandle | null = null, saved = false) => {
    const nh = startHistory(d);
    histRef.current = nh;
    setHist(nh);
    setSels([]);
    setHandle(h);
    setSavedDoc(saved ? d : null);
  }, []);

  const close = useCallback(() => {
    histRef.current = null;
    setHist(null);
    setSels([]);
    setHandle(null);
    setSavedDoc(null);
  }, []);

  const setH = useCallback((h: HistoryState<EditorDoc> | null) => {
    histRef.current = h;
    setHist(h);
  }, []);

  /** One edit: fn gets the document and returns the next one (or a Result with the selection to follow). */
  const apply = useCallback(
    (fn: (d: EditorDoc) => EditorDoc | AnyResult | null, key: string | null = null): boolean => {
      const h = histRef.current;
      if (!h) return false;
      try {
        const r = fn(h.present);
        if (!r) return false;
        const next: AnyResult = "doc" in r ? (r as AnyResult) : { doc: r as EditorDoc };
        setH(push(h, next.doc, key));
        if (next.selectMany !== undefined) setSels(next.selectMany);
        else if (next.select !== undefined) setSel(next.select);
        if (next.note) toast(next.note, "info");
        return true;
      } catch (e) {
        toast(errorText(e), "error");
        return false;
      }
    },
    [toast, setH, setSel],
  );

  // A live edit (dragging a size): shown as it goes, one undo step when committed, nothing when cancelled.
  const liveBase = useRef<HistoryState<EditorDoc> | null>(null);
  const live = useCallback(
    (fn: (d: EditorDoc) => EditorDoc) => {
      const base = liveBase.current ?? histRef.current;
      if (!base) return;
      liveBase.current = base;
      try {
        setH(preview(base, fn(base.present)));
      } catch (e) {
        toast(errorText(e), "error");
      }
    },
    [setH, toast],
  );
  const endLive = useCallback(
    (commit: boolean) => {
      const base = liveBase.current;
      liveBase.current = null;
      const h = histRef.current;
      if (!base || !h) return;
      setH(commit ? push(base, h.present) : base);
    },
    [setH],
  );

  const doUndo = useCallback(() => {
    const h = histRef.current;
    if (h && canUndo(h)) setH(undo(h));
  }, [setH]);
  const doRedo = useCallback(() => {
    const h = histRef.current;
    if (h && canRedo(h)) setH(redo(h));
  }, [setH]);

  // Selected elements that no longer exist (after an undo) drop out; with none left, the key's nearest ancestor.
  useEffect(() => {
    if (!doc || !sels.length) return;
    const next = stillThere(sels, doc.window);
    if (next !== sels) setSels(next);
  }, [doc, sels]);

  const copy = useCallback(
    (path: ElemPath | null) => {
      if (!doc || !path) return;
      const e = getElem(doc.window, path);
      if (!e) return;
      clipboard.current = structuredClone(e);
      try {
        void navigator.clipboard?.writeText(writeElement(e, "  "));
      } catch {
        /* the internal clipboard still has it */
      }
    },
    [doc],
  );

  const takeClipboard = useCallback(async (): Promise<JsonObject | null> => {
    try {
      const t = await navigator.clipboard?.readText();
      if (t && t.trim().startsWith("{")) {
        const v = JSON.parse(t) as unknown;
        if (isObject(v) && typeof v.type === "string") return v;
      }
    } catch {
      /* not allowed or not JSON */
    }
    return clipboard.current ? structuredClone(clipboard.current) : null;
  }, []);

  const openFromText = useCallback(
    (text: string, name: string, h: FileHandle | null = null) => {
      const r = openText(text, name);
      load(r.doc, r.kind === "project" ? h : null, r.kind === "project");
      return r;
    },
    [load],
  );

  const dirty = useMemo(() => !!doc && doc !== savedDoc, [doc, savedDoc]);

  return {
    hist,
    doc,
    /** The key element (the first selected), or null for the window. */
    sel,
    setSel,
    /** Every selected element, the key first. */
    sels,
    setSels,
    multi: sels.length > 1,
    apply,
    live,
    endLive,
    undo: doUndo,
    redo: doRedo,
    canUndo: !!hist && canUndo(hist),
    canRedo: !!hist && canRedo(hist),
    load,
    close,
    openFromText,
    handle,
    setHandle,
    markSaved: (d: EditorDoc) => setSavedDoc(d),
    dirty,
    toasts,
    toast,
    dismissToast: (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
    autosave,
    autosavedAt,
    copy,
    takeClipboard,
  };
}

export type Editor = ReturnType<typeof useEditor>;
