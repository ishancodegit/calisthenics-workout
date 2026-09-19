"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  HIGHLIGHT_COLORS,
  INK_COLORS,
  PAPER_W,
  TOOLS,
  newId,
  translateStroke,
  type InkToolId,
  type Stroke,
} from "@/lib/ink";
import {
  excerpt,
  extractLinks,
  normalizeTitle,
  renderMarkdown,
  toggleTask,
} from "@/lib/markdown";
import {
  deleteNote as dbDeleteNote,
  deleteNotebook as dbDeleteNotebook,
  exportAll,
  getInk,
  importAll,
  listNotebooks,
  listNotes,
  putInk,
  putNote,
  putNotebook,
  putNotes,
  storageEstimate,
  type Backup,
  type Note,
  type Notebook,
  type PaperStyle,
} from "@/lib/notes-db";
import InkLayer, { type InkOp, type PenTool } from "./InkLayer";

const GraphView = dynamic(() => import("./GraphView"), { ssr: false });

type Pane = "notes" | "search" | "tags" | "graph";
type Mode = "write" | "read" | "draw";
type Tint = "cream" | "white" | "slate";

const NOTEBOOK_COLORS = ["#f5e000", "#2f6fed", "#e0382c", "#1f9d55", "#a855f7", "#f97316"];
const PAPERS: PaperStyle[] = ["ruled", "grid", "dots", "plain"];
const LINE_GAP = 38; // paper units between ruled lines

/* ------------------------------------------------------------------ */

export default function NotesApp() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeNotebook, setActiveNotebook] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [undoStack, setUndoStack] = useState<InkOp[]>([]);
  const [redoStack, setRedoStack] = useState<InkOp[]>([]);
  const [ready, setReady] = useState(false);

  const [mode, setMode] = useState<Mode>("write");
  const [pane, setPane] = useState<Pane>("notes");
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 1024
  );
  const [rightPanel, setRightPanel] = useState(true);
  const [palette, setPalette] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [tint, setTint] = useState<Tint>("cream");

  const [tool, setTool] = useState<PenTool>("pen");
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [sizeIndex, setSizeIndex] = useState(1);
  const [eraserSize, setEraserSize] = useState(24);
  const [pencilOnly, setPencilOnly] = useState(true);
  const [snap, setSnap] = useState(false);
  const [sawPen, setSawPen] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [usage, setUsage] = useState<string>("");

  const paperRef = useRef<HTMLDivElement | null>(null);
  const [paperWidth, setPaperWidth] = useState(720);

  const active = useMemo(() => notes.find((n) => n.id === activeId) ?? null, [notes, activeId]);

  /** On a narrow screen the sidebar floats over the page, so opening a note closes it. */
  const openNote = useCallback((id: string) => {
    setActiveId(id);
    if (typeof window !== "undefined" && window.innerWidth < 1024) setSidebar(false);
  }, []);

  /* ----------------------------- boot ---------------------------- */

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      let [nbs, ns] = await Promise.all([listNotebooks(), listNotes()]);
      if (!nbs.length) {
        const nb = freshNotebook("Notebook", 0);
        await putNotebook(nb);
        const welcome = welcomeNote(nb.id);
        await putNote(welcome);
        const howto = pencilNote(nb.id);
        await putNote(howto);
        nbs = [nb];
        ns = [welcome, howto];
      }
      setNotebooks(nbs);
      setNotes(ns);
      setActiveNotebook(nbs[0]?.id ?? null);
      const newest = [...ns].sort((a, b) => b.updated - a.updated)[0];
      setActiveId(newest?.id ?? null);
      setReady(true);
    })().catch((err) => {
      console.error("notepad: failed to open storage", err);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    storageEstimate().then((e) => {
      if (e) setUsage(`${formatBytes(e.usage)} used`);
    });
  }, [notes, strokes]);

  /* --------------------------- paper size ------------------------ */

  useEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const next = Math.max(260, Math.min(avail, 860) * zoom);
      // Ignore sub-pixel noise: page height follows page width, so a width that
      // chases its own scrollbar would loop forever.
      setPaperWidth((prev) => (Math.abs(prev - next) < 2 ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // `ready` matters: the paper only exists once boot finishes, so without it
    // the first measurement never happens and every page keeps its default width.
  }, [zoom, sidebar, rightPanel, ready]);

  const scale = paperWidth / PAPER_W;
  const fontSize = Math.max(13, (LINE_GAP * scale) / 1.7);

  /* ------------------------------ ink ---------------------------- */

  useEffect(() => {
    let cancelled = false;
    strokesRef.current = [];
    undoRef.current = [];
    redoRef.current = [];
    setStrokes([]);
    setUndoStack([]);
    setRedoStack([]);
    if (!activeId) return;
    getInk(activeId).then((ink) => {
      if (cancelled) return;
      strokesRef.current = ink?.strokes ?? [];
      setStrokes(strokesRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const saveNoteSoon = useDebounced(async (note: Note) => {
    setSaving("saving");
    await putNote(note);
    setSaving("saved");
  }, 450);

  const notesRef = useRef<Note[]>([]);
  notesRef.current = notes;

  const saveInkSoon = useDebounced(async (noteId: string, list: Stroke[]) => {
    setSaving("saving");
    await putInk({ noteId, strokes: list, updated: Date.now() });
    setSaving("saved");
  }, 500);

  // Strokes and the undo history are mirrored in refs: pointer events land
  // faster than React re-renders, and a state updater has to stay pure.
  const strokesRef = useRef<Stroke[]>([]);
  const undoRef = useRef<InkOp[]>([]);
  const redoRef = useRef<InkOp[]>([]);

  const commitStrokes = useCallback(
    (noteId: string, next: Stroke[]) => {
      strokesRef.current = next;
      setStrokes(next);
      saveInkSoon(noteId, next);
    },
    [saveInkSoon]
  );

  const applyOp = useCallback(
    (op: InkOp) => {
      if (!activeId) return;
      commitStrokes(activeId, reduceOp(strokesRef.current, op));
      undoRef.current = [...undoRef.current.slice(-199), op];
      redoRef.current = [];
      setUndoStack(undoRef.current);
      setRedoStack(redoRef.current);
      // Drawing is an edit: stamp the note so the list sorts and marks it.
      const note = notesRef.current.find((n) => n.id === activeId);
      if (note) {
        const stamped: Note = { ...note, hasInk: true, updated: Date.now() };
        setNotes((prev) => prev.map((n) => (n.id === stamped.id ? stamped : n)));
        saveNoteSoon(stamped);
      }
    },
    [activeId, commitStrokes, saveNoteSoon]
  );

  const undoInk = useCallback(() => {
    const op = undoRef.current[undoRef.current.length - 1];
    if (!op || !activeId) return;
    undoRef.current = undoRef.current.slice(0, -1);
    redoRef.current = [...redoRef.current, op];
    setUndoStack(undoRef.current);
    setRedoStack(redoRef.current);
    commitStrokes(activeId, reduceOp(strokesRef.current, invertOp(op)));
  }, [activeId, commitStrokes]);

  const redoInk = useCallback(() => {
    const op = redoRef.current[redoRef.current.length - 1];
    if (!op || !activeId) return;
    redoRef.current = redoRef.current.slice(0, -1);
    undoRef.current = [...undoRef.current, op];
    setUndoStack(undoRef.current);
    setRedoStack(redoRef.current);
    commitStrokes(activeId, reduceOp(strokesRef.current, op));
  }, [activeId, commitStrokes]);

  /* ----------------------------- notes --------------------------- */

  const updateActive = useCallback(
    (patch: Partial<Note>) => {
      if (!activeId) return;
      setNotes((prev) => {
        const next = prev.map((n) => {
          if (n.id !== activeId) return n;
          const merged: Note = { ...n, ...patch, updated: Date.now() };
          if (patch.body !== undefined) {
            const { links, tags } = extractLinks(patch.body);
            merged.links = links;
            merged.tags = tags;
          }
          saveNoteSoon(merged);
          return merged;
        });
        return next;
      });
    },
    [activeId, saveNoteSoon]
  );

  const createNote = useCallback(
    async (opts: { title?: string; notebookId?: string; daily?: string } = {}) => {
      const notebookId = opts.notebookId ?? activeNotebook ?? notebooks[0]?.id;
      if (!notebookId) return null;
      const note: Note = {
        id: newId("n"),
        notebookId,
        title: opts.title ?? "",
        body: "",
        tags: [],
        links: [],
        created: Date.now(),
        updated: Date.now(),
        pageHeight: 1414,
        daily: opts.daily,
      };
      await putNote(note);
      setNotes((prev) => [...prev, note]);
      setActiveId(note.id);
      setActiveNotebook(notebookId);
      setMode("write");
      return note;
    },
    [activeNotebook, notebooks]
  );

  const removeNote = useCallback(
    async (id: string) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      if (!confirm(`Delete "${note.title || "Untitled"}" and its handwriting?`)) return;
      await dbDeleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (activeId === id) setActiveId(null);
    },
    [notes, activeId]
  );

  /** Renaming rewrites every [[wikilink]] that pointed at the old title. */
  const renameActive = useCallback(
    async (title: string) => {
      if (!active) return;
      const from = normalizeTitle(active.title);
      updateActive({ title });
      const to = title.trim();
      if (!from || !to || from === normalizeTitle(to)) return;
      const touched: Note[] = [];
      const rewritten = notes.map((n) => {
        if (n.id === active.id || !n.links.includes(from)) return n;
        const body = n.body.replace(/\[\[([^\]|#]+)((?:#[^\]|]+)?(?:\|[^\]]+)?)\]\]/g, (m, target: string, rest: string) =>
          normalizeTitle(target) === from ? `[[${to}${rest}]]` : m
        );
        const { links, tags } = extractLinks(body);
        const next = { ...n, body, links, tags, updated: Date.now() };
        touched.push(next);
        return next;
      });
      if (touched.length) {
        setNotes(rewritten);
        await putNotes(touched);
      }
    },
    [active, notes, updateActive]
  );

  const byTitle = useMemo(() => {
    const map = new Map<string, Note>();
    for (const n of notes) {
      const key = normalizeTitle(n.title);
      if (key && !map.has(key)) map.set(key, n);
    }
    return map;
  }, [notes]);

  const openByTitle = useCallback(
    async (target: string, label?: string) => {
      const hit = byTitle.get(normalizeTitle(target));
      if (hit) {
        setActiveId(hit.id);
        setActiveNotebook(hit.notebookId);
        return;
      }
      await createNote({ title: label ?? target });
    },
    [byTitle, createNote]
  );

  const openDaily = useCallback(async () => {
    const key = new Date().toISOString().slice(0, 10);
    const hit = notes.find((n) => n.daily === key);
    if (hit) {
      setActiveId(hit.id);
      setActiveNotebook(hit.notebookId);
      return;
    }
    const pretty = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const note = await createNote({ title: key, daily: key });
    if (note) updateActiveBody(note, `# ${pretty}\n\n- `, setNotes, saveNoteSoon);
  }, [notes, createNote, saveNoteSoon]);

  /* --------------------------- notebooks ------------------------- */

  const addNotebook = useCallback(async () => {
    const name = prompt("Notebook name")?.trim();
    if (!name) return;
    const nb = freshNotebook(name, notebooks.length);
    await putNotebook(nb);
    setNotebooks((prev) => [...prev, nb]);
    setActiveNotebook(nb.id);
    setPane("notes");
  }, [notebooks]);

  const removeNotebook = useCallback(
    async (id: string) => {
      const inside = notes.filter((n) => n.notebookId === id);
      if (notebooks.length === 1) {
        alert("Keep at least one notebook.");
        return;
      }
      if (!confirm(`Delete this notebook and its ${inside.length} note${inside.length === 1 ? "" : "s"}?`))
        return;
      for (const n of inside) await dbDeleteNote(n.id);
      await dbDeleteNotebook(id);
      setNotes((prev) => prev.filter((n) => n.notebookId !== id));
      setNotebooks((prev) => prev.filter((n) => n.id !== id));
      setActiveNotebook(notebooks.find((n) => n.id !== id)?.id ?? null);
    },
    [notes, notebooks]
  );

  /* ---------------------------- derived -------------------------- */

  const notebook = notebooks.find((n) => n.id === (active?.notebookId ?? activeNotebook)) ?? null;
  const paper: PaperStyle = active?.paper ?? notebook?.paper ?? "ruled";

  const visibleNotes = useMemo(() => {
    let list = notes;
    if (tagFilter) list = list.filter((n) => n.tags.includes(tagFilter));
    else if (pane === "notes" && activeNotebook) list = list.filter((n) => n.notebookId === activeNotebook);
    if (query.trim()) list = searchNotes(list, query);
    else list = [...list].sort((a, b) => b.updated - a.updated);
    return list;
  }, [notes, activeNotebook, query, pane, tagFilter]);

  const backlinks = useMemo(() => {
    if (!active) return [];
    const key = normalizeTitle(active.title);
    if (!key) return [];
    return notes.filter((n) => n.id !== active.id && n.links.includes(key));
  }, [notes, active]);

  const outgoing = useMemo(() => {
    if (!active) return [];
    return active.links.map((l) => ({ target: l, note: byTitle.get(l) ?? null }));
  }, [active, byTitle]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [notes]);

  const graphNodes = useMemo(
    () => notes.slice(0, 400).map((n) => ({ id: n.id, title: n.title || "Untitled", links: n.links.map((l) => byTitle.get(l)?.id ?? l), tags: n.tags })),
    [notes, byTitle]
  );

  const outline = useMemo(() => {
    if (!active) return [];
    return active.body
      .split(/\r?\n/)
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /^#{1,6}\s+/.test(line))
      .map(({ line, i }) => ({
        level: (line.match(/^#+/) ?? ["#"])[0].length,
        text: line.replace(/^#+\s+/, ""),
        i,
      }));
  }, [active]);

  const html = useMemo(() => {
    if (!active) return "";
    return renderMarkdown(active.body, (target) => {
      const hit = byTitle.get(target);
      return { id: hit?.id ?? null, title: hit?.title ?? target };
    });
  }, [active, byTitle]);

  /* -------------------------- backup ----------------------------- */

  const doExport = useCallback(async () => {
    const backup = await exportAll();
    download(
      `notepad-backup-${new Date().toISOString().slice(0, 10)}.json`,
      new Blob([JSON.stringify(backup)], { type: "application/json" })
    );
  }, []);

  const doExportMarkdown = useCallback(() => {
    if (!active) return;
    download(
      `${(active.title || "untitled").replace(/[^\w -]+/g, "_")}.md`,
      new Blob([`# ${active.title}\n\n${active.body}`], { type: "text/markdown" })
    );
  }, [active]);

  const doImport = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Backup;
      const { notes: n } = await importAll(parsed);
      const [nbs, ns] = await Promise.all([listNotebooks(), listNotes()]);
      setNotebooks(nbs);
      setNotes(ns);
      alert(`Imported ${n} notes.`);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
  }, []);

  /* ------------------------- shortcuts --------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTyping(e.target);
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (mod && e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        createNote();
        return;
      }
      if (mod && e.key.toLowerCase() === "z" && mode === "draw") {
        e.preventDefault();
        if (e.shiftKey) redoInk();
        else undoInk();
        return;
      }
      if (!typing && !mod) {
        if (e.key === "1") setMode("write");
        if (e.key === "2") setMode("read");
        if (e.key === "3") setMode("draw");
        if (mode === "draw") {
          if (e.key === "p") setTool("pen");
          if (e.key === "m") setTool("marker");
          if (e.key === "c") setTool("pencil");
          if (e.key === "h") setTool("highlighter");
          if (e.key === "e") setTool("eraser");
          if (e.key === "s") setTool("lasso");
        }
      }
      if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, createNote, undoInk, redoInk]);

  /* --------------------------- render ---------------------------- */

  const activeToolSpec = tool !== "eraser" && tool !== "lasso" ? TOOLS[tool as InkToolId] : null;
  const sizeChoices = activeToolSpec?.sizes ?? [8, 16, 24, 40];
  const currentColor = tool === "highlighter" ? highlightColor : inkColor;

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center text-white/40">Opening your notebooks…</div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#0a0a0a] text-white">
      {/* ------------------------------ top bar ------------------- */}
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-2 py-2 sm:px-3">
        <button
          onClick={() => setSidebar((s) => !s)}
          className="rounded-lg px-2 py-1.5 text-lg leading-none hover:bg-white/10"
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
        >
          ☰
        </button>
        <Link
          href="/"
          className="hidden rounded-lg px-2 py-1.5 text-xs font-bold text-white/50 hover:bg-white/10 hover:text-white sm:block"
        >
          ← Workout
        </Link>

        <div className="mx-1 min-w-0 flex-1">
          {active ? (
            <input
              value={active.title}
              onChange={(e) => updateActive({ title: e.target.value })}
              onBlur={(e) => renameActive(e.target.value)}
              placeholder="Untitled"
              className="w-full truncate bg-transparent text-base font-bold outline-none placeholder:text-white/25"
            />
          ) : (
            <span className="text-sm text-white/35">No note open</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-white/5 p-0.5">
          {(["write", "read", "draw"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold capitalize transition ${
                mode === m ? "bg-[var(--accent)] text-black" : "text-white/60 hover:text-white"
              }`}
            >
              {m === "write" ? "✎ Write" : m === "read" ? "👁 Read" : "✍️ Draw"}
            </button>
          ))}
        </div>

        <button
          onClick={() => setRightPanel((r) => !r)}
          className="hidden rounded-lg px-2 py-1.5 text-sm hover:bg-white/10 lg:block"
          title="Toggle links panel"
        >
          🔗
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------------------------- sidebar --------------------- */}
        {sidebar && (
          <button
            aria-label="Close sidebar"
            onClick={() => setSidebar(false)}
            className="absolute inset-0 z-20 bg-black/50 lg:hidden"
          />
        )}
        {sidebar && (
          <aside className="absolute inset-y-0 left-0 z-30 flex w-[min(86vw,320px)] flex-col border-r border-white/10 bg-[#0d0d0d] shadow-2xl lg:static lg:z-auto lg:w-72 lg:shadow-none">
            <div className="flex gap-1 border-b border-white/10 p-2">
              {(["notes", "search", "tags", "graph"] as Pane[]).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPane(p);
                    if (p !== "tags") setTagFilter(null);
                  }}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-bold capitalize ${
                    pane === p ? "bg-white/10 text-white" : "text-white/45 hover:text-white"
                  }`}
                >
                  {p === "notes" ? "📓" : p === "search" ? "🔍" : p === "tags" ? "#" : "◉"} {p}
                </button>
              ))}
            </div>

            {pane === "graph" ? (
              <div className="min-h-0 flex-1">
                <GraphView nodes={graphNodes} currentId={activeId} onOpen={openNote} />
              </div>
            ) : pane === "tags" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {allTags.length === 0 && (
                  <p className="p-3 text-xs text-white/35">
                    Type <code className="text-white/60">#tag</code> anywhere in a note.
                  </p>
                )}
                {allTags.map(([tag, count]) => (
                  <button
                    key={tag}
                    onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm ${
                      tagFilter === tag ? "bg-[var(--accent)] text-black" : "text-white/70 hover:bg-white/5"
                    }`}
                  >
                    <span className="truncate">#{tag}</span>
                    <span className="text-xs opacity-60">{count}</span>
                  </button>
                ))}
                {tagFilter && <div className="mt-2 border-t border-white/10 pt-2" />}
                {tagFilter && <NoteList notes={visibleNotes} activeId={activeId} onOpen={openNote} onDelete={removeNote} />}
              </div>
            ) : (
              <>
                {pane === "search" ? (
                  <div className="p-2">
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search every note…"
                      className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-[var(--accent)]/60"
                    />
                    <p className="px-1 pt-2 text-[11px] text-white/35">
                      {query.trim() ? `${visibleNotes.length} match${visibleNotes.length === 1 ? "" : "es"}` : `${notes.length} notes stored`}
                    </p>
                  </div>
                ) : (
                  <div className="border-b border-white/10 p-2">
                    <div className="flex flex-wrap gap-1.5">
                      {notebooks.map((nb) => (
                        <button
                          key={nb.id}
                          onClick={() => setActiveNotebook(nb.id)}
                          onDoubleClick={() => removeNotebook(nb.id)}
                          title={`${nb.name} — double-click to delete`}
                          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                            activeNotebook === nb.id ? "bg-white/15 text-white" : "text-white/50 hover:bg-white/5"
                          }`}
                        >
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: nb.color }} />
                          {nb.name}
                          <span className="opacity-50">
                            {notes.filter((n) => n.notebookId === nb.id).length}
                          </span>
                        </button>
                      ))}
                      <button
                        onClick={addNotebook}
                        className="rounded-lg px-2 py-1.5 text-xs font-bold text-white/40 hover:bg-white/5 hover:text-white"
                      >
                        + Notebook
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 px-2 pb-2">
                  <button
                    onClick={() => createNote()}
                    className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-black text-black"
                  >
                    + New note
                  </button>
                  <button
                    onClick={openDaily}
                    className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/15"
                    title="Today's daily note"
                  >
                    📅 Today
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pb-4">
                  <NoteList notes={visibleNotes} activeId={activeId} onOpen={openNote} onDelete={removeNote} query={query} />
                </div>
              </>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-[10px] text-white/35">
              <span>{usage || `${notes.length} notes`}</span>
              <div className="flex gap-2">
                <button onClick={doExport} className="hover:text-white" title="Download a backup of every note and stroke">
                  Export
                </button>
                <label className="cursor-pointer hover:text-white">
                  Import
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) doImport(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          </aside>
        )}

        {/* ----------------------------- page ----------------------- */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {mode === "draw" && (
            <PenToolbar
              tool={tool}
              setTool={setTool}
              colors={tool === "highlighter" ? HIGHLIGHT_COLORS : INK_COLORS}
              color={currentColor}
              setColor={tool === "highlighter" ? setHighlightColor : setInkColor}
              sizes={sizeChoices}
              sizeIndex={sizeIndex}
              setSizeIndex={setSizeIndex}
              eraserSize={eraserSize}
              setEraserSize={setEraserSize}
              pencilOnly={pencilOnly}
              setPencilOnly={setPencilOnly}
              snap={snap}
              setSnap={setSnap}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
              onUndo={undoInk}
              onRedo={redoInk}
              strokeCount={strokes.length}
            />
          )}

          <div
            ref={paperRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6"
            // A reserved gutter keeps the usable width constant whether or not
            // the scrollbar is showing, which is what stops that loop.
            style={{ scrollbarGutter: "stable" }}
          >
            {active ? (
              <div className="mx-auto" style={{ width: paperWidth }}>
                <div
                  className="notepad-page relative rounded-xl shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
                  style={{
                    ...paperStyle(paper, tint, scale),
                    minHeight: (active.pageHeight ?? 1414) * scale,
                    color: tint === "slate" ? "#eaeaea" : "#1a1a1a",
                  }}
                >
                  {/* text layer */}
                  <div
                    className="relative px-[7%] py-[5%]"
                    style={{ color: tint === "slate" ? "#eaeaea" : "#1a1a1a" }}
                  >
                    {mode === "write" ? (
                      <MarkdownEditorLazy
                        value={active.body}
                        onChange={(body) => updateActive({ body })}
                        titles={[...new Set(notes.map((n) => n.title).filter(Boolean))]}
                        fontSize={fontSize}
                        placeholder="Write in markdown. [[link]] to another note, #tag it, or switch to Draw and use your Pencil."
                        tint={tint}
                      />
                    ) : (
                      <div
                        className={`md-body ${tint === "slate" ? "md-dark" : ""}`}
                        style={{ fontSize, lineHeight: 1.7, minHeight: "50vh" }}
                        dangerouslySetInnerHTML={{ __html: html }}
                        onClick={(e) => {
                          const el = e.target as HTMLElement;
                          const link = el.closest("[data-wikilink]") as HTMLElement | null;
                          if (link) {
                            e.preventDefault();
                            openByTitle(link.dataset.wikilink ?? "", link.dataset.label);
                            return;
                          }
                          const tag = el.closest("[data-tag]") as HTMLElement | null;
                          if (tag) {
                            e.preventDefault();
                            setTagFilter(tag.dataset.tag ?? null);
                            setPane("tags");
                            setSidebar(true);
                            return;
                          }
                          const box = el.closest("[data-task-line]") as HTMLInputElement | null;
                          if (box) {
                            const line = Number(box.dataset.taskLine);
                            updateActive({ body: toggleTask(active.body, line) });
                          }
                        }}
                      />
                    )}
                  </div>

                  {/* ink layer — always painted, only interactive in Draw */}
                  <InkLayer
                    strokes={strokes}
                    tool={tool}
                    color={currentColor}
                    size={sizeChoices[Math.min(sizeIndex, sizeChoices.length - 1)]}
                    eraserSize={eraserSize}
                    pencilOnly={pencilOnly}
                    snap={snap}
                    width={paperWidth}
                    pageHeight={active.pageHeight ?? 1414}
                    onOp={applyOp}
                    onExtendPage={(h) => updateActive({ pageHeight: Math.max(active.pageHeight ?? 1414, h) })}
                    onPenDetected={() => setSawPen(true)}
                    readOnly={mode !== "draw"}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 py-4 text-[11px] text-white/30">
                  <button
                    onClick={() => updateActive({ pageHeight: (active.pageHeight ?? 1414) + 1000 })}
                    className="rounded-lg bg-white/5 px-3 py-1.5 font-bold text-white/60 hover:bg-white/10"
                  >
                    + Add page
                  </button>
                  <div className="flex items-center gap-2">
                    <PaperPicker
                      paper={paper}
                      setPaper={(p) => updateActive({ paper: p })}
                      tint={tint}
                      setTint={setTint}
                    />
                    <div className="flex items-center gap-1 rounded-lg bg-white/5 px-1 py-0.5">
                      <button className="px-1.5 py-1 hover:text-white" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}>
                        −
                      </button>
                      <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                      <button className="px-1.5 py-1 hover:text-white" onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.15).toFixed(2)))}>
                        +
                      </button>
                    </div>
                    <button onClick={doExportMarkdown} className="hover:text-white">
                      .md
                    </button>
                    <span className="w-14 text-right">
                      {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : ""}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState onCreate={() => createNote()} />
            )}
          </div>

          {mode === "draw" && pencilOnly && !sawPen && (
            <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[11px] text-white/35">
              Pencil-only is on — a finger scrolls, the Pencil draws. Turn it off to draw with touch.
            </p>
          )}
        </main>

        {/* --------------------------- right panel ------------------ */}
        {rightPanel && active && (
          <aside className="hidden w-64 shrink-0 overflow-y-auto border-l border-white/10 bg-[#0d0d0d] p-3 lg:block">
            <Panel title={`Backlinks (${backlinks.length})`}>
              {backlinks.length === 0 && <p className="text-xs text-white/30">Nothing links here yet.</p>}
              {backlinks.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setActiveId(n.id)}
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-white/70 hover:bg-white/5"
                >
                  <span className="block truncate font-semibold">{n.title || "Untitled"}</span>
                  <span className="block truncate text-white/35">{excerpt(n.body, 60)}</span>
                </button>
              ))}
            </Panel>

            <Panel title={`Links out (${outgoing.length})`}>
              {outgoing.length === 0 && <p className="text-xs text-white/30">Use [[double brackets]].</p>}
              {outgoing.map(({ target, note }) => (
                <button
                  key={target}
                  onClick={() => openByTitle(target)}
                  className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/5 ${
                    note ? "text-white/70" : "text-white/35 italic"
                  }`}
                >
                  {note?.title ?? target} {note ? "" : "· create"}
                </button>
              ))}
            </Panel>

            {outline.length > 0 && (
              <Panel title="Outline">
                {outline.map((h) => (
                  <div
                    key={h.i}
                    className="truncate py-0.5 text-xs text-white/55"
                    style={{ paddingLeft: (h.level - 1) * 10 }}
                  >
                    {h.text}
                  </div>
                ))}
              </Panel>
            )}

            {active.tags.length > 0 && (
              <Panel title="Tags">
                <div className="flex flex-wrap gap-1.5">
                  {active.tags.map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTagFilter(t);
                        setPane("tags");
                        setSidebar(true);
                      }}
                      className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/20"
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              </Panel>
            )}
          </aside>
        )}
      </div>

      {palette && (
        <CommandPalette
          notes={notes}
          onClose={() => setPalette(false)}
          onPick={(id) => {
            openNote(id);
            setPalette(false);
          }}
          onCreate={async (title) => {
            await createNote({ title });
            setPalette(false);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

const MarkdownEditorInner = dynamic(() => import("./MarkdownEditor"), { ssr: false });

function MarkdownEditorLazy(props: {
  value: string;
  onChange: (v: string) => void;
  titles: string[];
  fontSize: number;
  placeholder?: string;
  tint: Tint;
}) {
  const { tint, ...rest } = props;
  return (
    <div className={tint === "slate" ? "notepad-dark-text" : ""}>
      <MarkdownEditorInner {...rest} />
    </div>
  );
}

function NoteList({
  notes,
  activeId,
  onOpen,
  onDelete,
  query,
}: {
  notes: Note[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  query?: string;
}) {
  if (!notes.length) {
    return <p className="px-4 py-6 text-center text-xs text-white/30">{query ? "No matches." : "No notes yet."}</p>;
  }
  return (
    <ul>
      {notes.map((n) => (
        <li key={n.id} className="group relative">
          <button
            onClick={() => onOpen(n.id)}
            className={`block w-full border-l-2 px-3 py-2.5 text-left transition ${
              activeId === n.id
                ? "border-[var(--accent)] bg-white/[0.07]"
                : "border-transparent hover:bg-white/[0.04]"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-white/90">{n.title || "Untitled"}</span>
              {n.hasInk && <span className="text-[10px] opacity-60">✍️</span>}
            </span>
            <span className="mt-0.5 block truncate text-xs text-white/35">
              {excerpt(n.body, 70) || "Empty note"}
            </span>
            <span className="mt-1 block text-[10px] text-white/25">{relative(n.updated)}</span>
          </button>
          <button
            onClick={() => onDelete(n.id)}
            className="absolute right-2 top-2 hidden rounded-md px-1.5 py-0.5 text-xs text-white/30 hover:bg-white/10 hover:text-[#e0382c] group-hover:block"
            title="Delete note"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-white/35">{title}</h3>
      {children}
    </section>
  );
}

function PenToolbar(props: {
  tool: PenTool;
  setTool: (t: PenTool) => void;
  colors: string[];
  color: string;
  setColor: (c: string) => void;
  sizes: number[];
  sizeIndex: number;
  setSizeIndex: (i: number) => void;
  eraserSize: number;
  setEraserSize: (n: number) => void;
  pencilOnly: boolean;
  setPencilOnly: (b: boolean) => void;
  snap: boolean;
  setSnap: (b: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  strokeCount: number;
}) {
  const tools: { id: PenTool; icon: string; label: string }[] = [
    { id: "pen", icon: "🖊", label: "Pen" },
    { id: "marker", icon: "🖍", label: "Marker" },
    { id: "pencil", icon: "✏️", label: "Pencil" },
    { id: "highlighter", icon: "🟡", label: "Highlighter" },
    { id: "eraser", icon: "🧽", label: "Eraser" },
    { id: "lasso", icon: "⬚", label: "Select" },
  ];
  return (
    // One fixed-height row that scrolls sideways: if the bar reflowed when you
    // switched tools, the page would jump under the Pencil mid-stroke.
    <div className="z-20 flex h-[52px] shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-b border-white/10 bg-[#111] px-2 sm:px-3">
      <div className="flex shrink-0 items-center gap-0.5 rounded-xl bg-white/5 p-0.5">
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => props.setTool(t.id)}
            title={t.label}
            className={`rounded-lg px-2.5 py-1.5 text-base leading-none transition ${
              props.tool === t.id ? "bg-[var(--accent)]" : "hover:bg-white/10"
            }`}
          >
            {t.icon}
          </button>
        ))}
      </div>

      {props.tool !== "eraser" && props.tool !== "lasso" && (
        <>
          <div className="flex shrink-0 items-center gap-1">
            {props.colors.map((c) => (
              <button
                key={c}
                onClick={() => props.setColor(c)}
                className={`h-6 w-6 rounded-full ring-2 transition ${
                  props.color === c ? "ring-[var(--accent)]" : "ring-white/15"
                }`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-xl bg-white/5 p-0.5">
            {props.sizes.map((s, i) => (
              <button
                key={s}
                onClick={() => props.setSizeIndex(i)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                  props.sizeIndex === i ? "bg-white/15" : "hover:bg-white/10"
                }`}
                title={`${s}`}
              >
                <span
                  className="rounded-full bg-white"
                  style={{ width: Math.max(3, s / 3.2), height: Math.max(3, s / 3.2) }}
                />
              </button>
            ))}
          </div>
        </>
      )}

      {props.tool === "eraser" && (
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-white/50">
          Size
          <input
            type="range"
            min={10}
            max={90}
            value={props.eraserSize}
            onChange={(e) => props.setEraserSize(Number(e.target.value))}
            className="w-24 accent-[var(--accent)]"
          />
        </div>
      )}

      <div className="sticky right-0 ml-auto flex shrink-0 items-center gap-1.5 bg-[#111] pl-3">
        <Toggle on={props.pencilOnly} onClick={() => props.setPencilOnly(!props.pencilOnly)} title="Pencil only — palm and finger never draw">
          ✋ Palm
        </Toggle>
        <Toggle on={props.snap} onClick={() => props.setSnap(!props.snap)} title="Straighten lines, circles and boxes on release">
          📐 Snap
        </Toggle>
        <button
          onClick={props.onUndo}
          disabled={!props.canUndo}
          className="rounded-lg bg-white/5 px-2.5 py-1.5 text-sm disabled:opacity-25 hover:bg-white/10"
          title="Undo (⌘Z)"
        >
          ↶
        </button>
        <button
          onClick={props.onRedo}
          disabled={!props.canRedo}
          className="rounded-lg bg-white/5 px-2.5 py-1.5 text-sm disabled:opacity-25 hover:bg-white/10"
          title="Redo (⇧⌘Z)"
        >
          ↷
        </button>
        <span className="hidden text-[10px] text-white/25 sm:inline">{props.strokeCount} strokes</span>
      </div>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${
        on ? "bg-[var(--accent)] text-black" : "bg-white/5 text-white/50 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function PaperPicker({
  paper,
  setPaper,
  tint,
  setTint,
}: {
  paper: PaperStyle;
  setPaper: (p: PaperStyle) => void;
  tint: Tint;
  setTint: (t: Tint) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-white/5 px-1 py-0.5">
      {PAPERS.map((p) => (
        <button
          key={p}
          onClick={() => setPaper(p)}
          className={`rounded px-1.5 py-1 capitalize ${paper === p ? "text-[var(--accent)]" : "hover:text-white"}`}
        >
          {p}
        </button>
      ))}
      <span className="mx-0.5 h-3 w-px bg-white/15" />
      {(["cream", "white", "slate"] as Tint[]).map((t) => (
        <button
          key={t}
          onClick={() => setTint(t)}
          title={t}
          className={`h-4 w-4 rounded-full ring-1 ${tint === t ? "ring-[var(--accent)]" : "ring-white/20"}`}
          style={{ background: tintColor(t) }}
        />
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <p className="text-5xl">📓</p>
      <p className="max-w-xs text-sm text-white/40">
        Pick a note on the left, or start a fresh page.
      </p>
      <button onClick={onCreate} className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-black text-black">
        + New note
      </button>
    </div>
  );
}

function CommandPalette({
  notes,
  onClose,
  onPick,
  onCreate,
}: {
  notes: Note[];
  onClose: () => void;
  onPick: (id: string) => void;
  onCreate: (title: string) => void;
}) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const results = useMemo(() => (q.trim() ? searchNotes(notes, q) : [...notes].sort((a, b) => b.updated - a.updated)).slice(0, 8), [notes, q]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-[#141414] shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setI((v) => Math.min(results.length, v + 1));
            if (e.key === "ArrowUp") setI((v) => Math.max(0, v - 1));
            if (e.key === "Enter") {
              if (i < results.length) onPick(results[i].id);
              else if (q.trim()) onCreate(q.trim());
            }
            if (e.key === "Escape") onClose();
          }}
          placeholder="Jump to a note, or type a new title…"
          className="w-full bg-transparent px-4 py-3.5 text-base outline-none placeholder:text-white/25"
        />
        <div className="max-h-80 overflow-y-auto border-t border-white/10">
          {results.map((n, idx) => (
            <button
              key={n.id}
              onClick={() => onPick(n.id)}
              className={`block w-full px-4 py-2.5 text-left ${idx === i ? "bg-white/10" : "hover:bg-white/5"}`}
            >
              <span className="block truncate text-sm font-semibold">{n.title || "Untitled"}</span>
              <span className="block truncate text-xs text-white/35">{excerpt(n.body, 80)}</span>
            </button>
          ))}
          {q.trim() && (
            <button
              onClick={() => onCreate(q.trim())}
              className={`block w-full px-4 py-2.5 text-left text-sm ${
                i >= results.length ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <span className="text-[var(--accent)]">+ Create</span> “{q.trim()}”
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function reduceOp(list: Stroke[], op: InkOp): Stroke[] {
  if (op.type === "add") return [...list, ...op.strokes];
  if (op.type === "erase") {
    const ids = new Set(op.strokes.map((s) => s.id));
    return list.filter((s) => !ids.has(s.id));
  }
  const ids = new Set(op.ids);
  return list.map((s) => (ids.has(s.id) ? translateStroke(s, op.dx, op.dy) : s));
}

function invertOp(op: InkOp): InkOp {
  if (op.type === "add") return { type: "erase", strokes: op.strokes };
  if (op.type === "erase") return { type: "add", strokes: op.strokes };
  return { type: "move", ids: op.ids, dx: -op.dx, dy: -op.dy };
}

function searchNotes(notes: Note[], query: string): Note[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return notes;
  const scored: { note: Note; score: number }[] = [];
  for (const n of notes) {
    const title = n.title.toLowerCase();
    const body = n.body.toLowerCase();
    let score = 0;
    let all = true;
    for (const t of terms) {
      const inTitle = title.includes(t);
      const inBody = body.includes(t);
      const inTag = n.tags.some((tag) => tag.includes(t));
      if (!inTitle && !inBody && !inTag) {
        all = false;
        break;
      }
      if (title.startsWith(t)) score += 12;
      if (inTitle) score += 8;
      if (inTag) score += 5;
      if (inBody) score += 2;
    }
    if (all) scored.push({ note: n, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.note.updated - a.note.updated)
    .map((s) => s.note);
}

function useDebounced<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => latest.current(...args), ms);
    },
    [ms]
  );
}

function updateActiveBody(
  note: Note,
  body: string,
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>,
  save: (n: Note) => void
) {
  const { links, tags } = extractLinks(body);
  const next = { ...note, body, links, tags, updated: Date.now() };
  setNotes((prev) => prev.map((n) => (n.id === note.id ? next : n)));
  save(next);
}

/** Paper ruling as a background image; never the `background` shorthand, which
    fights the tint colour on re-render and leaves the page transparent. */
function paperStyle(paper: PaperStyle, tint: Tint, scale: number): React.CSSProperties {
  const gap = Math.max(14, LINE_GAP * scale);
  const line = tint === "slate" ? "rgba(255,255,255,0.10)" : "rgba(40,70,120,0.16)";
  const dot = tint === "slate" ? "rgba(255,255,255,0.18)" : "rgba(40,70,120,0.28)";
  const row = `repeating-linear-gradient(to bottom, transparent 0, transparent ${gap - 1}px, ${line} ${gap - 1}px, ${line} ${gap}px)`;
  const col = `repeating-linear-gradient(to right, transparent 0, transparent ${gap - 1}px, ${line} ${gap - 1}px, ${line} ${gap}px)`;
  const base: React.CSSProperties = { backgroundColor: tintColor(tint) };
  if (paper === "ruled") return { ...base, backgroundImage: row };
  if (paper === "grid") return { ...base, backgroundImage: `${row}, ${col}` };
  if (paper === "dots") {
    return {
      ...base,
      backgroundImage: `radial-gradient(${dot} 1.2px, transparent 1.3px)`,
      backgroundSize: `${gap}px ${gap}px`,
    };
  }
  return base;
}

function tintColor(t: Tint) {
  return t === "cream" ? "#fbf7ee" : t === "white" ? "#ffffff" : "#20242b";
}

function freshNotebook(name: string, order: number): Notebook {
  return {
    id: newId("nb"),
    name,
    color: NOTEBOOK_COLORS[order % NOTEBOOK_COLORS.length],
    paper: "ruled",
    order,
    created: Date.now(),
  };
}

function baseNote(notebookId: string, title: string, body: string): Note {
  const { links, tags } = extractLinks(body);
  return {
    id: newId("n"),
    notebookId,
    title,
    body,
    tags,
    links,
    created: Date.now(),
    updated: Date.now(),
    pageHeight: 1414,
  };
}

function welcomeNote(notebookId: string): Note {
  return baseNote(
    notebookId,
    "Start here",
    `This is your notebook. It holds **markdown**, **handwriting**, and links between notes — all on the same page.

## The three modes
1. **Write** — markdown with live shortcuts. ⌘B bold, ⌘I italic, ⌘E highlight, ⌘L link.
2. **Read** — rendered. Tap a checkbox to tick it, tap a [[link]] to follow it.
3. **Draw** — the Pencil layer. It sits *on top of* your text, so you can annotate what you typed.

## Links, the Obsidian part
Type \`[[\` anywhere and pick a note. Unresolved links are still links: tap one and the note gets created. Every note shows its **backlinks** in the right panel, and the **graph** in the sidebar draws the whole web.

Try it: [[Pencil notes]]

## Tags
Drop #ideas or #todo anywhere in a line and the sidebar indexes them.

- [ ] Tick this box in Read mode
- [x] Nested lists, tables and code all render
- [ ] ⌘K opens the quick switcher

> Everything lives in this browser — IndexedDB, no account, no server. Use **Export** in the sidebar for a full backup of notes *and* strokes.`
  );
}

function pencilNote(notebookId: string): Note {
  return baseNote(
    notebookId,
    "Pencil notes",
    `Switch to **Draw** and write with the Apple Pencil.

| Tool | What it does |
| --- | --- |
| 🖊 Pen | Pressure-sensitive, tapers with speed |
| ✏️ Pencil | Tilt the Pencil to shade with a broader nib |
| 🖍 Marker | Even width, opaque |
| 🟡 Highlighter | Transparent, flat ends, sits under your text |
| 🧽 Eraser | Removes whole strokes, not pixels |
| ⬚ Select | Lasso a scribble, drag it, delete it |

**✋ Palm** keeps fingers from drawing — rest your hand on the glass and scroll with a finger while the Pencil writes.

**📐 Snap** straightens a rough line, circle or box the moment you lift.

Strokes are vectors in page space, so they stay crisp at any zoom and on any screen. #handwriting`
  );
}

function relative(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}
