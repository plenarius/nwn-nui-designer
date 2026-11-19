/**
 * The properties of the selection (the window, or an element): every property its type supports, grouped, each
 * static or bound (where nw_inc_nui lets it be bound), with its findings under it. Draw lists, chart series and list
 * cells have editors of their own; the raw JSON is at the bottom for anything else.
 */
import { useMemo, useState } from "react";
import type { BindDetails } from "../../core/edit/binds.js";
import { bindDetails, sampleValue } from "../../core/edit/binds.js";
import { CHART_TYPE, DRAW_ITEM_COMMON, DRAW_ITEM_PROPS, DRAW_LIST_SCISSOR, DRAW_TYPE, type PropDef, WINDOW_PROPS, specOf } from "../../core/edit/catalog.js";
import { writeElement } from "../../core/edit/jui.js";
import { type Target, addDrawItem, bindProp, getValue, moveDrawItem, rebindProp, removeDrawItem, retypeDrawItem, setSample, setValue, unbindProp } from "../../core/edit/ops.js";
import type { EditorDoc } from "../../core/edit/project.js";
import { type ElemPath, cellOf, getElem, setCell, typeOf, updateElem } from "../../core/edit/tree.js";
import { type Finding, bindNameFinding } from "../../core/edit/validate.js";
import { type JsonObject, type JsonValue, isObject } from "../../core/model/types.js";
import * as N from "../../core/model/nui.js";
import { Field, JsonField } from "./fields.js";
import { Icon, typeIcon } from "./icons.js";
import type { Editor } from "./useEditor.js";
import { pressable } from "./a11y.js";
import { errorText } from "../../core/errors.js";
import type { Measure } from "../../core/edit/arrange.js";
import { MultiProperties } from "./ArrangePanel.js";

interface Ctx {
  doc: EditorDoc;
  ed: Editor;
  fonts: string[];
  binds: Map<string, BindDetails>;
  findings: Finding[];
  onShowBind(name: string): void;
}

const isBind = (v: JsonValue | undefined): v is JsonObject => isObject(v) && typeof v.bind === "string";
const tkey = (t: Target, key: string) => `${t.path === null ? "w" : t.path.join("/")}${t.item !== undefined ? `#${t.item}` : ""}${t.slot !== undefined ? `$${t.slot}` : ""}:${key}`;

function PropRow({ def, target, ctx, label }: { def: PropDef; target: Target; ctx: Ctx; label?: string }) {
  const { doc, ed } = ctx;
  const v = getValue(doc, target, def.key);
  const bound = isBind(v);
  const findingKey = target.item !== undefined ? `draw_list[${target.item}].${def.key}` : target.slot !== undefined ? `value[${target.slot}].${def.key}` : def.key;
  const mine = ctx.findings.filter((f) => f.key === findingKey && (f.path === null ? target.path === null : target.path !== null && f.path.join("/") === target.path.join("/")));
  const id = `p-${tkey(target, def.key).replace(/[^a-z0-9_-]/gi, "_")}`;
  const set = (x: JsonValue | undefined) => ed.apply((d) => setValue(d, target, def.key, x), tkey(target, def.key));
  const absent = v === undefined;
  const details = bound ? ctx.binds.get(String(v.bind)) : undefined;
  const bindName = bound ? String(v.bind) : "";
  const nameProblem = bound ? bindNameFinding(bindName) : null;
  return (
    <div className={`prop${absent ? " absent" : ""}${bound ? " bound" : ""}`} data-prop={def.key}>
      <label className="prop-label" htmlFor={id} title={def.help}>
        {label ?? def.label}
        {def.help && <span className="help">?</span>}
      </label>
      <div className="prop-value">
        {absent && def.optional ? (
          <button className="ghost" onClick={() => set(def.initial ?? sampleValue(def.kind))}>
            <Icon name="plus" size={12} /> Set
          </button>
        ) : bound ? (
          <div className="bind-edit">
            <div className="bind-name">
              <Icon name="bind" size={14} />
              <input
                id={id}
                className="mono"
                list="bind-names"
                value={bindName}
                onChange={(e) => ed.apply((d) => rebindProp(d, target, def.key, e.target.value), tkey(target, def.key))}
              />
              <button className="link" title="Show in the binds panel" onClick={() => ctx.onShowBind(bindName)}>
                sample
              </button>
            </div>
            {nameProblem && <div className="finding error">{nameProblem}</div>}
            {details && (details.perRow || details.countsRowsOf.length) ? (
              <div className="sample-note">
                {details.countsRowsOf.length ? "the row count: " : `one value a row (${Array.isArray(doc.binds[bindName]) ? (doc.binds[bindName] as JsonValue[]).length : 0} set): `}
                <JsonField value={doc.binds[bindName]} onChange={(x) => ed.apply((d) => setSample(d, bindName, x), `sample:${bindName}`)} />
              </div>
            ) : (
              <div className="sample">
                <span className="muted">sample</span>
                <Field def={{ ...def, optional: false }} value={doc.binds[bindName]} fonts={ctx.fonts} onChange={(x) => ed.apply((d) => setSample(d, bindName, x), `sample:${bindName}`)} />
              </div>
            )}
          </div>
        ) : (
          <Field id={id} def={def} value={v} fonts={ctx.fonts} onChange={set} />
        )}
      </div>
      <div className="prop-actions">
        {def.bindable && !absent && (
          <button
            className={`icon-btn${bound ? " on" : ""}`}
            title={bound ? "Make it a static value (the bind's sample)" : "Bind it: the script sets the value with NuiSetBind"}
            aria-label={bound ? `Unbind ${def.label}` : `Bind ${def.label}`}
            onClick={() =>
              ed.apply((d) => (bound ? unbindProp(d, target, def.key, def.initial ?? sampleValue(def.kind)) : bindProp(d, target, def.key, freshName(d, target, def))))
            }
          >
            <Icon name={bound ? "unlink" : "link"} size={14} />
          </button>
        )}
        {def.optional && !absent && (
          <button className="icon-btn" title="Remove (the client's default)" aria-label={`Clear ${def.label}`} onClick={() => set(undefined)}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {mine.length > 0 && (
        <div className="prop-findings">
          {mine.map((f, i) => (
            <div key={i} className={`finding ${f.severity}`}>
              {f.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A bind name for a property: the element's id and the key ("choose_label"), "text" for a label's or text's value,
 * else the key; with a number when it is taken. */
function freshName(d: EditorDoc, t: Target, def: PropDef): string {
  const e = t.path ? getElem(d.window, t.path) : null;
  const key = e && def.key === "value" && (typeOf(e) === "label" || typeOf(e) === "text") ? "text" : def.key;
  const base = e && typeof e.id === "string" && e.id ? `${e.id}_${key}` : key;
  const used = new Set([...bindDetails(d.window).keys(), ...Object.keys(d.binds)]);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function Section({ title, children, open = true, extra }: { title: string; children: React.ReactNode; open?: boolean; extra?: React.ReactNode }) {
  const [o, setO] = useState(open);
  return (
    <section className={`psection${o ? "" : " closed"}`}>
      <header {...pressable(() => setO(!o), { expanded: o })}>
        <Icon name={o ? "chevronDown" : "chevron"} size={12} />
        <span>{title}</span>
        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only keeps a click on the extra control from folding the section */}
        {extra && <span className="psection-extra" onClick={(e) => e.stopPropagation()}>{extra}</span>}
      </header>
      {o && <div className="psection-body">{children}</div>}
    </section>
  );
}

function DrawList({ path, elem, ctx }: { path: ElemPath; elem: JsonObject; ctx: Ctx }) {
  const items = Array.isArray(elem.draw_list) ? elem.draw_list : [];
  const [open, setOpen] = useState<number | null>(items.length ? 0 : null);
  const { ed } = ctx;
  return (
    <Section
      title={`Draw list${items.length ? ` (${items.length})` : ""}`}
      open={items.length > 0}
      extra={
        <select
          className="small"
          value=""
          aria-label="Add a draw-list item"
          onChange={(e) => {
            const t = Number(e.target.value);
            ed.apply((d) => addDrawItem(d, path, t));
            setOpen(items.length);
          }}
        >
          <option value="">+ Add item…</option>
          {DRAW_TYPE.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      }
    >
      {items.length > 0 && <PropRow def={DRAW_LIST_SCISSOR} target={{ path }} ctx={ctx} />}
      {!items.length && <p className="muted small">Shapes, text and images painted on the element, before (under) or after (over) it. Any element can have one.</p>}
      {items.map((it, i) => {
        if (!isObject(it)) return null;
        const t = typeof it.type === "number" ? it.type : -1;
        const props = DRAW_ITEM_PROPS[t] ?? [];
        const target: Target = { path, item: i };
        return (
          <div key={i} className={`dl-item${open === i ? " open" : ""}`}>
            <div className="dl-head" {...pressable(() => setOpen(open === i ? null : i), { expanded: open === i })}>
              <Icon name={open === i ? "chevronDown" : "chevron"} size={12} />
              <span className="dl-num">{i + 1}</span>
              <select value={t} onClick={(e) => e.stopPropagation()} onChange={(e) => ed.apply((d) => retypeDrawItem(d, path, i, Number(e.target.value)))} aria-label="Item type">
                {DRAW_TYPE.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="dl-desc">{drawDesc(it)}</span>
              {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only keeps a click on these buttons from folding the item */}
              <span className="dl-btns" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" title="Up (drawn earlier)" disabled={i === 0} onClick={() => ed.apply((d) => moveDrawItem(d, path, i, -1))}>
                  <Icon name="up" size={12} />
                </button>
                <button className="icon-btn" title="Down (drawn later)" disabled={i === items.length - 1} onClick={() => ed.apply((d) => moveDrawItem(d, path, i, 1))}>
                  <Icon name="down" size={12} />
                </button>
                <button className="icon-btn" title="Remove" onClick={() => ed.apply((d) => removeDrawItem(d, path, i))}>
                  <Icon name="trash" size={12} />
                </button>
              </span>
            </div>
            {open === i && (
              <div className="dl-body">
                {props.map((p) => (
                  <PropRow key={p.key} def={p} target={target} ctx={ctx} />
                ))}
                {DRAW_ITEM_COMMON.map((p) => (
                  <PropRow key={p.key} def={p} target={target} ctx={ctx} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

function drawDesc(it: JsonObject): string {
  const s = (v: JsonValue | undefined) => (isBind(v) ? `{${String(v.bind)}}` : typeof v === "string" ? `"${v.length > 18 ? v.slice(0, 17) + "…" : v}"` : "");
  const parts: string[] = [];
  if (it.type === 4) parts.push(s(it.text));
  if (it.type === 5) parts.push(s(it.image));
  if (it.order === -1) parts.push("before");
  if (it.render && it.render !== 0) parts.push("on " + (["", "mouse off", "hover", "left", "right", "middle"][Number(it.render)] ?? "?"));
  if (it.arrayBinds === true) parts.push("per entry");
  return parts.filter(Boolean).join(" · ");
}

function Chart({ path, elem, ctx }: { path: ElemPath; elem: JsonObject; ctx: Ctx }) {
  const slots = Array.isArray(elem.value) ? elem.value : [];
  const { ed } = ctx;
  return (
    <Section title={`Series (${slots.length})`}>
      {slots.map((s, i) => {
        if (!isObject(s)) return null;
        const target: Target = { path, slot: i };
        return (
          <div key={i} className="dl-item open">
            <div className="dl-head">
              <span className="dl-num">{i + 1}</span>
              <select value={typeof s.type === "number" ? s.type : 0} onChange={(e) => ed.apply((d) => setValue(d, target, "type", Number(e.target.value)))} aria-label="Series type">
                {CHART_TYPE.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="dl-btns">
                <button className="icon-btn" title="Remove" onClick={() => ed.apply((d) => ({ ...d, window: updateElem(d.window, path, (e) => ({ ...e, value: slots.filter((_, k) => k !== i) })) }))}>
                  <Icon name="trash" size={12} />
                </button>
              </span>
            </div>
            <div className="dl-body">
              <PropRow def={{ key: "legend", label: "Legend", kind: "string", bindable: true, group: "Content" }} target={target} ctx={ctx} />
              <PropRow def={{ key: "color", label: "Colour", kind: "color", bindable: true, group: "Content" }} target={target} ctx={ctx} />
              <PropRow def={{ key: "data", label: "Data", kind: "floats", bindable: true, group: "Content", float: true }} target={target} ctx={ctx} />
            </div>
          </div>
        );
      })}
      <button className="small" onClick={() => ed.apply((d) => ({ ...d, window: updateElem(d.window, path, (e) => ({ ...e, value: [...slots, N.NuiChartSlot(N.NUI_CHART_TYPE_COLUMN, `Series ${slots.length + 1}`, N.NuiColor(150, 210, 150), [2, 1, 3])] })) }))}>
        <Icon name="plus" size={12} /> Series
      </button>
    </Section>
  );
}

function RawJson({ path, elem, ctx }: { path: ElemPath; elem: JsonObject; ctx: Ctx }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? writeElement(elem, "  ");
  let error: string | null = null;
  if (text !== null) {
    try {
      const v = JSON.parse(text) as unknown;
      if (!isObject(v) || typeof v.type !== "string") error = 'an element: an object with a "type"';
    } catch (e) {
      error = errorText(e);
    }
  }
  return (
    <Section title="JSON" open={false}>
      <textarea className={`mono raw${error ? " bad" : ""}`} rows={Math.min(18, shown.split("\n").length)} value={shown} spellCheck={false} onChange={(e) => setText(e.target.value)} />
      {error && <div className="finding error">{error}</div>}
      <div className="row-btns">
        <button className="small" disabled={text === null || !!error} onClick={() => {
          ctx.ed.apply((d) => ({ ...d, window: updateElem(d.window, path, () => JSON.parse(text!) as JsonObject) }));
          setText(null);
        }}>
          Apply
        </button>
        {text !== null && <button className="small" onClick={() => setText(null)}>Revert</button>}
      </div>
    </Section>
  );
}

export function Properties({ doc, ed, fonts, findings, onShowBind, measure = null }: { doc: EditorDoc; ed: Editor; fonts: string[]; findings: Finding[]; onShowBind(name: string): void; measure?: Measure | null }) {
  if (ed.sels.length > 1) return <MultiProperties doc={doc} ed={ed} fonts={fonts} measure={measure} />;
  return <SingleProperties doc={doc} ed={ed} fonts={fonts} findings={findings} onShowBind={onShowBind} />;
}

function SingleProperties({ doc, ed, fonts, findings, onShowBind }: { doc: EditorDoc; ed: Editor; fonts: string[]; findings: Finding[]; onShowBind(name: string): void }) {
  const binds = useMemo(() => bindDetails(doc.window, doc.panes), [doc.window, doc.panes]);
  const ctx: Ctx = { doc, ed, fonts, binds, findings, onShowBind };
  const sel = ed.sel;
  const datalist = (
    <datalist id="bind-names">
      {[...new Set([...binds.keys(), ...Object.keys(doc.binds)])].sort().map((b) => (
        <option key={b} value={b} />
      ))}
    </datalist>
  );
  if (sel === null) {
    return (
      <div className="props" data-testid="properties">
        {datalist}
        <div className="props-head">
          <Icon name="window" size={20} />
          <div>
            <div className="props-title">Window</div>
            <div className="muted small">NuiWindow · its root is a {String((doc.window.root as JsonObject | undefined)?.type ?? "?")}</div>
          </div>
        </div>
        <Section title="Window">
          {WINDOW_PROPS.map((p) => (
            <PropRow key={p.key} def={p} target={{ path: null }} ctx={ctx} />
          ))}
        </Section>
        <WindowFindings findings={findings.filter((f) => f.path === null && !f.key)} />
      </div>
    );
  }
  const elem = getElem(doc.window, sel);
  if (!elem) return <div className="props muted">Nothing selected.</div>;
  const t = typeOf(elem);
  const spec = specOf(t);
  const parent = sel.length ? getElem(doc.window, sel.slice(0, -1)) : null;
  const cell = parent && typeOf(parent) === "list" ? cellOf(parent, sel[sel.length - 1]!) : null;
  const props = spec?.props ?? [];
  const groups: PropDef["group"][] = ["Element", "Content", "Layout", "State", "Style"];
  const own = findings.filter((f) => f.path && f.path.join("/") === sel.join("/") && !f.key);
  return (
    <div className="props" data-testid="properties">
      {datalist}
      <div className="props-head">
        <Icon name={typeIcon(t)} size={20} />
        <div>
          <div className="props-title">{spec?.title ?? t}</div>
          <div className="crumbs">
            <button className="link" onClick={() => ed.setSel(null)}>Window</button>
            {sel.map((_, i) => {
              const p = sel.slice(0, i);
              const e = getElem(doc.window, p);
              return (
                <span key={i}>
                  {" › "}
                  <button className="link" onClick={() => ed.setSel(p)}>
                    {specOf(typeOf(e))?.title ?? typeOf(e)}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
        <code className="builder">{spec?.builder ?? "NuiElement"}</code>
      </div>
      {own.map((f, i) => (
        <div key={i} className={`finding ${f.severity} block`}>
          {f.text}
        </div>
      ))}
      {!spec && <p className="finding error block">The client does not know "{t}" elements. Its JSON is below.</p>}
      {cell && (
        <Section title="List cell">
          <div className="prop">
            <label className="prop-label" htmlFor="cell-width" title="NuiListTemplateCell's fWidth: 0 is automatic">Cell width</label>
            <div className="prop-value">
              <Field id="cell-width" def={{ key: "w", label: "Cell width", kind: "float", bindable: false, group: "Layout", min: 0 }} value={cell.width} fonts={fonts} onChange={(v) => ed.apply((d) => ({ ...d, window: setCell(d.window, sel, { width: typeof v === "number" ? v : 0 }) }), `cell:${sel.join("/")}`)} />
            </div>
          </div>
          <div className="prop">
            <label className="prop-label" htmlFor="cell-grows" title="NuiListTemplateCell's bVariable: the cell can grow">Grows</label>
            <div className="prop-value">
              <Field id="cell-grows" def={{ key: "v", label: "Grows", kind: "bool", bindable: false, group: "Layout" }} value={cell.variable} fonts={fonts} onChange={(v) => ed.apply((d) => ({ ...d, window: setCell(d.window, sel, { variable: v === true }) }))} />
            </div>
          </div>
        </Section>
      )}
      {groups.map((g) => {
        const ps = props.filter((p) => p.group === g && !(t === "chart" && p.key === "value"));
        if (!ps.length) return null;
        return (
          <Section key={g} title={g === "Element" ? "Element" : g} open={g !== "State" || ps.some((p) => elem[p.key] !== undefined)}>
            {ps.map((p) => (
              <PropRow key={p.key} def={p} target={{ path: sel }} ctx={ctx} />
            ))}
          </Section>
        );
      })}
      {t === "chart" && <Chart path={sel} elem={elem} ctx={ctx} />}
      <DrawList path={sel} elem={elem} ctx={ctx} />
      <RawJson key={sel.join("/")} path={sel} elem={elem} ctx={ctx} />
    </div>
  );
}

function WindowFindings({ findings }: { findings: Finding[] }) {
  if (!findings.length) return null;
  return (
    <Section title="Window problems">
      {findings.map((f, i) => (
        <div key={i} className={`finding ${f.severity} block`}>
          {f.text}
        </div>
      ))}
    </Section>
  );
}
