/**
 * The properties panel with several elements selected: the arrange tools (match size, align, distribute), then the
 * properties the selected elements have in common. A value they do not all share shows as mixed; editing a property
 * sets it on all of them. Every tool and edit is one undo step; a tool that cannot run says why (its tooltip, or a
 * toast when it was tried).
 */
import { useMemo, useState } from "react";
import { type AlignEdge, type ArrangeResult, type DistributeMode, type MatchTo, type Measure, type SizeAxis, align, alignRefusal, distribute, distributeRefusal, matchRefusal, matchSize } from "../../core/edit/arrange.js";
import { type PropDef, specOf } from "../../core/edit/catalog.js";
import { setValueMany } from "../../core/edit/multi.js";
import type { EditorDoc } from "../../core/edit/project.js";
import { type Selection, nameOf } from "../../core/edit/selection.js";
import { getElem, typeOf } from "../../core/edit/tree.js";
import { sampleValue } from "../../core/edit/binds.js";
import { type JsonObject, type JsonValue, isObject } from "../../core/model/types.js";
import { Field } from "./fields.js";
import { Icon, typeIcon } from "./icons.js";
import type { Editor } from "./useEditor.js";

/** One arrange tool: its button, shortcut and the edit it makes. */
export interface ArrangeTool {
  id: string;
  label: string;
  icon: string;
  /** The shortcut, as shown (the key handler in App.tsx matches `code` with Alt, and Shift when `shift`). */
  keys?: string;
  code?: string;
  shift?: boolean;
  refusal(win: JsonObject, s: Selection): string | null;
  run(doc: EditorDoc, s: Selection, measure: Measure, to: MatchTo): ArrangeResult;
}

const alignTool = (id: AlignEdge, label: string, icon: string, letter: string): ArrangeTool => ({
  id: `align-${id}`,
  label,
  icon,
  keys: `Alt+${letter}`,
  code: `Key${letter}`,
  refusal: (w, s) => alignRefusal(w, s, id),
  run: (d, s, m) => align(d, s, m, id),
});

const matchTool = (axes: SizeAxis[], label: string, icon: string): ArrangeTool => ({
  id: `match-${axes.join("")}`,
  label,
  icon,
  refusal: (w, s) => matchRefusal(w, s),
  run: (d, s, m, to) => matchSize(d, s, m, axes, to),
});

const distTool = (mode: DistributeMode, axis: "h" | "v", label: string, icon: string, letter?: string): ArrangeTool => ({
  id: `dist-${mode}-${axis}`,
  label,
  icon,
  keys: letter ? `Alt+Shift+${letter}` : undefined,
  code: letter ? `Key${letter}` : undefined,
  shift: !!letter,
  refusal: (w, s) => {
    const why = distributeRefusal(w, s, mode);
    if (why) return why;
    const parent = typeOf(getElem(w, s[0]!.slice(0, -1)));
    const other = mode === "gaps" ? (axis === "h" ? "Equal gaps in a column" : "Equal gaps in a row") : axis === "h" ? "Equal heights in a column" : "Equal widths in a row";
    if (axis === "h" && parent !== "row") return `These are in a column, not a row. Use ${other} instead.`;
    if (axis === "v" && parent !== "col") return `These are in a row, not a column. Use ${other} instead.`;
    return null;
  },
  run: (d, s, m) => distribute(d, s, m, mode),
});

export const MATCH_TOOLS: ArrangeTool[] = [
  matchTool(["w"], "Same width", "matchW"),
  matchTool(["h"], "Same height", "matchH"),
  matchTool(["w", "h"], "Same width and height", "matchBoth"),
];

export const ALIGN_TOOLS: ArrangeTool[] = [
  alignTool("left", "Align left edges (across rows)", "alignLeft", "A"),
  alignTool("hcenter", "Align horizontal centres (across rows)", "alignHCenter", "H"),
  alignTool("right", "Align right edges (across rows)", "alignRight", "D"),
  alignTool("top", "Align top edges (across columns)", "alignTop", "W"),
  alignTool("vcenter", "Align vertical middles (across columns)", "alignVCenter", "V"),
  alignTool("bottom", "Align bottom edges (across columns)", "alignBottom", "S"),
];

export const DISTRIBUTE_TOOLS: ArrangeTool[] = [
  distTool("gaps", "h", "Equal gaps in a row (spacers between them sized evenly)", "gapsH", "H"),
  distTool("gaps", "v", "Equal gaps in a column (spacers between them sized evenly)", "gapsV", "V"),
  distTool("sizes", "h", "Equal widths in a row (each the average; together the room they took)", "sizesH"),
  distTool("sizes", "v", "Equal heights in a column (each the average; together the room they took)", "sizesV"),
];

export const ARRANGE_TOOLS = [...MATCH_TOOLS, ...ALIGN_TOOLS, ...DISTRIBUTE_TOOLS];

/** The tool an Alt (+ Shift) key press runs, if any. */
export function toolForKey(e: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; code: string }): ArrangeTool | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  return ARRANGE_TOOLS.find((t) => t.code === e.code && !!t.shift === e.shiftKey) ?? null;
}

/** Runs a tool as one undo step: its refusal (or the solver's) becomes a toast. */
export function runTool(ed: Editor, tool: ArrangeTool, measure: Measure | null, to: MatchTo = "largest"): void {
  const doc = ed.doc;
  if (!doc) return;
  if (!measure) return ed.toast("The skin is still loading. Try again in a moment.", "info");
  const why = tool.refusal(doc.window, ed.sels);
  if (why) return ed.toast(why, "error");
  ed.apply((d) => tool.run(d, ed.sels, measure, to));
}

const same = (a: JsonValue | undefined, b: JsonValue | undefined) => JSON.stringify(a) === JSON.stringify(b);
const isBind = (v: JsonValue | undefined) => isObject(v) && typeof v.bind === "string";

/** The properties every selected element has (by key; ids are left out, they must stay unique). */
function sharedProps(elems: JsonObject[]): PropDef[] {
  const lists = elems.map((e) => specOf(typeOf(e))?.props ?? []);
  if (!lists.length) return [];
  return lists[0]!.filter((p) => p.key !== "id" && lists.every((l) => l.some((q) => q.key === p.key && q.kind === p.kind)));
}

function ToolButton({ tool, win, sels, onRun }: { tool: ArrangeTool; win: JsonObject; sels: Selection; onRun(t: ArrangeTool): void }) {
  const why = tool.refusal(win, sels);
  const title = `${tool.label}${tool.keys ? ` (${tool.keys})` : ""}${why ? `\n${why}` : ""}`;
  return (
    // Not disabled outright: a click on one that cannot run says why (a toast), as its tooltip does.
    <button className={`icon-btn arrange-btn${why ? " off" : ""}`} title={title} aria-label={tool.label} aria-disabled={!!why} data-tool={tool.id} onClick={() => onRun(tool)}>
      <Icon name={tool.icon} size={16} />
    </button>
  );
}

export function MultiProperties({ doc, ed, fonts, measure }: { doc: EditorDoc; ed: Editor; fonts: string[]; measure: Measure | null }) {
  const sels = ed.sels;
  const [to, setTo] = useState<MatchTo>("largest");
  const elems = useMemo(() => sels.map((p) => getElem(doc.window, p)).filter((e): e is JsonObject => !!e), [sels, doc.window]);
  const props = useMemo(() => sharedProps(elems), [elems]);
  const types = [...new Set(elems.map((e) => typeOf(e)))];
  const run = (t: ArrangeTool) => runTool(ed, t, measure, to);
  const groups: PropDef["group"][] = ["Content", "Layout", "State", "Style"];
  return (
    <div className="props" data-testid="properties">
      <div className="props-head">
        <Icon name={types.length === 1 ? typeIcon(types[0]!) : "group"} size={20} />
        <div>
          <div className="props-title">{sels.length} elements</div>
          <div className="muted small">
            {types.map((t) => specOf(t)?.title ?? t).join(", ")} · key: <span className="key-name">{nameOf(doc.window, sels[0]!)}</span>
          </div>
        </div>
      </div>
      <section className="psection arrange" data-testid="arrange">
        <header>
          <span>Arrange</span>
        </header>
        <div className="psection-body">
          <p className="muted small arrange-note">NUI has no free positions: these set widths, heights and spacers, and every result is laid out again as the client does. What cannot be done is refused with the reason.</p>
          <div className="arrange-row">
            <span className="arrange-label">Match size</span>
            <span className="arrange-btns">
              {MATCH_TOOLS.map((t) => <ToolButton key={t.id} tool={t} win={doc.window} sels={sels} onRun={run} />)}
            </span>
            <span className="seg small" role="group" aria-label="Match to">
              <button className={to === "largest" ? "on" : ""} title="Match the largest of them" onClick={() => setTo("largest")}>largest</button>
              <button className={to === "key" ? "on" : ""} title="Match the key element (the first selected)" onClick={() => setTo("key")}>key</button>
            </span>
          </div>
          <div className="arrange-row">
            <span className="arrange-label">Align to key</span>
            <span className="arrange-btns">
              {ALIGN_TOOLS.map((t) => <ToolButton key={t.id} tool={t} win={doc.window} sels={sels} onRun={run} />)}
            </span>
          </div>
          <div className="arrange-row">
            <span className="arrange-label">Distribute</span>
            <span className="arrange-btns">
              {DISTRIBUTE_TOOLS.map((t) => <ToolButton key={t.id} tool={t} win={doc.window} sels={sels} onRun={run} />)}
            </span>
          </div>
        </div>
      </section>
      {groups.map((g) => {
        const ps = props.filter((p) => p.group === g);
        if (!ps.length) return null;
        return (
          <section key={g} className="psection">
            <header>
              <span>{g}</span>
              <span className="muted small">shared by all {sels.length}</span>
            </header>
            <div className="psection-body">
              {ps.map((p) => (
                <SharedRow key={p.key} def={p} elems={elems} fonts={fonts} onSet={(v) => ed.apply((d) => setValueMany(d, sels, p.key, v), `multi:${p.key}:${sels.map((x) => x.join("/")).join(",")}`)} />
              ))}
            </div>
          </section>
        );
      })}
      {!props.length && <p className="muted small">They have no properties in common.</p>}
    </div>
  );
}

function SharedRow({ def, elems, fonts, onSet }: { def: PropDef; elems: JsonObject[]; fonts: string[]; onSet(v: JsonValue | undefined): void }) {
  const values = elems.map((e) => e[def.key]);
  const mixed = values.some((v) => !same(v, values[0]));
  const v = mixed ? undefined : values[0];
  const absent = values.every((x) => x === undefined);
  const bound = values.some(isBind);
  const id = `pm-${def.key}`;
  return (
    <div className={`prop${absent ? " absent" : ""}${mixed ? " mixed" : ""}`} data-prop={def.key}>
      <label className="prop-label" htmlFor={id} title={def.help}>
        {def.label}
        {mixed && <span className="mixed-tag" title="Not the same on all of them: a value set here goes to all">mixed</span>}
      </label>
      <div className="prop-value">
        {absent && def.optional ? (
          <button className="ghost" onClick={() => onSet(def.initial ?? sampleValue(def.kind))}>
            <Icon name="plus" size={12} /> Set on all
          </button>
        ) : !mixed && bound ? (
          <span className="muted small mono">bound to {String((v as JsonObject).bind)}: change the bind on one element at a time</span>
        ) : (
          <Field id={id} def={{ ...def, optional: false }} value={v} fonts={fonts} onChange={onSet} />
        )}
        {mixed && bound && <div className="muted small">Some of them bind it: a value set here replaces their binds.</div>}
      </div>
      <div className="prop-actions">
        {def.optional && !absent && (
          <button className="icon-btn" title="Remove from all (the client's default)" aria-label={`Clear ${def.label} on all`} onClick={() => onSet(undefined)}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
