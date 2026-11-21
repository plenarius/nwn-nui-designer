/**
 * Exporting a skin: a hak (or an ERF) a module lists, a zip of loose files for the override or development folder,
 * nui_skin.tml alone, the skin project, or the full theme (the skin and the original GUI redrawn to match: ThemeExport). Shows exactly what goes in (only the user's own and generated files, the
 * .tml and a licence note), what is left out and why (the game's own textures and fonts are never bundled), and the
 * licence note.
 */
import { useMemo, useState } from "react";
import type { ResMan } from "../../core/res/resman.js";
import type { SkinFinding } from "../../core/skin/check.js";
import { SKIN_PROJECT_EXT, type SkinProject, exportHak, exportZip, planExport, writeSkinProject } from "../../core/skin/project.js";
import { download, downloadBytes } from "../editor/files.js";
import { Icon } from "../editor/icons.js";
import { Modal } from "../editor/Modal.js";
import { ThemeExport } from "./ThemeExport.js";

type Format = "hak" | "erf" | "zip" | "tml" | "project" | "theme";

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);

const LICENCE_LABEL: Record<string, string> = { user: "yours", cc0: "CC0", ofl: "OFL", text: "licence text", tml: "the skin", note: "licence note" };

export function SkinExportDialog({ project, resman, findings, onClose, onRename, onSaved }: { project: SkinProject; resman: ResMan | null; findings: SkinFinding[]; onClose(): void; onRename(n: string): void; onSaved(): void }) {
  const [fmt, setFmt] = useState<Format>("hak");
  const plan = useMemo(() => planExport(project, resman), [project, resman]);
  const nameBad = !/^[a-z0-9_]{1,16}$/.test(project.name) ? "1 to 16 characters: a to z, 0 to 9 and _" : null;
  const errors = findings.filter((f) => f.severity === "error").length;
  const items = fmt === "tml" ? plan.items.filter((i) => i.ext === "tml") : plan.items;
  const total = items.reduce((s, i) => s + i.data.length, 0);
  const go = () => {
    if (fmt === "theme") return;
    // anything downloaded keeps the skin as it is now: leaving it no longer asks
    onSaved();
    if (fmt === "tml") return download(project.tml, "nui_skin.tml", "text/plain");
    if (fmt === "project") return download(writeSkinProject(project), `${project.name}${SKIN_PROJECT_EXT}`);
    if (fmt === "zip") return downloadBytes(exportZip(plan), `${project.name}.zip`, "application/zip");
    downloadBytes(exportHak(plan, project.name, { fileType: fmt === "erf" ? "ERF" : "HAK" }), `${project.name}.${fmt}`, "application/octet-stream");
  };
  return (
    <Modal title="Export the skin" icon="export" className="export skin-export" onClose={onClose}>
      <div className="tabs">
        {(
          [
            ["hak", ".hak", "List it in the module"],
            ["erf", ".erf", "The same, as an ERF"],
            ["zip", "Loose files", "override or development"],
            ["tml", "nui_skin.tml", "The file alone"],
            ["project", "Project", "Reopen it here"],
            ["theme", "Full theme", "With the original GUI"],
          ] as const
        ).map(([k, label, sub]) => (
          <button key={k} className={fmt === k ? "on" : ""} onClick={() => setFmt(k)} data-autofocus={fmt === k || undefined}>
            <b>{label}</b>
            <span>{sub}</span>
          </button>
        ))}
      </div>
      <div className="modal-body skin-export-body">
        <div className="row-btns">
          <label className="field">
            <span>Name</span>
            <input className={`mono${nameBad ? " bad" : ""}`} value={project.name} onChange={(e) => onRename(e.target.value.toLowerCase())} aria-label="Skin name" title={nameBad ?? "The hak's file name"} />
          </label>
          {nameBad && <span className="finding error">{nameBad}</span>}
          <span className="spacer" />
          {errors > 0 && (
            <span className="finding warning">
              <Icon name="warning" size={13} /> {errors} error{errors === 1 ? "" : "s"} in the skin: the client will draw {errors === 1 ? "it" : "them"} wrong.
            </span>
          )}
          {fmt !== "theme" && (
            <button className="primary" disabled={!!nameBad && fmt !== "tml"} onClick={go}>
              <Icon name="save" size={14} /> Download {fmt === "tml" ? "nui_skin.tml" : fmt === "project" ? `${project.name}${SKIN_PROJECT_EXT}` : fmt === "zip" ? `${project.name}.zip` : `${project.name}.${fmt}`}
            </button>
          )}
        </div>
        {fmt === "theme" ? (
          <ThemeExport project={project} resman={resman} nameBad={nameBad} onSaved={onSaved} />
        ) : (
          <>
            <p className="muted small">
              {fmt === "hak" || fmt === "erf"
                ? "Add the hak to the module (or ship it through NWSync): the client reads nui_skin.tml and bakes its fonts every time a player joins, so every NUI window, the game's own included, gets this skin."
                : fmt === "zip"
                  ? "Unpack into a player's override folder, or development/ for testing (development beats a server's hak; override loses to it)."
                  : fmt === "tml"
                    ? "The skin's text alone, with its comments and order as they were. The textures and fonts it names must reach players some other way."
                    : "The whole project (the .tml, your files, the generator's style) to open here again."}
            </p>
            {fmt !== "project" && (
              <>
                <h3>
                  What goes in <span className="muted small">({items.length} files, {kb(total)})</span>
                </h3>
                <table className="export-files">
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.file}>
                        <td>
                          <code>
                            {i.resref}.{i.ext}
                          </code>
                        </td>
                        <td className="muted">{kb(i.data.length)}</td>
                        <td>
                          <span className={`chip lic-${i.licence}`}>{LICENCE_LABEL[i.licence] ?? i.licence}</span>
                        </td>
                        <td className="muted small">{i.why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.leftOut.length > 0 && (
                  <>
                    <h3>
                      Left out <span className="muted small">({plan.leftOut.length})</span>
                    </h3>
                    <p className="muted small">An export holds only what you made, uploaded or brought in a hak, and the open skin's CC0 and OFL files. Beamdog's files are never bundled: players have them.</p>
                    <ul className="left-out">
                      {plan.leftOut.map((l) => (
                        <li key={l.name}>
                          <code>{l.name}</code> <span className="muted small">{l.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {fmt !== "tml" && (
                  <>
                    <h3>Licence note</h3>
                    <pre className="code licence-note">{plan.note}</pre>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
