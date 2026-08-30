"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { planTurn, type ChatMessage } from "@/lib/agent/plan";
import { runAction, snapshot, onAvailabilityChange } from "@/lib/agent/bus";
import type { ActionName } from "@/lib/agent/actions";

/** Actions that only answer a question — the panel stays open for these. */
const ANSWER_ONLY: ActionName[] = ["show_plan", "show_progress", "explain"];

type Bubble = { role: "user" | "coach"; text: string };

function suggestionsFor(screen: string, phase?: string): string[] {
  if (screen === "workout")
    return phase === "rest"
      ? ["Skip the rest", "I need more time", "Done for today"]
      : ["Done", "Count my reps", "How do I do this?", "Shorter rests"];
  return ["What should I do today?", "I've only got 20 minutes", "Legs today", "Put music on"];
}

export default function Coach() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [listening, setListening] = useState(false);
  const [, force] = useState(0);

  const recRef = useRef<any>(null);
  const spokenRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-render when the set of possible actions changes (screen changed).
  useEffect(() => onAvailabilityChange(() => force((n) => n + 1)), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [bubbles, busy]);

  const ctx = snapshot();
  const voiceSupported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const speak = useCallback((text: string) => {
    if (!text || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }, []);

  const flash = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setInput("");
      setBubbles((b) => [...b, { role: "user", text }]);
      setBusy(true);

      const history: ChatMessage[] = bubbles.map((b) => ({
        role: b.role === "coach" ? "assistant" : "user",
        content: b.text,
      }));

      try {
        const turn = await planTurn(text, snapshot(), history);
        const parts = turn.say ? [turn.say] : [];
        let navigated = false;

        for (const action of turn.actions) {
          const result = await runAction(action.name, action.args ?? {});
          if (result.message) parts.push(result.message);
          if (result.ok && !ANSWER_ONLY.includes(action.name)) navigated = true;
        }

        const reply = parts.join(" ").trim() || "Done.";
        setBubbles((b) => [...b, { role: "coach", text: reply }]);
        if (spokenRef.current) speak(reply);
        // If the app moved, get out of the way so they can see what happened.
        if (navigated) {
          setOpen(false);
          flash(reply);
        }
      } finally {
        spokenRef.current = false;
        setBusy(false);
      }
    },
    [bubbles, busy, flash, speak]
  );

  const listen = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.continuous = false;
      rec.onresult = (e: any) => {
        const said = e.results[0][0].transcript;
        spokenRef.current = true; // they talked, so talk back
        send(said);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening, send]);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-start gap-2">
      {/* Panel */}
      <div
        // Keeps the closed panel out of the tab order while it fades.
        inert={!open}
        aria-hidden={!open}
        className={`pointer-events-auto w-[26rem] max-w-[calc(100vw-2rem)] origin-bottom-left rounded-2xl bg-[#141414] shadow-2xl ring-1 ring-white/10 transition-all duration-200 ${
          open ? "scale-100 opacity-100" : "pointer-events-none translate-y-2 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <div>
            <p className="text-sm font-black uppercase tracking-wider text-[var(--accent)]">Coach</p>
            <p className="text-xs text-white/40">Say what you want — I'll set it up</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close coach"
            className="text-white/40 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div ref={scrollRef} className="max-h-64 space-y-2 overflow-y-auto px-4 py-3">
          {bubbles.length === 0 && (
            <p className="py-2 text-sm text-white/45">
              Try “train me”, “I'm knackered”, “how do I do pike pushups”, or just tell me what
              you've got time for.
            </p>
          )}
          {bubbles.map((b, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                b.role === "user"
                  ? "ml-auto bg-white/10 text-white"
                  : "bg-[var(--accent)]/10 text-white/90 ring-1 ring-[var(--accent)]/20"
              }`}
            >
              {b.text}
            </div>
          ))}
          {busy && <p className="text-sm text-white/40">Thinking…</p>}
        </div>

        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {suggestionsFor(ctx.screen, ctx.phase).map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={busy}
              className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2 border-t border-white/5 p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What do you want to do?"
            aria-label="Tell the coach what you want"
            className="min-w-0 flex-1 rounded-xl bg-black/40 px-3 py-2.5 text-sm outline-none ring-1 ring-white/10 placeholder:text-white/30 focus:ring-[var(--accent)]/50"
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={listen}
              aria-label={listening ? "Stop listening" : "Speak to the coach"}
              className={`shrink-0 rounded-xl px-3 py-2.5 text-sm transition ${
                listening ? "bg-red-500/80 text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              🎤
            </button>
          )}
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="shrink-0 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black disabled:opacity-40"
          >
            Go
          </button>
        </form>
      </div>

      {/* Toast — what the coach just did, once the panel is out of the way */}
      {toast && !open && (
        <button
          onClick={() => setToast("")}
          className="pointer-events-auto max-w-[22rem] rounded-xl bg-[#141414] px-4 py-2.5 text-left text-sm text-white/85 shadow-xl ring-1 ring-[var(--accent)]/30"
        >
          {toast}
        </button>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Open coach"
        className="pointer-events-auto flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-3 font-bold text-black shadow-lg active:scale-95"
      >
        {open ? "✕" : "✦ Coach"}
      </button>
    </div>
  );
}
