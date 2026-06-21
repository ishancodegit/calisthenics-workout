"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const SpotifyPlayer = dynamic(() => import("./SpotifyPlayer"), { ssr: false });

// Default YouTube "Workout Playlist 2026" mix (full songs, free, no login).
const DEFAULT_LIST = "PLCULndnUE-_qfnkg7uOUxvCEDa4er9l8O";
const DEFAULT_EMBED = `https://www.youtube.com/embed/videoseries?list=${DEFAULT_LIST}&rel=0&modestbranding=1`;
const YT_KEY = "calisthenics-music-yt-v1";
const SRC_KEY = "calisthenics-music-src-v1";

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
    if (host === "youtu.be") videoId = u.pathname.slice(1);
    else if (host.endsWith("youtube.com")) {
      if (u.pathname === "/watch") videoId = u.searchParams.get("v") || "";
      else if (u.pathname.startsWith("/shorts/"))
        videoId = u.pathname.split("/")[2] || "";
      else if (u.pathname.startsWith("/embed/")) {
        const seg = u.pathname.split("/")[2] || "";
        if (seg && seg !== "videoseries") videoId = seg;
      }
    } else return null;
    if (listId) return buildList(listId, videoId || undefined);
    if (videoId) return buildVideo(videoId);
    return null;
  } catch {
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return buildVideo(raw);
    if (/^(PL|RD|UU|LL|FL|OL)[A-Za-z0-9_-]+$/.test(raw)) return buildList(raw);
    return null;
  }
}

type Source = "spotify" | "youtube";

export default function MusicPlayer() {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>("spotify");
  const [embed, setEmbed] = useState(DEFAULT_EMBED);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const savedSrc = localStorage.getItem(SRC_KEY) as Source | null;
    if (savedSrc === "spotify" || savedSrc === "youtube") setSource(savedSrc);
    const savedYt = localStorage.getItem(YT_KEY);
    if (savedYt) setEmbed(savedYt);
  }, []);

  function pick(s: Source) {
    setSource(s);
    localStorage.setItem(SRC_KEY, s);
  }

  function applyYt() {
    const e = toYouTubeEmbed(input);
    if (!e) {
      setErr("Paste a YouTube video or playlist link.");
      return;
    }
    setEmbed(e);
    localStorage.setItem(YT_KEY, e);
    setErr("");
    setInput("");
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      <div
        className={`w-80 max-w-[calc(100vw-2rem)] origin-bottom-right rounded-2xl bg-[#141414] p-3 shadow-2xl ring-1 ring-white/10 transition-all duration-200 ${
          open
            ? "scale-100 opacity-100"
            : "pointer-events-none translate-y-2 scale-95 opacity-0"
        }`}
      >
        {/* source tabs */}
        <div className="mb-3 flex gap-1 rounded-lg bg-black/40 p-1">
          {(["spotify", "youtube"] as Source[]).map((s) => (
            <button
              key={s}
              onClick={() => pick(s)}
              className={`flex-1 rounded-md py-1.5 text-xs font-bold capitalize transition ${
                source === s ? "bg-[var(--accent)] text-black" : "text-white/50"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {source === "spotify" ? (
          <SpotifyPlayer />
        ) : (
          <>
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
                onKeyDown={(e) => e.key === "Enter" && applyYt()}
                placeholder="Paste a YouTube link…"
                className="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 placeholder:text-white/30 focus:ring-[var(--accent)]/60"
              />
              <button
                onClick={applyYt}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-black active:scale-95"
              >
                Set
              </button>
            </div>
            {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
          </>
        )}
      </div>

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
