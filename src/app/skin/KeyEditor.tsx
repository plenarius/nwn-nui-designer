/**
 * The editor of one nui_skin.tml key, by its type: a 9-slice image (a texture, picked or uploaded, shown with the
 * key's fixed margins drawn over it and stretched to a few sizes), an image or a colour (a toggle), a colour (RGBA,
 * with alpha) or a whole number. Its findings are listed under it.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { RGBAImage } from "../../core/res/image.js";
import type { Resources } from "../../core/session.js";
import type { SkinFinding } from "../../core/skin/check.js";
import { type SkinKey, clientDefault } from "../../core/skin/keys.js";
import { type SkinProject, putFile, setValue, valueOf } from "../../core/skin/project.js";
import { artDepth, sliceForKey } from "../../core/skin/slice.js";
import { Icon } from "../editor/icons.js";
import { drawOn, resrefFrom, uploadAsTga } from "./images.js";
import { errorText } from "../../core/errors.js";

const HEX8 = /^#[0-9a-f]{8}$/i;

export function parseColour(v: unknown): [number, number, number, number] | null {
  if (typeof v !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) return null;
  const n = (i: number) => parseInt(v.slice(i, i + 2), 16);
  return [n(1), n(3), n(5), v.length === 9 ? n(7) : 255];
}

export const colourText = (c: readonly number[]) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0").toUpperCase()).join("")}`;

/** "#RRGGBBAA": a swatch with the browser's picker for RGB, and R, G, B, A as numbers. */
export function SkinColour({ value, onChange, label }: { value: string; onChange(v: string): void; label?: string }) {
  const c = parseColour(value) ?? [0, 0, 0, 0];
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="skin-colour">
      <label className="swatch checker" title="Pick a colour">
        <span style={{ background: `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})` }} />
        <input type="color" aria-label={label ? `${label} colour` : "colour"} value={colourText(c.slice(0, 3)).toLowerCase()} onChange={(e) => onChange(colourText([...(parseColour(e.target.value) ?? [0, 0, 0]).slice(0, 3), c[3]]))} />
      </label>
      <input
        className={`hex mono${HEX8.test(text) ? "" : " bad"}`}
        aria-label={label ? `${label} hex` : "hex"}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          if (HEX8.test(e.target.value)) onChange(e.target.value.toUpperCase());
        }}
      />
      {(["R", "G", "B", "A"] as const).map((k, i) => (
        <input
          key={k}
          className="num"
          type="number"
          min={0}
          max={255}
          step={1}
          title={k === "A" ? "Alpha: 0 is transparent, 255 opaque" : k}
          aria-label={`${label ?? "colour"} ${k}`}
          value={c[i]}
          onChange={(e) => {
            const n = [...c];
            n[i] = Math.max(0, Math.min(255, Number(e.target.value) || 0));
            onChange(colourText(n));
          }}
        />
      ))}
    </div>
  );
}

/** The texture field: a resref (with the names the skin and the project know), and Upload. */
function TextureField({ value, names, onChange, onUpload, label }: { value: string; names: string[]; onChange(v: string): void; onUpload(f: File, resref: string): void; label: string }) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const long = value.length > 16;
  return (
    <div className="texture-field">
      <input className={`mono${long ? " bad" : ""}`} list={id} value={value} aria-label={`${label} texture`} spellCheck={false} onChange={(e) => onChange(e.target.value.toLowerCase())} title={long ? "A resref has at most 16 characters" : "The texture's resref"} />
      <datalist id={id}>
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <button className="small" onClick={() => file.current?.click()} title="Upload a PNG, JPEG or TGA: it is converted to a 32-bit TGA under the name in the field">
        <Icon name="import" size={12} /> Upload
      </button>
      <input
        ref={file}
        type="file"
        hidden
        data-testid={`upload-${label}`}
        accept=".png,.jpg,.jpeg,.tga"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f, value && !value.startsWith("#") ? value : resrefFrom(f.name));
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** A 9-slice texture: the texture enlarged with the key's margins drawn over it, and the slice at a few sizes. */
function NinePreview({ sk, tex }: { sk: SkinKey; tex: RGBAImage }) {
  const zoomed = useRef<HTMLCanvasElement>(null);
  const samples = useRef<(HTMLCanvasElement | null)[]>([]);
  const m = sk.margins!;
  const depth = useMemo(() => artDepth(tex), [tex]);
  const s = Math.max(1, Math.min(8, Math.floor(240 / Math.max(tex.width, tex.height))));
  const sizes: [number, number][] = [
    [Math.max(24, Math.round(tex.width * 0.4)), Math.max(16, Math.round(tex.height * 0.7))],
    [tex.width * 2, Math.round(tex.height * 1.25)],
    [Math.round(tex.width * 1.2), tex.height * 3],
  ];
  useEffect(() => {
    drawOn(zoomed.current, tex, s);
    const c = zoomed.current;
    if (c && (m[0] || m[1] || m[2] || m[3])) {
      const ctx = c.getContext("2d")!;
      ctx.strokeStyle = "rgba(76, 194, 255, 0.95)";
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      const line = (x0: number, y0: number, x1: number, y1: number) => {
        ctx.beginPath();
        ctx.moveTo(x0 + 0.5, y0 + 0.5);
        ctx.lineTo(x1 + 0.5, y1 + 0.5);
        ctx.stroke();
      };
      line(m[0] * s, 0, m[0] * s, c.height);
      line(c.width - m[2] * s - 1, 0, c.width - m[2] * s - 1, c.height);
      line(0, m[1] * s, c.width, m[1] * s);
      line(0, c.height - m[3] * s - 1, c.width, c.height - m[3] * s - 1);
      if (sk.region) {
        const [rx, ry, rw, rh] = sk.region;
        ctx.strokeStyle = "rgba(255, 158, 61, 0.95)";
        ctx.setLineDash([]);
        ctx.strokeRect(rx * s + 0.5, ry * s + 0.5, rw * s - 1, rh * s - 1);
      }
    }
    sizes.forEach(([w, h], i) => drawOn(samples.current[i] ?? null, sliceForKey(sk.key, tex, w, h), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tex, sk.key, s]);
  const deeper = depth.some((d, i) => d > m[i]!);
  return (
    <div className="nine">
      <div className="nine-zoom">
        <canvas ref={zoomed} className="pix" aria-label={`${sk.key} texture with its slice margins`} />
        <div className="muted small">
          {tex.width} × {tex.height}, shown at {s}×. Margins {m.join(", ")} (left, top, right, bottom){sk.region ? "; orange: the strip the client repeats along the bar" : ""}.
        </div>
      </div>
      <div className="nine-samples">
        {sizes.map(([w, h], i) => (
          <canvas key={i} ref={(el) => void (samples.current[i] = el)} title={`${w} × ${h}`} />
        ))}
      </div>
      {deeper && (
        <div className="finding warning">
          <Icon name="warning" size={13} /> The art reaches {depth.join(", ")} px in from the edges, deeper than the {m.join(", ")} px the client keeps: that part stretches with the widget, so ornate corners
          and thick rims distort. Keep frame detail within {Math.max(...m)} px of the edge.
        </div>
      )}
    </div>
  );
}

export function KeyCard({
  sk,
  project,
  res,
  findings,
  apply,
  textureNames,
  onError,
}: {
  sk: SkinKey;
  project: SkinProject;
  res: Resources | null;
  findings: SkinFinding[];
  apply(fn: (p: SkinProject) => SkinProject, key?: string): void;
  textureNames: string[];
  onError(text: string): void;
}) {
  const v = valueOf(project, sk.key);
  const set = (x: string | number | undefined) => apply((p) => setValue(p, sk.key, x), `key:${sk.key}`);
  const isImage = typeof v === "string" && !v.startsWith("#");
  const [tex, setTex] = useState<RGBAImage | null>(null);
  const [texState, setTexState] = useState<"none" | "loading" | "missing" | "ok">("none");
  useEffect(() => {
    if (!res || !isImage) {
      setTex(null);
      setTexState("none");
      return;
    }
    let cancelled = false;
    setTexState("loading");
    res.images.get(v as string).then((t) => {
      if (cancelled) return;
      setTex(t);
      setTexState(t ? "ok" : "missing");
    });
    return () => {
      cancelled = true;
    };
  }, [res, v, isImage]);
  const upload = async (f: File, resref: string) => {
    try {
      if (!resref || resref.length > 16) throw new Error(`"${resref}": a texture name has 1 to 16 characters`);
      const { tga } = await uploadAsTga(f);
      apply((p) => {
        let q = putFile(p, `${resref}.tga`, { data: tga, licence: "user", from: `uploaded ${f.name}` });
        // An upload replaces the project's other formats of that name (the client would pick a DDS or JPEG over it).
        for (const e of ["dds", "jpg", "png", "gif", "wbm"]) if (q.files[`${resref}.${e}`]) q = { ...q, files: Object.fromEntries(Object.entries(q.files).filter(([n]) => n !== `${resref}.${e}`)) };
        return setValue(q, sk.key, resref);
      });
    } catch (e) {
      onError(errorText(e));
    }
  };
  const worst = findings.some((f) => f.severity === "error") ? "error" : findings.some((f) => f.severity === "warning") ? "warning" : findings.length ? "note" : "";
  const typeLabel = sk.type === "image9" ? `9-slice ${sk.margins!.join(",")}` : sk.type === "imgcol" ? "image or colour" : sk.type === "colour" ? "colour" : "int";
  return (
    <div className={`key-card ${worst}`} data-key={sk.key}>
      <div className="key-head">
        <code className="key-name">{sk.key}</code>
        <span className={`chip type-${sk.type}`}>{typeLabel}</span>
        <span className="spacer" />
        {v === undefined ? (
          <button className="small" onClick={() => set(sk.type === "int" ? 0 : sk.type === "image9" ? "nui_windowh" : "#000000FF")} title="Add this key">
            <Icon name="plus" size={12} /> Set
          </button>
        ) : (
          <button className="icon-btn" title={`Remove the key (the client then uses ${JSON.stringify(clientDefault(sk.type))})`} onClick={() => set(undefined)} aria-label={`Remove ${sk.key}`}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {sk.note && <div className="muted small key-note">{sk.note}</div>}
      {v === undefined ? (
        <div className="muted small">Not set: the client uses {sk.type === "image9" ? 'the image "" (the not-found placeholder)' : sk.type === "int" ? "0" : "#00000000 (transparent)"}.</div>
      ) : sk.type === "int" ? (
        <input className="num" type="number" step={1} aria-label={sk.key} value={typeof v === "number" ? v : 0} onChange={(e) => set(Math.trunc(Number(e.target.value) || 0))} />
      ) : sk.type === "colour" ? (
        <SkinColour label={sk.key} value={typeof v === "string" ? v : "#00000000"} onChange={set} />
      ) : (
        <>
          {sk.type === "imgcol" && (
            <div className="seg" role="group" aria-label={`${sk.key}: image or colour`}>
              <button className={!isImage ? "on" : ""} onClick={() => isImage && set("#000000FF")}>
                Colour
              </button>
              <button className={isImage ? "on" : ""} onClick={() => !isImage && set(textureNames[0] ?? "nui_windowh")}>
                Image
              </button>
            </div>
          )}
          {isImage || sk.type === "image9" ? (
            <TextureField label={sk.key} value={typeof v === "string" ? v : ""} names={textureNames} onChange={set} onUpload={upload} />
          ) : (
            <SkinColour label={sk.key} value={typeof v === "string" ? v : "#00000000"} onChange={set} />
          )}
          {isImage && texState === "missing" && <div className="finding error">No texture “{v as string}” in the project, the haks or the game.</div>}
          {isImage && tex && sk.type === "image9" && <NinePreview sk={sk} tex={tex} />}
          {isImage && tex && sk.type === "imgcol" && (
            <div className="stretch-preview">
              <TexThumb tex={tex} /> <span className="muted small">{tex.width} × {tex.height}, stretched to the widget (no slicing)</span>
            </div>
          )}
        </>
      )}
      {findings.map((f, i) => (
        <div key={i} className={`finding ${f.severity}`}>
          <Icon name={f.severity === "note" ? "info" : f.severity} size={13} /> {f.text}
        </div>
      ))}
    </div>
  );
}

function TexThumb({ tex }: { tex: RGBAImage }) {
  const c = useRef<HTMLCanvasElement>(null);
  useEffect(() => drawOn(c.current, tex, Math.max(1, Math.min(4, Math.floor(48 / Math.max(tex.width, tex.height))))), [tex]);
  return <canvas ref={c} className="pix checker" />;
}
