/**
 * The skin editor's state: the project being edited (with undo), the resources it draws with (rebuilt, briefly
 * debounced, after every edit: its own files over the game or the fallback skin), and its findings.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FontFace } from "../../core/font/font.js";
import { type HistoryState, canRedo, canUndo, push, redo, startHistory, undo } from "../../core/edit/history.js";
import type { Resources } from "../../core/session.js";
import type { SkinFinding } from "../../core/skin/check.js";
import type { SkinProject, checkProject as CheckProject } from "../../core/skin/project.js";
import { browserBitmapDecoder, browserCanvas } from "../platform.js";
import type { TextModel } from "../../core/font/font.js";
import { errorText } from "../../core/errors.js";

/** The skin project's checks: loaded with the skin editor (they are in its chunk), not with the app. */
let checkProject: typeof CheckProject | null = null;

export function useSkin(base: Resources | null, textModel: TextModel) {
  const [hist, setHist] = useState<HistoryState<SkinProject | null>>(() => startHistory<SkinProject | null>(null));
  const [preview, setPreview] = useState<Resources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const faces = useRef(new Map<string, FontFace>());
  const project = hist.present;
  const [checker, setChecker] = useState(() => checkProject);

  useEffect(() => {
    if (!project || checker) return;
    void import("../../core/skin/project.js").then((m) => {
      checkProject = m.checkProject;
      setChecker(() => m.checkProject);
    });
  }, [project, checker]);

  const apply = useCallback((fn: (p: SkinProject) => SkinProject, key: string | null = null) => {
    setHist((h) => (h.present ? push(h, fn(h.present), key) : h));
  }, []);
  // The project as last opened, exported or saved: the skin editor has no autosave, so leaving it with other changes
  // asks first (SkinMode's "Open another skin").
  const [saved, setSaved] = useState<SkinProject | null>(null);
  const start = useCallback((p: SkinProject | null) => {
    setHist(startHistory(p));
    setSaved(p);
  }, []);

  useEffect(() => {
    if (!project || !base) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      import("../../core/skin/preview.js")
        .then(({ skinResources }) => skinResources(base, project, { makeCanvas: browserCanvas, decodeBitmap: browserBitmapDecoder, textModel, faceCache: faces.current }))
        .then((r) => {
          if (cancelled) return;
          setPreview(r);
          setError(null);
        })
        .catch((e) => !cancelled && setError(errorText(e)))
        .finally(() => !cancelled && setBusy(false));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [project, base, textModel]);

  const findings: SkinFinding[] = useMemo(() => (project && checker ? checker(project, base?.resman ?? null) : []), [project, base, checker]);

  return {
    project,
    start,
    apply,
    undo: useCallback(() => setHist((h) => undo(h)), []),
    redo: useCallback(() => setHist((h) => redo(h)), []),
    canUndo: canUndo(hist),
    canRedo: canRedo(hist),
    /** Edits since the skin was opened, last exported or saved as a project. */
    dirty: !!project && project !== saved,
    markSaved: useCallback(() => setSaved(hist.present), [hist.present]),
    preview,
    error,
    busy,
    findings,
  };
}

export type SkinState = ReturnType<typeof useSkin>;
