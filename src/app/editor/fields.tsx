/** Editors for one value of each property kind (static values; binds are handled by the property row). */
import { useEffect, useState } from "react";
import type { PropDef } from "../../core/edit/catalog.js";
import { type JsonObject, type JsonValue, isObject } from "../../core/model/types.js";
import { Icon } from "./icons.js";

export interface FieldProps {
  def: PropDef;
  value: JsonValue | undefined;
  onChange(v: JsonValue | undefined): void;
  fonts: string[];
  id?: string;
}

function NumberInput({ value, onChange, step, min, max, placeholder, id, label }: { value: number | undefined; onChange(v: number | undefined): void; step?: number; min?: number; max?: number; placeholder?: string; id?: string; label?: string }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    if (Number(text) !== value || (value === undefined && text !== "")) setText(value === undefined ? "" : String(value));
    // Only follow outside changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      aria-label={label}
      className="num"
      type="number"
      value={text}
      step={step ?? "any"}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim() === "") onChange(undefined);
        else if (Number.isFinite(Number(e.target.value))) onChange(Number(e.target.value));
      }}
    />
  );
}

function hex(c: JsonObject): string {
  const h = (k: string) => Math.max(0, Math.min(255, Math.round(Number(c[k] ?? 0)))).toString(16).padStart(2, "0");
  return `#${h("r")}${h("g")}${h("b")}`;
}

export function ColorField({ value, onChange, id }: { value: JsonValue | undefined; onChange(v: JsonValue): void; id?: string }) {
  const c = isObject(value) ? value : { r: 255, g: 255, b: 255, a: 255 };
  const a = typeof c.a === "number" ? c.a : 255;
  return (
    <div className="color-field">
      <label className="swatch" style={{ background: `rgba(${c.r},${c.g},${c.b},${a / 255})` }}>
        <input id={id} type="color" value={hex(c)} onChange={(e) => {
          const v = e.target.value;
          onChange({ r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16), a });
        }} />
      </label>
      {(["r", "g", "b", "a"] as const).map((k) => (
        <NumberInput key={k} label={k} value={typeof c[k] === "number" ? (c[k] as number) : k === "a" ? 255 : 0} min={0} max={255} step={1} placeholder={k} onChange={(v) => onChange({ ...c, a, [k]: v ?? 0 })} />
      ))}
    </div>
  );
}

function XYField({ value, onChange, keys, id }: { value: JsonValue | undefined; onChange(v: JsonValue): void; keys: string[]; id?: string }) {
  const o = isObject(value) ? value : Object.fromEntries(keys.map((k) => [k, 0]));
  return (
    <div className={`xy-field n${keys.length}`}>
      {keys.map((k, i) => (
        <label key={k} className="xy">
          <span>{k}</span>
          <NumberInput id={i === 0 ? id : undefined} label={k} value={typeof o[k] === "number" ? (o[k] as number) : 0} onChange={(v) => onChange({ ...o, [k]: v ?? 0 })} />
        </label>
      ))}
    </div>
  );
}

function ListText({ value, onChange, parse, show, rows = 3, placeholder, id }: { value: JsonValue | undefined; onChange(v: JsonValue): void; parse(t: string): JsonValue | null; show(v: JsonValue | undefined): string; rows?: number; placeholder?: string; id?: string }) {
  const [text, setText] = useState(show(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!bad) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <textarea
      id={id}
      className={bad ? "bad" : ""}
      rows={rows}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        const v = parse(e.target.value);
        setBad(v === null);
        if (v !== null) onChange(v);
      }}
    />
  );
}

export function JsonField({ value, onChange, rows = 2, id }: { value: JsonValue | undefined; onChange(v: JsonValue | undefined): void; rows?: number; id?: string }) {
  return (
    <ListText
      id={id}
      value={value}
      rows={rows}
      placeholder="unset (a JSON value)"
      show={(v) => (v === undefined ? "" : JSON.stringify(v))}
      parse={(t) => {
        if (!t.trim()) {
          onChange(undefined);
          return null;
        }
        try {
          return JSON.parse(t) as JsonValue;
        } catch {
          return null;
        }
      }}
      onChange={onChange}
    />
  );
}

function ComboField({ value, onChange }: { value: JsonValue | undefined; onChange(v: JsonValue): void }) {
  const entries = Array.isArray(value) ? value.map((x) => (Array.isArray(x) ? [String(x[0] ?? ""), Number(x[1] ?? 0)] : ["", 0])) : [];
  const set = (i: number, j: 0 | 1, v: string | number) => onChange(entries.map((e, k) => (k === i ? (j ? [e[0]!, v] : [v, e[1]!]) : e)) as JsonValue);
  return (
    <div className="combo-field">
      {entries.map((e, i) => (
        <div key={i} className="combo-row">
          <input value={e[0] as string} placeholder="label" onChange={(ev) => set(i, 0, ev.target.value)} />
          <NumberInput value={e[1] as number} step={1} label="value" onChange={(v) => set(i, 1, v ?? 0)} />
          <button className="icon-btn" title="Remove" onClick={() => onChange(entries.filter((_, k) => k !== i) as JsonValue)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <button className="small" onClick={() => onChange([...entries, [`Entry ${entries.length + 1}`, entries.length]] as JsonValue)}>
        <Icon name="plus" size={12} /> Entry
      </button>
    </div>
  );
}

/** The editor of a static value of def's kind. */
export function Field({ def, value, onChange, fonts, id }: FieldProps) {
  switch (def.kind) {
    case "float":
    case "int":
      return <NumberInput id={id} label={def.label} value={typeof value === "number" ? value : undefined} step={def.step ?? (def.kind === "int" ? 1 : undefined)} min={def.min} max={def.max} placeholder={def.optional ? "unset" : ""} onChange={(v) => onChange(v === undefined ? (def.optional ? undefined : 0) : def.kind === "int" ? Math.round(v) : v)} />;
    case "bool":
      if (def.nullable) {
        const cur = value === null || value === undefined ? "null" : value ? "true" : "false";
        return (
          <div className="seg" id={id}>
            {(["true", "false", "null"] as const).map((k) => (
              <button key={k} className={cur === k ? "on" : ""} onClick={() => onChange(k === "null" ? null : k === "true")}>
                {k === "null" ? def.nullable : k === "true" ? "Yes" : "No"}
              </button>
            ))}
          </div>
        );
      }
      return (
        <label className="switch">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span />
        </label>
      );
    case "enum":
      if (def.options!.length <= 3)
        return (
          <div className="seg" id={id}>
            {def.options!.map((o) => (
              <button key={o.value} className={value === o.value ? "on" : ""} title={o.constant} onClick={() => onChange(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        );
      return (
        <select id={id} value={typeof value === "number" ? String(value) : ""} onChange={(e) => onChange(Number(e.target.value))}>
          {typeof value !== "number" && <option value="">(unset)</option>}
          {def.options!.map((o) => (
            <option key={o.value} value={o.value} title={o.constant}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "title":
      return (
        <div className="title-field">
          <input id={id} value={typeof value === "string" ? value : ""} disabled={value === false} placeholder={value === false ? "(no title bar)" : ""} onChange={(e) => onChange(e.target.value)} />
          <label className="inline">
            <input type="checkbox" checked={value === false} onChange={(e) => onChange(e.target.checked ? false : "")} /> none
          </label>
        </div>
      );
    case "string":
    case "text":
      if (isObject(value) && "strref" in value) {
        return (
          <div className="title-field">
            <span className="muted">StrRef</span>
            <NumberInput id={id} value={Number(value.strref)} step={1} onChange={(v) => onChange({ strref: v ?? 0 })} />
            <button className="small" onClick={() => onChange("")}>Text</button>
          </div>
        );
      }
      return def.kind === "text" ? (
        <textarea id={id} rows={Math.min(6, Math.max(1, Math.ceil(String(value ?? "").length / 34)))} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "resref":
      return <input id={id} className="mono" maxLength={16} value={typeof value === "string" ? value : ""} placeholder="resref" onChange={(e) => onChange(e.target.value.toLowerCase())} />;
    case "id":
      return <input id={id} className="mono" value={typeof value === "string" ? value : ""} placeholder="no id: sends no events" onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />;
    case "font": {
      const cur = typeof value === "string" ? value : "";
      return (
        <select id={id} value={cur} onChange={(e) => onChange(e.target.value)}>
          <option value="">(the default font)</option>
          {fonts.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          {cur && !fonts.includes(cur) && <option value={cur}>{cur} (not in the skin)</option>}
        </select>
      );
    }
    case "color":
      return <ColorField id={id} value={value} onChange={onChange} />;
    case "rect":
      if (value === null && def.nullable) return <button className="small" onClick={() => onChange({ x: 0, y: 0, w: 0, h: 0 })}>Set</button>;
      return <XYField id={id} value={value} onChange={onChange} keys={["x", "y", "w", "h"]} />;
    case "vec":
      return <XYField id={id} value={value} onChange={onChange} keys={["x", "y"]} />;
    case "strings":
      return <ListText id={id} value={value} onChange={onChange} placeholder="one label a line" show={(v) => (Array.isArray(v) ? v.map(String).join("\n") : "")} parse={(t) => t.split("\n")} rows={3} />;
    case "floats":
      return (
        <ListText
          id={id}
          value={value}
          onChange={onChange}
          rows={2}
          placeholder="numbers, separated by commas"
          show={(v) => (Array.isArray(v) ? v.join(", ") : "")}
          parse={(t) => {
            const parts = t.split(/[,\s]+/).filter(Boolean).map(Number);
            return parts.every(Number.isFinite) ? parts : null;
          }}
        />
      );
    case "combo":
      return <ComboField value={value} onChange={onChange} />;
    default:
      return <JsonField id={id} value={value} onChange={onChange} />;
  }
}
