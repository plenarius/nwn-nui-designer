/**
 * The generator: the open skin's Style (about 30 numbers: colours, rim, bevel, noise, glow, marks) edited in the
 * browser, every texture regenerated live (src/core/skin/gen, the same pixels as the committed Bronze) and the skin's
 * colours set from it. Presets: A Bronze, B Ink and brass and the steampunk S1 to S3 (the shipped skins), and D Iron.
 */
import { useEffect, useRef, useState } from "react";
import { encodeTga32 } from "../../core/res/tgawrite.js";
import type { Col, FillSpec } from "../../core/skin/gen/draw.js";
import { PRESETS, type RGB, type Style, cloneStyle, styleTextures, styleValues } from "../../core/skin/gen/style.js";
import { KEY_BY_NAME } from "../../core/skin/keys.js";
import { type SkinFile, type SkinProject, setValues } from "../../core/skin/project.js";
import type { TomlValue } from "../../core/skin/toml.js";
import { Icon } from "../editor/icons.js";
import { SkinColour, colourText, parseColour } from "./KeyEditor.js";

/** The generated textures and the style's colour keys put into the project (texture keys only with all = true). */
export function applyStyle(p: SkinProject, s: Style, all = false): SkinProject {
  const files: Record<string, SkinFile> = { ...p.files };
  for (const [name, im] of styleTextures(s)) files[`${name}.tga`] = { data: encodeTga32(im), licence: "cc0", from: `generated (style ${s.key})` };
  if (!s.title_body) delete files["nuio_title.tga"];
  const v = styleValues(s, s.title_body ? "nuio_title" : "nui_windowh");
  const set: Record<string, TomlValue> = {};
  for (const [k, x] of Object.entries(v)) {
    const t = KEY_BY_NAME.get(k)?.type;
    const colour = t === "colour" || (t === "imgcol" && typeof x === "string" && x.startsWith("#"));
    if (all || colour || k.startsWith("window.header.normal") || k.startsWith("window.header.hover") || k.startsWith("window.header.active")) set[k] = x;
  }
  return { ...setValues({ ...p, files }, set), style: s };
}

const rgbHex = (c: Col | null | undefined) => colourText([...(Array.isArray(c) ? c : [0, 0, 0]).slice(0, 3), 255]);
const fromHex = (h: string): RGB => (parseColour(h) ?? [0, 0, 0]).slice(0, 3) as RGB;

function Rgb({ label, value, onChange }: { label: string; value: Col | null | undefined; onChange(c: RGB): void }) {
  return (
    <label className="gen-rgb" title={label}>
      <span className="swatch">
        <span style={{ background: rgbHex(value).slice(0, 7) }} />
        <input type="color" aria-label={label} value={rgbHex(value).slice(0, 7).toLowerCase()} onChange={(e) => onChange(fromHex(e.target.value))} />
      </span>
      <span>{label}</span>
    </label>
  );
}

function Num({ label, value, onChange, min, max, step }: { label: string; value: number; onChange(v: number): void; min: number; max: number; step: number }) {
  return (
    <label className="gen-num">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <input className="num" type="number" min={min} max={max} step={step} value={value} aria-label={`${label} value`} onChange={(e) => Number.isFinite(Number(e.target.value)) && onChange(Number(e.target.value))} />
    </label>
  );
}

function Body({ title, spec, onChange, optional }: { title: string; spec: FillSpec | null; onChange(s: FillSpec | null): void; optional?: string }) {
  return (
    <div className="gen-body">
      <div className="gen-sub">
        {title}
        {optional && (
          <label className="inline small muted">
            <input type="checkbox" checked={!!spec} onChange={(e) => onChange(e.target.checked ? { top: [40, 40, 40] } : null)} /> {optional}
          </label>
        )}
      </div>
      {spec && (
        <>
          <div className="gen-row">
            <Rgb label="top" value={spec.top} onChange={(c) => onChange({ ...spec, top: c })} />
            <Rgb label="bottom" value={spec.bottom ?? spec.top} onChange={(c) => onChange({ ...spec, bottom: c })} />
          </div>
          <Num label="noise" value={spec.noise ?? 0} min={0} max={0.6} step={0.01} onChange={(v) => onChange({ ...spec, noise: v })} />
          {(spec.noise ?? 0) > 0 && (
            <>
              <Num label="cloud size" value={spec.cell ?? 12} min={2} max={48} step={1} onChange={(v) => onChange({ ...spec, cell: v })} />
              <Num label="octaves" value={spec.octaves ?? 3} min={1} max={4} step={1} onChange={(v) => onChange({ ...spec, octaves: v })} />
              <Num label="streaks (brushed)" value={spec.streak ?? 1} min={1} max={16} step={1} onChange={(v) => onChange({ ...spec, streak: v })} />
            </>
          )}
          <Num label="grain" value={spec.grain ?? 0} min={0} max={0.2} step={0.005} onChange={(v) => onChange({ ...spec, grain: v })} />
        </>
      )}
    </div>
  );
}

export function GeneratorPanel({ project, apply }: { project: SkinProject; apply(fn: (p: SkinProject) => SkinProject, key?: string): void }) {
  const [style, setStyle] = useState<Style>(() => cloneStyle(project.style ?? PRESETS[0]!));
  const [live, setLive] = useState(true);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!live) return;
    const t = setTimeout(() => apply((p) => applyStyle(p, style), "generator"), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, live]);
  const up = (patch: Partial<Style>) => setStyle((s) => ({ ...s, ...patch }));
  return (
    <div className="generator">
      <p className="muted small">
        The open skin's textures are drawn from these numbers (no input image). Change them and every texture is drawn again, live: frames, buttons, scrollbars, checkboxes, arrows. Rims stay
        within the client's 3 px margin and glows within 7 px, so the art never stretches. Generated textures are CC0.
      </p>
      <div className="gen-row">
        <label className="field">
          <span>Preset</span>
          <select value={PRESETS.some((p) => p.key === style.key) ? style.key : ""} onChange={(e) => setStyle(cloneStyle(PRESETS.find((p) => p.key === e.target.value)!))} aria-label="Preset">
            {!PRESETS.some((p) => p.key === style.key) && <option value="">{style.title}</option>}
            {PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="inline small">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live
        </label>
        {!live && (
          <button className="small" onClick={() => apply((p) => applyStyle(p, style), "generator")}>
            <Icon name="sparkle" size={12} /> Generate
          </button>
        )}
        <button className="small" title="Point every texture key at the generated textures (nui_button_n, ...) and set every colour and size from the style" onClick={() => apply((p) => applyStyle(p, style, true))}>
          Use for every key
        </button>
      </div>
      <p className="muted small">{style.summary}</p>

      <div className="gen-sec">Rim</div>
      <div className="gen-row">
        {[0, 1, 2].map((i) => (
          <div key={i} className="gen-ring">
            <Rgb label={["outer", "middle", "inner"][i]!} value={style.rings[i] ?? [0, 0, 0]} onChange={(c) => up({ rings: Object.assign([...style.rings], { [i]: c }) })} />
            <label className="inline small muted">
              <input
                type="checkbox"
                checked={style.rings[i] != null}
                aria-label={`ring ${i + 1}`}
                onChange={(e) => {
                  const r = [...style.rings];
                  while (r.length <= i) r.push(null);
                  r[i] = e.target.checked ? [128, 128, 128] : null;
                  up({ rings: r });
                }}
              />
              on
            </label>
          </div>
        ))}
      </div>
      <Num label="bevel" value={style.bevel} min={-0.5} max={0.5} step={0.01} onChange={(v) => up({ bevel: v })} />
      <div className="gen-row">
        <label className="inline small muted">
          <input type="checkbox" checked={!!style.pipe} onChange={(e) => up({ pipe: e.target.checked ? { color: [180, 140, 66], width: 2, inset: 1 } : null })} /> pipe over the rings
        </label>
        {style.pipe && <Rgb label="pipe" value={style.pipe.color} onChange={(c) => up({ pipe: { ...style.pipe!, color: c } })} />}
      </div>
      {style.pipe && (
        <>
          <Num label="pipe width" value={style.pipe.width} min={1} max={3 - (style.pipe.inset ?? 0)} step={1} onChange={(v) => up({ pipe: { ...style.pipe!, width: v } })} />
          <Num label="pipe inset" value={style.pipe.inset ?? 0} min={0} max={3 - style.pipe.width} step={1} onChange={(v) => up({ pipe: { ...style.pipe!, inset: v } })} />
          <Num label="highlight" value={style.pipe.light ?? 0.45} min={0} max={1} step={0.05} onChange={(v) => up({ pipe: { ...style.pipe!, light: v } })} />
          <Num label="shadow" value={style.pipe.shadow ?? 0.55} min={0} max={1} step={0.05} onChange={(v) => up({ pipe: { ...style.pipe!, shadow: v } })} />
        </>
      )}
      <div className="gen-row">
        <label className="inline small muted">
          <input type="checkbox" checked={!!style.rivet} onChange={(e) => up({ rivet: e.target.checked ? [200, 160, 90] : null })} /> corner rivets
        </label>
        {style.rivet && <Rgb label="rivet" value={style.rivet} onChange={(c) => up({ rivet: c })} />}
      </div>

      <div className="gen-sec">Fills</div>
      <Body title="Window and frames" spec={style.window_body} onChange={(s) => s && up({ window_body: s })} />
      <Body title="Title bar" spec={style.title_body} onChange={(s) => up({ title_body: s })} optional="own texture (nuio_title)" />
      <Body title="Buttons" spec={style.button_body} onChange={(s) => s && up({ button_body: s })} />
      <Body title="Pressed and selected" spec={style.active_body} onChange={(s) => s && up({ active_body: s })} />
      <Body title="Small buttons (close, scroll arrows)" spec={style.tile} onChange={(s) => up({ tile: s })} optional="a tile" />
      <div className="gen-row">
        <Rgb label="wells (checkbox, track)" value={style.well} onChange={(c) => up({ well: c })} />
      </div>

      <div className="gen-sec">Hover glow</div>
      <div className="gen-row">
        <Rgb label="glow" value={style.glow} onChange={(c) => up({ glow: c })} />
      </div>
      <Num label="starts at" value={style.glow_start} min={0} max={6} step={1} onChange={(v) => up({ glow_start: v })} />
      <Num label="width" value={style.glow_width} min={1} max={7} step={1} onChange={(v) => up({ glow_width: v })} />
      <Num label="strength" value={style.glow_strength} min={0} max={1} step={0.05} onChange={(v) => up({ glow_strength: v })} />
      {style.glow_start + style.glow_width > 7 && <div className="finding warning">The glow ends {style.glow_start + style.glow_width} px in: past the 7 px the hover states keep, it stretches.</div>}

      <div className="gen-sec">Marks</div>
      <div className="gen-row">
        <Rgb label="mark" value={style.mark} onChange={(c) => up({ mark: c })} />
        <Rgb label="dark" value={style.mark_dark} onChange={(c) => up({ mark_dark: c })} />
        <div className="seg" role="group" aria-label="Tick">
          {(["cross", "check"] as const).map((t) => (
            <button key={t} className={style.tick === t ? "on" : ""} onClick={() => up({ tick: t })}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="gen-row">
        <Rgb label="progress light" value={style.progress[0]} onChange={(c) => up({ progress: [c, style.progress[1]] })} />
        <Rgb label="progress dark" value={style.progress[1]} onChange={(c) => up({ progress: [style.progress[0], c] })} />
      </div>

      <div className="gen-sec">Colours of the skin</div>
      {(
        [
          ["text", "text"],
          ["title_label", "title"],
          ["title_label_active", "title (active)"],
          ["accent", "accent (borders, scaler, slider)"],
          ["fixed_background", "window background"],
        ] as const
      ).map(([k, label]) => (
        <div key={k} className="gen-colour">
          <span className="small">{label}</span>
          <SkinColour label={label} value={style[k]} onChange={(v) => up({ [k]: v } as Partial<Style>)} />
        </div>
      ))}
      {(["normal", "hover", "active"] as const).map((st, i) => (
        <div key={st} className="gen-colour">
          <span className="small">context menu {st}</span>
          <SkinColour label={`context ${st}`} value={style.contextual[i]!} onChange={(v) => up({ contextual: Object.assign([...style.contextual], { [i]: v }) as Style["contextual"] })} />
        </div>
      ))}
    </div>
  );
}
