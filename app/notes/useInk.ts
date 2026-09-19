"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { translateStroke, type Stroke } from "@/lib/ink";
import { getInk, putInk } from "@/lib/notes-db";
import type { InkOp } from "./InkLayer";

export function reduceOp(list: Stroke[], op: InkOp): Stroke[] {
  if (op.type === "add") return [...list, ...op.strokes];
  if (op.type === "erase") {
    const ids = new Set(op.strokes.map((s) => s.id));
    return list.filter((s) => !ids.has(s.id));
  }
  const ids = new Set(op.ids);
  return list.map((s) => (ids.has(s.id) ? translateStroke(s, op.dx, op.dy) : s));
}

export function invertOp(op: InkOp): InkOp {
  if (op.type === "add") return { type: "erase", strokes: op.strokes };
  if (op.type === "erase") return { type: "add", strokes: op.strokes };
  return { type: "move", ids: op.ids, dx: -op.dx, dy: -op.dy };
}

type Options = {
  /** called whenever ink changes, so the note itself can be stamped */
  onEdit?: (noteId: string) => void;
  onSaveState?: (state: "saving" | "saved") => void;
};

/**
 * Ink for one note: loading, saving, and the undo history.
 *
 * Strokes live in a ref as well as in state because pointer events arrive far
 * faster than React re-renders, and because every state updater here has to
 * stay pure. Pending writes are flushed when the note changes or the component
 * goes away, so the last stroke before a page turn is never lost.
 */
export function useInk(noteId: string | null, options: Options = {}) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const strokesRef = useRef<Stroke[]>([]);
  const undoRef = useRef<InkOp[]>([]);
  const redoRef = useRef<InkOp[]>([]);
  const pending = useRef<{ noteId: string; strokes: Stroke[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opts = useRef(options);
  opts.current = options;

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    opts.current.onSaveState?.("saving");
    await putInk({ noteId: job.noteId, strokes: job.strokes, updated: Date.now() });
    opts.current.onSaveState?.("saved");
  }, []);

  const commit = useCallback(
    (id: string, next: Stroke[]) => {
      strokesRef.current = next;
      setStrokes(next);
      setCanUndo(undoRef.current.length > 0);
      setCanRedo(redoRef.current.length > 0);
      pending.current = { noteId: id, strokes: next };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 500);
    },
    [flush]
  );

  useEffect(() => {
    let cancelled = false;
    // Save whatever the previous note had before swapping the buffers out.
    void flush();
    strokesRef.current = [];
    undoRef.current = [];
    redoRef.current = [];
    setStrokes([]);
    setCanUndo(false);
    setCanRedo(false);
    if (!noteId) return;
    getInk(noteId).then((ink) => {
      if (cancelled) return;
      strokesRef.current = ink?.strokes ?? [];
      setStrokes(strokesRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId, flush]);

  useEffect(() => () => void flush(), [flush]);

  const applyOp = useCallback(
    (op: InkOp) => {
      if (!noteId) return;
      undoRef.current = [...undoRef.current.slice(-199), op];
      redoRef.current = [];
      commit(noteId, reduceOp(strokesRef.current, op));
      opts.current.onEdit?.(noteId);
    },
    [noteId, commit]
  );

  const undo = useCallback(() => {
    const op = undoRef.current[undoRef.current.length - 1];
    if (!op || !noteId) return;
    undoRef.current = undoRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, op];
    commit(noteId, reduceOp(strokesRef.current, invertOp(op)));
    opts.current.onEdit?.(noteId);
  }, [noteId, commit]);

  const redo = useCallback(() => {
    const op = redoRef.current[redoRef.current.length - 1];
    if (!op || !noteId) return;
    redoRef.current = redoRef.current.slice(0, -1);
    undoRef.current = [...undoRef.current, op];
    commit(noteId, reduceOp(strokesRef.current, op));
    opts.current.onEdit?.(noteId);
  }, [noteId, commit]);

  return { strokes, applyOp, undo, redo, canUndo, canRedo, flush };
}
