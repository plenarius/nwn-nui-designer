/** The problems list: the layout's (from drawing), the client's rules, and the house style's when it is on. */
import { Fragment, useState } from "react";
import { groupIssues } from "../../core/edit/issues.js";
import type { ElemPath } from "../../core/edit/tree.js";
import type { WindowIssue } from "../../core/edit/lint.js";
import type { Severity } from "../../core/edit/validate.js";
import { Icon } from "./icons.js";
import { pressable } from "./a11y.js";

export { layoutSeverity } from "../../core/edit/issues.js";

/** A row of the list (core/edit/lint.ts makes them, for the command line too). */
export type Issue = WindowIssue;

export function ProblemsPanel({ issues, onSelect, open, setOpen }: { issues: Issue[]; onSelect(p: ElemPath | null): void; open: boolean; setOpen(o: boolean): void }) {
  const [filter, setFilter] = useState<Severity | "all">("all");
  const count = (s: Severity) => issues.filter((i) => i.severity === s).length;
  const shown = issues.filter((i) => filter === "all" || i.severity === filter);
  // Identical notes (one rule saying the same thing of many elements) share one row that opens to the elements.
  const groups = groupIssues(shown);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const toggle = (k: string) => setOpenGroups((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  const row = (i: Issue, key: string, cls = "") => (
    <li key={key} className={`${i.severity}${cls}`} data-count={1} {...pressable(() => onSelect(i.path))}>
      <Icon name={i.severity === "info" ? "info" : i.severity} size={14} />
      <span className="p-kind">{i.kind}</span>
      <span className="p-where">{i.where}</span>
      <span className="p-text">{i.text}</span>
      <span className={`p-src ${i.source.startsWith("style") ? "style" : i.source}`}>{i.source.startsWith("style:") ? "style" : i.source}</span>
    </li>
  );
  return (
    <div className={`problems${open ? " open" : ""}`} data-testid="problems">
      <div className="problems-head" {...pressable(() => setOpen(!open), { expanded: open })}>
        <Icon name={open ? "chevronDown" : "chevron"} size={12} />
        <span className="problems-title">Problems</span>
        <span className={`count error${count("error") ? "" : " zero"}`}><Icon name="error" size={12} /> {count("error")}</span>
        <span className={`count warning${count("warning") ? "" : " zero"}`}><Icon name="warning" size={12} /> {count("warning")}</span>
        <span className={`count info${count("info") ? "" : " zero"}`}><Icon name="info" size={12} /> {count("info")}</span>
        {open && (
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only stops a click on a filter from also folding the panel
          <span className="filters" onClick={(e) => e.stopPropagation()}>
            {(["all", "error", "warning", "info"] as const).map((f) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "error" ? "Errors" : f === "warning" ? "Warnings" : "Notes"}
              </button>
            ))}
          </span>
        )}
      </div>
      {open && (
        <ol className="problems-list">
          {!shown.length && <li className="none">{issues.length ? "None of these." : "No problems found."}</li>}
          {groups.map((g) => {
            const first = g.items[0]!;
            if (g.items.length === 1) return row(first, g.key);
            const isOpen = openGroups.has(g.key);
            return (
              <Fragment key={g.key}>
                <li className={`${first.severity} group`} data-count={g.items.length} {...pressable(() => toggle(g.key), { expanded: isOpen })}>
                  <Icon name={isOpen ? "chevronDown" : "chevron"} size={14} />
                  <span className="p-kind">{first.kind}</span>
                  <span className="p-where">{g.items.length} places</span>
                  <span className="p-text">{first.text} …</span>
                  <span className={`p-src ${first.source.startsWith("style") ? "style" : first.source}`}>{first.source.startsWith("style:") ? "style" : first.source}</span>
                </li>
                {isOpen && g.items.map((i, k) => row(i, `${g.key}/${k}`, " member"))}
              </Fragment>
            );
          })}
        </ol>
      )}
    </div>
  );
}
