/**
 * "Reskin everything": the original (MDL-panel) GUI's textures retoned to a designer skin, so one theme covers the
 * NUI windows and the old ones alike. Reads each stock texture the way the client finds it (the first layer that has
 * the name, a DDS before a TGA within a layer), recolours or redraws it in the same format at the same size, checks
 * the result, compresses a TGA to DDS where that is good enough (--format, compress.ts), and returns the files under
 * the stock names with a manifest. No file is written here (src/node/reskin.ts
 * does that), and no game art is part of this code: it all comes from the user's own install.
 */
import { writeErf } from "../res/erfwrite.js";
import type { RGBAImage } from "../res/image.js";
import type { ResMan } from "../res/resman.js";
import { decodeTga } from "../res/tga.js";
import { encodeBiowareDds, readBiowareHeader } from "./bc.js";
import { type CompressionError, type OutputFormat, compressToDds, keepTgaReason } from "./compress.js";
import { type AlphaMode, alphaCurve, frameColour, swatchColour } from "./colour.js";
import { type ReskinPalette, hex } from "./palette.js";
import { REDRAWS, type NuiPieces, resize } from "./redraw.js";
import { mapPicture, retoneDds, retoneTga, tgaInfo } from "./retone.js";
import { AUTO, type AutoTexture, type Group, MANUAL, type ManualTexture } from "./textures.js";
import { type Validation, decodeTexture, validateTexture } from "./validate.js";

/** Texture formats in the order the client prefers them within one layer. */
export const TEXTURE_EXTS = ["ktx", "dds", "tga"] as const;

export interface ManifestEntry {
  name: string;
  group: Group;
  action: "recoloured" | "redrawn";
  /** The output file ("gui_boxes.dds"). */
  file: string;
  /** Where the stock texture was read: the layer kind and its label. */
  source: string;
  /** The stock file's format ("tga 24-bit", "dds dxt5"). */
  format: string;
  /** The format written ("dds dxt1", "tga 24-bit"). */
  output: string;
  /** Bytes written (the texture alone, without its .txi). */
  bytes: number;
  /** A stock TGA: the size of the recoloured TGA (what --format tga writes). */
  tgaBytes?: number;
  /** A stock TGA compressed to DDS (or tried): the error, and why the TGA was kept. */
  compression?: CompressionError & { kept?: string };
  size: [number, number];
  txi: boolean;
  /** Pixels copied unchanged (a picture inside a frame). */
  protected?: [number, number, number, number];
  notes: string[];
  validation: Validation;
}

export interface Skipped {
  name: string;
  why: string;
}

export interface Manifest {
  tool: "nwn-nui-designer reskin";
  skin: { id: string; title: string; from: string };
  palette: Record<string, string>;
  alpha: AlphaMode;
  /** --format: what stock TGAs were written as. */
  outputFormat: OutputFormat;
  textures: ManifestEntry[];
  skipped: Skipped[];
  manual: (ManualTexture & { found: boolean })[];
}

export interface Preview {
  name: string;
  group: Group;
  before: RGBAImage;
  after: RGBAImage;
  ok: boolean;
}

export interface ReskinResult {
  /** Output files by file name (stock names: "gui_boxes.dds", "gui_boxes.txi"). */
  files: Record<string, Uint8Array>;
  manifest: Manifest;
  previews: Preview[];
}

export interface ReskinOptions {
  palette: ReskinPalette;
  /** The skin's NUI pieces the scrollbar and slider are drawn from. */
  nui: NuiPieces;
  skin: Manifest["skin"];
  alpha: AlphaMode;
  /** What to write a stock TGA as (default auto: DDS unless its error is above AUTO_LIMITS). */
  format?: OutputFormat;
  /** Only these textures (default: every one the reskin handles). */
  only?: string[];
  /** Keep the decoded before/after pictures for a contact sheet. */
  previews?: boolean;
  /** Called before each texture (awaited: the editor yields to the browser here and shows how far it got). */
  progress?(done: number, total: number, name: string): void | Promise<void>;
}

function formatOf(bytes: Uint8Array, ext: string): string {
  if (ext === "dds") {
    const h = readBiowareHeader(bytes);
    return h ? `dds ${h.bpp === 4 ? "dxt5" : "dxt1"}` : "dds (standard)";
  }
  const t = tgaInfo(bytes);
  return t ? `tga ${t.bits}-bit` : `tga type ${bytes[2]}`;
}

export async function reskin(resman: ResMan, o: ReskinOptions): Promise<ReskinResult> {
  const files: Record<string, Uint8Array> = {};
  const textures: ManifestEntry[] = [];
  const skipped: Skipped[] = [];
  const previews: Preview[] = [];
  const curve = alphaCurve(o.alpha);
  const outFormat = o.format ?? "auto";
  const list: AutoTexture[] = o.only ? AUTO.filter((t) => o.only!.includes(t.name)) : AUTO;
  for (const [i, t] of list.entries()) {
    await o.progress?.(i, list.length, t.name);
    const found = await resman.getAny(t.name, TEXTURE_EXTS);
    if (!found) {
      skipped.push({ name: t.name, why: "not in the game, haks or override folders given" });
      continue;
    }
    const [stock, ext] = found;
    const layer = resman.layers.find((l) => TEXTURE_EXTS.some((e) => resman.where(t.name, e) === l));
    const source = layer ? `${layer.kind}: ${layer.container.label}` : "?";
    if (ext === "ktx") {
      skipped.push({ name: t.name, why: `found as KTX (${source}): KTX is not handled, retone it by hand or remove it` });
      continue;
    }
    const format = formatOf(stock, ext);
    let bytes: Uint8Array;
    let notes: string[] = [];
    let validation: Validation;
    let drawn: RGBAImage | undefined;
    let outExt: string = ext;
    let compression: ManifestEntry["compression"];
    let tgaBytes: number | undefined;
    try {
      if (t.action === "redraw") {
        const h = readBiowareHeader(stock);
        if (ext !== "dds" || !h) throw new Error(`expected a BioWare DDS, found ${format}`);
        drawn = REDRAWS[t.name]!(o.nui, o.palette);
        if (drawn.width !== h.width || drawn.height !== h.height) {
          notes.push(`drawn at ${drawn.width} x ${drawn.height}, resampled to the stock ${h.width} x ${h.height}`);
          drawn = resize(drawn, h.width, h.height);
        }
        bytes = encodeBiowareDds(drawn, h.bpp);
        validation = validateTexture(stock, bytes, ext, { drawn });
      } else {
        const map = t.group === "swatch" ? swatchColour(o.palette, t.name, o.alpha) : frameColour(o.palette, t.name);
        const raise = o.alpha === "opaque" && !t.keepAlpha;
        if (ext === "dds") {
          const r = retoneDds(stock, map, raise ? curve : null);
          bytes = r.bytes;
          notes = r.notes;
          if (r.worstColour > 0) notes.push(`worst DXT colour error ${Math.round(r.worstColour)}/255`);
          const dxt5 = readBiowareHeader(stock)?.bpp === 4;
          // swatch strips are flat cells: a dark skin squeezes their greys together, so the correlation runs lower
          const minCorr = t.group === "swatch" ? 0.7 : 0.8;
          const mapped = mapPicture(decodeTexture(stock, ext), map, dxt5 && raise ? curve : null);
          validation = validateTexture(stock, bytes, ext, dxt5 && raise ? { alpha: curve, alphaTolerance: 16, minCorr, mapped } : { minCorr, mapped });
          const dxtLost = validation.edgesAfterDxt?.strongLost ?? [];
          if (dxtLost.length) notes.push(`DXT blocks flatten ${dxtLost.length} strong edge(s) the recolour keeps (${dxtLost.slice(0, 2).join("; ")}): the stock blocks hold 4 colours a block`);
        } else {
          const r = retoneTga(stock, map, t.protect);
          bytes = r.bytes;
          validation = validateTexture(stock, bytes, ext, { mapped: mapPicture(decodeTga(stock), map, null, t.protect) });
          if (outFormat !== "tga") {
            tgaBytes = bytes.length;
            const c = compressToDds(decodeTga(bytes));
            const kept = keepTgaReason(c.error);
            if (outFormat === "dds" || !kept) {
              bytes = c.bytes;
              outExt = "dds";
              compression = c.error;
              if (c.error.flipped) validation.problems.push("the compressed DDS decodes upside down");
              if (!c.error.alphaEndsKept) validation.problems.push("compressing moved alpha 0 or 255 (a cut-out)");
              validation.ok = validation.problems.length === 0;
            } else compression = { ...c.error, kept };
          }
        }
      }
    } catch (e) {
      skipped.push({ name: t.name, why: `${format} (${source}): ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const file = `${t.name}.${outExt}`;
    files[file] = bytes;
    const txi = await resman.get(t.name, "txi");
    if (txi) files[`${t.name}.txi`] = txi;
    const before = decodeTexture(stock, ext);
    textures.push({
      name: t.name,
      group: t.group,
      action: t.action === "redraw" ? "redrawn" : "recoloured",
      file,
      source,
      format,
      output: formatOf(bytes, outExt),
      bytes: bytes.length,
      ...(tgaBytes !== undefined ? { tgaBytes } : {}),
      ...(compression ? { compression } : {}),
      size: [before.width, before.height],
      txi: !!txi,
      ...(t.protect ? { protected: t.protect } : {}),
      notes,
      validation,
    });
    if (o.previews) previews.push({ name: t.name, group: t.group, before, after: decodeTexture(bytes, outExt), ok: validation.ok });
  }
  const p = o.palette;
  return {
    files,
    previews,
    manifest: {
      tool: "nwn-nui-designer reskin",
      skin: o.skin,
      palette: {
        ink: hex(p.ink),
        raised: hex(p.raised),
        button: hex(p.button),
        activeLo: hex(p.activeLo),
        active: hex(p.active),
        accent: hex(p.accent),
        glow: hex(p.glow),
        glowHi: hex(p.glowHi),
        mark: hex(p.mark),
        text: hex(p.text),
        bodyAlpha: String(p.bodyAlpha),
      },
      alpha: o.alpha,
      outputFormat: outFormat,
      textures,
      skipped,
      manual: await Promise.all(MANUAL.map(async (m) => ({ ...m, found: !!(await resman.getAny(m.name, TEXTURE_EXTS)) }))),
    },
  };
}

/** The manual list and any problems as Markdown, for a person to work through. */
export function reportMarkdown(m: Manifest): string {
  const out: string[] = [];
  out.push(`# Reskin report: ${m.skin.title}`, "");
  const bad = m.textures.filter((t) => !t.validation.ok);
  out.push(`${m.textures.length} textures written (${m.textures.filter((t) => t.action === "recoloured").length} recoloured, ${m.textures.filter((t) => t.action === "redrawn").length} redrawn); ${bad.length} failed a check; ${m.skipped.length} skipped. Alpha: ${m.alpha}.`, "");
  out.push(...formatSummary(m));
  if (bad.length) {
    out.push("## Failed checks (look at these in the contact sheet before shipping)", "");
    for (const t of bad) out.push(`- \`${t.name}\`: ${t.validation.problems.join("; ")}`);
    out.push("");
  }
  if (m.skipped.length) {
    out.push("## Skipped", "");
    for (const s of m.skipped) out.push(`- \`${s.name}\`: ${s.why}`);
    out.push("");
  }
  out.push("## Left to a person", "", "Textures the client uses that the reskin does not change. Decide for each: keep it, recolour it by hand, or draw new art at the same size (keep the name, the format family and the .txi).", "");
  const byClass = new Map<string, (ManualTexture & { found: boolean })[]>();
  for (const t of m.manual) byClass.set(`${t.class}|${t.why}`, [...(byClass.get(`${t.class}|${t.why}`) ?? []), t]);
  for (const list of byClass.values()) {
    out.push(`### ${list[0]!.class} (${list.length})`, "", `${list[0]!.why}.`, "");
    out.push(list.map((t) => `\`${t.name}\`${t.found ? "" : " (not found)"}`).join(", "), "");
  }
  out.push("## Not in any texture", "", "Text colours and fonts (`.gui` files, the client's code and `fnt_default*` TTFs), panel geometry and layout (the models and `.gui` files), selection tints and the radial's dimming, portraits and item and spell icons.", "");
  return out.join("\n");
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** report.md's "Formats" section: what was written as DDS and TGA, the sizes, and the TGAs kept and why. */
function formatSummary(m: Manifest): string[] {
  const out: string[] = ["## Formats", ""];
  const stockDds = m.textures.filter((t) => t.format.startsWith("dds"));
  const fromTga = m.textures.filter((t) => t.format.startsWith("tga"));
  const compressed = fromTga.filter((t) => t.output.startsWith("dds"));
  const kept = fromTga.filter((t) => t.output.startsWith("tga"));
  const total = m.textures.reduce((s, t) => s + t.bytes, 0);
  const asTga = m.textures.reduce((s, t) => s + (t.tgaBytes ?? t.bytes), 0);
  out.push(
    `\`--format ${m.outputFormat}\`. ${stockDds.length} textures are DDS in the game and stay DDS; of the ${fromTga.length} stock TGAs, ${compressed.length} were compressed to DDS and ${kept.length} stay TGA. Textures: ${mb(total)}${m.outputFormat === "tga" ? "" : ` (all TGAs kept as TGA: ${mb(asTga)})`}.`,
    "",
  );
  if (m.outputFormat !== "tga" && fromTga.length) {
    out.push(
      "Error of each compressed TGA (0-255, scaled by alpha): mean over every texel, mean over edge texels (rules, lines, text), worst alpha. `auto` keeps a TGA whose DDS has a mean above 4, an edge mean above 12, an alpha error above 16, or a moved alpha 0 or 255.",
      "",
      "| Texture | Written | Mean | Edge | Alpha | Size | As TGA | Why TGA |",
      "|---|---|---|---|---|---|---|---|",
    );
    const rows = [...fromTga].sort((a, b) => (b.compression?.edgeMean ?? 0) - (a.compression?.edgeMean ?? 0));
    for (const t of rows) {
      const c = t.compression;
      if (!c) continue;
      out.push(`| \`${t.name}\` | ${t.output} | ${c.mean.toFixed(1)} | ${c.edgeMean.toFixed(1)} | ${c.alphaMax} | ${kb(t.bytes)} | ${kb(t.tgaBytes ?? t.bytes)} | ${c.kept ?? ""} |`);
    }
    out.push("");
  }
  return out;
}

/** The output files as a hak (sorted by name), to load in a module's hak list. */
export function reskinHak(files: Record<string, Uint8Array>, title: string, date: Date): Uint8Array {
  const entries = Object.entries(files)
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([n, data]) => ({ resref: n.slice(0, n.lastIndexOf(".")), type: n.slice(n.lastIndexOf(".") + 1), data }));
  return writeErf(entries, { fileType: "HAK", description: `Original GUI reskin: ${title}. Made by nwn-nui-designer's pnpm reskin from the game's own textures.`, date });
}
