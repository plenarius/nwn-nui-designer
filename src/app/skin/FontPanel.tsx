/**
 * Fonts: the [[fonts]] list (add a .ttf, remove, reorder: the first is the UI default; each entry's size, oversampling,
 * spacing and pixel snap), and for the selected font a specimen, its coverage of the client's code page (the client
 * draws "?" for the rest), the atlas the client bakes, and its widths against the stock font when a game is loaded.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { type FontFace, NuiFont, type TextModel, parseFace } from "../../core/font/font.js";
import { compareWidths, coverage, estimateAtlas, uplus } from "../../core/font/fontinfo.js";
import { alphaCompositeInPlace, textLayer } from "../../core/render/text.js";
import { newImage } from "../../core/res/image.js";
import type { ResMan } from "../../core/res/resman.js";
import type { Resources } from "../../core/session.js";
import type { SkinFinding } from "../../core/skin/check.js";
import { CODE_PAGES, FONT_KEYS } from "../../core/skin/keys.js";
import { type SkinProject, fontsOf, putFile, setFonts } from "../../core/skin/project.js";
import type { FontEntryEdit } from "../../core/skin/tmldoc.js";
import type { TomlTable } from "../../core/skin/toml.js";
import { Icon } from "../editor/icons.js";
import { browserCanvas } from "../platform.js";
import { drawOn, resrefFrom } from "./images.js";
import { pressable } from "../editor/a11y.js";
import { errorText } from "../../core/errors.js";

const faceCache = new Map<string, FontFace | null>();

/** The parsed TTF of a resref, from the given resources (cached by resref and size). */
export function useFace(resman: ResMan | null, resref: string | undefined): FontFace | null | undefined {
  const [face, setFace] = useState<FontFace | null | undefined>(undefined);
  useEffect(() => {
    if (!resman || !resref) {
      setFace(null);
      return;
    }
    let cancelled = false;
    resman.get(resref, "ttf").then((b) => {
      if (cancelled) return;
      if (!b) return setFace(null);
      const k = `${resref}:${b.length}:${b[b.length >> 1]}:${b[b.length - 1]}`;
      if (!faceCache.has(k)) {
        try {
          faceCache.set(k, parseFace(b, resref));
        } catch {
          faceCache.set(k, null);
        }
      }
      setFace(faceCache.get(k)!);
    });
    return () => {
      cancelled = true;
    };
  }, [resman, resref]);
  return face;
}

const num = (t: TomlTable, k: string, d: number) => (typeof t[k] === "number" ? (t[k] as number) : d);
const str = (t: TomlTable, k: string, d: string) => (typeof t[k] === "string" ? (t[k] as string) : d);

export function FontList({ project, apply, sel, setSel, findings, onError, ownFonts }: { project: SkinProject; apply(fn: (p: SkinProject) => SkinProject, key?: string): void; sel: number; setSel(i: number): void; findings: SkinFinding[]; onError(t: string): void; ownFonts: string[] }) {
  const fonts = fontsOf(project);
  const file = useRef<HTMLInputElement>(null);
  const edit = (fn: (list: FontEntryEdit[]) => FontEntryEdit[], key?: string) => apply((p) => setFonts(p, fn(fontsOf(p))), key);
  const setKey = (i: number, k: string, v: string | number | boolean | undefined) =>
    edit((l) => l.map((f, j) => (j === i ? { ...f, values: Object.fromEntries(Object.entries({ ...f.values, [k]: v }).filter(([, x]) => x !== undefined)) as TomlTable } : f)), `font:${i}:${k}`);
  const move = (i: number, d: number) => {
    edit((l) => {
      const n = [...l];
      const j = i + d;
      if (j < 0 || j >= n.length) return l;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
    setSel(Math.max(0, Math.min(fonts.length - 1, i + d)));
  };
  const add = async (f: File) => {
    try {
      const resref = resrefFrom(f.name);
      if (f.name.replace(/\.[^.]+$/, "").length > 16) throw new Error(`${f.name}: the resref "${f.name.replace(/\.[^.]+$/, "")}" is longer than 16 characters; rename the file (it became "${resref}" here: rename and upload again if that is wrong)`);
      const bytes = new Uint8Array(await f.arrayBuffer());
      const face = parseFace(bytes, resref);
      apply((p) => {
        const q = putFile(p, `${resref}.ttf`, { data: bytes, licence: "user", from: `uploaded ${f.name}` });
        const list = fontsOf(q);
        const name = list.length ? face.familyName || resref : "(default)";
        return setFonts(q, [...list, { values: { name, resref, pixel_height: 0, pixel_snap: true, oversample_h: 1, oversample_v: 1, font_size: 17, spacing_h: 0.5, spacing_v: 0 } }]);
      });
      setSel(fonts.length);
    } catch (e) {
      onError(errorText(e));
    }
  };
  const f = fonts[sel];
  const fFindings = findings.filter((x) => x.key.startsWith(`fonts[${sel}]`));
  return (
    <div className="font-list">
      <p className="muted small">
        Every font is baked into one atlas when a player joins. The <b>first</b> is the UI's default font; scripts pick the others by name (<code>NuiStyleFont</code>). One face at two sizes is two
        entries.
      </p>
      <ol className="fonts">
        {fonts.map((x, i) => (
          <li key={i} className={i === sel ? "on" : ""} aria-current={i === sel ? "true" : undefined} {...pressable(() => setSel(i))}>
            <span className="f-name">{str(x.values, "name", "(default)")}</span>
            <code className="muted">{str(x.values, "resref", "fnt_maintext")}</code>
            <span className="muted">{num(x.values, "font_size", 17)} px</span>
            {i === 0 && <span className="chip">default</span>}
            <span className="spacer" />
            <button className="icon-btn" title="Up" aria-label="Move up" disabled={i === 0} onClick={(e) => (e.stopPropagation(), move(i, -1))}>
              <Icon name="up" size={12} />
            </button>
            <button className="icon-btn" title="Down" aria-label="Move down" disabled={i === fonts.length - 1} onClick={(e) => (e.stopPropagation(), move(i, 1))}>
              <Icon name="down" size={12} />
            </button>
            <button
              className="icon-btn danger"
              title="Remove"
              aria-label="Remove font"
              onClick={(e) => {
                e.stopPropagation();
                edit((l) => l.filter((_, j) => j !== i));
                setSel(Math.max(0, Math.min(sel, fonts.length - 2)));
              }}
            >
              <Icon name="trash" size={12} />
            </button>
          </li>
        ))}
      </ol>
      <div className="row-btns">
        <button onClick={() => file.current?.click()}>
          <Icon name="plus" size={12} /> Add a font (.ttf)
        </button>
        <input ref={file} type="file" hidden accept=".ttf" data-testid="font-upload" onChange={(e) => {
          const x = e.target.files?.[0];
          if (x) void add(x);
          e.target.value = "";
        }} />
      </div>
      {f && (
        <div className="font-fields">
          <label className="field">
            <span>name</span>
            <input value={str(f.values, "name", "(default)")} onChange={(e) => setKey(sel, "name", e.target.value)} aria-label="Font name" />
          </label>
          <label className="field">
            <span>resref</span>
            <input className={`mono${str(f.values, "resref", "").length > 16 ? " bad" : ""}`} list="own-fonts" value={str(f.values, "resref", "fnt_maintext")} onChange={(e) => setKey(sel, "resref", e.target.value.toLowerCase())} aria-label="Font resref" />
            <datalist id="own-fonts">
              {[...ownFonts, "fnt_maintext", "jbmonoreg", "fnt_default"].map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          {(
            [
              ["font_size", "font_size", 0.5],
              ["oversample_h", "oversample_h (whole)", 1],
              ["oversample_v", "oversample_v (whole)", 1],
              ["spacing_h", "spacing_h", 0.5],
              ["spacing_v", "spacing_v", 0.5],
            ] as const
          ).map(([k, label, step]) => (
            <label key={k} className="field">
              <span title={FONT_KEYS.find((x) => x.key === k)?.note}>{label}</span>
              <input
                className="num"
                type="number"
                step={step}
                min={k.startsWith("oversample") ? 1 : undefined}
                aria-label={`Font ${k}`}
                value={num(f.values, k, Number(FONT_KEYS.find((x) => x.key === k)!.def))}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setKey(sel, k, k.startsWith("oversample") ? Math.max(1, Math.trunc(v)) : v);
                }}
              />
            </label>
          ))}
          <label className="field">
            <span>pixel_snap</span>
            <label className="switch">
              <input type="checkbox" checked={f.values.pixel_snap !== false} onChange={(e) => setKey(sel, "pixel_snap", e.target.checked)} />
              <span />
            </label>
          </label>
          <label className="field">
            <span>pixel_height</span>
            <span className="muted small">{num(f.values, "pixel_height", 0)}: read but <b>ignored</b> by the client; font_size sets the size.</span>
          </label>
          {fFindings.map((x, i) => (
            <div key={i} className={`finding ${x.severity}`}>
              <Icon name={x.severity === "note" ? "info" : x.severity} size={13} /> {x.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FontDetails({
  project,
  sel,
  preview,
  base,
  textModel,
  setTextModel,
}: {
  project: SkinProject;
  sel: number;
  preview: Resources | null;
  base: Resources | null;
  textModel: TextModel;
  setTextModel(m: TextModel): void;
}) {
  const fonts = fontsOf(project);
  const f = fonts[sel]?.values;
  const resref = f ? str(f, "resref", "fnt_maintext") : undefined;
  const face = useFace(preview?.resman ?? null, resref);
  const [cp, setCp] = useState("cp1252");
  const stockFace = useFace(base && !base.usingFallback ? base.resman : null, "fnt_maintext");
  const size = f ? num(f, "font_size", 17) : 17;
  const spacing = f ? num(f, "spacing_h", 0.5) : 0.5;
  const cov = useMemo(() => (face ? coverage(face, cp) : null), [face, cp]);
  const allFaces = fonts.map((x) => str(x.values, "resref", "fnt_maintext"));
  const atlasFaces = useAtlasFaces(preview?.resman ?? null, allFaces);
  const atlas = useMemo(() => {
    const entries = fonts.flatMap((x, i) => (atlasFaces[i] ? [{ face: atlasFaces[i]!, size: num(x.values, "font_size", 17), oversampleH: num(x.values, "oversample_h", 1), oversampleV: num(x.values, "oversample_v", 1) }] : []));
    return entries.length ? estimateAtlas(entries, cp) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlasFaces, project.tml, cp]);
  const widths = useMemo(() => {
    if (!face || !stockFace || resref === "fnt_maintext") return null;
    return (["nuklear", "nui-preview"] as const).map((m) => compareWidths(face, stockFace, size, spacing, 0.5, m));
  }, [face, stockFace, size, spacing, resref]);
  const spec = useRef<HTMLCanvasElement>(null);
  const stockSpec = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    drawSpecimen(spec.current, face ?? null, size, spacing, textModel);
    drawSpecimen(stockSpec.current, widths ? (stockFace ?? null) : null, 17, 0.5, textModel);
  }, [face, size, spacing, textModel, stockFace, widths]);
  if (!f) return <div className="stage-note">No [[fonts]]: the client adds fnt_maintext at 17 px. Add a font on the right.</div>;
  return (
    <div className="font-details">
      <h3>
        {str(f, "name", "(default)")} <code className="muted">{resref}.ttf</code> {face?.familyName && <span className="muted small">“{face.familyName}”</span>}
      </h3>
      {face === null && <div className="finding error">No {resref}.ttf in the project, the haks or the game: the client skips this font.</div>}
      <section>
        <div className="sec-head">
          <b>Specimen</b> at {size} px
          <span className="spacer" />
          <span className="muted small">Text model</span>
          <div className="seg" role="group" aria-label="Text model">
            <button className={textModel === "nuklear" ? "on" : ""} onClick={() => setTextModel("nuklear")} title="font_size is the hhea ascent - descent height (stbtt_ScaleForPixelHeight), advances + spacing_h rounded: what the client does">
              Nuklear (the client's)
            </button>
            <button className={textModel === "nui-preview" ? "on" : ""} onClick={() => setTextModel("nui-preview")} title="font_size is the em (FreeType's size): the old nui-preview model, kept for comparison">
              em (old nui-preview)
            </button>
          </div>
        </div>
        <p className="muted small">
          The client sizes text the Nuklear way: font_size is the font's ascent minus descent, not its em (measured in game: an x-height of 6.11 px against 6.16 for this model and 6.98 for the em).
          A font with a tall ascent and descent comes out smaller than its font_size suggests.
        </p>
        <canvas ref={spec} className="specimen" aria-label="Specimen" />
        {widths && (
          <>
            <div className="muted small">The game's fnt_maintext at 17 px, for comparison:</div>
            <canvas ref={stockSpec} className="specimen" aria-label="Stock specimen" />
          </>
        )}
      </section>
      {widths && (
        <section>
          <div className="sec-head">
            <b>Widths against the stock font</b> <span className="muted small">(fnt_maintext 17 px, spacing 0.5; px under the client's Nuklear model)</span>
          </div>
          <table className="widths">
            <thead>
              <tr>
                <th>Text</th>
                <th>this font</th>
                <th>stock</th>
                <th className="muted">em (old)</th>
              </tr>
            </thead>
            <tbody>
              {widths[0]!.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.text}</td>
                  <td>{r.width.toFixed(0)}</td>
                  <td>{r.ref.toFixed(0)}</td>
                  <td className="muted">{widths[1]!.rows[i]!.width.toFixed(0)} / {widths[1]!.rows[i]!.ref.toFixed(0)}</td>
                </tr>
              ))}
              <tr className="total">
                <td>All of it, against stock</td>
                <td>{(widths[0]!.ratio * 100).toFixed(1)} %</td>
                <td>100 %</td>
                <td className="muted">{(widths[1]!.ratio * 100).toFixed(1)} %</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">Text wraps and clips by width: over about 104 %, labels sized for the stock font start to clip.</p>
        </section>
      )}
      {!widths && resref !== "fnt_maintext" && <p className="muted small">Load your game folder (Game and haks) to compare widths with the stock font.</p>}
      <section>
        <div className="sec-head">
          <b>Coverage</b>
          <select value={cp} onChange={(e) => setCp(e.target.value)} aria-label="Code page">
            {CODE_PAGES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        {cov && (
          <>
            <p className={cov.missing.length ? "finding warning" : "finding ok"}>
              {cov.have} of {cov.total} printable characters the client bakes for this code page.{" "}
              {cov.missing.length ? `${cov.missing.length} missing: the client draws “?” for them.` : "Nothing missing."}
            </p>
            {cov.missing.length > 0 && (
              <div className="missing-glyphs" aria-label="Missing glyphs">
                {cov.missing.slice(0, 400).map((c) => (
                  <span key={c} title={uplus(c)}>
                    <b>{String.fromCodePoint(c)}</b>
                    <code>{uplus(c).slice(2)}</code>
                  </span>
                ))}
                {cov.missing.length > 400 && <span className="muted">… {cov.missing.length - 400} more</span>}
              </div>
            )}
          </>
        )}
      </section>
      {atlas && (
        <section>
          <div className="sec-head">
            <b>Atlas</b> <span className="muted small">(every font together, at UI scale 1.0)</span>
          </div>
          <p>
            About <b>{atlas.width} × {atlas.height}</b> px, {atlas.glyphs} glyphs, {(atlas.bytes / 1048576).toFixed(1)} MB as RGBA. An estimate of Nuklear's baker; the client logs the real size (“NUI: Font bake
            complete; texture is W×Hpx”). Oversampling multiplies a font's share; a larger UI scale bakes larger glyphs.
          </p>
        </section>
      )}
    </div>
  );
}

function useAtlasFaces(resman: ResMan | null, resrefs: string[]): (FontFace | null)[] {
  const [faces, setFaces] = useState<(FontFace | null)[]>([]);
  const key = resrefs.join("|");
  useEffect(() => {
    if (!resman) return setFaces([]);
    let cancelled = false;
    Promise.all(
      resrefs.map(async (r) => {
        const b = await resman.get(r, "ttf");
        if (!b) return null;
        const k = `${r}:${b.length}:${b[b.length >> 1]}:${b[b.length - 1]}`;
        if (!faceCache.has(k)) {
          try {
            faceCache.set(k, parseFace(b, r));
          } catch {
            faceCache.set(k, null);
          }
        }
        return faceCache.get(k)!;
      }),
    ).then((f) => !cancelled && setFaces(f));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resman, key]);
  return faces;
}

const SPECIMEN = [
  "The quick brown fox jumps over the lazy dog.",
  "Wood Crafting, level 1 - 28 / 250 XP (222 to level 2)",
  "0123456789 !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
  "Àéîõü ÇÑß æø ¿¡ «» ©®°±²³µ¶ ×÷",
];

function drawSpecimen(c: HTMLCanvasElement | null, face: FontFace | null, size: number, spacing: number, model: TextModel): void {
  if (!c) return;
  if (!face) return drawOn(c, null);
  const font = new NuiFont("specimen", face, size > 0 ? size : 16, model, spacing, browserCanvas);
  const lh = Math.ceil(font.line + 6);
  const w = Math.min(1400, Math.max(...SPECIMEN.map((s) => Math.ceil(font.width(s)))) + 20);
  const im = newImage(w, lh * SPECIMEN.length + 12, [10, 9, 8, 255]);
  SPECIMEN.forEach((s, i) => {
    const l = textLayer(font, s, 10, 6 + i * lh, [255, 255, 255, 255], [0, 0, im.width, im.height]);
    if (l) alphaCompositeInPlace(im, l.im, l.x, l.y);
  });
  drawOn(c, im, 1);
}
