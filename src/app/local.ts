/**
 * The editor's side of the local API (src/node/localapi.ts): the settings, and the configured folders' files read
 * through the dev server. A file is a ByteSource whose reads are HTTP Range requests, so the containers read exactly
 * what they read from a picked folder (a hak's directory, one texture), never a whole BIF.
 */
import type { FileTree } from "../core/res/resman.js";
import type { ByteSource } from "../core/res/source.js";
import type { FileEntry, LocalState, WindowList } from "../node/localapi.js";
import type { IniSettings } from "../node/settings.js";
import type { StyleRuleSet } from "../core/edit/style.js";
import { StyleFileError, addPluginRules, parseStyleDef } from "../core/edit/styles/generic.js";

export type { LocalState, IniSettings, WindowList };

const API = "./api/local/";

export const fileUrl = (root: string, path: string) => `${API}file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`;

/** A file served by the local API: each read is one Range request. */
export class HttpSource implements ByteSource {
  constructor(
    readonly name: string,
    readonly size: number,
    private readonly url: string,
  ) {}
  async read(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(this.size, offset + length);
    if (end <= offset) return new Uint8Array(0);
    const r = await fetch(this.url, { headers: { range: `bytes=${offset}-${end - 1}` } });
    if (r.status !== 206 && r.status !== 200) throw new Error(`${this.name}: the dev server answered ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    // A server that ignores Range sends the whole file.
    return r.status === 200 ? bytes.subarray(offset, end) : bytes;
  }
}

/** A folder's files as the local API listed them. */
export class HttpTree implements FileTree {
  private readonly files = new Map<string, HttpSource>();
  constructor(
    readonly label: string,
    root: string,
    entries: FileEntry[],
  ) {
    for (const e of entries) {
      const name = e.path.slice(e.path.lastIndexOf("/") + 1);
      this.files.set(e.path.toLowerCase(), new HttpSource(name, e.size, fileUrl(root, e.path)));
    }
  }
  file(relPath: string): ByteSource | null {
    return this.files.get(relPath.toLowerCase().replace(/\\/g, "/")) ?? null;
  }
  list(relDir: string): ByteSource[] {
    const d = relDir.toLowerCase().replace(/\/$/, "") + "/";
    const out: ByteSource[] = [];
    for (const [p, f] of this.files) if (p.startsWith(d) && !p.slice(d.length).includes("/")) out.push(f);
    return out;
  }
  get size(): number {
    return this.files.size;
  }
}

/** The local state, or null when there is no local API (a static build, a server without it). */
export async function fetchLocalState(timeoutMs = 4000): Promise<LocalState | null> {
  try {
    const r = await fetch(`${API}state`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("application/json")) return null;
    const s = (await r.json()) as LocalState;
    return s && s.version === 1 ? s : null;
  } catch {
    return null;
  }
}

/** Saves the settings; throws with the server's message (which names the setting and the folder) when it refuses. */
export async function saveLocalSettings(s: IniSettings): Promise<LocalState> {
  const r = await fetch(`${API}settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
  const body = (await r.json().catch(() => ({}))) as { saved?: boolean; state?: LocalState; error?: string; errors?: Record<string, string> };
  if (!r.ok || !body.saved || !body.state) throw new SettingsError(body.error ?? `the dev server answered ${r.status}`, body.errors ?? {});
  return body.state;
}

export class SettingsError extends Error {
  constructor(
    message: string,
    readonly errors: Record<string, string>,
  ) {
    super(message);
  }
}

/** The resources a local state names: the game as a tree, the haks found (in order), the loose files. */
export function localInputs(s: LocalState): { game: HttpTree | null; haks: HttpSource[]; overrides: HttpSource[] } {
  const game = s.game ? new HttpTree(s.game.path, "game", s.game.files) : null;
  const haks = s.haks.filter((h) => h.found).map((h) => new HttpSource(h.file!, h.size!, fileUrl("hak", h.file!)));
  const overrides = s.overrides.flatMap((o, i) => o.files.map((f) => new HttpSource(f.path, f.size, fileUrl(`ovr:${i}`, f.path))));
  return { game, haks, overrides };
}

/** A window file's text from the windows folder. */
export async function fetchWindowText(path: string): Promise<string> {
  const r = await fetch(fileUrl("windows", path), { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: the dev server answered ${r.status}`);
  return r.text();
}

/** The windows folder's files with their titles (null: no windows folder set, or no local API). */
export async function fetchWindowList(timeoutMs = 4000): Promise<WindowList | null> {
  try {
    const r = await fetch(`${API}windows`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("application/json")) return null;
    return ((await r.json()) as { windows?: WindowList | null }).windows ?? null;
  } catch {
    return null;
  }
}

/**
 * The configured style files as rule sets, built as `pnpm check` builds them (core/edit/styles/generic.ts). A style's
 * plugin is fetched from the style file's folder and imported: it runs in the editor, as any plugin. A file that
 * cannot be used is left out, its error in errors.
 */
export async function loadLocalStyles(s: LocalState): Promise<{ sets: StyleRuleSet[]; errors: string[] }> {
  const sets: StyleRuleSet[] = [];
  const errors: string[] = [];
  for (const st of s.styles ?? []) {
    if (st.error || st.json === undefined) {
      errors.push(st.error ?? `${st.file}: cannot read it`);
      continue;
    }
    try {
      const def = parseStyleDef(st.json, st.file);
      if (!def.plugin) {
        sets.push(def.set);
        continue;
      }
      const r = await fetch(fileUrl(st.root, def.plugin), { cache: "no-store" });
      if (!r.ok) throw new StyleFileError(st.file, "plugin", `${def.plugin}: the dev server answered ${r.status}`);
      const url = URL.createObjectURL(new Blob([await r.text()], { type: "text/javascript" }));
      try {
        const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
        sets.push(addPluginRules(def, mod.default));
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { sets, errors };
}

/** The built-in sets and the style files' (a file with a built-in set's id replaces it: it is yours). */
export function allStyleSets(builtIn: readonly StyleRuleSet[], files: readonly StyleRuleSet[]): StyleRuleSet[] {
  const ids = new Set(files.map((f) => f.id));
  return [...builtIn.filter((b) => !ids.has(b.id)), ...files];
}
