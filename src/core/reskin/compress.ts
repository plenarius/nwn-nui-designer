/**
 * Compressing the reskin's TGA output to BioWare DDS (DXT1 when the picture is opaque, DXT5 when it has alpha), and
 * the error measure that decides, per texture, whether the compressed file is good enough to ship in its place.
 *
 * The original GUI's frames are mostly 24-bit TGAs (a 512 x 512 panel is 768 KB); as DXT1 with its mip chain the same
 * panel is 171 KB. DXT keeps 2 colours a 4 x 4 block (and 2 between them), so smooth fields survive almost exactly
 * and hard 1 px lines and tiny pixel art suffer first. The measure looks at exactly those:
 *
 * - mean: the mean error over every texel (the largest channel difference, 0-255, scaled by the texel's alpha, so a
 *   colour under alpha 0 counts for nothing);
 * - edgeMean: the same mean over edge texels only (a texel whose luminance differs from a 4-neighbour's by 48 or
 *   more: rules, frame lines, text), where DXT artefacts show;
 * - alphaMax: the largest alpha difference, and whether alpha 0 and 255 stayed exactly 0 and 255 (cut-outs);
 * - strongEdgesLost: rules against a dark field that the DXT blocks flatten (validate.ts, edgeContrast).
 *
 * The client prefers a DDS to a TGA of the same name in the same location, so a texture is shipped in one format
 * only, never both.
 */
import { decodeDds } from "../res/dds.js";
import type { RGBAImage } from "../res/image.js";
import { encodeBiowareDds } from "./bc.js";
import { edgeContrast } from "./validate.js";

/** --format: dds compresses every TGA, tga keeps every TGA (DDS stays DDS either way), auto decides by the error. */
export type OutputFormat = "auto" | "dds" | "tga";

export interface CompressionError {
  /** The DXT kind the TGA was compressed to. */
  format: "dxt1" | "dxt5";
  mean: number;
  max: number;
  edgeMean: number;
  edgeTexels: number;
  alphaMax: number;
  /** Alpha 0 stayed 0, nothing else became 0, and 255 stayed 255 (no cut-out moved, no solid part thinned). */
  alphaEndsKept: boolean;
  /** The decoded DDS matches the picture upside down better than the right way up: rows stored the wrong way. */
  flipped: boolean;
  /** Strong edges (a rule against a dark field) of the picture that the DDS flattens. */
  strongEdgesLost: number;
}

/**
 * auto keeps a TGA when its DDS is worse than this. Measured on the stock GUI's frames retoned to Ink and to Bronze:
 * the panels and buttons come out at a mean of 1-3 and an edge mean of 4-9 (artefacts not visible at 1:1); a 4 x 4
 * swatch of 16 different colours (gui_rgbc) at 70-110, a 16 x 16 checkbox at 9.
 */
export const AUTO_LIMITS = { mean: 4, edgeMean: 12, alphaMax: 16 } as const;

const EDGE_STEP = 48;

/** The error of a decoded DDS (rows top to bottom) against the picture it was made from. */
export function compressionError(src: RGBAImage, dec: RGBAImage, format: "dxt1" | "dxt5"): CompressionError {
  const { width: w, height: h } = src;
  if (dec.width !== w || dec.height !== h) throw new Error(`decoded DDS is ${dec.width} x ${dec.height}, the picture ${w} x ${h}`);
  const s = src.data;
  const d = dec.data;
  const luma = new Float64Array(w * h);
  for (let i = 0; i < luma.length; i++) luma[i] = ((0.299 * s[i * 4]! + 0.587 * s[i * 4 + 1]! + 0.114 * s[i * 4 + 2]!) * s[i * 4 + 3]!) / 255;
  let sum = 0;
  let max = 0;
  let edgeSum = 0;
  let edgeN = 0;
  let alphaMax = 0;
  let ends = true;
  let straight = 0;
  let upside = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      const a = s[p + 3]!;
      let e = 0;
      for (let k = 0; k < 3; k++) e = Math.max(e, Math.abs(s[p + k]! - d[p + k]!));
      e = (e * a) / 255;
      sum += e;
      if (e > max) max = e;
      const da = d[p + 3]!;
      alphaMax = Math.max(alphaMax, Math.abs(a - da));
      if ((a === 0) !== (da === 0) || (a === 255 && da !== 255)) ends = false;
      const l = luma[i]!;
      if (
        (x > 0 && Math.abs(luma[i - 1]! - l) >= EDGE_STEP) ||
        (x < w - 1 && Math.abs(luma[i + 1]! - l) >= EDGE_STEP) ||
        (y > 0 && Math.abs(luma[i - w]! - l) >= EDGE_STEP) ||
        (y < h - 1 && Math.abs(luma[i + w]! - l) >= EDGE_STEP)
      ) {
        edgeSum += e;
        edgeN++;
      }
      const f = ((h - 1 - y) * w + x) * 4;
      for (let k = 0; k < 4; k++) {
        straight += Math.abs(s[p + k]! - d[p + k]!);
        upside += Math.abs(s[p + k]! - d[f + k]!);
      }
    }
  }
  const n = w * h;
  return {
    format,
    mean: sum / n,
    max,
    edgeMean: edgeN ? edgeSum / edgeN : 0,
    edgeTexels: edgeN,
    alphaMax,
    alphaEndsKept: ends,
    flipped: upside / n + 0.5 < straight / n,
    strongEdgesLost: edgeContrast(src, dec).strongLost.length,
  };
}

/** Why auto keeps the TGA (null: the DDS is good enough). */
export function keepTgaReason(e: CompressionError): string | null {
  if (e.flipped) return "the DDS decodes upside down";
  if (!e.alphaEndsKept) return "alpha 0 or 255 moved (a cut-out would change)";
  if (e.strongEdgesLost) return `DXT flattens ${e.strongEdgesLost} rule(s) against a dark field`;
  const why: string[] = [];
  if (e.alphaMax > AUTO_LIMITS.alphaMax) why.push(`alpha error ${e.alphaMax} > ${AUTO_LIMITS.alphaMax}`);
  if (e.mean > AUTO_LIMITS.mean) why.push(`mean error ${e.mean.toFixed(1)} > ${AUTO_LIMITS.mean}`);
  if (e.edgeMean > AUTO_LIMITS.edgeMean) why.push(`edge error ${e.edgeMean.toFixed(1)} > ${AUTO_LIMITS.edgeMean}`);
  return why.length ? why.join(", ") : null;
}

/** True when any texel is not fully opaque (the DDS must then be DXT5). */
export function hasAlpha(im: RGBAImage): boolean {
  for (let i = 3; i < im.data.length; i += 4) if (im.data[i] !== 255) return true;
  return false;
}

export interface Compressed {
  bytes: Uint8Array;
  error: CompressionError;
  /** The DDS decoded (rows top to bottom), as the client will show it. */
  decoded: RGBAImage;
}

/** A picture (rows top to bottom) as a BioWare DDS with every mip level, and its error. */
export function compressToDds(im: RGBAImage): Compressed {
  const dxt5 = hasAlpha(im);
  const bytes = encodeBiowareDds(im, dxt5 ? 4 : 3);
  const decoded = decodeDds(bytes);
  return { bytes, decoded, error: compressionError(im, decoded, dxt5 ? "dxt5" : "dxt1") };
}
