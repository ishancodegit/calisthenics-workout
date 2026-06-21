"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  workouts,
  split,
  tips,
  buildSteps,
  type Workout,
  type SetStep,
} from "@/lib/workouts";

// Camera + pose model are heavy and browser-only — load on demand.
const PushupCamera = dynamic(() => import("./PushupCamera"), { ssr: false });
// Music player is client-only (Spotify iframe).
const MusicPlayer = dynamic(() => import("./MusicPlayer"), { ssr: false });

/* ------------------------------------------------------------------ */
/* Sound                                                              */
/* ------------------------------------------------------------------ */
function useBeeper() {
  const ctxRef = useRef<AudioContext | null>(null);
  const ensure = () => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (AC) ctxRef.current = new AC();
    }
    return ctxRef.current;
  };
  const beep = useCallback((freq = 880, duration = 0.15, when = 0) => {
    const ctx = ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }, []);
  const finish = useCallback(() => {
    beep(660, 0.18, 0);
    beep(990, 0.28, 0.2);
  }, [beep]);
  const tick = useCallback(() => beep(520, 0.08), [beep]);
  return { beep, finish, tick };
}

/* ------------------------------------------------------------------ */
/* Countdown                                                          */
/* ------------------------------------------------------------------ */
function useCountdown(onDone: () => void, onTick?: (remaining: number) => void) {
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const targetRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(onDone);
  const tickRef = useRef(onTick);
  doneRef.current = onDone;
  tickRef.current = onTick;
  const lastWholeRef = useRef<number>(-1);

  const stop = useCallback(() => {
    setRunning(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const loop = useCallback(() => {
    const ms = targetRef.current - Date.now();
    const secs = Math.max(0, ms / 1000);
    setRemaining(secs);
    const whole = Math.ceil(secs);
    if (whole !== lastWholeRef.current && whole > 0) {
      lastWholeRef.current = whole;
      tickRef.current?.(whole);
    }
    if (ms <= 0) {
      stop();
      setRemaining(0);
      doneRef.current();
      return;
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [stop]);

  const start = useCallback(
    (seconds: number) => {
      targetRef.current = Date.now() + seconds * 1000;
      lastWholeRef.current = -1;
      setRemaining(seconds);
      setRunning(true);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(loop);
    },
    [loop]
  );

  const pause = useCallback(() => {
    stop();
  }, [stop]);

  const resume = useCallback(() => {
    if (remaining <= 0) return;
    targetRef.current = Date.now() + remaining * 1000;
    setRunning(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [remaining, loop]);

  const addTime = useCallback(
    (secs: number) => {
      targetRef.current += secs * 1000;
      setRemaining((r) => Math.max(0, r + secs));
    },
    []
  );

  useEffect(() => () => stop(), [stop]);

  return { remaining, running, start, pause, resume, stop, addTime };
}

/* ------------------------------------------------------------------ */
/* Progress storage                                                   */
/* ------------------------------------------------------------------ */
type LogEntry = { workoutId: string; date: string };
const LOG_KEY = "calisthenics-log-v1";
const REST_KEY = "calisthenics-rest-v1";

function loadLog(): LogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#141414] px-5 py-3 mb-4">
      <h2 className="text-2xl font-extrabold tracking-tight text-[var(--accent)] uppercase">
        {children}
      </h2>
    </div>
  );
}

function fmt(secs: number) {
  const s = Math.ceil(secs);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, "0")}` : `${r}`;
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */
function Home({ onStart }: { onStart: (id: string) => void }) {
  const [log, setLog] = useState<LogEntry[]>([]);
  useEffect(() => setLog(loadLog()), []);

  const lastDone = (id: string) => {
    const e = log.filter((l) => l.workoutId === id).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!e) return null;
    return new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const countThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 864e5;
    return log.filter((l) => new Date(l.date).getTime() > weekAgo).length;
  }, [log]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-20">
      {/* Banner */}
      <div className="relative mt-4 overflow-hidden rounded-2xl bg-black p-7 ring-1 ring-white/5">
        <div className="pointer-events-none absolute -right-6 -top-6 text-7xl text-[var(--accent)]/20 select-none">✦</div>
        <h1 className="text-4xl font-black leading-none tracking-tight text-[var(--accent)]">
          BEGINNER
          <br />
          CALISTHENICS
        </h1>
        <p className="mt-2 text-sm text-[var(--accent)]/80">Build strength &amp; unlock advanced skills</p>
        <p className="mt-4 text-xs text-white/50">
          {countThisWeek} workout{countThisWeek === 1 ? "" : "s"} logged this week
        </p>
      </div>

      {/* Pick a session */}
      <div className="mt-8">
        <SectionTitle>Start a Session</SectionTitle>
        <div className="space-y-3">
          {Object.values(workouts).map((w: Workout) => {
            const exCount = w.sections.reduce((n, s) => n + s.exercises.length, 0);
            const setCount = w.sections.reduce(
              (n, s) => n + s.exercises.reduce((m, e) => m + e.sets, 0),
              0
            );
            const last = lastDone(w.id);
            return (
              <button
                key={w.id}
                onClick={() => onStart(w.id)}
                className="group w-full rounded-xl bg-[#141414] p-5 text-left ring-1 ring-white/5 transition hover:ring-[var(--accent)]/60 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold">{w.name}</h3>
                  <span className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1 text-sm font-bold text-black transition group-hover:brightness-110">
                    Start ▸
                  </span>
                </div>
                <p className="mt-1 text-sm text-white/55">{w.blurb}</p>
                <p className="mt-3 text-xs font-medium text-white/40">
                  {exCount} exercises · {setCount} sets{last ? ` · last done ${last}` : ""}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Weekly split */}
      <div className="mt-10">
        <SectionTitle>Weekly Training Split</SectionTitle>
        <div className="overflow-hidden rounded-xl ring-1 ring-white/5">
          {split.map((d, i) => (
            <div
              key={d.day}
              className={`flex items-center justify-between px-5 py-3 ${
                i % 2 ? "bg-[#101010]" : "bg-[#161616]"
              }`}
            >
              <span className="text-sm text-white/60">Day {d.day}</span>
              <span className={`text-sm font-semibold ${d.type === "rest" ? "text-white/40" : ""}`}>
                {d.label}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs italic text-white/40">
          Follows the supercompensation principle (48h recovery per muscle group for muscles to grow).
        </p>
      </div>

      {/* Tips */}
      <div className="mt-10">
        <SectionTitle>Rules &amp; Tips</SectionTitle>
        <ul className="space-y-2">
          {tips.map((t) => (
            <li key={t} className="flex gap-2 text-sm text-white/70">
              <span className="text-[var(--accent)]">▸</span>
              {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */
function Runner({ workout, onExit }: { workout: Workout; onExit: () => void }) {
  const steps = useMemo<SetStep[]>(() => buildSteps(workout), [workout]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"work" | "rest" | "done">("work");
  const [restLen, setRestLen] = useState(60);
  const { finish, tick, beep } = useBeeper();

  const step = steps[idx];

  // load saved rest preference
  useEffect(() => {
    const saved = Number(localStorage.getItem(REST_KEY));
    if (saved) setRestLen(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem(REST_KEY, String(restLen));
  }, [restLen]);

  const onRestDone = useCallback(() => {
    finish();
    advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish]);

  const onHoldDone = useCallback(() => {
    finish();
  }, [finish]);

  const rest = useCountdown(onRestDone, (n) => {
    if (n <= 3) tick();
  });
  const hold = useCountdown(onHoldDone, (n) => {
    if (n <= 3) tick();
  });

  function advance() {
    if (idx + 1 >= steps.length) {
      setPhase("done");
      logWorkout();
      return;
    }
    setIdx((i) => i + 1);
    setPhase("work");
    hold.stop();
  }

  function completeSet() {
    hold.stop();
    const isLast = idx + 1 >= steps.length;
    if (isLast) {
      setPhase("done");
      logWorkout();
      return;
    }
    setPhase("rest");
    rest.start(restLen);
  }

  function skipRest() {
    rest.stop();
    finish();
    advance();
  }

  function logWorkout() {
    try {
      const log: LogEntry[] = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
      log.push({ workoutId: workout.id, date: new Date().toISOString() });
      localStorage.setItem(LOG_KEY, JSON.stringify(log));
    } catch {
      /* ignore */
    }
  }

  // ----- Done screen -----
  if (phase === "done") {
    return (
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center">
        <div className="text-6xl">💪</div>
        <h2 className="mt-4 text-3xl font-black text-[var(--accent)]">SESSION COMPLETE</h2>
        <p className="mt-2 text-white/60">{workout.name}</p>
        <p className="mt-1 text-sm text-white/40">{steps.length} sets done · logged for today</p>
        <button
          onClick={onExit}
          className="mt-8 rounded-xl bg-[var(--accent)] px-8 py-3 font-bold text-black active:scale-95"
        >
          Done
        </button>
      </div>
    );
  }

  const progress = (idx / steps.length) * 100;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4">
      {/* top bar */}
      <div className="flex items-center justify-between py-4">
        <button onClick={onExit} className="text-sm text-white/50 hover:text-white">
          ✕ Exit
        </button>
        <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
          {workout.name.split("·")[0].trim()}
        </span>
        <span className="text-sm font-semibold text-white/50">
          {idx + 1}/{steps.length}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* body */}
      <div className="flex flex-1 flex-col items-center justify-center py-6">
        {phase === "rest" ? (
          <RestView
            remaining={rest.remaining}
            running={rest.running}
            restLen={restLen}
            next={steps[idx + 1]}
            onPause={rest.pause}
            onResume={rest.resume}
            onAdd={() => rest.addTime(15)}
            onSkip={skipRest}
          />
        ) : (
          <WorkView
            step={step}
            hold={hold}
            onComplete={completeSet}
            beep={beep}
          />
        )}
      </div>

      {/* rest length selector */}
      <div className="pb-6">
        <p className="mb-2 text-center text-xs uppercase tracking-wider text-white/30">
          Rest between sets
        </p>
        <div className="flex justify-center gap-2">
          {[30, 45, 60, 90, 120].map((s) => (
            <button
              key={s}
              onClick={() => setRestLen(s)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                restLen === s
                  ? "bg-[var(--accent)] text-black"
                  : "bg-white/5 text-white/50 hover:bg-white/10"
              }`}
            >
              {s}s
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----- Work (doing a set) ----- */
function WorkView({
  step,
  hold,
  onComplete,
  beep,
}: {
  step: SetStep;
  hold: ReturnType<typeof useCountdown>;
  onComplete: () => void;
  beep: (f?: number) => void;
}) {
  const isTimed = !!step.exercise.holdSeconds;
  const hasCamera = !!step.exercise.cameraMove;
  const [started, setStarted] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [countedReps, setCountedReps] = useState<number | null>(null);

  // reset local timer state when the step changes
  useEffect(() => {
    setStarted(false);
    setShowCamera(false);
    setCountedReps(null);
    hold.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.exercise.name, step.setNumber]);

  const startHold = () => {
    setStarted(true);
    beep(880);
    hold.start(step.exercise.holdSeconds!);
  };

  const holdFinished = isTimed && started && hold.remaining <= 0;

  return (
    <div className="w-full text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
        {step.sectionTitle} · Exercise {step.exerciseIndex + 1}/{step.totalExercises}
      </p>
      <h1 className="mt-3 text-4xl font-black leading-tight">{step.exercise.name}</h1>

      <div className="mt-4 flex items-center justify-center gap-3">
        <span className="rounded-lg bg-white/5 px-4 py-2 text-sm">
          Set <span className="font-bold text-[var(--accent)]">{step.setNumber}</span> / {step.totalSets}
        </span>
        <span className="rounded-lg bg-white/5 px-4 py-2 text-sm">
          Target <span className="font-bold text-[var(--accent)]">{step.exercise.target}</span>
        </span>
      </div>

      <p className="mx-auto mt-5 max-w-md text-sm text-white/55">{step.exercise.notes}</p>

      {/* Timer (timed exercises only) */}
      {isTimed && (
        <div className="mt-8">
          <div
            className={`mx-auto flex h-48 w-48 items-center justify-center rounded-full ring-4 ${
              hold.running
                ? "ring-[var(--accent)] timer-pulse"
                : holdFinished
                ? "ring-green-400"
                : "ring-white/15"
            }`}
          >
            <span className="text-6xl font-black tabular-nums">
              {started ? fmt(hold.remaining) : step.exercise.holdSeconds}
            </span>
          </div>
          <div className="mt-5 flex justify-center gap-3">
            {!started ? (
              <button
                onClick={startHold}
                className="rounded-xl bg-[var(--accent)] px-8 py-3 font-bold text-black active:scale-95"
              >
                ▶ Start Hold
              </button>
            ) : hold.running ? (
              <button
                onClick={hold.pause}
                className="rounded-xl bg-white/10 px-8 py-3 font-bold active:scale-95"
              >
                ⏸ Pause
              </button>
            ) : !holdFinished ? (
              <button
                onClick={hold.resume}
                className="rounded-xl bg-white/10 px-8 py-3 font-bold active:scale-95"
              >
                ▶ Resume
              </button>
            ) : null}
          </div>
        </div>
      )}

      {countedReps != null && (
        <p className="mt-6 text-sm text-white/70">
          Camera counted{" "}
          <span className="font-bold text-[var(--accent)]">{countedReps}</span> reps
        </p>
      )}

      {/* Camera verify (pushup-family exercises) */}
      {hasCamera && (
        <div className="mt-6">
          <button
            onClick={() => setShowCamera(true)}
            className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-5 py-2.5 text-sm font-bold text-[var(--accent)] active:scale-95"
          >
            📷 Verify reps with camera
          </button>
        </div>
      )}

      {/* Complete set */}
      <div className="mt-8">
        <button
          onClick={onComplete}
          className="w-full max-w-sm rounded-2xl bg-[var(--accent)] py-4 text-lg font-black text-black active:scale-[0.98]"
        >
          {isTimed && !holdFinished ? "Done — Complete Set" : "✓ Complete Set"}
        </button>
      </div>

      {showCamera && (
        <PushupCamera
          exerciseName={step.exercise.name}
          target={step.exercise.target}
          move={step.exercise.cameraMove!}
          onClose={() => setShowCamera(false)}
          onUseCount={(reps) => {
            setCountedReps(reps);
            setShowCamera(false);
            onComplete();
          }}
        />
      )}
    </div>
  );
}

/* ----- Rest ----- */
function RestView({
  remaining,
  running,
  restLen,
  next,
  onPause,
  onResume,
  onAdd,
  onSkip,
}: {
  remaining: number;
  running: boolean;
  restLen: number;
  next?: SetStep;
  onPause: () => void;
  onResume: () => void;
  onAdd: () => void;
  onSkip: () => void;
}) {
  const pct = restLen > 0 ? (remaining / restLen) * 100 : 0;
  return (
    <div className="w-full text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-[var(--accent)]">Rest</p>

      <div className="relative mx-auto mt-6 h-56 w-56">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 45}
            strokeDashoffset={2 * Math.PI * 45 * (1 - pct / 100)}
            style={{ transition: "stroke-dashoffset 0.2s linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-6xl font-black tabular-nums">{fmt(remaining)}</span>
        </div>
      </div>

      {next && (
        <p className="mt-6 text-sm text-white/50">
          Next:{" "}
          <span className="font-semibold text-white">
            {next.exercise.name} · Set {next.setNumber}/{next.totalSets}
          </span>
        </p>
      )}

      <div className="mt-6 flex justify-center gap-3">
        <button onClick={onAdd} className="rounded-xl bg-white/10 px-5 py-3 font-semibold active:scale-95">
          +15s
        </button>
        {running ? (
          <button onClick={onPause} className="rounded-xl bg-white/10 px-5 py-3 font-semibold active:scale-95">
            ⏸ Pause
          </button>
        ) : (
          <button onClick={onResume} className="rounded-xl bg-white/10 px-5 py-3 font-semibold active:scale-95">
            ▶ Resume
          </button>
        )}
        <button onClick={onSkip} className="rounded-xl bg-[var(--accent)] px-5 py-3 font-bold text-black active:scale-95">
          Skip ▸
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */
export default function Page() {
  const [activeId, setActiveId] = useState<string | null>(null);

  // keep screen awake during a session if supported
  useEffect(() => {
    let lock: any = null;
    if (activeId && "wakeLock" in navigator) {
      (navigator as any).wakeLock.requestScreen?.();
      (navigator as any).wakeLock
        .request?.("screen")
        .then((l: any) => (lock = l))
        .catch(() => {});
    }
    return () => {
      try {
        lock?.release?.();
      } catch {
        /* ignore */
      }
    };
  }, [activeId]);

  return (
    <>
      {activeId && workouts[activeId] ? (
        <Runner workout={workouts[activeId]} onExit={() => setActiveId(null)} />
      ) : (
        <Home onStart={setActiveId} />
      )}
      {/* Persistent across views so music keeps playing into a session */}
      <MusicPlayer />
    </>
  );
}
