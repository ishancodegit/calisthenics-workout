"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const SpotifyPlayer = dynamic(() => import("./SpotifyPlayer"), { ssr: false });

// Default YouTube "Workout Playlist 2026" mix (full songs, free, no login).
const DEFAULT_LIST = "PLCULndnUE-_qfnkg7uOUxvCEDa4er9l8O";
const DEFAULT_YT = `https://www.youtube.com/embed/videoseries?list=${DEFAULT_LIST}&rel=0&modestbranding=1`;
// Default Apple Music "Pure Workout" playlist.
const DEFAULT_APPLE =
  "https://embed.music.apple.com/us/playlist/pure-workout/pl.ad0ee1557e3e4feba314fd70f7982766";

const YT_KEY = "calisthenics-music-yt-v1";
const AP_KEY = "calisthenics-music-ap-v1";
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

function toAppleEmbed(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!u.hostname.endsWith("music.apple.com")) return null;
    u.hostname = "embed.music.apple.com"; // idempotent for already-embed links
    return u.toString();
  } catch {
    return null;
  }
}

type Source = "spotify" | "apple" | "youtube";

export default function MusicPlayer() {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>("spotify");
  const [yt, setYt] = useState(DEFAULT_YT);
  const [apple, setApple] = useState(DEFAULT_APPLE);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const savedSrc = localStorage.getItem(SRC_KEY) as Source | null;
    if (savedSrc) setSource(savedSrc);
    const savedYt = localStorage.getItem(YT_KEY);
    if (savedYt) setYt(savedYt);
    const savedAp = localStorage.getItem(AP_KEY);
    if (savedAp) setApple(savedAp);
  }, []);

  function pick(s: Source) {
    setSource(s);
    setErr("");
    setInput("");
    localStorage.setItem(SRC_KEY, s);
  }

  function applyYt() {
    const e = toYouTubeEmbed(input);
    if (!e) return setErr("Paste a YouTube video or playlist link.");
    setYt(e);
    localStorage.setItem(YT_KEY, e);
    setErr("");
    setInput("");
  }

  function applyApple() {
    const e = toAppleEmbed(input);
    if (!e) return setErr("Paste an Apple Music playlist/album/song link.");
    setApple(e);
    localStorage.setItem(AP_KEY, e);
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
          {(["spotify", "apple", "youtube"] as Source[]).map((s) => (
            <button
              key={s}
              onClick={() => pick(s)}
              className={`flex-1 rounded-md py-1.5 text-xs font-bold capitalize transition ${
                source === s ? "bg-[var(--accent)] text-black" : "text-white/50"
              }`}
            >
              {s === "apple" ? "Apple" : s}
            </button>
          ))}
        </div>

        {source === "spotify" && <SpotifyPlayer />}

        {source === "apple" && (
          <>
            <div className="overflow-hidden rounded-xl bg-black">
              <iframe
                title="Apple Music player"
                src={apple}
                height={175}
                width="100%"
                frameBorder={0}
                allow="autoplay *; encrypted-media *; clipboard-write"
                sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
                loading="lazy"
                className="w-full"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyApple()}
                placeholder="Paste an Apple Music link…"
                className="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 placeholder:text-white/30 focus:ring-[var(--accent)]/60"
              />
              <button
                onClick={applyApple}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-black active:scale-95"
              >
                Set
              </button>
            </div>
            <p className="mt-1 text-xs text-white/40">
              Sign in inside the player for full songs (previews otherwise).
            </p>
            {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
          </>
        )}

        {source === "youtube" && (
          <>
            <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
              <iframe
                title="YouTube music player"
                src={yt}
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
