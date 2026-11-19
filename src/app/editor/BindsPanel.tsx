/**
 * The window's binds and their sample values: what the canvas draws with, and what the NWScript skeleton sets first.
 * Presets stress the layout with one click: long text everywhere, everything empty, every list full.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { type BindDetails, applyPreset, bindDetails, fillList, sampleFor, unusedBinds } from "../../core/edit/binds.js";
import type { PropDef } from "../../core/edit/catalog.js";
import { renameBindDoc, setSample } from "../../core/edit/ops.js";
import type { EditorDoc } from "../../core/edit/project.js";
import { type ElemPath, getElem, typeOf } from "../../core/edit/tree.js";
import { bindNameFinding } from "../../core/edit/validate.js";
import { specOf } from "../../core/edit/catalog.js";
import { Field, JsonField } from "./fields.js";
import { Icon } from "./icons.js";
import type { Editor } from "./useEditor.js";

export function BindsPanel({ doc, ed, fonts, focus, rows, setRows }: { doc: EditorDoc; ed: Editor; fonts: string[]; focus: string | null; rows: number; setRows(n: number): void }) {
  const details = useMemo(() => [...bindDetails(doc.window, doc.panes).values()].sort((a, b) => a.name.localeCompare(b.name)), [doc.window, doc.panes]);
  const unused = useMemo(() => unusedBinds(doc.window, doc.binds, doc.panes), [doc]);
  const lists = useMemo(() => {
    const out = new Map<string, ElemPath>();
    for (const d of details) for (const p of d.countsRowsOf) out.set(p.join("/"), p);
    for (const d of details) for (const u of d.uses) if (u.list) out.set(u.list.join("/"), u.list);
    return [...out.values()];
  }, [details]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    const el = box.current?.querySelector(`[data-bind="${CSS.escape(focus)}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "center" });
    el?.classList.add("flash");
    const t = setTimeout(() => el?.classList.remove("flash"), 900);
    return () => clearTimeout(t);
  }, [focus]);

  return (
    <div className="binds" ref={box} data-testid="binds">
      <div className="presets">
        <div className="presets-row">
          <span className="muted small">All binds:</span>
          <button className="small" onClick={() => ed.apply((d) => ({ ...d, binds: applyPreset(d.window, d.binds, "short", d.panes, rows) }))} title="A short value for every bind">Short</button>
          <button className="small" onClick={() => ed.apply((d) => ({ ...d, binds: applyPreset(d.window, d.binds, "long", d.panes, rows) }))} title="Long text in every string, full lists">Long text</button>
          <button className="small" onClick={() => ed.apply((d) => ({ ...d, binds: applyPreset(d.window, d.binds, "empty", d.panes, rows) }))} title="Every string empty, every list empty">Empty</button>
        </div>
        <div className="presets-row">
          <span className="muted small">Lists:</span>
          <button className="small" disabled={!lists.length} onClick={() => ed.apply((d) => ({ ...d, binds: lists.reduce((b, l) => fillList(d.window, b, l, rows, "short", d.panes), d.binds) }))} title="Every list's row count and row values">
            Fill {lists.length ? `${lists.length} list${lists.length > 1 ? "s" : ""}` : "lists"} with
          </button>
          <input className="num tiny" type="number" min={0} max={500} value={rows} onChange={(e) => setRows(Math.max(0, Math.min(500, Number(e.target.value) || 0)))} aria-label="Rows" />
          <span className="muted small">rows</span>
        </div>
      </div>
      {!details.length && <p className="muted pad">No binds yet. Bind a property with its <Icon name="link" size={12} /> button: the script then sets its value, and the value here is the sample the canvas shows.</p>}
      {details.map((d) => (
        <BindCard key={d.name} d={d} doc={doc} ed={ed} fonts={fonts} rows={rows} />
      ))}
      {unused.length > 0 && (
        <div className="unused">
          <div className="muted small">Sample values of binds the window no longer uses:</div>
          {unused.map((n) => (
            <div key={n} className="unused-row">
              <code>{n}</code>
              <button className="icon-btn" title="Remove the sample" onClick={() => ed.apply((x) => setSample(x, n, undefined))}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BindCard({ d, doc, ed, fonts, rows }: { d: BindDetails; doc: EditorDoc; ed: Editor; fonts: string[]; rows: number }) {
  const [name, setName] = useState(d.name);
  useEffect(() => setName(d.name), [d.name]);
  const v = doc.binds[d.name];
  const rename = () => {
    if (name === d.name) return;
    const why = bindNameFinding(name);
    if (why) {
      ed.toast(why, "error");
      setName(d.name);
      return;
    }
    ed.apply((x) => renameBindDoc(x, d.name, name));
  };
  const def: PropDef = { key: d.name, label: d.name, kind: d.kind === "json" ? "string" : d.kind, bindable: false, group: "Content", options: undefined };
  // An enum's options come from its first use.
  const use0 = d.uses[0];
  if (d.kind === "enum" && use0?.path) {
    const e = getElem(doc.window, use0.path);
    def.options = specOf(typeOf(e))?.props.find((p) => p.key === use0.key)?.options;
  }
  const rowish = d.perRow || d.countsRowsOf.length > 0;
  const where = (u: (typeof d.uses)[number]) => {
    if (!u.path) return `window.${u.key}`;
    const e = getElem(doc.window, u.path);
    return `${specOf(typeOf(e))?.title ?? typeOf(e)}${e && typeof e.id === "string" && e.id ? ` #${e.id}` : ""}.${u.key}`;
  };
  return (
    <div className="bind-card" data-bind={d.name}>
      <div className="bind-top">
        <Icon name="bind" size={14} />
        <input className="mono bind-rename" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label="Bind name" />
        <span className="chip">{d.kind === "text" || d.kind === "title" ? "string" : d.kind}</span>
        {d.perRow && <span className="chip row">per row</span>}
        {d.countsRowsOf.length > 0 && <span className="chip row">row count</span>}
      </div>
      <div className="bind-uses">
        {d.uses.map((u, i) => (
          <button key={i} className="link small" onClick={() => ed.setSel(u.path)}>
            {where(u)}
          </button>
        ))}
      </div>
      <div className="bind-value">
        {rowish || d.kind === "json" || d.kind === "chart" ? <JsonField value={v} rows={rowish ? 3 : 2} onChange={(x) => ed.apply((y) => setSample(y, d.name, x), `sample:${d.name}`)} /> : <Field def={def} value={v} fonts={fonts} onChange={(x) => ed.apply((y) => setSample(y, d.name, x), `sample:${d.name}`)} />}
      </div>
      <div className="bind-presets">
        {(["empty", "short", "long"] as const).map((p) => (
          <button key={p} className="chip-btn" onClick={() => ed.apply((y) => setSample(y, d.name, sampleFor(d, p, rows)))}>
            {p === "short" ? (rowish ? `${rows} rows` : "short") : p}
          </button>
        ))}
        {v === undefined && <span className="muted small">unset: the canvas shows {"{" + d.name + "}"}</span>}
      </div>
    </div>
  );
}
