/**
 * The game folder, haks and loose files the canvas draws with, and how it draws. With the dev server's local API the
 * folders are paths saved in nui-designer.ini (LocalSection); without it, the browser's pickers (BrowserSection).
 */
import { useEffect, useRef, useState } from "react";
import type { TextModel } from "../../core/font/font.js";
import { BlobSource } from "../../core/res/source.js";
import { hasDirectoryPicker, pickDirectory, treeFromFileList } from "../platform.js";
import { type IniSettings, type LocalState, SettingsError } from "../local.js";
import { Icon } from "./icons.js";
import { Modal } from "./Modal.js";
import type { ResourceState } from "./useResources.js";
import { errorText } from "../../core/errors.js";

export interface DrawSettings {
  textModel: TextModel;
  fallback: boolean;
}

export function ResourcesDialog({ r, s, set, onClose }: { r: ResourceState; s: DrawSettings; set<K extends keyof DrawSettings>(k: K, v: DrawSettings[K]): void; onClose(): void }) {
  return (
    <Modal title="Game and haks" icon="folder" className="resources" onClose={onClose}>
      <div className="modal-body">
        {r.status === "local" && r.local ? <LocalSection r={r} st={r.local} /> : r.status === "loading" ? <p className="muted">Asking the dev server for your settings…</p> : <BrowserSection r={r} />}
        {r.res && <p className="small muted">Skin: {r.res.skinFrom}. Fonts: {r.res.skin.fontList.map((f) => `${f.name} ${f.size}px`).join(", ")}.</p>}
        {r.res?.warnings.map((w) => <p key={w} className="finding warning">{w}</p>)}
        {r.error && <p className="finding error">{r.error}</p>}
        <h3>Drawing</h3>
        <div className="grid2 wide">
          <label htmlFor="res-text-model">Text</label>
          <select id="res-text-model" value={s.textModel} onChange={(e) => set("textModel", e.target.value as TextModel)}>
            <option value="nuklear">nuklear.h metrics (the client's; default)</option>
            <option value="nui-preview">em metrics (nui-preview's)</option>
          </select>
          <span>Skin</span>
          <label className="inline"><input type="checkbox" checked={s.fallback} onChange={(e) => set("fallback", e.target.checked)} /> Built-in skin even with a game</label>
        </div>
      </div>
    </Modal>
  );
}

function BrowserSection({ r }: { r: ResourceState }) {
  const folderInput = useRef<HTMLInputElement>(null);
  return (
    <>
        <p className="muted">
          The canvas draws with your NWN:EE install's skin, fonts and textures, and your module's haks. Without a game folder a built-in open skin is used:
          Ink and brass (the default) or another of the five, chosen in the toolbar's Drawn with.
        </p>
        <p className="small finding info">
          The editor's local server is not running (a static build opened on its own), so pick the folders here. Your browser may ask to “upload” them:
          that is only its word for reading them. Nothing leaves this computer. Run <code>pnpm dev</code> to have the folders found and remembered.
        </p>
        <div className="row-btns">
          <button
            data-autofocus
            onClick={async () => {
              if (hasDirectoryPicker) {
                try {
                  const t = await pickDirectory();
                  if (t) r.setGame(t);
                } catch (e) {
                  r.setError(errorText(e));
                }
              } else folderInput.current?.click();
            }}
          >
            <Icon name="folder" size={14} /> Pick NWN folder…
          </button>
          {r.game && <button onClick={() => r.setGame(null)}>Forget it</button>}
        </div>
        <input
          ref={folderInput}
          type="file"
          hidden
          {...({ webkitdirectory: "", directory: "" } as object)}
          onChange={(e) => {
            if (e.target.files?.length) r.setGame(treeFromFileList(e.target.files));
            e.target.value = "";
          }}
        />
        <p className="small">{r.game ? <>Game: <b>{r.game.label}</b> ({r.game.size} files read)</> : <span className="muted">No game folder.</span>}</p>
        <div className="row-btns">
          <label className="button">
            Add haks…
            <input type="file" accept=".hak,.erf,.mod" multiple hidden onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              r.setHaks((h) => [...h, ...fs.filter((f) => !h.some((x) => x.name === f.name)).map((f) => new BlobSource(f.name, f))]);
              e.target.value = "";
            }} />
          </label>
          <label className="button">
            Order by module.ifo…
            <input type="file" accept=".json,.ifo,.mod" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void r.orderFromIfo(f);
              e.target.value = "";
            }} />
          </label>
          <label className="button">
            Add loose files…
            <input type="file" multiple hidden onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              r.setOverrides((o) => [...o, ...fs.map((f) => new BlobSource(f.name, f))]);
              e.target.value = "";
            }} />
          </label>
        </div>
        {r.haks.length > 0 && (
          <>
            <ol className="haks">
              {r.haks.map((h, i) => (
                <li key={h.name}>
                  <span>{h.name}</span>
                  <button className="icon-btn" onClick={() => r.moveHak(i, -1)} title="Higher priority"><Icon name="up" size={12} /></button>
                  <button className="icon-btn" onClick={() => r.moveHak(i, 1)} title="Lower priority"><Icon name="down" size={12} /></button>
                  <button className="icon-btn" onClick={() => r.setHaks((x) => x.filter((_, j) => j !== i))} title="Remove"><Icon name="close" size={12} /></button>
                </li>
              ))}
            </ol>
            <p className="muted small">Module order: the first hak wins, then loose files, then the game.</p>
          </>
        )}
        {r.overrides.length > 0 && (
          <p className="small">
            {r.overrides.length} loose file(s): {r.overrides.map((f) => f.name).join(", ")}{" "}
            <button className="small" onClick={() => r.setOverrides([])}>Clear</button>
          </p>
        )}
    </>
  );
}

const CUSTOM = "\u0000custom";
const same = (a: IniSettings, b: IniSettings) => JSON.stringify(a) === JSON.stringify(b);
const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The settings in nui-designer.ini, edited as a draft and saved with one button. */
function LocalSection({ r, st }: { r: ResourceState; st: LocalState }) {
  const [draft, setDraft] = useState<IniSettings>(st.ini.settings);
  const [custom, setCustom] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [newOvr, setNewOvr] = useState("");
  const [addHak, setAddHak] = useState("");
  useEffect(() => setDraft(st.ini.settings), [st]);
  const put = <K extends keyof IniSettings>(k: K, v: IniSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = !same(draft, st.ini.settings);

  const save = async () => {
    setSaving(true);
    try {
      await r.saveLocal(draft);
      setErrors({});
      setCustom(false);
    } catch (e) {
      setErrors(e instanceof SettingsError ? { ...e.errors, _: Object.keys(e.errors).length ? "" : e.message } : { _: errorText(e) });
    } finally {
      setSaving(false);
    }
  };

  // The game select: the detected installs, the file's game if it is none of them, and a custom path.
  const options = st.detected.map((i) => ({ value: i.path, label: `${i.store}: ${i.path}` }));
  if (draft.game && !st.detected.some((i) => i.path === draft.game)) options.push({ value: draft.game, label: draft.game });
  const selected = custom ? CUSTOM : draft.game || (st.game?.from === "detected" ? st.game.path : "");
  const err = (k: string) => errors[k] && <p className="finding error small">{errors[k]}</p>;
  const fromNote = (v: string | undefined, name: string) => v && <p className="small muted">{name}={v} is set and overrides the file.</p>;
  const orderEditable = !draft.module_ifo;

  return (
    <>
      <p className="muted">
        The canvas draws with your NWN:EE install's skin, fonts and textures, and your module's haks, read from your disk by the editor's local server. The
        settings are saved in <code>{st.ini.path}</code>{st.ini.exists ? "" : " (made when you save)"}; the command line reads it too.
      </p>
      <h3>Game</h3>
      <div className="grid2 wide">
        <label htmlFor="res-game">Install</label>
        <select
          id="res-game"
          data-autofocus
          value={selected}
          onChange={(e) => {
            if (e.target.value === CUSTOM) setCustom(true);
            else {
              setCustom(false);
              put("game", e.target.value);
            }
          }}
        >
          {!selected && <option value="">No game: the built-in skin</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom path…</option>
        </select>
        {custom && (
          <>
            <label htmlFor="res-game-path">Folder</label>
            <input id="res-game-path" type="text" placeholder="the folder that holds data/ and ovr/" value={draft.game} onChange={(e) => put("game", e.target.value)} />
          </>
        )}
      </div>
      {err("game")}
      {fromNote(st.env.NWN_ROOT, "NWN_ROOT")}
      <p className="small" data-testid="game-status">
        {st.game ? (
          <>
            Game: <b>{st.game.path}</b> ({st.game.from === "detected" ? "found on this computer; save to keep it" : st.game.from === "env" ? "NWN_ROOT" : "nui-designer.ini"}, {st.game.files.length} files)
          </>
        ) : st.gameError ? (
          <span className="finding error">{st.gameError}</span>
        ) : (
          <span className="muted">No game{st.detected.length ? "" : " found in the usual Steam, GOG and Beamdog folders: choose Custom path…"}.</span>
        )}
      </p>

      <h3>Haks</h3>
      <div className="grid2 wide">
        <label htmlFor="res-hak-dir">Hak folder</label>
        <input id="res-hak-dir" type="text" placeholder={st.hakDir?.from === "detected" ? st.hakDir.path : "the folder of your .hak files"} value={draft.hak_dir} onChange={(e) => put("hak_dir", e.target.value)} />
        <label htmlFor="res-ifo">Hak order</label>
        <input id="res-ifo" type="text" placeholder="module.ifo.json (nasher), module.ifo or .mod; or list the haks below" value={draft.module_ifo} onChange={(e) => put("module_ifo", e.target.value)} />
      </div>
      {err("hak_dir")}
      {err("module_ifo")}
      {fromNote(st.env.NWN_HAK_DIR, "NWN_HAK_DIR")}
      {fromNote(st.env.NWN_MODULE_IFO, "NWN_MODULE_IFO")}
      {st.hakDirError && <p className="finding error small">{st.hakDirError}</p>}
      {st.order.error && <p className="finding error small">{st.order.error}</p>}
      {st.hakDir?.from === "detected" && <p className="small muted">Hak folder found: {st.hakDir.path}</p>}
      {orderEditable ? (
        <>
          <ol className="haks" aria-label="Haks, best first">
            {draft.haks.map((h, i) => {
              const e = st.available.includes(h);
              return (
                <li key={h} className={e ? undefined : "missing"}>
                  <span>{h}{e ? "" : " (not in the hak folder)"}</span>
                  <button className="icon-btn" disabled={i === 0} onClick={() => put("haks", move(draft.haks, i, -1))} title="Higher priority" aria-label={`Move ${h} up`}><Icon name="up" size={12} /></button>
                  <button className="icon-btn" disabled={i === draft.haks.length - 1} onClick={() => put("haks", move(draft.haks, i, 1))} title="Lower priority" aria-label={`Move ${h} down`}><Icon name="down" size={12} /></button>
                  <button className="icon-btn" onClick={() => put("haks", draft.haks.filter((_, j) => j !== i))} title="Remove" aria-label={`Remove ${h}`}><Icon name="close" size={12} /></button>
                </li>
              );
            })}
          </ol>
          {st.available.length > 0 && (
            <div className="row-btns">
              <select aria-label="Hak to add" value={addHak} onChange={(e) => setAddHak(e.target.value)}>
                <option value="">Add a hak from the folder…</option>
                {st.available.filter((h) => !draft.haks.includes(h)).map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
              <button disabled={!addHak} onClick={() => { put("haks", [...draft.haks, addHak]); setAddHak(""); }}>Add</button>
            </div>
          )}
        </>
      ) : (
        <ol className="haks" aria-label="Haks in module order">
          {st.haks.map((h) => (
            <li key={h.name} className={h.found ? undefined : "missing"}>
              <span>{h.name}</span> {h.found ? <span className="muted small">{kb(h.size!)}</span> : <b className="finding error small">missing from the hak folder</b>}
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">
        {st.haks.length ? `${st.haks.filter((h) => h.found).length} of ${st.haks.length} haks loaded. ` : ""}Module order: the first hak wins, then the override folders, then the game.
      </p>

      <h3>Override folders</h3>
      <ul className="haks" aria-label="Override folders">
        {draft.overrides.map((o, i) => {
          // The saved folders' state, in the file's order (a folder added in the draft has none yet).
          const saved = st.ini.settings.overrides.indexOf(o);
          const f = saved >= 0 ? st.overrides[saved] : undefined;
          return (
            <li key={o}>
              <span>{o}</span> {f && (f.error ? <b className="finding error small">{f.error}</b> : <span className="muted small">{f.files.length} files</span>)}
              <button className="icon-btn" onClick={() => put("overrides", draft.overrides.filter((_, j) => j !== i))} title="Remove" aria-label={`Remove ${o}`}><Icon name="close" size={12} /></button>
            </li>
          );
        })}
      </ul>
      <div className="row-btns">
        <input type="text" aria-label="Override folder to add" placeholder="a folder of loose files (override/, development/)" value={newOvr} onChange={(e) => setNewOvr(e.target.value)} />
        <button disabled={!newOvr.trim()} onClick={() => { put("overrides", [...draft.overrides, newOvr.trim()]); setNewOvr(""); }}>Add</button>
      </div>
      {err("overrides")}

      <h3>Windows</h3>
      <div className="grid2 wide">
        <label htmlFor="res-windows">Folder</label>
        <input id="res-windows" type="text" placeholder="your module's window files, for the start screen and the window switcher" value={draft.windows} onChange={(e) => put("windows", e.target.value)} />
      </div>
      {err("windows")}
      {st.windows && !st.windows.error && <p className="small muted">{st.windows.files.length} window file(s), listed on the start screen and in the window switcher (the window's name in the toolbar).</p>}

      <div className="row-btns save-row">
        <button className="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save to nui-designer.ini"}
        </button>
        {dirty && <button onClick={() => { setDraft(st.ini.settings); setCustom(false); setErrors({}); }}>Undo changes</button>}
      </div>
      {errors._ && <p className="finding error">{errors._}</p>}
    </>
  );
}

function move<T>(a: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= a.length) return a;
  const n = [...a];
  [n[i], n[j]] = [n[j]!, n[i]!];
  return n;
}
