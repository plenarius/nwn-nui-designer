/**
 * The game, haks and loose files the canvas draws with, and the view settings that need them rebuilt.
 *
 * With the dev server's local API (local.ts) they come from nui-designer.ini, or an install found on this computer,
 * and load at start with no clicks. Without it (a static build) the user picks them in the browser, as before.
 */
import { useCallback, useEffect, useState } from "react";
import type { TextModel } from "../../core/font/font.js";
import type { FileTree } from "../../core/res/resman.js";
import { readHakOrder } from "../../core/res/hakorder.js";
import { BlobSource } from "../../core/res/source.js";
import type { ByteSource } from "../../core/res/source.js";
import { type Resources, openResourceSet } from "../../core/session.js";
import { browserBitmapDecoder, browserCanvas, fallbackSkin } from "../platform.js";
import { type IniSettings, type LocalState, fetchLocalState, localInputs, saveLocalSettings } from "../local.js";
import { themeOf } from "../../core/skin/themes.js";
import { errorText } from "../../core/errors.js";

export interface ResourceSettings {
  textModel: TextModel;
  fallback: boolean;
  /** The built-in skin used without a game (or with "built-in skin even with a game"). */
  theme: string;
}

/** A game install as the canvas reads it: a picked folder or the local API's file list. */
export type GameTree = FileTree & { readonly size: number };

/** "loading": asking the dev server; "local": its settings are used; "browser": no local API, the pickers are. */
export type LocalStatus = "loading" | "local" | "browser";

export function useResources(s: ResourceSettings) {
  const [game, setGame] = useState<GameTree | null>(null);
  const [haks, setHaks] = useState<ByteSource[]>([]);
  const [overrides, setOverrides] = useState<ByteSource[]>([]);
  const [res, setRes] = useState<Resources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<LocalState | null>(null);
  const [status, setStatus] = useState<LocalStatus>("loading");

  const applyLocal = useCallback((st: LocalState) => {
    const i = localInputs(st);
    setLocal(st);
    setGame(i.game);
    setHaks(i.haks);
    setOverrides(i.overrides);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchLocalState().then((st) => {
      if (cancelled) return;
      if (st) applyLocal(st);
      setStatus(st ? "local" : "browser");
    });
    return () => {
      cancelled = true;
    };
  }, [applyLocal]);

  /** Writes the settings to nui-designer.ini and loads what they name; throws a SettingsError when refused. */
  const saveLocal = useCallback(
    async (n: IniSettings) => {
      const st = await saveLocalSettings(n);
      applyLocal(st);
      return st;
    },
    [applyLocal],
  );

  useEffect(() => {
    // Wait for the local settings (a few ms) rather than draw with the built-in skin and then again with the game's.
    if (status === "loading") return;
    let cancelled = false;
    setBusy(true);
    openResourceSet({
      game,
      haks,
      overrides,
      overridesLabel: status === "local" ? "override folders" : "loose files",
      forceFallback: s.fallback,
      fallbackSkin: () => fallbackSkin(s.theme),
      fallbackLabel: `built-in skin: ${themeOf(s.theme).title}`,
      makeCanvas: browserCanvas,
      decodeBitmap: browserBitmapDecoder,
      textModel: s.textModel,
    })
      .then((r) => {
        if (!cancelled) {
          setRes(r);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(String(e instanceof Error ? e.message : e)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [status, game, haks, overrides, s.textModel, s.fallback, s.theme]);

  const moveHak = useCallback(
    (i: number, d: number) =>
      setHaks((h) => {
        const j = i + d;
        if (j < 0 || j >= h.length) return h;
        const n = [...h];
        [n[i], n[j]] = [n[j]!, n[i]!];
        return n;
      }),
    [],
  );

  const orderFromIfo = useCallback(async (f: File) => {
    try {
      const ifo = await readHakOrder(new BlobSource(f.name, f));
      if (!ifo.field) throw new Error("no Mod_HakList (or Mod_Hak) in it");
      const order = ifo.haks;
      const rank = (n: string) => {
        const i = order.indexOf(n.replace(/\.(hak|erf)$/i, "").toLowerCase());
        return i < 0 ? order.length : i;
      };
      setHaks((h) => [...h].sort((a, b) => rank(a.name) - rank(b.name)));
    } catch (e) {
      setError(`${f.name}: ${errorText(e)}`);
    }
  }, []);

  return { game, setGame, haks, setHaks, moveHak, orderFromIfo, overrides, setOverrides, res, error, setError, busy, local, status, saveLocal };
}

export type ResourceState = ReturnType<typeof useResources>;
