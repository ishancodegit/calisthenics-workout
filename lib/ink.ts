/* ------------------------------------------------------------------ */
/* Ink engine — Apple Pencil strokes as vectors                        */
/*                                                                     */
/* Strokes are stored in "paper space": x runs 0..PAPER_W across the   */
/* page, y grows down. That keeps handwriting identical on an iPad, a  */
/* phone and a desktop — the canvas just scales paper space to CSS px. */
/* ------------------------------------------------------------------ */

export const PAPER_W = 1000;

export type InkToolId = "pen" | "marker" | "pencil" | "highlighter";

export type Stroke = {
  id: string;
  tool: InkToolId;
  color: string;
  /** base width, paper units */
  size: number;
  x: number[];
  y: number[];
  /** per-point pressure 0..1 */
  p: number[];
  /** bounding box [x0, y0, x1, y1], padded by the stroke radius */
  b: [number, number, number, number];
};

export type ToolSpec = {
  id: InkToolId;
  label: string;
  icon: string;
  sizes: number[];
  alpha: number;
  /** does pressure change the width? */
  pressure: boolean;
  /** does pencil tilt widen the line (shading)? */
  tilt: boolean;
  /** flat ends look right for a highlighter, round for everything else */
  flat: boolean;
};

export const TOOLS: Record<InkToolId, ToolSpec> = {
  pen: {
    id: "pen", label: "Pen", icon: "🖊", sizes: [2, 3, 5, 8],
    alpha: 1, pressure: true, tilt: false, flat: false,
  },
  marker: {
    id: "marker", label: "Marker", icon: "🖍", sizes: [6, 10, 16, 24],
    alpha: 0.95, pressure: false, tilt: false, flat: false,
  },
  pencil: {
    id: "pencil", label: "Pencil", icon: "✏️", sizes: [2, 4, 7, 11],
    alpha: 0.78, pressure: true, tilt: true, flat: false,
  },
  highlighter: {
    id: "highlighter", label: "Highlighter", icon: "🟡", sizes: [14, 22, 32, 44],
    alpha: 0.3, pressure: false, tilt: false, flat: true,
  },
};

export const INK_COLORS = [
  "#111111", "#2f6fed", "#e0382c", "#1f9d55",
  "#f5e000", "#f97316", "#a855f7", "#ffffff",
];

export const HIGHLIGHT_COLORS = ["#f5e000", "#5ce1a6", "#7cc4ff", "#ff9ecb", "#ffb86b"];

let seq = 0;
export function newId(prefix = "s"): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function createStroke(tool: InkToolId, color: string, size: number): Stroke {
  return { id: newId(), tool, color, size, x: [], y: [], p: [], b: [0, 0, 0, 0] };
}

/** Minimum travel (paper units) before a new sample is kept. */
const MIN_STEP = 1.1;

/** Appends a sample; returns true if it was kept. */
export function pushPoint(s: Stroke, x: number, y: number, pressure: number): boolean {
  const n = s.x.length;
  if (n > 0) {
    const dx = x - s.x[n - 1];
    const dy = y - s.y[n - 1];
    if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) {
      // Stationary: let pressure keep climbing so a held nib still swells.
      s.p[n - 1] = Math.max(s.p[n - 1], pressure);
      return false;
    }
    // Light low-pass filter — kills the jitter Pencil samples pick up at speed.
    x = s.x[n - 1] + (x - s.x[n - 1]) * 0.72;
    y = s.y[n - 1] + (y - s.y[n - 1]) * 0.72;
    pressure = s.p[n - 1] + (pressure - s.p[n - 1]) * 0.5;
  }
  s.x.push(round1(x));
  s.y.push(round1(y));
  s.p.push(Math.round(clamp(pressure, 0.02, 1) * 100) / 100);
  return true;
}

export function finishStroke(s: Stroke): Stroke {
  simplify(s, 0.55);
  s.b = computeBBox(s);
  return s;
}

export function radiusAt(s: Stroke, i: number): number {
  const spec = TOOLS[s.tool];
  const base = s.size / 2;
  if (!spec.pressure) return base;
  const p = s.p[i] ?? 0.5;
  return base * (0.32 + 0.68 * p);
}

function computeBBox(s: Stroke): [number, number, number, number] {
  if (!s.x.length) return [0, 0, 0, 0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < s.x.length; i++) {
    const r = radiusAt(s, i) + 1;
    if (s.x[i] - r < x0) x0 = s.x[i] - r;
    if (s.y[i] - r < y0) y0 = s.y[i] - r;
    if (s.x[i] + r > x1) x1 = s.x[i] + r;
    if (s.y[i] + r > y1) y1 = s.y[i] + r;
  }
  return [x0, y0, x1, y1];
}

export function strokesBottom(strokes: Stroke[]): number {
  let bottom = 0;
  for (const s of strokes) if (s.b[3] > bottom) bottom = s.b[3];
  return bottom;
}

/* ------------------------------------------------------------------ */
/* Outline — variable-width path built from the centre line            */
/* ------------------------------------------------------------------ */

export function buildPath(s: Stroke): Path2D {
  const path = new Path2D();
  const n = s.x.length;
  if (n === 0) return path;
  if (n === 1) {
    path.moveTo(s.x[0] + radiusAt(s, 0), s.y[0]);
    path.arc(s.x[0], s.y[0], radiusAt(s, 0), 0, Math.PI * 2);
    return path;
  }

  const left: number[][] = [];
  const right: number[][] = [];
  for (let i = 0; i < n; i++) {
    const ax = s.x[Math.max(0, i - 1)];
    const ay = s.y[Math.max(0, i - 1)];
    const bx = s.x[Math.min(n - 1, i + 1)];
    const by = s.y[Math.min(n - 1, i + 1)];
    let dx = bx - ax;
    let dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const r = radiusAt(s, i);
    left.push([s.x[i] - dy * r, s.y[i] + dx * r]);
    right.push([s.x[i] + dy * r, s.y[i] - dx * r]);
  }

  addSide(path, left, true);
  addSide(path, right.slice().reverse(), false);
  path.closePath();

  // Round caps as extra sub-paths: one fill, no seams, no double-darkening
  // (nonzero winding), and they vanish for a flat-ended highlighter.
  if (!TOOLS[s.tool].flat) {
    capCircle(path, s.x[0], s.y[0], radiusAt(s, 0));
    capCircle(path, s.x[n - 1], s.y[n - 1], radiusAt(s, n - 1));
  }
  return path;
}

function capCircle(path: Path2D, x: number, y: number, r: number) {
  path.moveTo(x + r, y);
  path.arc(x, y, r, 0, Math.PI * 2);
}

function addSide(path: Path2D, pts: number[][], start: boolean) {
  if (!pts.length) return;
  if (start) path.moveTo(pts[0][0], pts[0][1]);
  else path.lineTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  path.lineTo(last[0], last[1]);
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const spec = TOOLS[s.tool];
  ctx.save();
  ctx.globalAlpha = spec.alpha;
  ctx.fillStyle = s.color;
  ctx.fill(buildPath(s));
  ctx.restore();
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], clip?: [number, number]) {
  for (const s of strokes) {
    if (clip && (s.b[3] < clip[0] || s.b[1] > clip[1])) continue;
    drawStroke(ctx, s);
  }
}

/* ------------------------------------------------------------------ */
/* Hit testing (stroke eraser + lasso)                                 */
/* ------------------------------------------------------------------ */

export function hitStroke(s: Stroke, x: number, y: number, r: number): boolean {
  if (x < s.b[0] - r || x > s.b[2] + r || y < s.b[1] - r || y > s.b[3] + r) return false;
  const n = s.x.length;
  if (n === 1) return Math.hypot(x - s.x[0], y - s.y[0]) <= r + radiusAt(s, 0);
  for (let i = 0; i < n - 1; i++) {
    const d = segDistance(x, y, s.x[i], s.y[i], s.x[i + 1], s.y[i + 1]);
    if (d <= r + Math.max(radiusAt(s, i), radiusAt(s, i + 1))) return true;
  }
  return false;
}

function segDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Strokes whose centre line falls inside a lasso polygon. */
export function strokesInPolygon(strokes: Stroke[], poly: number[][]): Stroke[] {
  if (poly.length < 3) return [];
  return strokes.filter((s) => {
    let inside = 0;
    for (let i = 0; i < s.x.length; i++) if (pointInPoly(s.x[i], s.y[i], poly)) inside++;
    return inside > s.x.length * 0.6;
  });
}

function pointInPoly(x: number, y: number, poly: number[][]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function translateStroke(s: Stroke, dx: number, dy: number): Stroke {
  return {
    ...s,
    x: s.x.map((v) => round1(v + dx)),
    y: s.y.map((v) => round1(v + dy)),
    b: [s.b[0] + dx, s.b[1] + dy, s.b[2] + dx, s.b[3] + dy],
  };
}

/* ------------------------------------------------------------------ */
/* Simplify (Ramer–Douglas–Peucker, pressure preserved)                */
/* ------------------------------------------------------------------ */

function simplify(s: Stroke, epsilon: number) {
  const n = s.x.length;
  if (n < 3) return;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[][] = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segDistance(s.x[i], s.y[i], s.x[first], s.y[first], s.x[last], s.y[last]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx > 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  const x: number[] = [], y: number[] = [], p: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      x.push(s.x[i]);
      y.push(s.y[i]);
      p.push(s.p[i]);
    }
  }
  s.x = x;
  s.y = y;
  s.p = p;
}

/* ------------------------------------------------------------------ */

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

/** A rough "is this ink or a stray palm blob" guard used by the canvas. */
export function strokeLength(s: Stroke): number {
  let d = 0;
  for (let i = 1; i < s.x.length; i++) d += Math.hypot(s.x[i] - s.x[i - 1], s.y[i] - s.y[i - 1]);
  return d;
}

/* ------------------------------------------------------------------ */
/* Shape snapping — optional "draw it rough, get it straight"          */
/* ------------------------------------------------------------------ */

export function unionBBox(strokes: Stroke[]): [number, number, number, number] | null {
  if (!strokes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    x0 = Math.min(x0, s.b[0]);
    y0 = Math.min(y0, s.b[1]);
    x1 = Math.max(x1, s.b[2]);
    y1 = Math.max(y1, s.b[3]);
  }
  return [x0, y0, x1, y1];
}

/** Returns an idealised line/rectangle/ellipse, or null if it isn't one. */
export function snapShape(s: Stroke): Stroke | null {
  const n = s.x.length;
  if (n < 4) return null;
  const total = strokeLength(s);
  if (total < 30) return null;

  const gap = Math.hypot(s.x[n - 1] - s.x[0], s.y[n - 1] - s.y[0]);
  const closed = gap < total * 0.22;
  const avgP = s.p.reduce((a, b) => a + b, 0) / n;

  if (!closed) {
    const chord = gap;
    if (chord < 20) return null;
    let maxDev = 0;
    for (let i = 1; i < n - 1; i++) {
      const d = pointLineDistance(s.x[i], s.y[i], s.x[0], s.y[0], s.x[n - 1], s.y[n - 1]);
      if (d > maxDev) maxDev = d;
    }
    if (maxDev > chord * 0.07) return null;
    // Snap near-horizontal / near-vertical lines flat, they are almost always meant to be.
    let ax = s.x[0], ay = s.y[0], bx = s.x[n - 1], by = s.y[n - 1];
    const dx = Math.abs(bx - ax), dy = Math.abs(by - ay);
    if (dy < dx * 0.08) ay = by = (ay + by) / 2;
    else if (dx < dy * 0.08) ax = bx = (ax + bx) / 2;
    return rebuild(s, [[ax, ay], [bx, by]], avgP);
  }

  const [x0, y0, x1, y1] = computeBBox({ ...s, b: [0, 0, 0, 0] } as Stroke);
  const w = x1 - x0, h = y1 - y0;
  if (w < 20 || h < 20) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;

  // Ellipse: every point sits at a near-constant normalised radius.
  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot((s.x[i] - cx) / (w / 2), (s.y[i] - cy) / (h / 2));
    sum += r;
    sumSq += r * r;
  }
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  if (sd / (mean || 1) < 0.14) {
    const pts: number[][] = [];
    for (let a = 0; a <= 48; a++) {
      const t = (a / 48) * Math.PI * 2;
      pts.push([cx + (w / 2) * Math.cos(t), cy + (h / 2) * Math.sin(t)]);
    }
    return rebuild(s, pts, avgP);
  }

  // Rectangle: most points hug one of the four bbox edges.
  let hugging = 0;
  const tol = Math.min(w, h) * 0.12;
  for (let i = 0; i < n; i++) {
    const near =
      Math.abs(s.x[i] - x0) < tol || Math.abs(s.x[i] - x1) < tol ||
      Math.abs(s.y[i] - y0) < tol || Math.abs(s.y[i] - y1) < tol;
    if (near) hugging++;
  }
  if (hugging / n > 0.82) {
    return rebuild(s, [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], avgP);
  }
  return null;
}

function rebuild(s: Stroke, pts: number[][], pressure: number): Stroke {
  const out: Stroke = {
    ...s,
    x: pts.map((p) => Math.round(p[0] * 10) / 10),
    y: pts.map((p) => Math.round(p[1] * 10) / 10),
    p: pts.map(() => Math.round(pressure * 100) / 100),
    b: [0, 0, 0, 0],
  };
  out.b = computeBBox(out);
  return out;
}

function pointLineDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((px - ax) * dy - (py - ay) * dx) / len;
}
