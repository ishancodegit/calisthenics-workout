"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PAPER_W,
  TOOLS,
  clamp,
  createStroke,
  drawStroke,
  finishStroke,
  hitStroke,
  pushPoint,
  snapShape,
  strokeLength,
  strokesInPolygon,
  translateStroke,
  unionBBox,
  type InkToolId,
  type Stroke,
} from "@/lib/ink";

export type PenTool = InkToolId | "eraser" | "lasso";

export type InkOp =
  | { type: "add"; strokes: Stroke[] }
  | { type: "erase"; strokes: Stroke[] }
  | { type: "move"; ids: string[]; dx: number; dy: number };

type Props = {
  strokes: Stroke[];
  tool: PenTool;
  color: string;
  size: number;
  eraserSize: number;
  /** ignore finger input so a resting palm never draws */
  pencilOnly: boolean;
  /** straighten lines / circles / boxes on release */
  snap: boolean;
  /** CSS width of the page in px */
  width: number;
  /** page height in paper units */
  pageHeight: number;
  onOp: (op: InkOp) => void;
  onExtendPage: (paperHeight: number) => void;
  onPenDetected?: () => void;
  readOnly?: boolean;
};

const MAX_DPR = 2.5;

export default function InkLayer({
  strokes,
  tool,
  color,
  size,
  eraserSize,
  pencilOnly,
  snap,
  width,
  pageHeight,
  onOp,
  onExtendPage,
  onPenDetected,
  readOnly,
}: Props) {
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const scale = width / PAPER_W;
  const cssHeight = Math.max(1, pageHeight * scale);

  // Live gesture state lives in refs — pointer events fire far faster than React.
  const drawing = useRef<{
    pointerId: number;
    stroke: Stroke | null;
    erased: Map<string, Stroke>;
    lasso: number[][];
    dragFrom: { x: number; y: number } | null;
    moved: { dx: number; dy: number };
    last: { x: number; y: number; t: number } | null;
    speed: number;
  } | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number } | null>(null);

  /* ------------------------------ painting ------------------------ */

  const ctxFor = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.round(width * dpr);
    const h = Math.round(cssHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    return ctx;
  };

  const redrawBase = useCallback(() => {
    const canvas = baseRef.current;
    const ctx = ctxFor(canvas);
    if (!ctx || !canvas) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    const sel = new Set(selected);
    for (const s of strokes) {
      if (hidden.has(s.id)) continue;
      if (dragDelta && sel.has(s.id)) drawStroke(ctx, translateStroke(s, dragDelta.dx, dragDelta.dy));
      else drawStroke(ctx, s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, hidden, selected, dragDelta, width, cssHeight, scale]);

  useEffect(() => {
    redrawBase();
  }, [redrawBase]);

  useEffect(() => {
    const onResize = () => redrawBase();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redrawBase]);

  const clearLive = () => {
    const canvas = liveRef.current;
    const ctx = ctxFor(canvas);
    if (!ctx || !canvas) return null;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    return ctx;
  };

  const paintLive = () => {
    const ctx = clearLive();
    const g = drawing.current;
    if (!ctx || !g) return;
    if (g.stroke) drawStroke(ctx, g.stroke);
    if (g.lasso.length > 1) {
      ctx.save();
      ctx.strokeStyle = "#2f6fed";
      ctx.lineWidth = 2 / scale;
      ctx.setLineDash([8 / scale, 6 / scale]);
      ctx.beginPath();
      ctx.moveTo(g.lasso[0][0], g.lasso[0][1]);
      for (const p of g.lasso.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ctx.restore();
    }
  };

  /* ------------------------------ input --------------------------- */

  const toPaper = (e: React.PointerEvent | PointerEvent) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * PAPER_W,
      y: ((e.clientY - rect.top) / rect.width) * PAPER_W,
    };
  };

  const isEraserInput = (e: React.PointerEvent | PointerEvent) =>
    e.pointerType === "eraser" || (e.buttons & 32) !== 0;

  const pressureOf = (e: PointerEvent | React.PointerEvent, spec: { pressure: boolean }) => {
    if (!spec.pressure) return 1;
    if (e.pointerType === "pen") return e.pressure > 0 ? clamp(e.pressure, 0.02, 1) : 0.5;
    // No barometer in a finger or a mouse: fake it from speed, so lines still taper.
    const g = drawing.current;
    const speed = g ? g.speed : 0;
    return clamp(0.85 - speed * 0.05, 0.25, 1);
  };

  /** Nib width from Pencil tilt, sampled once when the stroke starts. */
  const tiltWidth = (e: React.PointerEvent, base: number) => {
    const alt =
      (e as unknown as { altitudeAngle?: number }).altitudeAngle ??
      Math.atan(
        1 /
          (Math.hypot(
            Math.tan(((e.tiltX || 0) * Math.PI) / 180),
            Math.tan(((e.tiltY || 0) * Math.PI) / 180)
          ) || 1e-6)
      );
    const flatness = clamp(1 - alt / (Math.PI / 2), 0, 1);
    return base * (1 + flatness * 2.2);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "pen") onPenDetected?.();
    if (pencilOnly && e.pointerType === "touch") return;
    if (drawing.current) return;

    const { x, y } = toPaper(e);
    const erasing = tool === "eraser" || isEraserInput(e);
    drawing.current = {
      pointerId: e.pointerId,
      stroke: null,
      erased: new Map(),
      lasso: [],
      dragFrom: null,
      moved: { dx: 0, dy: 0 },
      last: { x, y, t: performance.now() },
      speed: 0,
    };

    if (erasing) {
      eraseAt(x, y);
    } else if (tool === "lasso") {
      const box = unionBBox(strokes.filter((s) => selected.includes(s.id)));
      if (box && x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]) {
        drawing.current.dragFrom = { x, y };
      } else {
        setSelected([]);
        drawing.current.lasso = [[x, y]];
      }
    } else {
      const spec = TOOLS[tool];
      const nib = spec.tilt ? tiltWidth(e, size) : size;
      const stroke = createStroke(tool, color, nib);
      pushPoint(stroke, x, y, pressureOf(e, spec));
      drawing.current.stroke = stroke;
      paintLive();
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = drawing.current;
    if (!g || g.pointerId !== e.pointerId) return;
    e.preventDefault();

    // Apple Pencil reports at ~240Hz; the browser batches those into one
    // move event, so replay the whole batch or the line loses its shape.
    const native = e.nativeEvent as PointerEvent;
    const batch: PointerEvent[] =
      typeof native.getCoalescedEvents === "function" && native.getCoalescedEvents().length
        ? native.getCoalescedEvents()
        : [native];

    for (const ev of batch) {
      const { x, y } = toPaper(ev);
      const now = performance.now();
      if (g.last) {
        const dt = Math.max(1, now - g.last.t);
        const d = Math.hypot(x - g.last.x, y - g.last.y);
        g.speed = g.speed * 0.7 + (d / dt) * 0.3;
      }
      g.last = { x, y, t: now };

      if (g.stroke) {
        pushPoint(g.stroke, x, y, pressureOf(ev, TOOLS[g.stroke.tool]));
      } else if (g.dragFrom) {
        g.moved = { dx: x - g.dragFrom.x, dy: y - g.dragFrom.y };
      } else if (g.lasso.length) {
        const last = g.lasso[g.lasso.length - 1];
        if (Math.hypot(x - last[0], y - last[1]) > 3) g.lasso.push([x, y]);
      } else {
        eraseAt(x, y);
      }
    }

    if (g.dragFrom) setDragDelta({ ...g.moved });
    else paintLive();
  };

  const eraseAt = (x: number, y: number) => {
    const g = drawing.current;
    if (!g) return;
    const r = eraserSize / 2;
    let changed = false;
    for (const s of strokes) {
      if (g.erased.has(s.id)) continue;
      if (hitStroke(s, x, y, r)) {
        g.erased.set(s.id, s);
        changed = true;
      }
    }
    if (changed) setHidden(new Set(g.erased.keys()));
  };

  const endGesture = (e: React.PointerEvent, cancelled = false) => {
    const g = drawing.current;
    if (!g || g.pointerId !== e.pointerId) return;
    drawing.current = null;
    clearLive();

    if (cancelled) {
      setHidden(new Set());
      setDragDelta(null);
      return;
    }

    if (g.stroke) {
      let stroke = finishStroke(g.stroke);
      if (snap && stroke.tool !== "highlighter") stroke = snapShape(stroke) ?? stroke;
      // A single tap with no travel is a dot; anything shorter than that is noise.
      if (stroke.x.length > 1 || strokeLength(stroke) > 0 || stroke.p[0] > 0.1) {
        onOp({ type: "add", strokes: [stroke] });
        if (stroke.b[3] > pageHeight - 120) onExtendPage(Math.ceil(stroke.b[3] + 400));
      }
    } else if (g.erased.size) {
      onOp({ type: "erase", strokes: [...g.erased.values()] });
      setHidden(new Set());
    } else if (g.dragFrom) {
      const { dx, dy } = g.moved;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) onOp({ type: "move", ids: selected, dx, dy });
      setDragDelta(null);
    } else if (g.lasso.length > 2) {
      setSelected(strokesInPolygon(strokes, g.lasso).map((s) => s.id));
    }
  };

  useEffect(() => {
    if (tool !== "lasso") setSelected([]);
  }, [tool]);

  const deleteSelection = useCallback(() => {
    const picked = strokes.filter((s) => selected.includes(s.id));
    if (picked.length) onOp({ type: "erase", strokes: picked });
    setSelected([]);
  }, [selected, strokes, onOp]);

  useEffect(() => {
    if (!selected.length) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Backspace" || e.key === "Delete") && !isTyping(e.target)) {
        e.preventDefault();
        deleteSelection();
      }
      if (e.key === "Escape") setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, deleteSelection]);

  const selBox = unionBBox(strokes.filter((s) => selected.includes(s.id)));

  return (
    <div
      ref={hostRef}
      className="absolute inset-0"
      style={{
        // Finger scrolling stays alive in pencil-only mode; when a finger can
        // draw, the browser must not steal the gesture for a pan.
        touchAction: readOnly ? "auto" : pencilOnly ? "pan-y" : "none",
        cursor: readOnly ? "default" : tool === "eraser" ? "cell" : tool === "lasso" ? "crosshair" : "crosshair",
        pointerEvents: readOnly ? "none" : "auto",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endGesture(e)}
      onPointerCancel={(e) => endGesture(e, true)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={liveRef} className="absolute inset-0 h-full w-full" />
      {selBox && (
        <div
          className="pointer-events-none absolute rounded-md border-2 border-dashed border-[#2f6fed]/70 bg-[#2f6fed]/5"
          style={{
            left: (selBox[0] + (dragDelta?.dx ?? 0)) * scale - 6,
            top: (selBox[1] + (dragDelta?.dy ?? 0)) * scale - 6,
            width: (selBox[2] - selBox[0]) * scale + 12,
            height: (selBox[3] - selBox[1]) * scale + 12,
          }}
        />
      )}
      {selBox && !dragDelta && (
        <button
          // The host swallows pointerdown (and with it the synthetic click),
          // so this button has to act on pointerdown itself.
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            deleteSelection();
          }}
          className="absolute z-10 rounded-lg bg-[#e0382c] px-3 py-1.5 text-xs font-bold text-white shadow-lg"
          style={{
            left: selBox[0] * scale - 6,
            top: Math.max(0, selBox[1] * scale - 40),
          }}
        >
          Delete {selected.length}
        </button>
      )}
    </div>
  );
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}
