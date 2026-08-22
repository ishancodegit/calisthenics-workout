"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  skills,
  skillById,
  branches,
  sources,
  pathsFor,
  loadEntries,
  saveEntries,
  computeStats,
  statusOf,
  isUnlocked,
  isMastered,
  newlyUnlocked,
  branchProgress,
  fmtStandard,
  fmtValue,
  reqLabel,
  nextGate,
  best,
  type Branch,
  type Entry,
  type Skill,
  type Stats,
  type Status,
} from "@/lib/skilltree";

const PushupCamera = dynamic(() => import("./PushupCamera"), { ssr: false });

/* ------------------------------------------------------------------ */
/* Stopwatch (for hold skills)                                         */
/* ------------------------------------------------------------------ */
function useStopwatch() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const startedRef = useRef(0);
  const baseRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const loop = useCallback(() => {
    setElapsed(baseRef.current + (Date.now() - startedRef.current) / 1000);
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const start = useCallback(() => {
    startedRef.current = Date.now();
    setRunning(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    baseRef.current = baseRef.current + (Date.now() - startedRef.current) / 1000;
    setElapsed(baseRef.current);
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    baseRef.current = 0;
    setElapsed(0);
    setRunning(false);
  }, []);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  return { elapsed, running, start, stop, reset };
}

function beep(freq = 880, dur = 0.18) {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    setTimeout(() => ctx.close().catch(() => {}), (dur + 0.2) * 1000);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Node card                                                           */
/* ------------------------------------------------------------------ */
const STATUS_STYLE: Record<Status, string> = {
  locked: "bg-[#0e0e0e] ring-white/5",
  available: "bg-[#161616] ring-[var(--accent)]/50",
  training: "bg-[#181818] ring-[var(--accent)]/70",
  mastered: "bg-[var(--accent)]/10 ring-[var(--accent)]",
};

const STATUS_BADGE: Record<Status, { label: string; cls: string }> = {
  locked: { label: "🔒 Locked", cls: "bg-white/5 text-white/40" },
  available: { label: "Unlocked", cls: "bg-[var(--accent)]/20 text-[var(--accent)]" },
  training: { label: "Training", cls: "bg-[var(--accent)]/20 text-[var(--accent)]" },
  mastered: { label: "✓ Mastered", cls: "bg-[var(--accent)] text-black" },
};

function NodeCard({
  skill,
  stats,
  onOpen,
}: {
  skill: Skill;
  stats: Stats;
  onOpen: () => void;
}) {
  const status = statusOf(skill, stats);
  const st = stats[skill.id];
  const locked = status === "locked";
  const badge = STATUS_BADGE[status];
  const pct = Math.min(100, ((st?.qualifying ?? 0) / skill.standard.sets) * 100);
  const gate = locked ? null : nextGate(skill.id, stats);

  return (
    <button
      onClick={onOpen}
      className={`w-full rounded-xl px-4 py-3 text-left ring-1 transition active:scale-[0.99] ${STATUS_STYLE[status]} ${
        locked ? "opacity-60" : "hover:ring-[var(--accent)]"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`text-2xl ${locked ? "grayscale" : ""}`}>{locked ? "🔒" : skill.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className={`truncate font-bold ${locked ? "text-white/50" : ""}`}>{skill.name}</h4>
          </div>
          <p className="mt-0.5 text-xs text-white/40">
            {locked ? (
              <>Needs {skill.requires.map(reqLabel).join(" + ")}</>
            ) : (
              <>
                Standard {fmtStandard(skill)}
                {st?.best ? ` · best ${fmtValue(skill, st.best)}` : ""}
              </>
            )}
          </p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      {!locked && (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-white/40">
            {st?.qualifying ?? 0}/{skill.standard.sets} sets
          </span>
        </div>
      )}

      {gate && (
        <p className="mt-1.5 text-[11px] text-[var(--accent)]/70">
          ⤷ {fmtValue(skill, gate.value)} in one set unlocks {gate.opens.map((o) => o.name).join(" + ")}
        </p>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Detail sheet                                                        */
/* ------------------------------------------------------------------ */
function DetailSheet({
  skill,
  stats,
  entries,
  onLog,
  onClose,
  onJump,
}: {
  skill: Skill;
  stats: Stats;
  entries: Entry[];
  onLog: (value: number, src: Entry["src"]) => void;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  const status = statusOf(skill, stats);
  const locked = status === "locked";
  const st = stats[skill.id];
  const isHold = skill.measure === "hold";

  const gate = locked ? null : nextGate(skill.id, stats);
  const [reps, setReps] = useState(skill.standard.value);
  const [showCamera, setShowCamera] = useState(false);
  const watch = useStopwatch();

  useEffect(() => {
    setReps(skill.standard.value);
    watch.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill.id]);

  const history = useMemo(
    () => entries.filter((e) => e.skill === skill.id).slice(-6).reverse(),
    [entries, skill.id]
  );

  const children = useMemo(
    () => skills.filter((k) => k.requires.some((r) => r.skill === skill.id)),
    [skill.id]
  );

  const logHold = () => {
    const secs = Math.round(watch.elapsed);
    if (secs <= 0) return;
    watch.stop();
    onLog(secs, "timer");
    watch.reset();
  };

  return (
    // Above the floating music player (z-40), below the camera overlay (z-50).
    <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[#111] ring-1 ring-white/10 sm:rounded-3xl">
        {/* header */}
        <div className="sticky top-0 z-10 flex items-start gap-3 bg-[#111] px-5 pb-3 pt-5">
          <span className="text-4xl">{locked ? "🔒" : skill.icon}</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-black leading-tight">{skill.name}</h3>
            <p className="mt-0.5 text-xs uppercase tracking-wider text-[var(--accent)]">
              {skill.path} · Standard {fmtStandard(skill)}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg bg-white/5 px-3 py-1.5 text-sm text-white/60">
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 pb-8">
          <p className="text-sm text-white/60">{skill.blurb}</p>

          {/* Requirements */}
          {skill.requires.length > 0 && (
            <div>
              <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-white/40">
                {locked ? "Unlock requirements" : "Unlocked by"}
              </h5>
              <div className="space-y-2">
                {skill.requires.map((r) => {
                  const target = skillById[r.skill];
                  const have = best(stats, r.skill);
                  const met = have >= r.value;
                  return (
                    <button
                      key={r.skill}
                      onClick={() => onJump(r.skill)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ring-1 ${
                        met ? "bg-[var(--accent)]/10 ring-[var(--accent)]/40" : "bg-white/[0.03] ring-white/10"
                      }`}
                    >
                      <span className={met ? "text-[var(--accent)]" : "text-white/30"}>{met ? "✓" : "○"}</span>
                      <span className="flex-1 text-sm">{reqLabel(r)}</span>
                      <span className={`text-xs tabular-nums ${met ? "text-[var(--accent)]" : "text-white/40"}`}>
                        {target ? fmtValue(target, have) : have} / {target ? fmtValue(target, r.value) : r.value}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Your numbers */}
          {!locked && (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Best set", value: st?.best ? fmtValue(skill, st.best) : "—" },
                { label: "Sets at standard", value: `${st?.qualifying ?? 0}/${skill.standard.sets}` },
                { label: isHold ? "Total time" : "Total reps", value: st?.total ? (isHold ? `${st.total}s` : String(st.total)) : "—" },
              ].map((b) => (
                <div key={b.label} className="rounded-xl bg-white/[0.04] px-2 py-3">
                  <div className="text-lg font-black text-[var(--accent)]">{b.value}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-white/40">{b.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Form cues */}
          <div>
            <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-white/40">Form</h5>
            <ul className="space-y-1.5">
              {skill.cues.map((c) => (
                <li key={c} className="flex gap-2 text-sm text-white/65">
                  <span className="text-[var(--accent)]">▸</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>

          {gate && (
            <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.07] px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-widest text-[var(--accent)]">Next unlock</p>
              <p className="mt-1 text-sm text-white/75">
                One set of <span className="font-black text-[var(--accent)]">{fmtValue(skill, gate.value)}</span> opens{" "}
                {gate.opens.map((o) => `${o.icon} ${o.name}`).join(" + ")}
                {st?.best ? (
                  <span className="text-white/45">
                    {" "}
                    — {fmtValue(skill, Math.max(0, gate.value - st.best))} to go
                  </span>
                ) : null}
              </p>
            </div>
          )}

          {/* Logging */}
          {locked ? (
            <p className="rounded-xl bg-white/[0.04] px-4 py-3 text-center text-sm text-white/50">
              Hit the requirements above and this unlocks automatically.
            </p>
          ) : isHold ? (
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <h5 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/40">Log a hold</h5>
              <div className="text-center">
                <div
                  className={`mx-auto flex h-32 w-32 items-center justify-center rounded-full ring-4 ${
                    watch.running ? "ring-[var(--accent)] timer-pulse" : "ring-white/15"
                  }`}
                >
                  <span className="text-4xl font-black tabular-nums">{watch.elapsed.toFixed(1)}</span>
                </div>
                <p className="mt-2 text-xs text-white/40">
                  Target {skill.standard.value}s per set
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  {!watch.running ? (
                    <button
                      onClick={() => {
                        beep(880);
                        watch.start();
                      }}
                      className="rounded-xl bg-[var(--accent)] px-6 py-2.5 font-bold text-black active:scale-95"
                    >
                      ▶ Start
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        beep(660);
                        watch.stop();
                      }}
                      className="rounded-xl bg-white/10 px-6 py-2.5 font-bold active:scale-95"
                    >
                      ⏸ Stop
                    </button>
                  )}
                  <button onClick={watch.reset} className="rounded-xl bg-white/10 px-4 py-2.5 font-semibold active:scale-95">
                    Reset
                  </button>
                </div>
                <button
                  onClick={logHold}
                  disabled={watch.elapsed < 1}
                  className="mt-3 w-full rounded-xl bg-[var(--accent)] py-3 font-black text-black disabled:opacity-30 active:scale-[0.98]"
                >
                  ✓ Log {Math.round(watch.elapsed)}s hold
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white/[0.04] p-4">
              <h5 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/40">Log a set</h5>
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => setReps((n) => Math.max(1, n - 1))}
                  className="h-11 w-11 rounded-xl bg-white/10 text-xl font-bold active:scale-90"
                >
                  −
                </button>
                <div className="w-20 text-center">
                  <div className="text-4xl font-black tabular-nums">{reps}</div>
                  <div className="text-[10px] uppercase tracking-wide text-white/40">
                    reps{skill.standard.perSide ? " / side" : ""}
                  </div>
                </div>
                <button
                  onClick={() => setReps((n) => n + 1)}
                  className="h-11 w-11 rounded-xl bg-white/10 text-xl font-bold active:scale-90"
                >
                  +
                </button>
              </div>
              <button
                onClick={() => onLog(reps, "manual")}
                className="mt-4 w-full rounded-xl bg-[var(--accent)] py-3 font-black text-black active:scale-[0.98]"
              >
                ✓ Log {reps} reps
              </button>
              {skill.cameraMove && (
                <button
                  onClick={() => setShowCamera(true)}
                  className="mt-2 w-full rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 py-2.5 text-sm font-bold text-[var(--accent)] active:scale-95"
                >
                  📷 Count reps with the camera
                </button>
              )}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div>
              <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-white/40">Recent sets</h5>
              <div className="overflow-hidden rounded-xl ring-1 ring-white/5">
                {history.map((e, i) => (
                  <div
                    key={`${e.at}-${i}`}
                    className={`flex items-center justify-between px-4 py-2 text-sm ${i % 2 ? "bg-[#101010]" : "bg-[#161616]"}`}
                  >
                    <span className="text-white/50">
                      {new Date(e.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      <span className="ml-2 text-white/25">
                        {e.src === "camera" ? "📷" : e.src === "timer" ? "⏱" : "✍️"}
                      </span>
                    </span>
                    <span
                      className={`font-bold tabular-nums ${
                        e.value >= skill.standard.value ? "text-[var(--accent)]" : "text-white/60"
                      }`}
                    >
                      {fmtValue(skill, e.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unlocks */}
          {children.length > 0 && (
            <div>
              <h5 className="mb-2 text-xs font-bold uppercase tracking-widest text-white/40">Unlocks</h5>
              <div className="flex flex-wrap gap-2">
                {children.map((c) => {
                  const req = c.requires.find((r) => r.skill === skill.id)!;
                  const open = isUnlocked(c, stats);
                  return (
                    <button
                      key={c.id}
                      onClick={() => onJump(c.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ${
                        open
                          ? "bg-[var(--accent)]/10 text-[var(--accent)] ring-[var(--accent)]/40"
                          : "bg-white/[0.03] text-white/45 ring-white/10"
                      }`}
                    >
                      {open ? c.icon : "🔒"} {c.name}
                      <span className="ml-1.5 opacity-60">at {fmtValue(skill, req.value)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Source */}
          <a
            href={sources[skill.source].url}
            target="_blank"
            rel="noreferrer"
            className="block text-xs text-white/30 underline decoration-white/20 underline-offset-2"
          >
            Standard from: {sources[skill.source].label} ↗
          </a>
        </div>
      </div>

      {showCamera && skill.cameraMove && (
        <PushupCamera
          exerciseName={skill.name}
          target={String(skill.standard.value)}
          move={skill.cameraMove}
          onClose={() => setShowCamera(false)}
          onUseCount={(n) => {
            setShowCamera(false);
            if (n > 0) onLog(n, "camera");
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Unlock celebration                                                  */
/* ------------------------------------------------------------------ */
function UnlockToast({ list, onClose }: { list: Skill[]; onClose: () => void }) {
  useEffect(() => {
    beep(660, 0.18);
    const t = setTimeout(() => beep(990, 0.3), 180);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6 backdrop-blur" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-[var(--accent)] p-7 text-center text-black">
        <div className="text-5xl">🔓</div>
        <h3 className="mt-3 text-2xl font-black uppercase tracking-tight">
          {list.length > 1 ? `${list.length} skills unlocked` : "Skill unlocked"}
        </h3>
        <div className="mt-4 space-y-2">
          {list.map((k) => (
            <div key={k.id} className="rounded-xl bg-black/10 px-4 py-2.5 text-left">
              <div className="flex items-center gap-2">
                <span className="text-xl">{k.icon}</span>
                <span className="font-black">{k.name}</span>
              </div>
              <div className="mt-0.5 text-xs font-medium text-black/60">
                {k.branch.toUpperCase()} · {k.path} · Standard {fmtStandard(k)}
              </div>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="mt-5 w-full rounded-xl bg-black py-3 font-black text-[var(--accent)] active:scale-95">
          Let's go
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main view                                                           */
/* ------------------------------------------------------------------ */
export default function SkillTree({ onExit }: { onExit: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [branch, setBranch] = useState<Branch>("push");
  const [openId, setOpenId] = useState<string | null>(null);
  const [unlocks, setUnlocks] = useState<Skill[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setEntries(loadEntries());
    setHydrated(true);
  }, []);

  const stats = useMemo(() => computeStats(entries), [entries]);

  const log = useCallback(
    (skillId: string, value: number, src: Entry["src"]) => {
      setEntries((prev) => {
        const before = computeStats(prev);
        const next = [...prev, { skill: skillId, value, at: new Date().toISOString(), src }];
        saveEntries(next);
        const gained = newlyUnlocked(before, computeStats(next));
        if (gained.length) setUnlocks(gained);
        else beep(880);
        return next;
      });
    },
    []
  );

  const totals = useMemo(() => {
    const unlocked = skills.filter((k) => isUnlocked(k, stats)).length;
    const mastered = skills.filter((k) => isMastered(k, stats)).length;
    return { unlocked, mastered, total: skills.length };
  }, [stats]);

  const paths = useMemo(() => pathsFor(branch), [branch]);
  const open = openId ? skillById[openId] : null;

  // Jumping to a skill in another branch should switch tabs behind the sheet.
  const jump = (id: string) => {
    const target = skillById[id];
    if (!target) return;
    setBranch(target.branch);
    setOpenId(id);
  };

  if (!hydrated) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24">
      {/* header */}
      <div className="flex items-center justify-between py-4">
        <button onClick={onExit} className="text-sm text-white/50 hover:text-white">
          ‹ Back
        </button>
        <span className="text-xs font-semibold uppercase tracking-wider text-white/40">Skill Tree</span>
        <span className="text-sm font-bold tabular-nums text-[var(--accent)]">
          {totals.mastered}/{totals.total}
        </span>
      </div>

      <div className="rounded-2xl bg-black p-6 ring-1 ring-white/5">
        <h1 className="text-3xl font-black leading-none tracking-tight text-[var(--accent)]">
          CALISTHENICS
          <br />
          SKILL TREE
        </h1>
        <p className="mt-2 text-sm text-[var(--accent)]/70">
          Hit a rep standard, unlock the next move.
        </p>
        <div className="mt-4 flex gap-4 text-xs text-white/50">
          <span>
            <span className="font-bold text-white">{totals.unlocked}</span> unlocked
          </span>
          <span>
            <span className="font-bold text-white">{totals.mastered}</span> mastered
          </span>
          <span>
            <span className="font-bold text-white">{totals.total - totals.unlocked}</span> locked
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
            style={{ width: `${(totals.mastered / totals.total) * 100}%` }}
          />
        </div>
      </div>

      {/* branch tabs */}
      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {branches.map((b) => {
          const p = branchProgress(b.id, stats);
          const active = branch === b.id;
          return (
            <button
              key={b.id}
              onClick={() => setBranch(b.id)}
              className={`shrink-0 rounded-xl px-4 py-2.5 text-left transition ${
                active ? "bg-[var(--accent)] text-black" : "bg-[#141414] text-white/60 hover:bg-[#1c1c1c]"
              }`}
            >
              <div className="text-sm font-black">
                {b.icon} {b.label}
              </div>
              <div className={`text-[10px] font-semibold tabular-nums ${active ? "text-black/60" : "text-white/35"}`}>
                {p.mastered}/{p.total} mastered
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-sm text-white/45">{branches.find((b) => b.id === branch)!.blurb}</p>

      {/* ladders */}
      <div className="mt-5 space-y-8">
        {paths.map((p) => (
          <div key={p.path}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-lg font-black uppercase tracking-tight text-[var(--accent)]">{p.path}</h2>
              <div className="h-px flex-1 bg-white/10" />
            </div>
            {p.tiers.map((tier, i) => (
              <div key={i}>
                {i > 0 && <div className="mx-auto h-4 w-px bg-white/15" />}
                <div className={tier.length > 1 ? "grid gap-2 sm:grid-cols-2" : ""}>
                  {tier.map((k) => (
                    <NodeCard key={k.id} skill={k} stats={stats} onOpen={() => setOpenId(k.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* sources */}
      <div className="mt-10 rounded-2xl bg-[#101010] p-5 ring-1 ring-white/5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">Where these standards come from</h3>
        <ul className="mt-3 space-y-1.5">
          {Object.entries(sources).map(([k, v]) => (
            <li key={k}>
              <a
                href={v.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-white/45 underline decoration-white/15 underline-offset-2 hover:text-white/70"
              >
                {v.label} ↗
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] italic text-white/30">
          Rep and hold targets are the published progression standards from these sources, not estimates.
        </p>
      </div>

      {open && (
        <DetailSheet
          skill={open}
          stats={stats}
          entries={entries}
          onClose={() => setOpenId(null)}
          onJump={jump}
          onLog={(value, src) => log(open.id, value, src)}
        />
      )}

      {unlocks.length > 0 && <UnlockToast list={unlocks} onClose={() => setUnlocks([])} />}
    </div>
  );
}
