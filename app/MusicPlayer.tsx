"use client";

import { useEffect, useState } from "react";

// Default: a YouTube "Workout Playlist 2026" mix (full songs, free, no login).
const DEFAULT_LIST = "PLCULndnUE-_qfnkg7uOUxvCEDa4er9l8O";
const DEFAULT_EMBED = `https://www.youtube.com/embed/videoseries?list=${DEFAULT_LIST}&rel=0&modestbranding=1`;
const KEY = "calisthenics-music-yt-v1";

// Convert any YouTube link / id into an embeddable URL.
function toYouTubeEmbed(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;

  const buildList = (listId: string, videoId?: string) =>
    videoId
      ? `https://www.youtube.com/embed/${videoId}?list=${listId}&rel=0&modestbranding=1`
      : `https://www.youtube.com/embed/videoseries?list=${listId}&rel=0&modestbranding=1`;
  const buildVideo = (videoId: string) =>
    `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`;

  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, "").replace(/^music\./, "");
    const listId = u.searchParams.get("list") || "";
    let videoId = "";

    if (host === "youtu.be") {
      videoId = u.pathname.slice(1);
    } else if (host.endsWith("youtube.com")) {
      if (u.pathname === "/watch") videoId = u.searchParams.get("v") || "";
      else if (u.pathname.startsWith("/shorts/"))
        videoId = u.pathname.split("/")[2] || "";
      else if (u.pathname.startsWith("/embed/")) {
        const seg = u.pathname.split("/")[2] || "";
        if (seg && seg !== "videoseries") videoId = seg;
      }
      // /playlist -> list only
    } else {
      return null; // not a YouTube host
    }

    if (listId) return buildList(listId, videoId || undefined);
    if (videoId) return buildVideo(videoId);
    return null;
  } catch {
    // bare ids pasted directly
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return buildVideo(raw);
    if (/^(PL|RD|UU|LL|FL|OL)[A-Za-z0-9_-]+$/.test(raw)) return buildList(raw);
    return null;
  }
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
    const e = toYouTubeEmbed(input);
    if (!e) {
      setErr("Paste a YouTube video or playlist link.");
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
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          <iframe
            title="YouTube music player"
            src={embed}
            width="100%"
            height="100%"
            frameBorder={0}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
            className="h-full w-full"
          />
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder="Paste a YouTube link…"
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
            Reset to default mix
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
