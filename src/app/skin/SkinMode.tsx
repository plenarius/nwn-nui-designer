/**
 * The skin and font editor, a mode beside the window editor: where to start from (the open Bronze skin, the game's
 * skin, a hak, loose files, a saved skin project), the keys grouped by widget, the fonts, the generator, the
 * findings and the raw nui_skin.tml on the left; the live preview (the current window drawn with the edited skin, the
 * widget-states sheet, the selected font) in the middle; the editors on the right.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorDoc } from "../../core/edit/project.js";
import type { TextModel } from "../../core/font/font.js";
import { Erf } from "../../core/res/containers.js";
import { CLIENT_PROBE } from "../../core/res/images.js";
import { TYPE_EXT } from "../../core/res/restype.js";
import { BlobSource } from "../../core/res/source.js";
import type { SkinFinding } from "../../core/skin/check.js";
import { DEFAULT_THEME, THEMES, type ThemeId, themeOf } from "../../core/skin/themes.js";
import { GROUPS, type GroupId, SKIN_KEYS } from "../../core/skin/keys.js";
import { type SkinProject, fromGameSkin, fromOpenSkin, fromResources, readSkinProject, referenced } from "../../core/skin/project.js";
import { SHEET_H, SHEET_W, preloadSkinImages, widgetSheet } from "../../core/skin/sheet.js";
import { TmlDoc } from "../../core/skin/tmldoc.js";
import { Canvas } from "../editor/Canvas.js";
import { Icon } from "../editor/icons.js";
import { Modal } from "../editor/Modal.js";
import { useDevicePixelRatio } from "../editor/useDpr.js";
import { zoomRendering } from "../editor/zoom.js";
import type { ResourceState } from "../editor/useResources.js";
import { browserCanvas, fallbackSkin } from "../platform.js";
import { FontDetails, FontList } from "./FontPanel.js";
import { GeneratorPanel } from "./GeneratorPanel.js";
import { KeyCard } from "./KeyEditor.js";
import { drawOn } from "./images.js";
import type { SkinState } from "./useSkin.js";
import { pressable } from "../editor/a11y.js";
import { errorText } from "../../core/errors.js";

export type SkinNav = GroupId | "fonts" | "generator" | "problems" | "file";
export type SkinView = "window" | "sheet" | "font";

interface Props {
  r: ResourceState;
  sk: SkinState;
  doc: EditorDoc | null;
  sample: EditorDoc | null;
  nav: SkinNav;
  setNav(n: SkinNav): void;
  view: SkinView;
  setView(v: SkinView): void;
  canvas: { canvasW: number; canvasH: number; scale: number; zoom: number };
  textModel: TextModel;
  setTextModel(m: TextModel): void;
  /** The built-in skin chosen in the toolbar. */
  theme: string;
  /** What the window editor draws with when it is not the skin being edited ("the built-in Ink and brass"), or null. */
  windowSkin: string | null;
  toast(text: string, kind: "ok" | "error" | "info"): void;
  onZoom(z: number): void;
}

const GAME_KINDS = new Set(["game-ovr", "texture-pack", "key"]);

export function SkinMode({ r, sk, doc, sample, nav, setNav, view, setView, canvas, textModel, setTextModel, theme, windowSkin, toast, onZoom }: Props) {
  const p = sk.project;
  const [fontSel, setFontSel] = useState(0);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<string, { n: number; worst: SkinFinding["severity"] }>();
    for (const f of sk.findings) {
      const k = SKIN_KEYS.find((x) => x.key === f.key);
      const g = k ? k.group : f.key.startsWith("fonts") ? "fonts" : "problems";
      const c = m.get(g) ?? { n: 0, worst: "note" as const };
      if (f.severity !== "note") c.n++;
      if (f.severity === "error" || (f.severity === "warning" && c.worst === "note")) c.worst = f.severity;
      m.set(g, c);
    }
    return m;
  }, [sk.findings]);

  if (!p) return <StartFrom r={r} sk={sk} toast={toast} theme={theme} />;

  const textureNames = [...new Set([...Object.keys(p.files).filter((n) => CLIENT_PROBE.some((e) => n.endsWith(`.${e}`))).map((n) => n.replace(/\.[^.]+$/, "")), ...referenced(p).textures])].sort();
  const ownFonts = Object.keys(p.files).filter((n) => n.endsWith(".ttf")).map((n) => n.slice(0, -4));
  const errors = sk.findings.filter((f) => f.severity === "error").length;
  const warnings = sk.findings.filter((f) => f.severity === "warning").length;

  return (
    <>
      <aside className="left skin-left">
        <div className="pane-head">
          <span>Skin</span>
        </div>
        <div className="skin-origin">
          <span className="muted small">Editing</span>
          <b>{p.origin.label}</b>
          <span className="muted small">
            {Object.keys(p.files).length} own file{Object.keys(p.files).length === 1 ? "" : "s"} · {p.name}
          </span>
          <button className="open-another" onClick={() => (sk.dirty ? setConfirmLeave(true) : sk.start(null))} title="Back to the start: a built-in skin, the game's, a hak, loose files or a project">
            <Icon name="folder" size={14} /> Open another skin
          </button>
          <span className="small window-skin" data-testid="window-skin">
            {windowSkin ? `The window editor draws with ${windowSkin}, not this skin (the toolbar's Window editor select).` : "The window editor draws with this skin too."}
          </span>
        </div>
        <nav className="skin-nav" aria-label="Skin sections">
          {GROUPS.map((g) => (
            <NavItem key={g.id} on={nav === g.id} onClick={() => setNav(g.id)} title={g.summary} count={counts.get(g.id)}>
              {g.title}
            </NavItem>
          ))}
          <hr />
          <NavItem on={nav === "fonts"} onClick={() => (setNav("fonts"), setView("font"))} count={counts.get("fonts")} icon="font">
            Fonts
          </NavItem>
          <NavItem on={nav === "generator"} onClick={() => setNav("generator")} icon="sparkle">
            Generator
          </NavItem>
          <NavItem on={nav === "problems"} onClick={() => setNav("problems")} icon="warning" count={{ n: errors + warnings, worst: errors ? "error" : warnings ? "warning" : "note" }}>
            Problems
          </NavItem>
          <NavItem on={nav === "file"} onClick={() => setNav("file")} icon="notes">
            nui_skin.tml
          </NavItem>
        </nav>
      </aside>
      <main className="center">
        <div className="tabs center-tabs">
          <button className={view === "window" ? "on" : ""} onClick={() => setView("window")}>
            Window
          </button>
          <button className={view === "sheet" ? "on" : ""} onClick={() => setView("sheet")}>
            Widget states
          </button>
          <button className={view === "font" ? "on" : ""} onClick={() => setView("font")}>
            Font
          </button>
          <span className="spacer" />
          {sk.busy && <span className="muted small">drawing…</span>}
          {sk.error && <span className="finding error">{sk.error}</span>}
        </div>
        {view === "window" &&
          (sample ? (
            <>
              <Canvas
                doc={sample}
                res={sk.preview}
                settings={{ ...canvas, markers: false, outlines: false }}
                sels={[]}
                findings={[]}
                onSelect={() => {}}
                onMove={() => {}}
                onAdd={() => {}}
                onRendered={() => {}}
                onZoom={onZoom}
                onError={() => {}}
              />
              <div className="canvas-bar">
                <span className="muted small">{doc ? `“${doc.name}” from the window editor` : "A sample window (open one in the window editor to see yours)"}, drawn with the edited skin, at rest. Hover and pressed states: Widget states.</span>
              </div>
            </>
          ) : (
            <div className="stage-note">Loading a sample window…</div>
          ))}
        {view === "sheet" && <Sheet res={sk.preview} zoom={canvas.zoom} />}
        {view === "font" && <div className="font-stage"><FontDetails project={p} sel={fontSel} preview={sk.preview} base={r.res} textModel={textModel} setTextModel={setTextModel} /></div>}
      </main>
      <aside className="right">
        <div className="right-body skin-right">
          {GROUPS.some((g) => g.id === nav) && (
            <>
              <div className="props-head">
                <b>{GROUPS.find((g) => g.id === nav)!.title}</b>
                <span className="muted small">{GROUPS.find((g) => g.id === nav)!.summary}</span>
              </div>
              {SKIN_KEYS.filter((k) => k.group === nav).map((k) => (
                <KeyCard key={k.key} sk={k} project={p} res={sk.preview} findings={sk.findings.filter((f) => f.key === k.key)} apply={sk.apply} textureNames={textureNames} onError={(t) => toast(t, "error")} />
              ))}
              {nav === "list" && <p className="muted small">Lists and groups are framed with window.border_image (Window) and their rows are selectables (Selectable); their scrollbars are under Scrollbars.</p>}
            </>
          )}
          {nav === "fonts" && <FontList project={p} apply={sk.apply} sel={fontSel} setSel={(i) => (setFontSel(i), setView("font"))} findings={sk.findings} onError={(t) => toast(t, "error")} ownFonts={ownFonts} />}
          {nav === "generator" && <GeneratorPanel project={p} apply={sk.apply} />}
          {nav === "problems" && <Problems findings={sk.findings} go={(f) => {
            const k = SKIN_KEYS.find((x) => x.key === f.key);
            if (k) setNav(k.group);
            else if (f.key.startsWith("fonts")) setNav("fonts");
          }} />}
          {nav === "file" && <TmlEditor project={p} apply={sk.apply} />}
        </div>
      </aside>
      {confirmLeave && (
        <Modal title={`Discard your changes to ${p.name}?`} icon="warning" className="confirm" onClose={() => setConfirmLeave(false)}>
          <div className="modal-body">
            <p>The skin has changes since it was opened, last exported or saved as a project, and the skin editor does not keep them. Export it or save the project (Export skin, Project) to keep them.</p>
            <div className="row-btns confirm-btns">
              <span className="spacer" />
              <button onClick={() => setConfirmLeave(false)} data-autofocus>
                Cancel
              </button>
              <button className="primary" onClick={() => (setConfirmLeave(false), sk.start(null))}>
                Discard
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function NavItem({ on, onClick, title, count, children, icon }: { on: boolean; onClick(): void; title?: string; count?: { n: number; worst: string }; children: React.ReactNode; icon?: string }) {
  return (
    <button className={`nav-item${on ? " on" : ""}`} onClick={onClick} title={title}>
      {icon && <Icon name={icon} size={13} />}
      <span>{children}</span>
      {count && count.n > 0 && <span className={`count ${count.worst}`}>{count.n}</span>}
    </button>
  );
}

/** The widget-states sheet at the editor's zoom (scrolling when it is bigger than the stage), crisp at whole ratios. */
function Sheet({ res, zoom }: { res: SkinState["preview"]; zoom: number }) {
  const c = useRef<HTMLCanvasElement>(null);
  const dpr = useDevicePixelRatio();
  useEffect(() => {
    if (!res) return;
    let cancelled = false;
    preloadSkinImages(res.skin, res.images).then(() => {
      if (!cancelled) drawOn(c.current, widgetSheet(res.skin, res.images, { makeCanvas: browserCanvas, title: "widget states (every state the skin has art for)" }), 1);
    });
    return () => {
      cancelled = true;
    };
  }, [res]);
  return (
    <div className="stage sheet-stage">
      <canvas ref={c} className="sheet" aria-label="Widget states" style={{ width: SHEET_W * zoom, height: SHEET_H * zoom, imageRendering: zoomRendering(zoom, dpr) }} />
    </div>
  );
}

function Problems({ findings, go }: { findings: SkinFinding[]; go(f: SkinFinding): void }) {
  if (!findings.length) return <p className="finding ok">No problems: every key the client reads is set, with the right type, and every texture and font is found.</p>;
  return (
    <ul className="skin-problems">
      {findings.map((f, i) => (
        <li key={i} className={`finding ${f.severity}`} {...pressable(() => go(f))}>
          <Icon name={f.severity === "note" ? "info" : f.severity} size={13} /> {f.text}
        </li>
      ))}
    </ul>
  );
}

function TmlEditor({ project, apply }: { project: SkinProject; apply(fn: (p: SkinProject) => SkinProject, key?: string): void }) {
  const [text, setText] = useState(project.tml);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setText(project.tml), [project.tml]);
  return (
    <div className="tml-editor">
      <p className="muted small">The file as it will be exported. Edits elsewhere change only their own lines: comments, order and spacing stay as they are.</p>
      <textarea
        className="mono"
        aria-label="nui_skin.tml"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            new TmlDoc(e.target.value).data();
            setErr(null);
            const t = e.target.value;
            apply((p) => ({ ...p, tml: t }), "tml");
          } catch (x) {
            setErr(x instanceof Error ? x.message : String(x));
          }
        }}
      />
      {err && <div className="finding error">{err} (not applied: the client would skip the whole skin)</div>}
    </div>
  );
}

function StartFrom({ r, sk, toast, theme }: { r: ResourceState; sk: SkinState; toast(t: string, k: "ok" | "error" | "info"): void; theme: string }) {
  const hak = useRef<HTMLInputElement>(null);
  const loose = useRef<HTMLInputElement>(null);
  const proj = useRef<HTMLInputElement>(null);
  const hasGame = !!r.game;
  const fail = (e: unknown) => toast(errorText(e), "error");
  const builtin = async (id: ThemeId) => {
    try {
      const t = themeOf(id);
      sk.start(fromOpenSkin(await fallbackSkin(t.id, true), t.style, t.title, t.hak));
    } catch (e) {
      fail(e);
    }
  };
  const game = async () => {
    try {
      const rm = r.res?.resman;
      const layer = rm?.layers.find((l) => GAME_KINDS.has(l.kind) && l.container.has("nui_skin", 2076));
      if (!rm || !layer) throw new Error("no nui_skin.tml in the game folder");
      const tml = await layer.container.get("nui_skin", 2076);
      sk.start(fromGameSkin(tml!, `the game's skin (${layer.container.label})`));
    } catch (e) {
      fail(e);
    }
  };
  return (
    <main className="skin-start">
      <div className="start-inner">
        <h1>Restyle every NUI window</h1>
        <p className="lead">
          A skin is one <code>nui_skin.tml</code> and the textures and fonts it names: frames, title bars, buttons, scrollbars, checkboxes, fonts. The client applies it to every NUI window, the game's own
          included. Edit it here, see it on your windows, and export it as a hak.
        </p>
        <div className="start-cards">
          {THEMES.map((t) => (
            <button key={t.id} className={`card${t.id === theme ? " primary" : ""}`} onClick={() => builtin(t.id)}>
              <Icon name="sparkle" size={22} />
              <b>
                Built-in: {t.title}
                {t.id === DEFAULT_THEME ? " (default)" : ""}
              </b>
              <span>
                {t.look} CC0 art from the generator (tweak it live), OFL fonts.
              </span>
            </button>
          ))}
          <button className="card" disabled={!hasGame} onClick={game} title={hasGame ? "" : "Load your game folder first (Game and haks)"}>
            <Icon name="folder" size={22} />
            <b>Your game's skin</b>
            <span>{hasGame ? "Beamdog's nui_skin.tml to edit; its textures stay the game's and are never exported." : "Load your game folder first (Game and haks in the toolbar)."}</span>
          </button>
          <button className="card" onClick={() => hak.current?.click()}>
            <Icon name="import" size={22} />
            <b>A skin from a hak</b>
            <span>A .hak or .erf with a nui_skin.tml, its textures and fonts.</span>
          </button>
          <button className="card" onClick={() => loose.current?.click()}>
            <Icon name="open" size={22} />
            <b>Loose files</b>
            <span>nui_skin.tml with its .tga, .png, .dds and .ttf files (pick them all).</span>
          </button>
          <button className="card" onClick={() => proj.current?.click()}>
            <Icon name="save" size={22} />
            <b>A saved skin project</b>
            <span>.nuiskin.json, from Export, Project.</span>
          </button>
        </div>
        <p className="muted small">Nothing is uploaded: files are read in your browser.</p>
      </div>
      <input
        ref={hak}
        type="file"
        hidden
        accept=".hak,.erf,.mod"
        data-testid="skin-hak-input"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const erf = await Erf.open(new BlobSource(f.name, f));
            const entries = [...erf.entries()].map(([n, t]) => [n, TYPE_EXT[t] ?? "", () => erf.get(n, t)] as [string, string, () => Promise<Uint8Array | null>]);
            sk.start(await fromResources(f.name, "hak", entries, f.name.replace(/\.[^.]+$/, "").toLowerCase()));
          } catch (x) {
            fail(x);
          }
        }}
      />
      <input
        ref={loose}
        type="file"
        hidden
        multiple
        data-testid="skin-files-input"
        onChange={async (e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = "";
          try {
            const entries = fs.map((f) => {
              const dot = f.name.lastIndexOf(".");
              return [f.name.slice(0, dot).toLowerCase(), f.name.slice(dot + 1).toLowerCase(), async () => new Uint8Array(await f.arrayBuffer())] as [string, string, () => Promise<Uint8Array>];
            });
            sk.start(await fromResources(`${fs.length} loose files`, "files", entries));
          } catch (x) {
            fail(x);
          }
        }}
      />
      <input
        ref={proj}
        type="file"
        hidden
        accept=".json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            sk.start(readSkinProject(await f.text()));
          } catch (x) {
            fail(x);
          }
        }}
      />
    </main>
  );
}
