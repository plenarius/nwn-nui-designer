/** Export: the .jui (for NuiCreateFromResRef), NWScript (nw_inc_nui builder calls), the project, a nui-preview dump. */
import { useMemo, useState } from "react";
import { resrefProblem, writeJui } from "../../core/edit/jui.js";
import { nwscriptOptions, writeNwscript } from "../../core/edit/nwscript.js";
import { type EditorDoc, type ExportSettings, PROJECT_EXT, writeDump, writeProject } from "../../core/edit/project.js";
import { cp1252, download, downloadBytes } from "./files.js";
import { Highlighted } from "./highlight.js";
import { Icon } from "./icons.js";
import { Modal } from "./Modal.js";
import type { Editor } from "./useEditor.js";
import { errorText } from "../../core/errors.js";
import { exportWindow } from "../../core/mobile/portable.js";
import NUI_TOUCH from "../../../nss/nui_touch.nss?raw";

type Tab = "jui" | "nss" | "project" | "dump";

export function ExportDialog({ doc, ed, onClose, problems }: { doc: EditorDoc; ed: Editor; onClose(): void; problems: number }) {
  const [tab, setTab] = useState<Tab>("jui");
  const [skeleton, setSkeleton] = useState(true);
  const [compact, setCompact] = useState(false);
  const x = doc.export;
  const set = (k: "resref" | "windowId" | "script" | "prefix", v: string) => ed.apply((d) => ({ ...d, export: { ...d.export, [k]: v } }), `export:${k}`);
  const setFlag = (k: "portableMargins" | "touch", v: boolean) =>
    ed.apply((d) => {
      const exp: ExportSettings = { ...d.export };
      if (v) exp[k] = true;
      else delete exp[k];
      return { ...d, export: exp };
    }, `export:${k}`);
  const text = useMemo(() => {
    try {
      if (tab === "jui") return writeJui(exportWindow(doc), compact ? "" : "  ");
      if (tab === "nss") return writeNwscript(exportWindow(doc), { ...nwscriptOptions(doc), skeleton });
      if (tab === "project") return writeProject(doc);
      return writeDump(doc);
    } catch (e) {
      return `// ${errorText(e)}`;
    }
  }, [doc, tab, skeleton, compact]);
  const file = tab === "jui" ? `${x.resref}.jui` : tab === "nss" ? `${x.script}.nss` : tab === "project" ? `${doc.name}${PROJECT_EXT}` : `${doc.name}.json`;
  const resrefBad = resrefProblem(x.resref);
  const scriptBad = resrefProblem(x.script);
  const idBad = /^[A-Za-z0-9_]+$/.test(x.windowId) ? null : "letters, digits and _";
  const prefixBad = /^[A-Za-z][A-Za-z0-9_]*$/.test(x.prefix) ? null : "an NWScript name: a letter, then letters, digits and _";
  const lines = text.split("\n").length;
  return (
    <Modal title={<>Export “{doc.name}”</>} icon="export" className="export" onClose={onClose}>
      <div className="tabs">
        {(
          [
            ["jui", ".jui", "For NuiCreateFromResRef"],
            ["nss", "NWScript", "nw_inc_nui builder calls"],
            ["project", "Project", "Window, samples, notes"],
            ["dump", "Dump", "nui-preview's format"],
          ] as const
        ).map(([k, label, sub]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)} data-autofocus={tab === k || undefined}>
            <b>{label}</b>
            <span>{sub}</span>
          </button>
        ))}
      </div>
      <div className="export-body">
        <aside className="export-side">
          {tab === "jui" && (
            <>
              <label className="field">
                <span>Resref</span>
                <input className={`mono${resrefBad ? " bad" : ""}`} value={x.resref} maxLength={16} onChange={(e) => set("resref", e.target.value.toLowerCase())} />
                {resrefBad && <em className="finding error">{resrefBad}</em>}
              </label>
              <label className="field">
                <span>Window id</span>
                <input className={`mono${idBad ? " bad" : ""}`} value={x.windowId} onChange={(e) => set("windowId", e.target.value)} />
              </label>
              <label className="inline">
                <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} /> Compact (one line)
              </label>
              <label className="inline" title="iOS multiplies every margin by its screen density (NUI-MOBILE-021): write margin 0 on every element and the gaps as spacers. docs/MOBILE.md">
                <input type="checkbox" checked={!!x.portableMargins} onChange={(e) => setFlag("portableMargins", e.target.checked)} /> Portable margins (margin 0 and spacers, for iOS)
              </label>
              <div className="note">
                <p>
                  Ship <code>{x.resref}.jui</code> to the players (a hak, NWSync, or their override): the client loads it from its own resources, so the
                  server only sends the name.
                </p>
                <pre className="mono">{`int nToken = NuiCreateFromResRef(oPC, "${x.resref}", "${x.windowId}");`}</pre>
                <p>
                  It is the window's JSON, the same as <code>NuiCreate</code> takes: strict JSON, no comments. Binds and ids are in it; set the bind values
                  with <code>NuiSetBind</code> after it opens.
                </p>
              </div>
            </>
          )}
          {tab === "nss" && (
            <>
              <label className="field">
                <span>Script (resref)</span>
                <input className={`mono${scriptBad ? " bad" : ""}`} value={x.script} maxLength={16} onChange={(e) => set("script", e.target.value.toLowerCase())} />
                {scriptBad && <em className="finding error">{scriptBad}</em>}
              </label>
              <label className="field">
                <span>Prefix</span>
                <input className={`mono${prefixBad ? " bad" : ""}`} value={x.prefix} onChange={(e) => set("prefix", e.target.value)} />
                {prefixBad && <em className="finding error">{prefixBad}</em>}
              </label>
              <label className="field">
                <span>Window id</span>
                <input className={`mono${idBad ? " bad" : ""}`} value={x.windowId} onChange={(e) => set("windowId", e.target.value)} />
              </label>
              <label className="inline">
                <input type="checkbox" checked={skeleton} onChange={(e) => setSkeleton(e.target.checked)} /> Open, bind and event skeleton
              </label>
              <label className="inline" title="iOS multiplies every margin by its screen density (NUI-MOBILE-021): write margin 0 on every element and the gaps as spacers. docs/MOBILE.md">
                <input type="checkbox" checked={!!x.portableMargins} onChange={(e) => setFlag("portableMargins", e.target.checked)} /> Portable margins (margin 0 and spacers, for iOS)
              </label>
              <label className="inline" title="The skeleton builds the window per player through nui_touch.nss: controls grown and list cells narrowed for the iOS frame and inset, list row heights, cell widths and draw coordinates divided by the player's density, the position by density / UI scale, -1 windows at the top left, the iOS frame's extra size added. docs/MOBILE.md">
                <input type="checkbox" checked={!!x.touch} disabled={!skeleton} onChange={(e) => setFlag("touch", e.target.checked)} /> Scale for touch clients (nui_touch)
              </label>
              <div className="note">
                <p>
                  <code>{x.prefix}_Window()</code> builds exactly the JSON of the .jui, with <code>nw_inc_nui</code>'s builders. Binds and ids are constants.
                </p>
                {skeleton ? (
                  <p>
                    <code>{x.prefix}_Open(oPC)</code> opens it with this script as its event script and sets the sample values; <code>main()</code> handles its
                    events.
                  </p>
                ) : (
                  <p>Without the skeleton the file is an include.</p>
                )}
                {x.touch && skeleton && (
                  <p>
                    Ship <code>nui_touch.nss</code> beside it{" "}
                    <button className="small" onClick={() => { downloadBytes(cp1252(NUI_TOUCH), "nui_touch.nss"); ed.toast("Downloaded nui_touch.nss", "ok"); }}>
                      <Icon name="export" size={12} /> nui_touch.nss
                    </button>
                    , call <code>NuiTouch_StartProbe(oPC, sEventScript, sThen)</code> at login (open windows from <code>sThen</code>) and <code>NuiTouch_HandleEvent()</code> first in the NUI event script. Its numbers come from one iPhone and one Android tablet.
                  </p>
                )}
                <p className="muted">Saved in the Windows-1252 encoding the compiler reads.</p>
              </div>
            </>
          )}
          {tab === "project" && (
            <div className="note">
              <p>Everything to carry on later: the window, the sample bind values, panes, your notes and these export settings.</p>
              <p className="muted">Save (Ctrl+S) writes the same file.</p>
            </div>
          )}
          {tab === "dump" && (
            <div className="note">
              <p>The window with its bind values in nwn-module's nui-preview format, for its renderer and for this designer's viewer.</p>
            </div>
          )}
          {x.portableMargins && (tab === "jui" || tab === "nss") && (
            <p className="muted small">
              Portable margins: each margin is now a spacer, and list cells lose theirs (their content fills the cell). Fixed sizes lay out as before; where the solver shares room between flexible elements, it can settle a little differently. Open the export to check it.
            </p>
          )}
          {problems > 0 && (
            <p className="finding warning">
              {problems} error{problems > 1 ? "s" : ""} in the problems list.
            </p>
          )}
        </aside>
        <div className="export-code">
          <div className="code-head">
            <span className="mono">{file}</span>
            <span className="muted small">
              {lines} lines · {new Blob([text]).size.toLocaleString()} bytes
            </span>
            <span className="spacer" />
            <button
              className="small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  ed.toast("Copied", "ok");
                } catch {
                  ed.toast("The browser did not allow copying", "error");
                }
              }}
            >
              <Icon name="copy" size={14} /> Copy
            </button>
            <button
              className="primary small"
              disabled={(tab === "jui" && !!resrefBad) || (tab === "nss" && (!!scriptBad || !!prefixBad))}
              onClick={() => {
                if (tab === "nss") downloadBytes(cp1252(text), file);
                else download(text, file);
                ed.toast(`Downloaded ${file}`, "ok");
              }}
            >
              <Icon name="export" size={14} /> Download
            </button>
          </div>
          <pre className="code" data-testid="export-code"><Highlighted text={text} lang={tab === "nss" ? "nss" : "json"} /></pre>
        </div>
      </div>
    </Modal>
  );
}
