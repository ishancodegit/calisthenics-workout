"use client";

import { useEffect, useRef, useState } from "react";
import * as sp from "@/lib/spotify";

declare global {
  interface Window {
    Spotify: any;
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

// Default: Spotify "Beast Mode" workout playlist.
const DEFAULT_CTX = "spotify:playlist:37i9dQZF1DX76Wlfdnj7AP";
const CTX_KEY = "spotify-context-v1";

export default function SpotifyPlayer() {
  const [connected, setConnected] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [track, setTrack] = useState<any>(null);
  const [paused, setPaused] = useState(true);
  const [err, setErr] = useState("");
  const [input, setInput] = useState("");
  const playerRef = useRef<any>(null);

  // Handle the OAuth redirect + initial connection state.
  useEffect(() => {
    (async () => {
      if (!sp.hasClientId()) return;
      try {
        await sp.handleRedirect();
      } catch {
        /* ignore */
      }
      if (sp.isConnected()) setConnected(true);
    })();
  }, []);

  // Load the Web Playback SDK once connected.
  useEffect(() => {
    if (!connected) return;

    function init() {
      const player = new window.Spotify.Player({
        name: "Calisthenics Workout",
        getOAuthToken: (cb: (t: string) => void) => {
          sp.getAccessToken().then((t) => t && cb(t));
        },
        volume: 0.7,
      });
      playerRef.current = player;

      player.addListener("ready", ({ device_id }: any) => setDeviceId(device_id));
      player.addListener("not_ready", () => setDeviceId(null));
      player.addListener("player_state_changed", (s: any) => {
        if (!s) return;
        setPaused(s.paused);
        setTrack(s.track_window?.current_track || null);
      });
      player.addListener("authentication_error", () => {
        setErr("Login expired — reconnect Spotify.");
        sp.logout();
        setConnected(false);
      });
      player.addListener("account_error", () =>
        setErr("This Spotify account needs Premium for playback.")
      );
      player.connect();
    }

    if (window.Spotify) {
      init();
    } else {
      window.onSpotifyWebPlaybackSDKReady = init;
      const s = document.createElement("script");
      s.src = "https://sdk.scdn.co/spotify-player.js";
      s.async = true;
      document.body.appendChild(s);
    }

    return () => {
      try {
        playerRef.current?.disconnect();
      } catch {
        /* ignore */
      }
    };
  }, [connected]);

  async function playContext(ctx: string) {
    if (!deviceId) {
      setErr("Player still connecting… try again in a second.");
      return;
    }
    setErr("");
    localStorage.setItem(CTX_KEY, ctx);
    const res = await sp.api(`/me/player/play?device_id=${deviceId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context_uri: ctx }),
    });
    if (res.status === 403)
      setErr("Playback failed — the logged-in account needs Spotify Premium.");
    else if (!res.ok && res.status !== 404)
      setErr("Couldn't start playback.");
  }

  function applyAndPlay() {
    const ctx = sp.toContextUri(input);
    if (!ctx) {
      setErr("Paste a Spotify playlist/album/track link.");
      return;
    }
    setInput("");
    playContext(ctx);
  }

  // ---- Not configured (no Client ID set) ----
  if (!sp.hasClientId()) {
    return (
      <div className="rounded-xl bg-white/5 p-4 text-center text-sm text-white/60">
        Spotify isn&apos;t set up yet. Add your{" "}
        <span className="text-white/80">Client ID</span> to enable full-track
        playback (see README), then redeploy.
      </div>
    );
  }

  // ---- Not connected ----
  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-white/5 p-5 text-center">
        <p className="text-sm text-white/60">
          Log in with a Spotify <span className="text-white/80">Premium</span>{" "}
          account for full songs.
        </p>
        <button
          onClick={() => sp.login()}
          className="rounded-full bg-[#1DB954] px-5 py-2.5 font-bold text-black active:scale-95"
        >
          Connect Spotify
        </button>
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>
    );
  }

  // ---- Connected ----
  const art = track?.album?.images?.[0]?.url;
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-black/40">
          {art && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={art} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {track?.name || "Ready to play"}
          </p>
          <p className="truncate text-xs text-white/50">
            {track?.artists?.map((a: any) => a.name).join(", ") ||
              (deviceId ? "Pick a playlist below" : "Connecting…")}
          </p>
        </div>
      </div>

      {/* transport */}
      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          onClick={() => playerRef.current?.previousTrack()}
          className="rounded-lg bg-white/10 px-3 py-2 active:scale-90"
          aria-label="Previous"
        >
          ⏮
        </button>
        <button
          onClick={() => {
            if (paused && !track) playContext(localStorage.getItem(CTX_KEY) || DEFAULT_CTX);
            else playerRef.current?.togglePlay();
          }}
          className="rounded-lg bg-[var(--accent)] px-5 py-2 font-bold text-black active:scale-90"
          aria-label="Play/Pause"
        >
          {paused ? "▶" : "⏸"}
        </button>
        <button
          onClick={() => playerRef.current?.nextTrack()}
          className="rounded-lg bg-white/10 px-3 py-2 active:scale-90"
          aria-label="Next"
        >
          ⏭
        </button>
      </div>

      {/* playlist input */}
      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyAndPlay()}
          placeholder="Paste a Spotify link…"
          className="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 placeholder:text-white/30 focus:ring-[var(--accent)]/60"
        />
        <button
          onClick={applyAndPlay}
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-black active:scale-95"
        >
          Play
        </button>
      </div>

      <div className="mt-1 flex items-center justify-between">
        {err ? (
          <p className="text-xs text-red-400">{err}</p>
        ) : (
          <button
            onClick={() => playContext(DEFAULT_CTX)}
            className="text-xs text-white/40 hover:text-white/70"
          >
            Play Beast Mode
          </button>
        )}
        <button
          onClick={() => {
            sp.logout();
            setConnected(false);
            setTrack(null);
          }}
          className="text-xs text-white/40 hover:text-white/70"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
