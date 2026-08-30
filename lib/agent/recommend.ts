// "Just tell me what to do today."
//
// Turns the saved log into one recommendation, following the program's own
// rule: alternate upper body and legs, never the same muscle group two days
// running, and take the rest day when you've earned it.

import { workouts } from "@/lib/workouts";

export type LogEntry = { workoutId: string; date: string };
export const LOG_KEY = "calisthenics-log-v1";

export function loadLog(): LogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export type Recommendation = { id: string; name: string; reason: string };

const isUpper = (id: string) => id.startsWith("upper");
const daysAgo = (iso: string) => (Date.now() - new Date(iso).getTime()) / 864e5;

export function recommend(log: LogEntry[] = loadLog()): Recommendation {
  const sorted = [...log].sort((a, b) => b.date.localeCompare(a.date));
  const last = sorted[0];
  const name = (id: string) => workouts[id]?.name ?? id;

  if (!last) {
    return {
      id: "upper-a",
      name: name("upper-a"),
      reason: "First session — Plan A is the gentlest way in.",
    };
  }

  const gap = daysAgo(last.date);
  const thisWeek = log.filter((l) => daysAgo(l.date) < 7).length;

  // Six sessions in the last week already means today is the rest day.
  if (thisWeek >= 6 && gap < 1) {
    return {
      id: "legs-abs",
      name: name("legs-abs"),
      reason:
        "You've trained 6 days this week — today is your rest day. Rest is when the muscle actually grows, so only start this if you're skipping a day later.",
    };
  }

  if (isUpper(last.workoutId)) {
    return {
      id: "legs-abs",
      name: name("legs-abs"),
      reason:
        gap < 1
          ? "You did upper body today, so legs and abs keeps your arms recovering."
          : "Last session was upper body — legs and abs is next in the split.",
    };
  }

  // Coming off legs: pick whichever upper plan has been neglected longer.
  const lastA = sorted.find((l) => l.workoutId === "upper-a");
  const lastB = sorted.find((l) => l.workoutId === "upper-b");
  const id = !lastA ? "upper-a" : !lastB ? "upper-b" : lastA.date < lastB.date ? "upper-a" : "upper-b";
  return {
    id,
    name: name(id),
    reason:
      gap < 1
        ? "You've already done legs today — this one leaves them alone."
        : `Last session was legs, so upper body is up, and ${
            id === "upper-a" ? "Plan A" : "Plan B"
          } is the one you've left longest.`,
  };
}

export function progressSummary(log: LogEntry[] = loadLog()): string {
  if (log.length === 0) return "No sessions logged yet — the first one is the hard one.";
  const week = log.filter((l) => daysAgo(l.date) < 7).length;
  const sorted = [...log].sort((a, b) => b.date.localeCompare(a.date));
  const gap = daysAgo(sorted[0].date);
  const when =
    gap < 1 ? "today" : gap < 2 ? "yesterday" : `${Math.floor(gap)} days ago`;
  return `${week} session${week === 1 ? "" : "s"} in the last 7 days, ${log.length} in total. Your last one was ${when}.`;
}
