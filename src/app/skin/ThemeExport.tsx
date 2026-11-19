/**
 * The skin export dialog's "Full theme" tab: the NUI skin and the original GUI retoned to match it (src/core/reskin/
 * theme.ts, the same as `pnpm export-theme`), downloaded as one zip: stock/ and a hak under the stock names, and,
 * with a prefix, prefixed/, its hak and prefixed.json for a server that lets each player choose. The original GUI is
 * read from the user's own game folder: without one loaded, the tab says so and does nothing.
 */
import { useMemo, useState } from "react";
import { ResMan } from "../../core/res/resman.js";
import { writeZip } from "../../core/res/zip.js";
import { LIGHT_WARNING, type ThemeResult, exportTheme, hasGame, lightCheck, normalisePrefix, themePackage } from "../../core/reskin/theme.js";
import type { SkinProject } from "../../core/skin/project.js";
import { errorText } from "../../core/errors.js";
import { downloadBytes } from "../editor/files.js";
import { Icon } from "../editor/icons.js";

const GAME_KINDS = new Set(["key", "game-ovr", "texture-pack"]);

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

type State = { kind: "idle" } | { kind: "running"; done: number; total: number; name: string } | { kind: "done"; r: ThemeResult; zip: Uint8Array; file: string } | { kind: "error"; text: string };

export function ThemeExport({ project, resman, nameBad, onSaved }: { project: SkinProject; resman: ResMan | null; nameBad: string | null; onSaved(): void }) {
  const [usePrefix, setUsePrefix] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [haks, setHaks] = useState(true);
  const [state, setState] = useState<State>({ kind: "idle" });
  const light = useMemo(() => (project.style ? lightCheck(project.style) : null), [project.style]);
  const game = hasGame(resman);
  const prefixBad = usePrefix && !normalisePrefix(prefix) ? "1 or 2 letters and digits, starting with a letter (e.g. bz)" : null;
  const blocked = !project.style
    ? "This skin has no generator style, and the original GUI's palette is derived from one: open it in the Generator (or start from a built-in skin) first."
    : !game
      ? "No game loaded. The original GUI is retoned from your own install's textures: load your game folder (Game and haks in the toolbar) first."
      : null;
  const hakName = project.name;
  const prefixHak = `${project.name.slice(0, 14)}_p`;

  const run = async () => {
    if (!resman) return;
    const rm = new ResMan();
    rm.layers = resman.layers.filter((l) => l.kind !== "memory" && (haks || GAME_KINDS.has(l.kind)));
    setState({ kind: "running", done: 0, total: 1, name: "" });
    try {
      const r = await exportTheme({
        project,
        resman: rm,
        prefix: usePrefix ? prefix : undefined,
        progress: async (done, total, name) => {
          setState({ kind: "running", done, total, name });
          // let the browser draw between textures (compressing one can take a moment)
          await new Promise((res) => setTimeout(res, 0));
        },
      });
      const pkg = themePackage(r, { hak: hakName, prefixHak: r.prefixed ? prefixHak : undefined });
      const zip = writeZip(Object.entries(pkg).map(([name, data]) => ({ name, data })));
      setState({ kind: "done", r, zip, file: `${project.name}-theme.zip` });
    } catch (e) {
      setState({ kind: "error", text: errorText(e) });
    }
  };

  const running = state.kind === "running";
  return (
    <>
      <p className="muted small">
        The whole theme in one package: this NUI skin and the original GUI (character record, inventory, chat, quickbar, character select, the creation wizard, ...) retoned from your own game's textures to match it.
        Everything under the stock names goes in <code>stock/</code> and <code>{hakName}.hak</code>: list the hak in the module (or put the files in an override folder) and every window has the look.
      </p>
      {blocked && (
        <p className="finding error" data-testid="theme-blocked">
          {blocked}
        </p>
      )}
      {light?.light && (
        <p className="finding warning" data-testid="theme-light">
          {LIGHT_WARNING}
        </p>
      )}
      <div className="row-btns theme-options">
        <label className="inline">
          <input type="checkbox" checked={haks} onChange={(e) => setHaks(e.target.checked)} disabled={running} /> Read the stock textures through the module's haks too
        </label>
        <label className="inline">
          <input type="checkbox" checked={usePrefix} onChange={(e) => setUsePrefix(e.target.checked)} disabled={running} /> Also under a prefix, for players to choose
        </label>
        {usePrefix && (
          <label className="field">
            <span>Prefix</span>
            <input className={`mono${prefixBad ? " bad" : ""}`} value={prefix} maxLength={3} onChange={(e) => setPrefix(e.target.value.toLowerCase())} aria-label="Theme prefix" placeholder="bz" disabled={running} />
          </label>
        )}
        {prefixBad && prefix && <span className="finding error">{prefixBad}</span>}
        <span className="spacer" />
        <button className="primary" disabled={!!blocked || !!nameBad || !!prefixBad || running} onClick={run}>
          <Icon name="export" size={14} /> {running ? "Building..." : "Build the theme"}
        </button>
      </div>
      {usePrefix && (
        <p className="muted small">
          With a prefix of one or two characters, each name's first part becomes the prefix and a letter (with bz: gui_boxes is bzg_boxes, nui_skin is bzn_skin), so every name keeps its length. The zip then
          also holds <code>prefixed/</code>, <code>{prefixHak}.hak</code> and <code>prefixed.json</code>, the map a server uses to switch a player (docs/RESKIN-EVERYTHING.md, "Per-player themes"). Leave out the haks if
          one of them already holds a theme under the stock names.
        </p>
      )}
      {state.kind === "running" && (
        <p className="muted small" role="status">
          <progress max={state.total} value={state.done} /> Original GUI: {state.done} of {state.total} {state.name && <code>{state.name}</code>}
        </p>
      )}
      {state.kind === "error" && <p className="finding error">{state.text}</p>}
      {state.kind === "done" && <ThemeDone {...state} onSaved={onSaved} />}
    </>
  );
}

function ThemeDone({ r, zip, file, onSaved }: { r: ThemeResult; zip: Uint8Array; file: string; onSaved(): void }) {
  const m = r.reskin.manifest;
  const bad = m.textures.filter((t) => !t.validation.ok);
  return (
    <div className="theme-done" data-testid="theme-done">
      <h3>Ready</h3>
      <ul className="left-out">
        <li>
          <code>stock/</code>: {Object.keys(r.stock).length} files: the NUI skin ({r.skinItems.length}) and {m.textures.length} original-GUI textures with their .txi
        </li>
        {r.prefixed && (
          <li>
            <code>prefixed/</code>: the same under <code>{r.prefixed.prefix}</code>, the skin <code>{r.prefixed.manifest.skin.resref}</code>, {Object.keys(r.prefixed.manifest.textures).length} texture overrides in <code>prefixed.json</code>
          </li>
        )}
        <li>
          Left stock: {m.manual.length} icons, cursors, pictures and bitmap fonts (they need an artist; <code>report.md</code> lists them)
        </li>
        {bad.length > 0 && (
          <li className="finding error">
            {bad.length} texture{bad.length === 1 ? "" : "s"} failed a check: {bad.map((t) => t.name).join(", ")} (report.md)
          </li>
        )}
        {m.skipped.length > 0 && (
          <li className="finding warning">
            {m.skipped.length} skipped: {m.skipped.map((s) => s.name).join(", ")}
          </li>
        )}
      </ul>
      <p className="muted small">The original GUI's textures are derived from your copy of Beamdog's art: ship them in your module's haks, never in a public repository.</p>
      <button className="primary" onClick={() => (downloadBytes(zip, file, "application/zip"), onSaved())}>
        <Icon name="save" size={14} /> Download {file} ({mb(zip.length)})
      </button>
    </div>
  );
}
