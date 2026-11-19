/**
 * The few Pillow drawing operations the skin generator uses, reproduced so the TypeScript generator makes the same
 * pixels as the Python generator did (tools/open-skin/draw.py at e38d1ca, Pillow 13.0): ImageDraw on an RGBA image (lines, wide lines, polygons, ellipses,
 * chords, pie slices, rectangles, rounded rectangles; ink replaces pixels, as ImageDraw does on RGBA), paste with an
 * L mask, the RGBA to LA to RGBA grey conversion and the 90 degree rotation.
 *
 * Written from Pillow's algorithms (libImaging/Draw.c, Paste.c, Convert.c, Geometry.c and PIL/ImageDraw.py; Pillow
 * is MIT-CMU), including its float32 arithmetic and rounding, so the scan lines land on the same pixels. No Pillow code
 * is copied verbatim. PROVENANCE.md lists it.
 */
import { type RGBAImage, newImage } from "../../res/image.js";

export type Ink = readonly [number, number, number, number];
export type Pt = readonly [number, number];

const f32 = Math.fround;
/** C's roundf / lround: halves away from zero. */
const roundAway = (v: number) => (v >= 0 ? Math.floor(v + 0.5) : -Math.floor(-v + 0.5));
/** Draw.c's ROUND_UP on a float (f + 0.5F is a float sum). */
const roundUpF = (f: number) => (f >= 0 ? Math.floor(f32(f + 0.5)) : -Math.floor(f32(Math.abs(f) + 0.5)));
const roundDownF = (f: number) => (f >= 0 ? Math.ceil(f32(f - 0.5)) : -Math.ceil(f32(Math.abs(f) - 0.5)));
/** ROUND_UP / ROUND_DOWN on a double. */
const roundUpD = (f: number) => (f >= 0 ? Math.floor(f + 0.5) : -Math.floor(Math.abs(f) + 0.5));
const roundDownD = (f: number) => (f >= 0 ? Math.ceil(f - 0.5) : -Math.ceil(Math.abs(f) - 0.5));

// --- pixels -------------------------------------------------------------------------------------------------------

function point(im: RGBAImage, x: number, y: number, ink: Ink): void {
  if (x >= 0 && x < im.width && y >= 0 && y < im.height) {
    const i = (y * im.width + x) * 4;
    im.data[i] = ink[0];
    im.data[i + 1] = ink[1];
    im.data[i + 2] = ink[2];
    im.data[i + 3] = ink[3];
  }
}

function hline(im: RGBAImage, x0: number, y0: number, x1: number, ink: Ink): void {
  if (y0 < 0 || y0 >= im.height) return;
  if (x0 < 0) x0 = 0;
  else if (x0 >= im.width) return;
  if (x1 < 0) return;
  if (x1 >= im.width) x1 = im.width - 1;
  for (let x = x0; x <= x1; x++) {
    const i = (y0 * im.width + x) * 4;
    im.data[i] = ink[0];
    im.data[i + 1] = ink[1];
    im.data[i + 2] = ink[2];
    im.data[i + 3] = ink[3];
  }
}

/** Draw.c line(): Bresenham, the end point excluded. */
function line(im: RGBAImage, x0: number, y0: number, x1: number, y1: number, ink: Ink): void {
  let dy = y1 - y0;
  let ys: number;
  if (dy < 0) {
    dy = -dy;
    ys = -1;
  } else if (dy === 0) {
    if (x1 > x0) hline(im, x0, y0, x1 - 1, ink);
    else if (x0 > x1) hline(im, x1 + 1, y0, x0, ink);
    return;
  } else ys = 1;
  let dx = x1 - x0;
  let xs: number;
  if (dx < 0) {
    dx = -dx;
    xs = -1;
  } else xs = 1;
  if (dx === 0) {
    for (let i = 0; i < dy; i++) {
      point(im, x0, y0, ink);
      y0 += ys;
    }
  } else if (dx > dy) {
    const n = dx;
    dy += dy;
    let e = dy - dx;
    dx += dx;
    for (let i = 0; i < n; i++) {
      point(im, x0, y0, ink);
      if (e >= 0) {
        y0 += ys;
        e -= dx;
      }
      e += dy;
      x0 += xs;
    }
  } else {
    const n = dy;
    dx += dx;
    let e = dx - dy;
    dy += dy;
    for (let i = 0; i < n; i++) {
      point(im, x0, y0, ink);
      if (e >= 0) {
        x0 += xs;
        e -= dy;
      }
      e += dx;
      y0 += ys;
    }
  }
}

// --- polygons -----------------------------------------------------------------------------------------------------

interface Edge {
  x0: number;
  y0: number;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  dx: number; // a float32
}

function edge(x0: number, y0: number, x1: number, y1: number): Edge {
  return {
    x0,
    y0,
    xmin: Math.min(x0, x1),
    xmax: Math.max(x0, x1),
    ymin: Math.min(y0, y1),
    ymax: Math.max(y0, y1),
    dx: y0 === y1 ? 0 : f32(f32(x1 - x0) / (y1 - y0)),
  };
}

const edgeX = (e: Edge, y: number) => f32(f32((y - e.y0) * e.dx) + e.x0);

/** Draw.c polygon_generic, for an image without blending (ImageDraw on RGBA replaces pixels). */
function polygonGeneric(im: RGBAImage, edges: Edge[], ink: Ink): void {
  if (!edges.length) return;
  let ymin = im.height - 1;
  let ymax = 0;
  const table: Edge[] = [];
  for (const e of edges) {
    if (ymin > e.ymin) ymin = e.ymin;
    if (ymax < e.ymax) ymax = e.ymax;
    if (e.ymin === e.ymax) {
      hline(im, e.xmin, e.ymin, e.xmax, ink);
      continue;
    }
    table.push(e);
  }
  if (ymin < 0) ymin = 0;
  if (ymax > im.height) ymax = im.height;
  for (; ymin <= ymax; ymin++) {
    const xx: number[] = [];
    for (let i = 0; i < table.length; i++) {
      const cur = table[i]!;
      if (ymin < cur.ymin || ymin > cur.ymax) continue;
      xx.push(edgeX(cur, ymin));
      if (ymin === cur.ymax && ymin < ymax) {
        xx.push(xx[xx.length - 1]!);
      } else if ((ymin === cur.ymin || ymin === cur.ymax) && cur.dx !== 0) {
        for (let k = 0; k < i; k++) {
          const other = table[k]!;
          if ((ymin !== other.ymin && ymin !== other.ymax) || other.dx === 0) continue;
          const last = xx[xx.length - 1]!;
          if (roundAway(last) !== roundAway(edgeX(other, ymin))) continue;
          const offset = ymin === cur.ymax ? -1 : 1;
          const adj = edgeX(cur, ymin + offset);
          if (ymin + offset >= other.ymin && ymin + offset <= other.ymax) {
            const adjOther = edgeX(other, ymin + offset);
            if (last > f32(adj + 1) && last > f32(adjOther + 1)) {
              xx[xx.length - 1] = roundAway(f32(Math.max(adj, adjOther))) + 1;
            } else if (last < f32(adj - 1) && last < f32(adjOther - 1)) {
              xx[xx.length - 1] = roundAway(f32(Math.min(adj, adjOther))) - 1;
            }
            break;
          }
        }
      }
    }
    xx.sort((a, b) => a - b);
    for (let i = 1; i < xx.length; i += 2) hline(im, roundUpF(xx[i - 1]!), ymin, roundDownF(xx[i]!), ink);
  }
}

/** ImagingDrawWideLine. */
function wideLine(im: RGBAImage, x0: number, y0: number, x1: number, y1: number, ink: Ink, width: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) {
    point(im, x0, y0, ink);
    return;
  }
  const big = Math.hypot(dx, dy);
  const small = (width - 1) / 2;
  const ratioMax = roundUpD(small) / big;
  const ratioMin = roundDownD(small) / big;
  const dxmin = roundDownD(ratioMin * dy);
  const dxmax = roundDownD(ratioMax * dy);
  const dymin = roundDownD(ratioMin * dx);
  const dymax = roundDownD(ratioMax * dx);
  const v: [number, number][] = [
    [x0 - dxmin, y0 + dymax],
    [x1 - dxmin, y1 + dymax],
    [x1 + dxmax, y1 - dymin],
    [x0 + dxmax, y0 - dymin],
  ];
  polygonGeneric(
    im,
    [0, 1, 2, 3].map((i) => edge(v[i]![0], v[i]![1], v[(i + 1) % 4]![0], v[(i + 1) % 4]![1])),
    ink,
  );
}

/** ImagingDrawPolygon with fill, on whole-pixel vertices. */
function fillPolygon(im: RGBAImage, xy: [number, number][], ink: Ink): void {
  const e: Edge[] = [];
  const n = xy.length;
  let i = 0;
  for (; i < n - 1; i++) {
    const [x0, y0] = xy[i]!;
    const [x1, y1] = xy[i + 1]!;
    if (y0 === y1 && i !== 0 && y0 === xy[i - 1]![1]) {
      const last = e[e.length - 1]!;
      if (x1 > x0 && x0 > xy[i - 1]![0]) {
        last.xmax = x1;
        continue;
      } else if (x1 < x0 && x0 < xy[i - 1]![0]) {
        last.xmin = x1;
        continue;
      }
    }
    e.push(edge(x0, y0, x1, y1));
  }
  if (xy[i]![0] !== xy[0]![0] || xy[i]![1] !== xy[0]![1]) e.push(edge(xy[i]![0], xy[i]![1], xy[0]![0], xy[0]![1]));
  polygonGeneric(im, e, ink);
}

// --- ellipses (Draw.c's quarter/ellipse state machines and clipping tree) ---------------------------------------------

class Quarter {
  a = 0;
  b = 0;
  cx = 0;
  cy = 0;
  ex = 0;
  ey = 0;
  a2 = 0;
  b2 = 0;
  a2b2 = 0;
  finished = false;
  constructor(a: number, b: number) {
    if (a < 0 || b < 0) {
      this.finished = true;
      return;
    }
    this.a = a;
    this.b = b;
    this.cx = a;
    this.cy = b % 2;
    this.ex = a % 2;
    this.ey = b;
    this.a2 = a * a;
    this.b2 = b * b;
    this.a2b2 = this.a2 * this.b2;
  }
  private delta(x: number, y: number): number {
    return Math.abs(this.a2 * y * y + this.b2 * x * x - this.a2b2);
  }
  next(): [number, number] | null {
    if (this.finished) return null;
    const ret: [number, number] = [this.cx, this.cy];
    if (this.cx === this.ex && this.cy === this.ey) {
      this.finished = true;
    } else {
      let nx = this.cx;
      let ny = this.cy + 2;
      let nd = this.delta(nx, ny);
      if (nx > 1) {
        let d = this.delta(this.cx - 2, this.cy + 2);
        if (nd > d) {
          nx = this.cx - 2;
          ny = this.cy + 2;
          nd = d;
        }
        d = this.delta(this.cx - 2, this.cy);
        if (nd > d) {
          nx = this.cx - 2;
          ny = this.cy;
        }
      }
      this.cx = nx;
      this.cy = ny;
    }
    return ret;
  }
}

class EllipseState {
  private readonly o: Quarter;
  private readonly i: Quarter;
  private py = 0;
  private pl = 0;
  private pr = 0;
  private buf: [number, number, number][] = [];
  private finished: boolean;
  private readonly leftmost: number;
  constructor(a: number, b: number, w: number) {
    this.leftmost = a % 2;
    this.o = new Quarter(a, b);
    const first = w < 1 ? null : this.o.next();
    this.i = new Quarter(a - 2 * (w - 1), b - 2 * (w - 1));
    if (!first) this.finished = true;
    else {
      this.finished = false;
      [this.pr, this.py] = first;
      this.pl = this.leftmost;
    }
  }
  /** [x0, y, x1] on the doubled grid, or null. */
  next(): [number, number, number] | null {
    if (!this.buf.length) {
      if (this.finished) return null;
      const y = this.py;
      let l = this.pl;
      const r = this.pr;
      let got: [number, number] | null;
      while ((got = this.o.next()) !== null && got[1] <= y) {
        /* skip */
      }
      if (!got) this.finished = true;
      else [this.pr, this.py] = got;
      let inner: [number, number] | null;
      while ((inner = this.i.next()) !== null && inner[1] <= y) l = inner[0];
      this.pl = inner === null ? this.leftmost : inner[0];
      if ((l > 0 || l < r) && y > 0) this.buf.push([l === 0 ? 2 : l, y, r]);
      if (y > 0) this.buf.push([-r, y, -l]);
      if (l > 0 || l < r) this.buf.push([l === 0 ? 2 : l, -y, r]);
      this.buf.push([-r, -y, -l]);
    }
    return this.buf.pop()!;
  }
}

type ClipNode = { type: "and" | "or"; l: ClipNode | null; r: ClipNode | null } | { type: "clip"; a: number; b: number; c: number };
type Ev = [x: number, type: 1 | -1];

function doClip(root: ClipNode | null, x0: number, y: number, x1: number): Ev[] {
  if (root === null) return [
    [x0, 1],
    [x1, -1],
  ];
  if (root.type === "clip") {
    const eps = 1e-9;
    const { a: A, b: B, c: C } = root;
    if (Math.abs(A) < eps) {
      if (B * y + C < -eps) {
        x0 = 1;
        x1 = 0;
      }
    } else {
      const ix = -(B * y + C) / A;
      if (A * x0 + B * y + C < eps) x0 = roundAway(Math.max(x0, ix));
      if (A * x1 + B * y + C < eps) x1 = roundAway(Math.min(x1, ix));
    }
    return x0 <= x1 ? [
      [x0, 1],
      [x1, -1],
    ] : [];
  }
  const l1 = doClip(root.l, x0, y, x1);
  const l2 = doClip(root.r, x0, y, x1);
  const out: Ev[] = [];
  let i1 = 0;
  let i2 = 0;
  let k1 = 0;
  let k2 = 0;
  while (i1 < l1.length || i2 < l2.length) {
    let t: Ev;
    const a = l1[i1];
    const b = l2[i2];
    if (b === undefined || (a !== undefined && (a[0] < b[0] || (a[0] === b[0] && a[1] > b[1])))) {
      t = a!;
      k1 += t[1];
      i1++;
    } else {
      t = b;
      k2 += t[1];
      i2++;
    }
    const tail = out[out.length - 1];
    const keep =
      root.type === "or"
        ? (t[1] === 1 && (!tail || tail[1] === -1)) || (t[1] === -1 && k1 === 0 && k2 === 0)
        : (t[1] === 1 && (!tail || tail[1] === -1) && k1 > 0 && k2 > 0) || (t[1] === -1 && !!tail && tail[1] === 1 && (k1 === 0 || k2 === 0));
    if (keep) out.push(t);
  }
  return out;
}

/** normalize_angles on C floats. */
function normalizeAngles(al: number, ar: number): [number, number] {
  al = f32(al);
  ar = f32(ar);
  if (f32(ar - al) >= 360) return [0, 360];
  const nal = f32((al < 0 ? 360 - (-al % 360) : al) % 360);
  const nar = f32(nal + ((ar < nal ? 360 - ((nal - ar) % 360) : ar - nal) % 360));
  return [nal, nar];
}

const rad = (deg: number) => (deg * Math.PI) / 180;

function chordRoot(a: number, b: number, al: number, ar: number): ClipNode {
  const xl = a * Math.cos(rad(al));
  const xr = a * Math.cos(rad(ar));
  const yl = b * Math.sin(rad(al));
  const yr = b * Math.sin(rad(ar));
  const A = yr - yl;
  const B = xl - xr;
  return { type: "clip", a: A, b: B, c: -(A * xl + B * yl) };
}

function pieRoot(a: number, b: number, al: number, ar: number): ClipNode {
  const xl = a * Math.cos(rad(al));
  const xr = a * Math.cos(rad(ar));
  const yl = b * Math.sin(rad(al));
  const yr = b * Math.sin(rad(ar));
  const lc: ClipNode = { type: "clip", a: -yl, b: xl, c: 0 };
  const rc: ClipNode = { type: "clip", a: yr, b: -xr, c: 0 };
  let root: ClipNode = { type: f32(ar - al) < 180 ? "and" : "or", l: lc, r: rc };
  if (f32(ar - al) < 90) root = { type: "and", l: root, r: { type: "clip", a: (xl + xr) / 2, b: (yl + yr) / 2, c: 0 } };
  return root;
}

/** ellipseNew / clipEllipseNew: the spans of the ellipse in (x0, y0)-(x1, y1), w px thick, clipped by root. */
function drawEllipseSpans(im: RGBAImage, x0: number, y0: number, x1: number, y1: number, w: number, root: ClipNode | null, ink: Ink): void {
  const a = x1 - x0;
  const b = y1 - y0;
  if (a < 0 || b < 0) return;
  const st = new EllipseState(a, b, w);
  let s: [number, number, number] | null;
  while ((s = st.next()) !== null) {
    const [X0, Y, X1] = s;
    const spans = root === null ? ([
      [X0, 1],
      [X1, -1],
    ] as Ev[]) : doClip(root, X0, Y, X1);
    for (let i = 0; i + 1 < spans.length; i += 2) {
      hline(im, x0 + Math.trunc((spans[i]![0] + a) / 2), y0 + Math.trunc((Y + b) / 2), x0 + Math.trunc((spans[i + 1]![0] + a) / 2), ink);
    }
  }
}

// --- ImageDraw ------------------------------------------------------------------------------------------------------

const ti = Math.trunc;

/** An ImageDraw.Draw on an RGBA image. */
export class Draw {
  constructor(readonly im: RGBAImage) {}

  /** ImageDraw.line(xy, fill, width, joint). */
  line(pts: Pt[], ink: Ink, width = 1, joint: "curve" | null = null): void {
    if (width === 0) return;
    if (width === 1) {
      let last: Pt | null = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i]!;
        const q = pts[i + 1]!;
        line(this.im, ti(p[0]), ti(p[1]), ti(q[0]), ti(q[1]), ink);
        last = q;
      }
      if (last) point(this.im, ti(last[0]), ti(last[1]), ink);
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i]!;
        const q = pts[i + 1]!;
        wideLine(this.im, ti(p[0]), ti(p[1]), ti(q[0]), ti(q[1]), ink, width);
      }
    }
    if (joint === "curve" && width > 4) {
      const deg = (r: number) => (r * 180) / Math.PI;
      const pymod = (v: number, m: number) => ((v % m) + m) % m;
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i]!;
        const angles = [
          [pts[i - 1]!, p],
          [p, pts[i + 1]!],
        ].map(([s, e]) => pymod(deg(Math.atan2(e![0] - s![0], s![1] - e![1])), 360));
        const [a0, a1] = angles as [number, number];
        if (a0 === a1) continue;
        const flipped = (a1 > a0 && a1 - 180 > a0) || (a1 < a0 && a1 + 180 > a0);
        const coords: [number, number, number, number] = [p[0] - width / 2 + 1, p[1] - width / 2 + 1, p[0] + width / 2 - 1, p[1] + width / 2 - 1];
        const [start, end] = flipped ? [a1 + 90, a0 + 90] : [a0 - 90, a1 - 90];
        this.pieslice(coords, start - 90, end - 90, ink);
        if (width > 8) {
          const at = (c: Pt, angle: number): Pt => {
            angle -= 90;
            const dist = width / 2 - 1;
            const off = (v: number) => (v > 0 ? Math.floor(v) : Math.ceil(v));
            return [c[0] + off(dist * Math.cos(rad(angle))), c[1] + off(dist * Math.sin(rad(angle)))];
          };
          const gap = flipped ? [at(p, a0 + 90), p, at(p, a1 + 90)] : [at(p, a0 - 90), p, at(p, a1 - 90)];
          this.line(gap, ink, 3);
        }
      }
    }
  }

  /** ImageDraw.polygon(xy, fill, outline) (outline 1 px wide). */
  polygon(pts: Pt[], fill: Ink | null, outline: Ink | null = null): void {
    const xy = pts.map(([x, y]) => [ti(x), ti(y)] as [number, number]);
    if (fill) fillPolygon(this.im, xy, fill);
    if (outline && !(fill && sameInk(outline, fill))) {
      let i = 0;
      for (; i < xy.length - 1; i++) line(this.im, xy[i]![0], xy[i]![1], xy[i + 1]![0], xy[i + 1]![1], outline);
      line(this.im, xy[i]![0], xy[i]![1], xy[0]![0], xy[0]![1], outline);
    }
  }

  /** ImageDraw.rectangle with fill (whole-pixel corners, both inclusive). */
  rectangleFill(x0: number, y0: number, x1: number, y1: number, ink: Ink): void {
    x0 = ti(x0);
    y0 = ti(y0);
    x1 = ti(x1);
    y1 = ti(y1);
    if (y0 < 0) y0 = 0;
    else if (y0 >= this.im.height) return;
    if (y1 < 0) return;
    if (y1 > this.im.height) y1 = this.im.height;
    for (let y = y0; y <= y1; y++) hline(this.im, x0, y, x1, ink);
  }

  /** ImageDraw.ellipse(xy, fill, outline, width). */
  ellipse(xy: readonly [number, number, number, number], fill: Ink | null, outline: Ink | null = null, width = 1): void {
    const [x0, y0, x1, y1] = xy.map(ti) as [number, number, number, number];
    if (fill) drawEllipseSpans(this.im, x0, y0, x1, y1, x1 - x0 + (y1 - y0), null, fill);
    if (outline && width !== 0 && !(fill && sameInk(outline, fill))) drawEllipseSpans(this.im, x0, y0, x1, y1, width, null, outline);
  }

  /** ImageDraw.chord(xy, start, end, fill) (filled only). */
  chord(xy: readonly [number, number, number, number], start: number, end: number, fill: Ink): void {
    const [x0, y0, x1, y1] = xy.map(ti) as [number, number, number, number];
    const [al, ar] = normalizeAngles(start, end);
    if (al + 360 === ar) return this.ellipse([x0, y0, x1, y1], fill);
    if (al === ar) return;
    drawEllipseSpans(this.im, x0, y0, x1, y1, x1 - x0 + y1 - y0 + 1, chordRoot(x1 - x0, y1 - y0, al, ar), fill);
  }

  /** ImageDraw.pieslice(xy, start, end, fill) (filled only). */
  pieslice(xy: readonly [number, number, number, number], start: number, end: number, fill: Ink): void {
    const [x0, y0, x1, y1] = xy.map(ti) as [number, number, number, number];
    const [al, ar] = normalizeAngles(start, end);
    if (al + 360 === ar) return drawEllipseSpans(this.im, x0, y0, x1, y1, x1 - x0 + (y1 - y0), null, fill);
    if (al === ar) return;
    drawEllipseSpans(this.im, x0, y0, x1, y1, x1 + y1 - x0 - y0, pieRoot(x1 - x0, y1 - y0, al, ar), fill);
  }

  /** ImageDraw.rounded_rectangle(xy, radius, fill) (filled, all four corners). */
  roundedRectangle(xy: readonly [number, number, number, number], radius: number, fill: Ink): void {
    let [x0, y0, x1, y1] = xy;
    let d = Math.min(x1 - x0, y1 - y0, radius * 2);
    x0 = pyRoundInt(x0);
    y0 = pyRoundInt(y0);
    x1 = pyRoundInt(x1);
    y1 = pyRoundInt(y1);
    const fullX = d >= x1 - x0 - 1;
    if (fullX) d = x1 - x0;
    const fullY = d >= y1 - y0 - 1;
    if (fullY) d = y1 - y0;
    if (fullX && fullY) return this.ellipse(xy, fill);
    if (d === 0) return this.rectangleFill(xy[0], xy[1], xy[2], xy[3], fill);
    const r = Math.trunc(Math.floor(d / 2));
    const parts: [[number, number, number, number], number, number][] = fullX
      ? [
          [[x0, y0, x0 + d, y0 + d], 180, 360],
          [[x0, y1 - d, x0 + d, y1], 0, 180],
        ]
      : fullY
        ? [
            [[x0, y0, x0 + d, y0 + d], 90, 270],
            [[x1 - d, y0, x1, y0 + d], 270, 90],
          ]
        : [
            [[x0, y0, x0 + d, y0 + d], 180, 270],
            [[x1 - d, y0, x1, y0 + d], 270, 360],
            [[x1 - d, y1 - d, x1, y1], 0, 90],
            [[x0, y1 - d, x0 + d, y1], 90, 180],
          ];
    for (const [box, s, e] of parts) this.pieslice(box, s, e, fill);
    if (fullX) this.rectangleFill(x0, y0 + r + 1, x1, y1 - r - 1, fill);
    else if (x1 - r - 1 >= x0 + r + 1) this.rectangleFill(x0 + r + 1, y0, x1 - r - 1, y1, fill);
    if (!fullX && !fullY) {
      this.rectangleFill(x0, y0 + r + 1, x0 + r, y1 - r - 1, fill);
      this.rectangleFill(x1 - r, y0 + r + 1, x1, y1 - r - 1, fill);
    }
  }
}

const sameInk = (a: Ink, b: Ink) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/** Python's round() of a float to an int (halves to even). */
export function pyRoundInt(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// --- images ---------------------------------------------------------------------------------------------------------

const div255 = (a: number) => {
  const t = a + 128;
  return ((t >> 8) + t) >> 8;
};

/** Image.paste(src, (x, y), mask) with an L mask (one byte a pixel, src's size): every channel, alpha too, blended. */
export function pasteMask(dst: RGBAImage, src: RGBAImage, mask: Uint8ClampedArray, x = 0, y = 0): void {
  for (let j = 0; j < src.height; j++) {
    const dy = y + j;
    if (dy < 0 || dy >= dst.height) continue;
    for (let i = 0; i < src.width; i++) {
      const dx = x + i;
      if (dx < 0 || dx >= dst.width) continue;
      const m = mask[j * src.width + i]!;
      const s = (j * src.width + i) * 4;
      const d = (dy * dst.width + dx) * 4;
      for (let c = 0; c < 4; c++) dst.data[d + c] = div255(dst.data[d + c]! * (255 - m) + src.data[s + c]! * m);
    }
  }
}

/** im.getchannel("A"). */
export function alphaOf(im: RGBAImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(im.width * im.height);
  for (let i = 0; i < out.length; i++) out[i] = im.data[i * 4 + 3]!;
  return out;
}

/** im.convert("LA").convert("RGBA"): ITU-R 601 luma in 16.16 fixed point, alpha kept. */
export function greyLA(im: RGBAImage): RGBAImage {
  const out = newImage(im.width, im.height);
  for (let i = 0; i < im.data.length; i += 4) {
    const l = (im.data[i]! * 19595 + im.data[i + 1]! * 38470 + im.data[i + 2]! * 7471 + 0x8000) >> 16;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = l;
    out.data[i + 3] = im.data[i + 3]!;
  }
  return out;
}

/** im.rotate(90, expand=True): a quarter turn anticlockwise. */
export function rotate90(im: RGBAImage): RGBAImage {
  const out = newImage(im.height, im.width);
  for (let y = 0; y < im.height; y++) {
    for (let x = 0; x < im.width; x++) {
      const s = (y * im.width + x) * 4;
      const d = ((im.width - 1 - x) * out.width + y) * 4;
      out.data[d] = im.data[s]!;
      out.data[d + 1] = im.data[s + 1]!;
      out.data[d + 2] = im.data[s + 2]!;
      out.data[d + 3] = im.data[s + 3]!;
    }
  }
  return out;
}

export function copyImage(im: RGBAImage): RGBAImage {
  return { width: im.width, height: im.height, data: new Uint8ClampedArray(im.data) };
}
