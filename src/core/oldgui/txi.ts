/**
 * A texture's `.txi`: the plain-text sidecar that says how the client samples it. The original GUI depends on a few
 * of its keys: `filter 0` (no texel blending: each pixel takes the texel it falls in), `mipmap 0`, `clamp` (an axis
 * repeats its edge texel instead of wrapping: 1 = u, 2 = v, 3 = both) and the keys that name another texture.
 */

export interface Txi {
  /** Lower-case keys to their words (the first line of each key; font tables keep only their count). */
  keys: Map<string, string[]>;
  /** false for `filter 0`. */
  filter: boolean;
  /** false for `mipmap 0`. */
  mipmap: boolean;
  /** The clamp bits: 1 = u (across), 2 = v (down); 0 when the txi says nothing. */
  clamp: number;
  /** Other textures it names (lower case). */
  refs: string[];
}

/** Keys whose value names another texture. */
export const TXI_TEXTURE_KEYS = ["bumpmaptexture", "envmaptexture", "texture0", "texture1", "texture2", "texture3", "defaultbumpyshiny", "bumpyshinytexture"];

/** Reads a txi's text. Unknown keys are kept; numbered tables (a font's coordinates) are skipped. */
export function readTxi(text: string): Txi {
  const keys = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    const k = (t[0] ?? "").toLowerCase();
    if (!/^[a-z]/.test(k) || keys.has(k)) continue;
    keys.set(k, t.slice(1));
  }
  const n = (k: string) => {
    const v = keys.get(k)?.[0];
    return v === undefined ? undefined : Number(v);
  };
  const refs: string[] = [];
  for (const k of TXI_TEXTURE_KEYS) {
    const v = keys.get(k)?.[0]?.toLowerCase();
    if (v && v !== "null" && !refs.includes(v)) refs.push(v);
  }
  return { keys, filter: n("filter") !== 0, mipmap: n("mipmap") !== 0, clamp: (n("clamp") ?? 0) & 3, refs };
}

/** A short summary for the inventory ("filter 0, mipmap 0, clamp 3"), "" when it changes nothing the GUI cares about. */
export function txiSummary(t: Txi | null): string {
  if (!t) return "";
  const out: string[] = [];
  if (!t.filter) out.push("filter 0");
  if (!t.mipmap) out.push("mipmap 0");
  if (t.clamp) out.push(`clamp ${t.clamp}`);
  return out.join(", ");
}
