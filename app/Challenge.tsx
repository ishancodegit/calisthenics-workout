"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { challengeUrl, type Challenge } from "@/lib/challenge";

const PushupCamera = dynamic(() => import("./PushupCamera"), { ssr: false });

const NAME_KEY = "challenge-name-v1";

export default function ChallengeView({
  incoming,
  onClose,
}: {
  incoming: Challenge | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(
    () => (typeof window !== "undefined" && localStorage.getItem(NAME_KEY)) || ""
  );
  const [secs, setSecs] = useState(incoming?.s ?? 60);
  const [phase, setPhase] = useState<"intro" | "active" | "result">("intro");
  const [reps, setReps] = useState(0);
  const [shared, setShared] = useState("");

  function start() {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
    setPhase("active");
  }

  async function share() {
    const url = challengeUrl({ n: name.trim() || "Someone", r: reps, s: secs });
    const text = `I did ${reps} pushups in ${secs}s 💪 Can you beat me?`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Pushup Challenge", text, url });
        return;
      }
    } catch {
      /* fell through to copy */
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setShared("Link copied!");
    } catch {
      setShared(url);
    }
  }

  // ---- Active: run the AMRAP camera ----
  if (phase === "active") {
    return (
      <PushupCamera
        exerciseName="Pushup Challenge"
        target="0"
        move="pushup"
        amrapSeconds={secs}
        onClose={() => setPhase("intro")}
        onUseCount={(r) => {
          setReps(r);
          setPhase("result");
        }}
      />
    );
  }

  // ---- Result ----
  if (phase === "result") {
    const beat = incoming ? reps > incoming.r : null;
    const tied = incoming ? reps === incoming.r : false;
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl">{beat ? "🏆" : tied ? "🤝" : incoming ? "😤" : "💪"}</div>
        <p className="mt-4 text-7xl font-black text-[var(--accent)]">{reps}</p>
        <p className="text-white/60">pushups in {secs}s (clean form)</p>

        {incoming && (
          <p className="mt-4 text-lg font-bold">
            {tied
              ? `Tied with ${incoming.n} (${incoming.r})!`
              : beat
              ? `You beat ${incoming.n}'s ${incoming.r}! 🎉`
              : `${incoming.n} did ${incoming.r} — so close!`}
          </p>
        )}

        <button onClick={share} className="mt-8 w-full rounded-2xl bg-[var(--accent)] py-4 text-lg font-black text-black active:scale-95">
          {incoming ? "↗ Challenge back" : "↗ Share challenge"}
        </button>
        {shared && <p className="mt-2 break-all text-xs text-white/50">{shared}</p>}

        <button onClick={() => setPhase("intro")} className="mt-4 text-sm text-white/60 hover:text-white">
          Try again
        </button>
        <button onClick={onClose} className="mt-2 text-sm text-white/40 hover:text-white">
          Back to app
        </button>
      </div>
    );
  }

  // ---- Intro ----
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <button onClick={onClose} className="mb-6 self-start text-sm text-white/50 hover:text-white">
        ← Back
      </button>

      <div className="rounded-2xl bg-black p-6 text-center ring-1 ring-white/5">
        <div className="text-5xl">💪</div>
        <h1 className="mt-3 text-3xl font-black text-[var(--accent)]">PUSHUP CHALLENGE</h1>
        <p className="mt-2 text-sm text-white/60">
          Max pushups in {secs} seconds — clean form only (the camera judges depth &amp; a straight body).
        </p>

        {incoming && (
          <div className="mt-5 rounded-xl bg-[var(--accent)]/10 p-4 ring-1 ring-[var(--accent)]/30">
            <p className="text-sm">
              <span className="font-bold text-[var(--accent)]">{incoming.n}</span> did{" "}
              <span className="font-bold">{incoming.r}</span> pushups in {incoming.s}s.
            </p>
            <p className="text-sm font-bold">Can you beat them?</p>
          </div>
        )}
      </div>

      <div className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wider text-white/40">Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (for the share link)"
            className="w-full rounded-xl bg-white/5 px-4 py-3 outline-none ring-1 ring-white/10 placeholder:text-white/30 focus:ring-[var(--accent)]/60"
          />
        </div>

        {!incoming && (
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-white/40">Duration</label>
            <div className="flex gap-2">
              {[30, 60, 90, 120].map((s) => (
                <button
                  key={s}
                  onClick={() => setSecs(s)}
                  className={`flex-1 rounded-lg py-2 text-sm font-bold ${secs === s ? "bg-[var(--accent)] text-black" : "bg-white/5 text-white/50"}`}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={start} className="w-full rounded-2xl bg-[var(--accent)] py-4 text-lg font-black text-black active:scale-[0.98]">
          ▶ Start Challenge
        </button>
      </div>
    </div>
  );
}
