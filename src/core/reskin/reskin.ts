/**
 * "Reskin everything": the original (MDL-panel) GUI's textures redrawn in a designer skin's colours, so one theme
 * covers the NUI windows and the old ones alike. Reads each stock texture the way the client finds it (the first layer
 * that has the name, a DDS before a TGA within a layer), redraws its chrome (src/core/oldgui/draw) or recolours a flat
 * cell or an icon's ground, in the same format at the same size, checks the result, compresses a TGA to DDS where that
 * is good enough (--format, compress.ts), and returns the files under the stock names with a manifest. No file is
 * written here (src/node/reskin.ts does that), and no game art is part of this code: it all comes from the user's own
 * install.
 */
import { type UvEntry, cellsFor } from "../oldgui/cells.js";
import { lightFills } from "../oldgui/checks.js";
import { flatFailures } from "../oldgui/runchecks.js";
import { collectOldGui } from "../oldgui/collect.js";
import { FACE_WEIGHT, faceWeights, oldGuiStyle, recolourIconGround, redrawOldGui, warm565Image } from "../oldgui/draw/index.js";
import { decodeGuiTexture } from "../oldgui/texture.js";
import { readTxi } from "../oldgui/txi.js";
import { writeErf } from "../res/erfwrite.js";
import type { RGBAImage } from "../res/image.js";
import type { ResMan } from "../res/resman.js";
import { decodeTga } from "../res/tga.js";
import { encodeTga24, encodeTga32 } from "../res/tgawrite.js";
import { biowareLevels, encodeBiowareDds, readBiowareHeader } from "./bc.js";
import { type Compressed, type CompressionError, type OutputFormat, compressToDds, hasAlpha, keepTgaReason } from "./compress.js";
import { type AlphaMode, alphaCurve, frameColour, swatchColour } from "./colour.js";
import { type ReskinPalette, hex } from "./palette.js";
import { mapPicture, retoneDds, retoneTga, tgaInfo } from "./retone.js";
import { AUTO, type AutoTexture, type Group, MANUAL, type ManualTexture } from "./textures.js";
import { type Validation, decodeTexture, meanDiff, validateTexture } from "./validate.js";

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
  /** Every UV rectangle the old GUI's models sample, by texture (collectOldGui's uv; read from resman when not given). */
  uv?: Map<string, UvEntry[]>;
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

/** A redrawn picture in the stock file's format: a DDS stays a DDS (DXT5 once it has alpha) with the stock's number of
 * mip levels, dark colours snapped to exact 5:6:5 values; a TGA becomes a DDS unless --format tga or auto finds the
 * DDS too far off (24-bit when opaque, as the stock's). */
function encodeRedraw(drawn: RGBAImage, stock: Uint8Array, ext: string, fmt: OutputFormat, mipmap = true, flat?: FlatTest): { bytes: Uint8Array; ext: string; compression?: ManifestEntry["compression"]; tgaBytes?: number; note?: string } {
  const alpha = hasAlpha(drawn);
  const snapped = warm565Image(drawn);
  const weights = faceWeights(snapped);
  const tga = () => (alpha ? encodeTga32(drawn) : encodeTga24(drawn));
  if (ext === "dds") {
    const bpp = alpha ? 4 : (readBiowareHeader(stock)?.bpp ?? 3);
    // as many mip levels as the stock file has
    const fit = flatFit((w) => encodeBiowareDds(snapped, bpp === 4 ? 4 : 3, w, biowareLevels(stock)), weights, fmt === "dds" ? undefined : flat, drawn);
    if (!fit.broken) return { bytes: fit.bytes, ext: "dds" };
    const t = tga();
    return { bytes: t, ext: "tga", tgaBytes: t.length, note: `kept as TGA: ${fit.broken}` };
  }
  const t = tga();
  if (fmt === "tga") return { bytes: t, ext: "tga" };
  // a texture whose txi says mipmap 0 is drawn from its base level at every size
  let c!: Compressed;
  const { broken } = flatFit((w) => (c = compressToDds(snapped, w, mipmap ? Infinity : 1)).bytes, weights, fmt === "auto" ? flat : undefined, drawn);
  const shift = faceShift(snapped, c.decoded, weights);
  const kept = [keepTgaReason(c.error), shift > FACE_SHIFT ? `a flat face moves ${shift} levels` : null, broken].filter(Boolean).join(", ") || null;
  if (fmt === "dds" || !kept) return { bytes: c.bytes, ext: "dds", compression: c.error, tgaBytes: t.length };
  return { bytes: t, ext: "tga", compression: { ...c.error, kept }, tgaBytes: t.length };
}

/** Face weights to try in turn when a DXT fit breaks a flat face: the local search lands differently on each. */
const FLAT_RETRY = [FACE_WEIGHT, FACE_WEIGHT * 4, 1];

/** Why a DDS fails the redraw's own check (decoded mean error above 6), or null. */
function drift(drawn: RGBAImage, dds: Uint8Array): string | null {
  const d = meanDiff(decodeGuiTexture(dds, "dds"), drawn);
  return d > 6 ? `the DDS differs from the drawing by ${d.toFixed(1)} on average` : null;
}

/** A DDS that passes the flatness check where the drawing does and stays close to it, trying FLAT_RETRY; broken says why none did. */
function flatFit(encode: (weights: Float64Array) => Uint8Array, weights: Float64Array, flat: FlatTest | undefined, drawn: RGBAImage): { bytes: Uint8Array; broken: string | null } {
  let first: { bytes: Uint8Array; broken: string | null } | null = null;
  for (const fw of flat ? FLAT_RETRY : [FACE_WEIGHT]) {
    const bytes = encode(fw === FACE_WEIGHT ? weights : weights.map((v) => (v === FACE_WEIGHT ? fw : 1)));
    const broken = flat ? (dxtBreaksFlat(flat, drawn, bytes) ?? drift(drawn, bytes)) : null;
    if (!broken) return { bytes, broken };
    first ??= { bytes, broken };
  }
  return first!;
}

/** The old-GUI flatness check on one texture: its failing findings. */
export type FlatTest = (img: RGBAImage) => string[];

/** Why auto keeps a TGA because the DDS fails the flatness check where the TGA passes it (null: it does not). */
export function dxtBreaksFlat(flat: FlatTest, tga: RGBAImage, dds: Uint8Array): string | null {
  const after = flat(decodeGuiTexture(dds, "dds"));
  if (!after.length) return null;
  // a fault keyed by its box and kind: one the TGA has too is not the DDS's doing
  const key = (m: string) => m.split(":").slice(0, 2).join(":");
  const before = new Set(flat(tga).map(key));
  const added = after.filter((m) => !before.has(key(m)));
  if (!added.length) return null;
  return `DXT breaks the flatness check: ${added[0]!.replace(/ \[.*\]$/, "")}${added.length > 1 ? ` (+${added.length - 1})` : ""}`;
}

/** How far DXT may move a redrawn face (0-255, any channel) before auto keeps a stock TGA as TGA. */
export const FACE_SHIFT = 4;

/** The largest change of a face texel (weighted FACE_WEIGHT) between the drawing and the decoded file. */
function faceShift(drawn: RGBAImage, decoded: RGBAImage, weights: Float64Array): number {
  let worst = 0;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] !== FACE_WEIGHT || drawn.data[i * 4 + 3] === 0) continue;
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(drawn.data[i * 4 + k]! - decoded.data[i * 4 + k]!));
  }
  return worst;
}

/** A redraw's checks: the stock size, the file decodes to the drawing (mean error at most 6), the right way up, and
 * no texel's alpha 0 moved by the encoding. */
function redrawValidation(stock: RGBAImage, drawn: RGBAImage, decoded: RGBAImage): Validation {
  const problems: string[] = [];
  const sizeSame = stock.width === decoded.width && stock.height === decoded.height;
  if (!sizeSame) problems.push(`size ${decoded.width} x ${decoded.height}, stock ${stock.width} x ${stock.height}`);
  const d = sizeSame ? meanDiff(decoded, drawn) : 0;
  const f = sizeSame ? meanDiff(decoded, drawn, true) : 0;
  let moved = false;
  for (let i = 3; i < drawn.data.length && sizeSame; i += 4) if ((drawn.data[i] === 0) !== (decoded.data[i] === 0)) moved = true;
  if (d > 6) problems.push(`decoded file differs from the drawing by ${d.toFixed(1)} on average`);
  if (f + 0.5 < d) problems.push("the decoded file matches the drawing upside down: rows stored the wrong way");
  if (moved) problems.push("the encoding moved alpha 0 (a cut-out or transparent cell)");
  return { ok: !problems.length, problems, sizeSame, fileLengthSame: false, headerSame: false, alphaZeroKept: !moved, alphaMaxDiff: 0, lumaCorr: null, drawnMeanDiff: d, drawnFlippedMeanDiff: f };
}

export async function reskin(resman: ResMan, o: ReskinOptions): Promise<ReskinResult> {
  const files: Record<string, Uint8Array> = {};
  const textures: ManifestEntry[] = [];
  const skipped: Skipped[] = [];
  const previews: Preview[] = [];
  const curve = alphaCurve(o.alpha);
  const outFormat = o.format ?? "auto";
  const list: AutoTexture[] = o.only ? AUTO.filter((t) => o.only!.includes(t.name)) : AUTO;
  const style = oldGuiStyle(o.palette);
  const uv = o.uv ?? (list.some((t) => t.action === "redraw") || outFormat === "auto" ? (await collectOldGui(resman)).uv : new Map<string, UvEntry[]>());
  // auto writes a TGA where its DXT would fail the old-GUI flatness check
  const pal = { ink: o.palette.ink.slice(0, 3), allowed: lightFills(o.palette) };
  const flatTest = (name: string): FlatTest => (img) => flatFailures(name, img, cellsFor(uv.get(name) ?? [], img.width, img.height), pal);
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
      skipped.push({ name: t.name, why: `found as KTX (${source}): KTX is not handled, redraw it by hand or remove it` });
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
      if (t.action === "redraw" || t.group === "icon") {
        // chrome drawn again; an icon a tab carries keeps its art, its dark ground in the tabs' ink
        const before = decodeGuiTexture(stock, ext);
        drawn = t.action === "redraw" ? (redrawOldGui({ name: t.name, stock: before, uv: uv.get(t.name) ?? [], style, alpha: o.alpha === "opaque" ? curve : (a) => a }) ?? undefined) : recolourIconGround(before, style);
        if (!drawn) throw new Error("no redraw for it");
        const stockTxi = await resman.get(t.name, "txi");
        const w = encodeRedraw(drawn, stock, ext, outFormat, !stockTxi || readTxi(new TextDecoder("latin1").decode(stockTxi)).mipmap, flatTest(t.name));
        bytes = w.bytes;
        outExt = w.ext;
        compression = w.compression;
        tgaBytes = w.tgaBytes;
        if (w.note) notes.push(w.note);
        validation = redrawValidation(before, drawn, decodeGuiTexture(bytes, outExt));
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
          const r = retoneTga(stock, map);
          bytes = r.bytes;
          validation = validateTexture(stock, bytes, ext, { mapped: mapPicture(decodeTga(stock), map, null) });
          if (outFormat !== "tga") {
            tgaBytes = bytes.length;
            const c = compressToDds(decodeTga(bytes));
            let kept = keepTgaReason(c.error);
            if (outFormat === "auto" && !kept) kept = dxtBreaksFlat(flatTest(t.name), decodeGuiTexture(bytes, "tga"), c.bytes);
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
    const before = t.action === "redraw" || t.group === "icon" ? decodeGuiTexture(stock, ext) : decodeTexture(stock, ext);
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
      notes,
      validation,
    });
    const after = t.action === "redraw" || t.group === "icon" ? decodeGuiTexture(bytes, outExt) : decodeTexture(bytes, outExt);
    if (o.previews) previews.push({ name: t.name, group: t.group, before, after, ok: validation.ok });
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
