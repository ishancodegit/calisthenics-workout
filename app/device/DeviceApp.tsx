"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAPER_W, newId } from "@/lib/ink";
import { extractLinks } from "@/lib/markdown";
import {
  listNotebooks,
  listNotes,
  putNote,
  putNotebook,
  deleteNote,
  type Note,
  type Notebook,
} from "@/lib/notes-db";
import InkLayer, { type PenTool } from "../notes/InkLayer";
import { useInk } from "../notes/useInk";

/* ------------------------------------------------------------------ */
/* A note-taking device.                                               */
/*                                                                     */
/* One page on screen at a time, no colour anywhere, no panels. It     */
/* opens on paper and nothing else: the chrome is two hairline strips  */
/* that fade out of the way while you write. Same vault as /notes.     */
/* ------------------------------------------------------------------ */

const PAGE_H = 1414; // A-series proportions, in paper units
const NIBS = [1.6, 2.6, 4.2];
const INK = "#1c1c1c";

type Mode = "ink" | "type";

export default function DeviceApp() {
  const [pages, setPages] = useState<Note[]>([]);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("ink");
  const [tool, setTool] = useState<PenTool>("pen");
  const [nib, setNib] = useState(1);
  const [showIndex, setShowIndex] = useState(false);
  const [resting, setResting] = useState(false);
  const [fit, setFit] = useState({ width: 360, height: 509 });

  const frameRef = useRef<HTMLDivElement | null>(null);
  const notesRef = useRef<Note[]>([]);
  notesRef.current = pages;

  const page = pages[index] ?? null;

  const touchNote = useCallback((noteId: string) => {
    const note = notesRef.current.find((n) => n.id === noteId);
    if (!note) return;
    const stamped: Note = { ...note, hasInk: true, updated: Date.now() };
    setPages((prev) => prev.map((n) => (n.id === stamped.id ? stamped : n)));
    void putNote(stamped);
  }, []);

  const { strokes, applyOp, undo, redo, canUndo, canRedo, flush } = useInk(page?.id ?? null, {
    onEdit: touchNote,
  });

  /* ----------------------------- boot ---------------------------- */

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const [books, notes] = await Promise.all([listNotebooks(), listNotes()]);
      let book: Notebook | undefined = books[0];
      if (!book) {
        book = {
          id: newId("nb"),
          name: "Notebook",
          color: "#1c1c1c",
          paper: "ruled",
          order: 0,
          created: Date.now(),
        };
        await putNotebook(book);
      }
      const ordered = notes.sort((a, b) => a.created - b.created);
      if (!ordered.length) {
        const first = blankPage(book.id, 1);
        await putNote(first);
        ordered.push(first);
      }
      setPages(ordered);
      // Open where you left off, the way a notebook falls open at its bookmark.
      const last = Number(localStorage.getItem("device-page") ?? "");
      const startAt = ordered.findIndex((n) => n.id === localStorage.getItem("device-page-id"));
      setIndex(startAt >= 0 ? startAt : Number.isFinite(last) ? Math.min(Math.max(0, last), ordered.length - 1) : ordered.length - 1);
      setReady(true);
    })().catch(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!page) return;
    localStorage.setItem("device-page", String(index));
    localStorage.setItem("device-page-id", page.id);
  }, [index, page]);

  /* ------------------------ the shell itself --------------------- */

  useEffect(() => {
    // The rest of the site is black; a device should be paper to the edges,
    // with no rubber-banding when the nib runs past the page.
    const { style } = document.body;
    const prev = {
      background: style.background,
      color: style.color,
      overscrollBehavior: style.overscrollBehavior,
    };
    style.background = "#f4f4f2";
    style.color = "#1c1c1c";
    style.overscrollBehavior = "none";
    return () => {
      style.background = prev.background;
      style.color = prev.color;
      style.overscrollBehavior = prev.overscrollBehavior;
    };
  }, []);

  useEffect(() => {
    // Installed to the home screen it has to work with no network at all.
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  /* --------------------------- page fitting ---------------------- */

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const scale = Math.min(w / PAPER_W, h / PAGE_H);
      const width = Math.floor(PAPER_W * scale);
      setFit((prev) =>
        Math.abs(prev.width - width) < 2 ? prev : { width, height: Math.floor(PAGE_H * scale) }
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  /* ------------------------- screen + pages ---------------------- */

  useEffect(() => {
    // A device shouldn't sleep mid-sentence.
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        /* denied or unsupported; harmless */
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
      else void flush();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [flush]);

  const addPage = useCallback(async () => {
    const notebookId = page?.notebookId ?? pages[0]?.notebookId;
    if (!notebookId) return;
    const next = blankPage(notebookId, pages.length + 1);
    await putNote(next);
    setPages((prev) => [...prev, next]);
    setIndex(pages.length);
    setShowIndex(false);
  }, [page, pages]);

  const turn = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const next = i + delta;
        return next < 0 || next >= notesRef.current.length ? i : next;
      });
    },
    []
  );

  const removePage = useCallback(
    async (id: string) => {
      if (!confirm("Tear out this page?")) return;
      await deleteNote(id);
      setPages((prev) => {
        const next = prev.filter((n) => n.id !== id);
        setIndex((i) => Math.max(0, Math.min(i, next.length - 1)));
        return next;
      });
    },
    []
  );

  const writeBody = useCallback((body: string) => {
    setPages((prev) => {
      const current = prev[indexRef.current];
      if (!current) return prev;
      const { links, tags } = extractLinks(body);
      const next: Note = { ...current, body, links, tags, updated: Date.now() };
      bodySave(next);
      return prev.map((n) => (n.id === next.id ? next : n));
    });
  }, []);

  const indexRef = useRef(0);
  indexRef.current = index;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") turn(1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") turn(-1);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key === "Escape") setShowIndex(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, undo, redo]);

  /* ------------------------------ chrome ------------------------- */

  // The bars step back while the nib is down and come straight back after.
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteWriting = useCallback(() => {
    setResting(true);
    if (restTimer.current) clearTimeout(restTimer.current);
    restTimer.current = setTimeout(() => setResting(false), 1400);
  }, []);

  const label = useMemo(() => (page ? pageLabel(page) : ""), [page]);

  if (!ready) return <div className="h-dvh bg-white" />;

  return (
    <div className="flex h-dvh select-none flex-col bg-[#f4f4f2] text-[#1c1c1c]">
      {/* top strip */}
      <header
        className="flex h-11 shrink-0 items-center gap-1 border-b border-black/10 px-2 text-[13px] transition-opacity duration-300"
        style={{ opacity: resting ? 0.25 : 1 }}
      >
        <Key onClick={() => setShowIndex(true)} label="Pages">
          ☰
        </Key>
        <span className="ml-1 truncate text-black/45">{label}</span>
        <div className="ml-auto flex items-center gap-1">
          <Key onClick={() => turn(-1)} disabled={index === 0} label="Previous page">
            ‹
          </Key>
          <span className="min-w-[4.5rem] text-center tabular-nums text-black/45">
            {index + 1} / {pages.length}
          </span>
          <Key onClick={() => turn(1)} disabled={index >= pages.length - 1} label="Next page">
            ›
          </Key>
          <Key onClick={addPage} label="New page">
            +
          </Key>
        </div>
      </header>

      {/* the page */}
      <div ref={frameRef} className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4">
        {page && (
          <div
            className="relative bg-white shadow-[0_1px_0_rgba(0,0,0,0.12),0_10px_30px_rgba(0,0,0,0.08)]"
            style={{
              width: fit.width,
              height: fit.height,
              backgroundImage: ruling(fit.width / PAPER_W),
            }}
          >
            {mode === "type" ? (
              <textarea
                value={page.body}
                onChange={(e) => writeBody(e.target.value)}
                placeholder=""
                spellCheck
                className="absolute inset-0 h-full w-full select-text resize-none bg-transparent px-[8%] py-[7%] leading-[1.7] outline-none"
                style={{ fontSize: Math.max(13, (38 * (fit.width / PAPER_W)) / 1.7) }}
              />
            ) : (
              <div
                className="absolute inset-0 select-text whitespace-pre-wrap px-[8%] py-[7%] leading-[1.7]"
                style={{ fontSize: Math.max(13, (38 * (fit.width / PAPER_W)) / 1.7) }}
              >
                {page.body}
              </div>
            )}

            <InkLayer
              strokes={strokes}
              tool={tool}
              color={INK}
              size={NIBS[nib]}
              eraserSize={26}
              pencilOnly
              snap={false}
              width={fit.width}
              pageHeight={PAGE_H}
              onOp={(op) => {
                noteWriting();
                applyOp(op);
              }}
              onExtendPage={() => {
                /* fixed page: turn to the next one instead of growing */
              }}
              readOnly={mode === "type"}
            />
          </div>
        )}
      </div>

      {/* bottom strip */}
      <footer
        className="flex h-12 shrink-0 items-center justify-center gap-1 border-t border-black/10 px-2 transition-opacity duration-300"
        style={{ opacity: resting ? 0.25 : 1 }}
      >
        <Key onClick={() => setMode("ink")} on={mode === "ink"} label="Write with the pen" wide>
          ✎ Write
        </Key>
        <Key onClick={() => setMode("type")} on={mode === "type"} label="Type with the keyboard" wide>
          ⌨ Type
        </Key>
        <span className="mx-1 h-5 w-px bg-black/10" />
        <Key onClick={() => setTool("pen")} on={tool === "pen" && mode === "ink"} label="Pen">
          Pen
        </Key>
        <Key onClick={() => setTool("pencil")} on={tool === "pencil" && mode === "ink"} label="Pencil">
          Pencil
        </Key>
        <Key onClick={() => setTool("eraser")} on={tool === "eraser" && mode === "ink"} label="Eraser">
          Erase
        </Key>
        <span className="mx-1 h-5 w-px bg-black/10" />
        <div className="flex items-center gap-1">
          {NIBS.map((n, i) => (
            <button
              key={n}
              onClick={() => setNib(i)}
              aria-label={`Nib ${i + 1}`}
              className={`flex h-8 w-8 items-center justify-center rounded ${
                nib === i ? "bg-black/10" : "hover:bg-black/5"
              }`}
            >
              <span className="rounded-full bg-[#1c1c1c]" style={{ width: 2 + i * 2.5, height: 2 + i * 2.5 }} />
            </button>
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-black/10" />
        <Key onClick={undo} disabled={!canUndo} label="Undo">
          ↶
        </Key>
        <Key onClick={redo} disabled={!canRedo} label="Redo">
          ↷
        </Key>
      </footer>

      {showIndex && (
        <PageIndex
          pages={pages}
          index={index}
          onPick={(i) => {
            setIndex(i);
            setShowIndex(false);
          }}
          onClose={() => setShowIndex(false)}
          onNew={addPage}
          onDelete={removePage}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Key({
  children,
  onClick,
  on,
  disabled,
  label,
  wide,
}: {
  children: React.ReactNode;
  onClick: () => void;
  on?: boolean;
  disabled?: boolean;
  label: string;
  wide?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`h-8 rounded text-[13px] transition ${wide ? "px-3" : "min-w-[2rem] px-2"} ${
        on ? "bg-black/10 font-semibold" : "hover:bg-black/5"
      } ${disabled ? "opacity-25" : ""}`}
    >
      {children}
    </button>
  );
}

function PageIndex({
  pages,
  index,
  onPick,
  onClose,
  onNew,
  onDelete,
}: {
  pages: Note[];
  index: number;
  onPick: (i: number) => void;
  onClose: () => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#f4f4f2]">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-black/10 px-2 text-[13px]">
        <Key onClick={onClose} label="Back to the page">
          ‹
        </Key>
        <span className="text-black/45">
          {pages.length} page{pages.length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Key onClick={onNew} label="New page" wide>
            + New page
          </Key>
          <a href="/notes" className="rounded px-2 py-1 text-[12px] text-black/35 hover:bg-black/5">
            Full app
          </a>
        </div>
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {pages.map((p, i) => (
          <li key={p.id} className="group flex items-center border-b border-black/5">
            <button onClick={() => onPick(i)} className="min-w-0 flex-1 px-3 py-3 text-left">
              <span className="flex items-baseline gap-2">
                <span className="w-8 shrink-0 tabular-nums text-[12px] text-black/30">{i + 1}</span>
                <span className="truncate text-[14px]">
                  {firstLine(p.body) || (p.hasInk ? "Handwritten" : "Blank")}
                </span>
                {i === index && <span className="shrink-0 text-[11px] text-black/35">open</span>}
              </span>
              <span className="mt-0.5 block pl-10 text-[11px] text-black/30">{pageLabel(p)}</span>
            </button>
            <button
              onClick={() => onDelete(p.id)}
              aria-label="Tear out this page"
              className="mr-2 hidden rounded px-2 py-1 text-[12px] text-black/30 hover:bg-black/5 group-hover:block"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function bodySave(note: Note) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void putNote(note), 400);
}

function blankPage(notebookId: string, ordinal: number): Note {
  const now = new Date();
  return {
    id: newId("n"),
    notebookId,
    title: `${now.toISOString().slice(0, 10)} · ${ordinal}`,
    body: "",
    tags: [],
    links: [],
    created: Date.now(),
    updated: Date.now(),
    pageHeight: PAGE_H,
  };
}

function pageLabel(note: Note) {
  return new Date(note.created).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function firstLine(body: string) {
  const line = body.split(/\r?\n/).find((l) => l.trim());
  return line ? line.replace(/^#+\s*/, "").slice(0, 70) : "";
}

function ruling(scale: number) {
  const gap = Math.max(12, 38 * scale);
  const line = "rgba(0,0,0,0.07)";
  return `repeating-linear-gradient(to bottom, transparent 0, transparent ${gap - 1}px, ${line} ${gap - 1}px, ${line} ${gap}px)`;
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}
