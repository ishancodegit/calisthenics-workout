"use client";

import dynamic from "next/dynamic";

// Everything here is browser-only: IndexedDB, canvas, pointer events.
const NotesApp = dynamic(() => import("./NotesApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center text-sm text-white/40">
      Opening your notebooks…
    </div>
  ),
});

export default function NotesPage() {
  return <NotesApp />;
}
