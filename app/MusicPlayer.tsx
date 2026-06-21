"use client";

import { useEffect, useState } from "react";

// Default: Spotify's "Beast Mode" workout playlist.
const DEFAULT_EMBED =
  "https://open.spotify.com/embed/playlist/37i9dQZF1DX76Wlfdnj7AP?utm_source=generator";
const KEY = "calisthenics-music-v1";

const TYPES = ["playlist", "album", "track", "artist", "show", "episode"];

// Convert any Spotify link / URI into an embeddable URL.
function toEmbed(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    if (raw.startsWith("spotify:")) {
      const [, type, id] = raw.split(":");
      if (TYPES.includes(type) && id)
        return `https://open.spotify.com/embed/${type}/${id}?utm_source=generator`;
      return null;
    }
    const u = new URL(raw);
    if (!u.hostname.includes("spotify.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean); // handles /embed and /intl-xx
    const idx = parts.findIndex((p) => TYPES.includes(p));
    if (idx >= 0 && parts[idx + 1]) {
      const id = parts[idx + 1].split("?")[0];
      return `https://open.spotify.com/embed/${parts[idx]}/${id}?utm_source=generator`;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export default function MusicPlayer() {
  const [open, setOpen] = useState(false);
  const [embed, setEmbed] = useState(DEFAULT_EMBED);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (saved) setEmbed(saved);
  }, []);

  function apply() {
    const e = toEmbed(input);
    if (!e) {
      setErr("Paste a Spotify playlist, album, or track link.");
      return;
    }
    setEmbed(e);
    localStorage.setItem(KEY, e);
    setErr("");
    setInput("");
  }

  function resetDefault() {
    setEmbed(DEFAULT_EMBED);
    localStorage.removeItem(KEY);
    setErr("");
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {/* Player panel — kept mounted (just hidden) so audio survives toggling */}
      <div
        className={`w-80 max-w-[calc(100vw-2rem)] origin-bottom-right rounded-2xl bg-[#141414] p-3 shadow-2xl ring-1 ring-white/10 transition-all duration-200 ${
          open
            ? "scale-100 opacity-100"
            : "pointer-events-none translate-y-2 scale-95 opacity-0"
        }`}
      >
        <iframe
          title="Spotify player"
          src={embed}
          width="100%"
          height={152}
          frameBorder={0}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          className="rounded-xl"
        />
        <div className="mt-2 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder="Paste a Spotify link…"
            className="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 placeholder:text-white/30 focus:ring-[var(--accent)]/60"
          />
          <button
            onClick={apply}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-black active:scale-95"
          >
            Set
          </button>
        </div>
        {err ? (
          <p className="mt-1 text-xs text-red-400">{err}</p>
        ) : (
          <button
            onClick={resetDefault}
            className="mt-1 text-xs text-white/40 hover:text-white/70"
          >
            Reset to Beast Mode
          </button>
        )}
      </div>

      {/* Toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle music player"
        className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-3 font-bold text-black shadow-lg active:scale-95"
      >
        {open ? "✕" : "♪ Music"}
      </button>
    </div>
  );
}
