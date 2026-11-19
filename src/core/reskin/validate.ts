/**
 * Checks a reskinned texture against the stock one it replaces: the client must find the same kind of file at the
 * same size with the same alpha layout (UVs and cut-outs point into it), a DDS must still be stored bottom row first,
 * and a recolour must keep the picture's structure (its luminance follows the stock one).
 */
import { decodeDds } from "../res/dds.js";
import { type RGBAImage, newImage } from "../res/image.js";
import { decodeTga } from "../res/tga.js";
import { readBiowareHeader } from "./bc.js";
import { tgaInfo } from "./retone.js";

export interface Validation {
  ok: boolean;
  problems: string[];
  sizeSame: boolean;
  fileLengthSame: boolean;
  headerSame: boolean;
  alphaZeroKept: boolean;
  /** Worst alpha difference against the expected alpha (stock through the curve), 0-255. */
  alphaMaxDiff: number;
  /** Luminance correlation stock vs new (recolours), or null where the stock is flat. A light skin inverts it on
   * purpose (dark stock fields become light paper): with ValidateOptions.mapped, layout and orientation are judged on
   * mappedCorr instead. */
  lumaCorr: number | null;
  /** With ValidateOptions.mapped: luminance correlation of the intended picture (the stock one mapped) vs new. */
  mappedCorr?: number | null;
  /** Recolours: the new picture follows the stock one better upside down (rows stored the wrong way). */
  upsideDown?: boolean;
  /** Recolours: the stock picture's visible edges and how many the recolour lost (see edgeContrast). */
  edges?: EdgeContrast;
  /** With ValidateOptions.mapped: the same, judged on the file as decoded (DXT blocks of 4 colours can merge a dark
   * step next to a bright one). Reported, not failed: the stock file has the same blocks. */
  edgesAfterDxt?: EdgeContrast;
  /** Redraws: mean difference (0-255) of the decoded file against the drawing, and against the drawing upside down. */
  drawnMeanDiff?: number;
  drawnFlippedMeanDiff?: number;
}

export const decodeTexture = (bytes: Uint8Array, ext: string): RGBAImage => (ext === "dds" ? decodeDds(bytes) : decodeTga(bytes));

function luma(im: RGBAImage): Float64Array {
  const out = new Float64Array(im.width * im.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * im.data[i * 4]! + 0.587 * im.data[i * 4 + 1]! + 0.114 * im.data[i * 4 + 2]!;
  return out;
}

/** Pearson correlation over texels with alpha > 0 in a (or every texel when a has no alpha). null when flat. */
function correlation(a: Float64Array, b: Float64Array, mask: Uint8Array | null): number | null {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    if (mask && !mask[i]) continue;
    n++;
    sa += a[i]!;
    sb += b[i]!;
  }
  if (n < 2) return null;
  const ma = sa / n;
  const mb = sb / n;
  let cab = 0;
  let caa = 0;
  let cbb = 0;
  for (let i = 0; i < a.length; i++) {
    if (mask && !mask[i]) continue;
    cab += (a[i]! - ma) * (b[i]! - mb);
    caa += (a[i]! - ma) ** 2;
    cbb += (b[i]! - mb) ** 2;
  }
  if (caa / n < 4 || cbb / n < 1) return null; // flat: a correlation says nothing
  return cab / Math.sqrt(caa * cbb);
}

function flipRowsCopy(im: RGBAImage): RGBAImage {
  const out = newImage(im.width, im.height);
  const stride = im.width * 4;
  for (let y = 0; y < im.height; y++) out.data.set(im.data.subarray(y * stride, (y + 1) * stride), (im.height - 1 - y) * stride);
  return out;
}

export function meanDiff(a: RGBAImage, b: RGBAImage, flipB = false): number {
  let s = 0;
  for (let y = 0; y < a.height; y++) {
    const by = flipB ? b.height - 1 - y : y;
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const j = (by * b.width + x) * 4;
      for (let k = 0; k < 4; k++) s += Math.abs(a.data[i + k]! - b.data[j + k]!);
    }
  }
  return s / (a.width * a.height * 4);
}

/** The backgrounds an edge is judged over: black and a mid-dark world (the scenes the GUI is drawn over). */
const BACKGROUNDS = [0, 80];
/** A stock edge: neighbouring texels whose luminance over one of BACKGROUNDS differs by at least this. */
export const EDGE_MIN = 24;
/** Lost: over every background where the stock texels make an edge, the new ones differ by less than this (0-255, the
 * largest channel difference: a hue edge such as green against brass stays visible at one luminance). */
export const EDGE_LOST = 6;
/** A strong stock edge: a rule against a dark field (one side at most EDGE_DARK, the other this much lighter; the
 * stock rules are #636563 on black, 99 apart). Losing any one fails the texture. A light highlight against its gold
 * rule is not one: the recolour maps both into the brass range on purpose. */
export const EDGE_STRONG = 80;
export const EDGE_DARK = 40;
/** A recolour fails when more than this share of the stock edges is lost. */
export const EDGE_LOST_SHARE = 0.25;

export interface EdgeContrast {
  /** Kinds of stock edge: distinct pairs of stock texel values that meet as 4-neighbours (see EDGE_MIN). */
  edges: number;
  /** Kinds lost somewhere (one place where the pair is flattened loses the kind: a swatch cell is the same everywhere). */
  lost: number;
  /** Lost kinds that were strong edges (EDGE_STRONG), as "stock RGBA | stock RGBA". */
  strongLost: string[];
}

function composite(im: RGBAImage, i: number, bg: number): number {
  const d = im.data;
  const a = d[i * 4 + 3]! / 255;
  return (0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!) * a + bg * (1 - a);
}

/** The largest channel difference of two texels, each over a background. */
function channelDiff(im: RGBAImage, i: number, j: number, bg: number): number {
  const d = im.data;
  const ai = d[i * 4 + 3]! / 255;
  const aj = d[j * 4 + 3]! / 255;
  let m = 0;
  for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(d[i * 4 + k]! * ai + bg * (1 - ai) - (d[j * 4 + k]! * aj + bg * (1 - aj))));
  return m;
}

/**
 * The stock picture's edges (rules, dividers, bevel steps, cell borders) as they show over a background, and how
 * many of them the new picture flattens. Counted by kind (the pair of stock values on each side), so a rule a few
 * texels wide in a swatch strip weighs as much as a large field. A recolour may compress contrast (a dark skin's
 * panels are darker than the stock grey ones) but must keep an edge visible: Bronze's first reskin mapped the
 * character record's rules and its fill to the same near-black and passed every other check (same layout, alpha 0
 * kept, luminance correlated).
 */
export function edgeContrast(a: RGBAImage, b: RGBAImage): EdgeContrast {
  const kinds = new Map<string, { lost: boolean; strong: boolean }>();
  const { width: w, height: h } = a;
  const ca = BACKGROUNDS.map((bg) => Float64Array.from({ length: w * h }, (_, i) => composite(a, i, bg)));
  const view = new DataView(a.data.buffer, a.data.byteOffset, a.data.byteLength);
  const pair = (i: number, j: number) => {
    const ai = a.data[i * 4 + 3]!;
    const aj = a.data[j * 4 + 3]!;
    if (ai === 0 && aj === 0) return;
    // the same colour at two partial alphas (an anti-aliased rim, two fill densities): an opaque skin's alpha curve
    // merges these on purpose
    if (ai < 255 && aj < 255 && ai > 0 && aj > 0 && a.data[i * 4] === a.data[j * 4] && a.data[i * 4 + 1] === a.data[j * 4 + 1] && a.data[i * 4 + 2] === a.data[j * 4 + 2]) return;
    const over = ca.map((c) => Math.abs(c[i]! - c[j]!) >= EDGE_MIN);
    if (!over.includes(true)) return;
    const vi = view.getUint32(i * 4);
    const vj = view.getUint32(j * 4);
    const key = vi < vj ? `${vi},${vj}` : `${vj},${vi}`;
    // over every background where it was an edge (one world colour that happens to match the new texel is no loss)
    const lost = BACKGROUNDS.every((bg, k) => !over[k] || channelDiff(b, i, j, bg) < EDGE_LOST);
    const strong = ca.some((c) => Math.min(c[i]!, c[j]!) <= EDGE_DARK && Math.abs(c[i]! - c[j]!) >= EDGE_STRONG);
    const was = kinds.get(key);
    kinds.set(key, { lost: (was?.lost ?? false) || lost, strong: (was?.strong ?? false) || strong });
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x + 1 < w) pair(i, i + 1);
      if (y + 1 < h) pair(i, i + w);
    }
  }
  let lost = 0;
  const strongLost: string[] = [];
  const rgba = (v: number) => (v >>> 0).toString(16).padStart(8, "0");
  for (const [k, v] of kinds) {
    if (!v.lost) continue;
    lost++;
    if (v.strong) strongLost.push(k.split(",").map((x) => `#${rgba(Number(x)).toUpperCase()}`).join(" | "));
  }
  return { edges: kinds.size, lost, strongLost };
}

export interface ValidateOptions {
  /** The expected alpha of a stock alpha (identity when alpha is kept). */
  alpha?: (a: number) => number;
  /** Allowed alpha error (DXT5 alpha blocks hold 6-8 levels: a bent curve can't always keep every one). */
  alphaTolerance?: number;
  /** For a redraw: the picture drawn (top-down RGBA); checked against the decoded file, upside down too. */
  drawn?: RGBAImage;
  /** Lowest luminance correlation accepted for a recolour (default 0.8). */
  minCorr?: number;
  /** A recolour's intended picture: the stock one mapped texel by texel, before DXT encoding. The file must follow it
   * the right way up (layout and orientation; a light skin's file follows the stock picture inverted, which is meant);
   * the edge check judges it (the recolour's own fault); what the DXT blocks flatten on top is reported in
   * edgesAfterDxt. */
  mapped?: RGBAImage;
}

export function validateTexture(stock: Uint8Array, out: Uint8Array, ext: string, o: ValidateOptions = {}): Validation {
  const problems: string[] = [];
  const v: Validation = { ok: false, problems, sizeSame: false, fileLengthSame: stock.length === out.length, headerSame: false, alphaZeroKept: false, alphaMaxDiff: 0, lumaCorr: null };
  if (!v.fileLengthSame) problems.push(`file length ${out.length}, stock ${stock.length}`);
  if (ext === "dds") {
    const hs = readBiowareHeader(stock);
    const ho = readBiowareHeader(out);
    v.headerSame = !!hs && !!ho && hs.width === ho.width && hs.height === ho.height && hs.bpp === ho.bpp && hs.size0 === ho.size0;
  } else {
    const ts = tgaInfo(stock);
    v.headerSame = !!ts && stock.subarray(0, ts.pixelOffset).every((b, i) => b === out[i]);
  }
  if (!v.headerSame) problems.push("header differs from the stock file's (size, format or layout)");
  let a: RGBAImage;
  let b: RGBAImage;
  try {
    a = decodeTexture(stock, ext);
    b = decodeTexture(out, ext);
  } catch (e) {
    problems.push(`cannot decode: ${e instanceof Error ? e.message : String(e)}`);
    return v;
  }
  v.sizeSame = a.width === b.width && a.height === b.height;
  if (!v.sizeSame) {
    problems.push(`size ${b.width} x ${b.height}, stock ${a.width} x ${a.height}`);
    return v;
  }
  const curve = o.alpha ?? ((x: number) => x);
  let zeroKept = true;
  let worst = 0;
  const mask = new Uint8Array(a.width * a.height);
  for (let i = 0; i < mask.length; i++) {
    const sa = a.data[i * 4 + 3]!;
    const na = b.data[i * 4 + 3]!;
    if ((sa === 0) !== (na === 0)) zeroKept = false;
    worst = Math.max(worst, Math.abs(na - curve(sa)));
    mask[i] = sa > 0 ? 1 : 0;
  }
  v.alphaZeroKept = zeroKept;
  v.alphaMaxDiff = worst;
  if (!o.drawn) {
    if (!zeroKept) problems.push("alpha 0 moved: a cut-out or transparent cell is not where the stock one is");
    if (worst > (o.alphaTolerance ?? 0)) problems.push(`alpha differs by up to ${worst} from the stock alpha${o.alpha ? " through the curve" : ""}`);
    v.lumaCorr = correlation(luma(a), luma(b), mask);
    // the picture the file must follow: the stock one, or the stock one mapped (a light skin inverts the luminance)
    const ref = o.mapped ? luma(o.mapped) : luma(a);
    const follows = o.mapped ? correlation(ref, luma(b), mask) : v.lumaCorr;
    if (o.mapped) v.mappedCorr = follows;
    const what = o.mapped ? "the stock picture mapped" : "the stock picture";
    // row order: the decoded file must follow it the right way up (a TGA written with the wrong origin bit, or a DDS
    // stored top row first, follows it upside down)
    const flipped = correlation(ref, luma(flipRowsCopy(b)), mask);
    v.upsideDown = flipped !== null && follows !== null && flipped > follows + 0.05;
    if (v.upsideDown) problems.push(`the picture follows ${what} upside down (correlation ${flipped!.toFixed(3)} flipped, ${follows!.toFixed(3)} as is): rows stored the wrong way`);
    if (follows !== null && follows < (o.minCorr ?? 0.8)) problems.push(`luminance correlation with ${what} is ${follows.toFixed(3)}: layout or orientation moved?`);
    v.edges = edgeContrast(a, o.mapped ?? b);
    if (o.mapped) v.edgesAfterDxt = edgeContrast(a, b);
    if (v.edges.edges && v.edges.lost / v.edges.edges > EDGE_LOST_SHARE) {
      problems.push(`${v.edges.lost} of the stock picture's ${v.edges.edges} kinds of edge (rules, dividers, bevels) are flattened: the colours on each side map to nearly the same`);
    }
    if (v.edges.strongLost.length) {
      problems.push(`strong edges flattened (a rule or divider would vanish): ${v.edges.strongLost.slice(0, 4).join("; ")}${v.edges.strongLost.length > 4 ? ` and ${v.edges.strongLost.length - 4} more` : ""}`);
    }
  } else {
    v.drawnMeanDiff = meanDiff(b, o.drawn);
    v.drawnFlippedMeanDiff = meanDiff(b, o.drawn, true);
    if (v.drawnMeanDiff > 12) problems.push(`decoded file differs from the drawing by ${v.drawnMeanDiff.toFixed(1)} on average`);
    if (v.drawnFlippedMeanDiff + 0.5 < v.drawnMeanDiff) problems.push("the decoded file matches the drawing upside down: DDS rows stored the wrong way");
  }
  v.ok = problems.length === 0;
  return v;
}
