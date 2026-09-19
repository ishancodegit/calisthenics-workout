/* ------------------------------------------------------------------ */
/* Storage — IndexedDB                                                 */
/*                                                                     */
/* Notes and ink live in separate stores on purpose: note records are  */
/* small and get loaded in full (search, backlinks, graph all need the */
/* whole set), while a page of handwriting is orders of magnitude      */
/* bigger and is only ever fetched for the page you have open. That    */
/* split is what lets the app hold thousands of notes without the      */
/* sidebar ever touching a stroke.                                     */
/* ------------------------------------------------------------------ */

import type { Stroke } from "./ink";

export const DB_NAME = "notepad";
export const DB_VERSION = 1;

export type PaperStyle = "ruled" | "grid" | "dots" | "plain";

export type Notebook = {
  id: string;
  name: string;
  color: string;
  paper: PaperStyle;
  order: number;
  created: number;
};

export type Note = {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  /** #tags harvested from the body */
  tags: string[];
  /** normalized [[wikilink]] targets harvested from the body */
  links: string[];
  created: number;
  updated: number;
  starred?: boolean;
  /** paper override; falls back to the notebook's */
  paper?: PaperStyle;
  /** page height in paper units (grows as you write past the bottom) */
  pageHeight: number;
  /** YYYY-MM-DD when this is a daily note */
  daily?: string;
  /** true once ink has ever been written, so the list can show a nib icon */
  hasInk?: boolean;
};

export type NoteInk = {
  noteId: string;
  strokes: Stroke[];
  updated: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("notebooks")) {
        db.createObjectStore("notebooks", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("notes")) {
        const notes = db.createObjectStore("notes", { keyPath: "id" });
        notes.createIndex("notebookId", "notebookId");
        notes.createIndex("updated", "updated");
        notes.createIndex("tags", "tags", { multiEntry: true });
        notes.createIndex("links", "links", { multiEntry: true });
        notes.createIndex("daily", "daily");
      }
      if (!db.objectStoreNames.contains("ink")) {
        db.createObjectStore("ink", { keyPath: "noteId" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

/* --------------------------------- notebooks ---------------------- */

export const listNotebooks = () =>
  tx<Notebook[]>("notebooks", "readonly", (s) => s.getAll() as IDBRequest<Notebook[]>).then((r) =>
    r.sort((a, b) => a.order - b.order)
  );

export const putNotebook = (nb: Notebook) =>
  tx("notebooks", "readwrite", (s) => s.put(nb)).then(() => nb);

export const deleteNotebook = (id: string) =>
  tx("notebooks", "readwrite", (s) => s.delete(id));

/* --------------------------------- notes -------------------------- */

export const listNotes = () =>
  tx<Note[]>("notes", "readonly", (s) => s.getAll() as IDBRequest<Note[]>);

export const getNote = (id: string) =>
  tx<Note | undefined>("notes", "readonly", (s) => s.get(id) as IDBRequest<Note | undefined>);

export const putNote = (n: Note) => tx("notes", "readwrite", (s) => s.put(n)).then(() => n);

export async function deleteNote(id: string) {
  await tx("notes", "readwrite", (s) => s.delete(id));
  await tx("ink", "readwrite", (s) => s.delete(id));
}

/** One transaction for a bulk write — used by import and by "move to notebook". */
export async function putNotes(notes: Note[]) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("notes", "readwrite");
    const store = t.objectStore("notes");
    for (const n of notes) store.put(n);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/* --------------------------------- ink ---------------------------- */

export const getInk = (noteId: string) =>
  tx<NoteInk | undefined>("ink", "readonly", (s) => s.get(noteId) as IDBRequest<NoteInk | undefined>);

export const putInk = (ink: NoteInk) => tx("ink", "readwrite", (s) => s.put(ink)).then(() => ink);

export const listInk = () => tx<NoteInk[]>("ink", "readonly", (s) => s.getAll() as IDBRequest<NoteInk[]>);

/* --------------------------------- meta --------------------------- */

export const getMeta = <T,>(key: string) =>
  tx<{ key: string; value: T } | undefined>("meta", "readonly", (s) => s.get(key) as IDBRequest<{ key: string; value: T } | undefined>).then(
    (r) => r?.value
  );

export const setMeta = <T,>(key: string, value: T) =>
  tx("meta", "readwrite", (s) => s.put({ key, value }));

/* --------------------------------- backup ------------------------- */

export type Backup = {
  format: "notepad-backup";
  version: number;
  exported: number;
  notebooks: Notebook[];
  notes: Note[];
  ink: NoteInk[];
};

export async function exportAll(): Promise<Backup> {
  const [notebooks, notes, ink] = await Promise.all([listNotebooks(), listNotes(), listInk()]);
  return { format: "notepad-backup", version: DB_VERSION, exported: Date.now(), notebooks, notes, ink };
}

/** Merges a backup in; existing ids are overwritten, everything else is kept. */
export async function importAll(backup: Backup): Promise<{ notes: number; notebooks: number }> {
  if (backup?.format !== "notepad-backup") throw new Error("Not a notepad backup file");
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(["notebooks", "notes", "ink"], "readwrite");
    for (const nb of backup.notebooks ?? []) t.objectStore("notebooks").put(nb);
    for (const n of backup.notes ?? []) t.objectStore("notes").put(n);
    for (const i of backup.ink ?? []) t.objectStore("ink").put(i);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  return { notes: backup.notes?.length ?? 0, notebooks: backup.notebooks?.length ?? 0 };
}

/** Rough storage usage, for the footer readout. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
