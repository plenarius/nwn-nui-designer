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

type Tab = "jui" | "nss" | "project" | "dump";

export function ExportDialog({ doc, ed, onClose, problems }: { doc: EditorDoc; ed: Editor; onClose(): void; problems: number }) {
  const [tab, setTab] = useState<Tab>("jui");
  const [skeleton, setSkeleton] = useState(true);
  const [compact, setCompact] = useState(false);
  const x = doc.export;
  const set = (k: keyof ExportSettings, v: string) => ed.apply((d) => ({ ...d, export: { ...d.export, [k]: v } }), `export:${k}`);
  const text = useMemo(() => {
    try {
      if (tab === "jui") return writeJui(doc.window, compact ? "" : "  ");
      if (tab === "nss") return writeNwscript(doc.window, { ...nwscriptOptions(doc), skeleton });
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
