// The coach's built-in brain.
//
// Runs entirely in the browser, so it works on a gym floor with no signal, no
// account and no API key — which is the point: the app has never needed a
// backend and the coach shouldn't be the thing that changes that. When an
// Anthropic key IS configured, lib/agent/plan.ts prefers Claude and falls back
// to this. Everything here maps plain English onto the same action catalog
// Claude gets, so both planners drive the app through one code path.

import { workouts } from "@/lib/workouts";
import type { AgentAction, AgentContext, Turn } from "./actions";

const REST_STEPS = [30, 45, 60, 90, 120];

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "45 seconds", "a minute", "two mins", "minute and a half" -> seconds. */
function parseDuration(t: string): number | null {
  const half = /minute and a half|1 and a half min|one and a half min/.test(t);
  if (half) return 90;
  if (/half a min/.test(t)) return 30;
  const digits = t.match(/(\d+)\s*(s\b|sec|second|m\b|min|minute)/);
  if (digits) {
    const n = Number(digits[1]);
    return /^m/.test(digits[2]) ? n * 60 : n;
  }
  const words: Record<string, number> = {
    one: 1, a: 1, two: 2, three: 3, four: 4, five: 5,
  };
  const spelled = t.match(/\b(one|a|two|three|four|five)\s*(m\b|min|minute)/);
  if (spelled) return words[spelled[1]] * 60;
  const bare = t.match(/\b(\d{2,3})\b/);
  if (bare && /rest|break|between|wait|timer/.test(t)) return Number(bare[1]);
  return null;
}

function snapRest(seconds: number) {
  return REST_STEPS.reduce((best, s) =>
    Math.abs(s - seconds) < Math.abs(best - seconds) ? s : best
  );
}

function stepRest(current: number, dir: 1 | -1) {
  const i = REST_STEPS.indexOf(snapRest(current));
  return REST_STEPS[Math.min(REST_STEPS.length - 1, Math.max(0, i + dir))];
}

/** Fuzzy-match free text against every exercise in the program. */
export function findExercise(query: string) {
  const q = norm(query).replace(/\b(how|do|i|to|the|a|an|what|is|are|about|my|for|of|explain|form|tell|me)\b/g, " ");
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return null;
  let best: { score: number; ex: any } | null = null;
  for (const w of Object.values(workouts)) {
    for (const section of w.sections) {
      for (const ex of section.exercises) {
        const name = norm(ex.name);
        let score = 0;
        for (const word of words) {
          const stem = word.replace(/(s|es)$/, "");
          if (name.includes(stem)) score += stem.length;
        }
        if (score > 0 && (!best || score > best.score)) best = { score, ex };
      }
    }
  }
  return best?.ex ?? null;
}

function pickUpperPlan(ctx: AgentContext): string {
  // Prefer whichever upper plan the recommendation engine already favours.
  const s = ctx.suggestedWorkout;
  return s && s.startsWith("upper") ? s : "upper-a";
}

function turn(say: string, actions: AgentAction[] = []): Turn {
  return { say, actions, source: "offline" };
}

const A = (name: AgentAction["name"], args?: Record<string, unknown>): AgentAction => ({
  name,
  args,
});

export function planOffline(input: string, ctx: AgentContext): Turn {
  const t = norm(input);
  const inWorkout = ctx.screen === "workout";
  const resting = inWorkout && ctx.phase === "rest";

  if (!t) return turn("Tell me what you want to do and I'll set it up.");

  /* --- pain: never train through it, and never diagnose it --- */
  if (/\b(hurts?|hurting|pain|painful|injured|injury|sharp|tweaked|pulled|strain)\b/.test(t)) {
    return turn(
      "Stop for now — that's pain, not the usual soreness, and I'm not the one to judge it. Get it looked at rather than training through it."
    );
  }

  /* --- leaving (works from the challenge screen too, not just a session) --- */
  if (
    /\b(exit|quit|leave|go back|home|cancel)\b/.test(t) ||
    /\b(stop|end|finish)\b.*\b(workout|session|training|it)\b/.test(t) ||
    /\b(done|finished)\b.*\b(for (today|now)|training)\b/.test(t)
  ) {
    if (ctx.available.includes("end_workout"))
      return turn(inWorkout ? "Ending the session — nice work." : "Back to the home screen.", [
        A("end_workout"),
      ]);
  }

  /* --- mid-set commands --- */
  if (resting && /\b(skip|ready|go now|carry on|next|continue|move on)\b/.test(t)) {
    return turn("Skipping ahead.", [A("skip_rest")]);
  }
  if (
    resting &&
    /\b(more time|longer|another|not ready|need a (bit|sec|minute)|wait)\b/.test(t) &&
    !/\b(breaks?|between sets|rests)\b/.test(t) // that's the standing preference, below
  ) {
    const extra = parseDuration(t) ?? 15;
    return turn(`Adding ${extra} seconds.`, [A("add_rest", { seconds: extra })]);
  }
  if (inWorkout && /\b(done|next|finished|complete|completed|got it|that's it|yep|yes)\b/.test(t)) {
    return turn("Nice — resting now.", [A("next_set")]);
  }

  /* --- rest length --- */
  if (/\b(rest|break|breaks|between sets|timer)\b/.test(t) || /\b(shorter|longer)\b/.test(t)) {
    const explicit = parseDuration(t);
    if (explicit) {
      const s = snapRest(explicit);
      return turn(`Rest is now ${s} seconds between sets.`, [A("set_rest", { seconds: s })]);
    }
    if (/\b(shorter|less|quicker|faster|cut)\b/.test(t)) {
      const s = stepRest(ctx.restSeconds ?? 60, -1);
      return turn(`Shorter breaks — ${s} seconds.`, [A("set_rest", { seconds: s })]);
    }
    if (/\b(longer|more|extend)\b/.test(t)) {
      const s = stepRest(ctx.restSeconds ?? 60, 1);
      return turn(`Longer breaks — ${s} seconds.`, [A("set_rest", { seconds: s })]);
    }
  }

  /* --- camera --- */
  if (
    /\b(camera|count|counting|film|record)\b|watch (me|my)|(check|watch) my form/.test(t)
  ) {
    if (ctx.available.includes("open_camera"))
      return turn("Camera on — I'll count them for you.", [A("open_camera")]);
    return turn(
      "The rep counter lives inside a session. Start one and I'll switch the camera on for you."
    );
  }

  /* --- music --- */
  if (/\b(music|song|songs|playlist|tunes|spotify|play something)\b/.test(t)) {
    if (/\b(off|stop|quiet|silence|pause|close|no)\b/.test(t))
      return turn("Music off.", [A("close_music")]);
    return turn("Putting some music on.", [A("open_music")]);
  }

  /* --- challenge --- */
  if (/\b(challenge|friend|compete|competition|beat|versus|vs|max pushups|amrap)\b/.test(t)) {
    return turn("Here's the 60-second challenge — you'll get a link to send.", [
      A("open_challenge"),
    ]);
  }

  /* --- progress --- */
  if (/\b(progress|streak|history|log|how many|how much|how often|been doing)\b/.test(t)) {
    return turn("", [A("show_progress")]);
  }

  /* --- explain an exercise --- */
  if (
    /\b(how do i|how to|what is|what are|what's|whats|explain|tell me about|form|technique|tips)\b/.test(
      t
    )
  ) {
    const ex = findExercise(t);
    if (ex) return turn("", [A("explain", { topic: ex.name })]);
    // Asked about something — better to say it's not in the program than to
    // silently start a session they didn't ask for.
    if (/\b(how do i|how to|what is|what are|what's|whats|explain|tell me about)\b/.test(t))
      return turn(
        "That's not one of the moves in this program. It covers pushup variations, dips, planche leans, hollow body holds, L-sits, leg raises, squats, lunges and calf raises."
      );
  }

  /* --- tired / short on time --- */
  if (/\b(tired|sore|exhausted|knackered|no energy|aching|rest day|lazy)\b/.test(t)) {
    return turn(
      "Then take it as a rest day — the program builds that in on purpose, and muscle grows while you rest, not while you train. If you still want to move, here's what I'd pick:",
      [A("show_plan")]
    );
  }
  if (/\b(quick|hurry|no time|short on time|rushed|only got|in a rush)\b/.test(t)) {
    return turn("Right — short rests, straight in.", [
      A("set_rest", { seconds: 30 }),
      A("start_workout", { workout: "auto" }),
    ]);
  }

  /* --- start something specific --- */
  const wantsLegs = /\b(leg|legs|lower|squat|squats|lunge|lunges|calf|calves|abs|core|stomach)\b/.test(t);
  const wantsUpper = /\b(upper|arm|arms|chest|push|pushup|pushups|shoulder|shoulders|tricep|triceps|dip|dips|back)\b/.test(t);
  const asksToStart = /\b(start|begin|do|train|work ?out|let's go|lets go|go|ready|session)\b/.test(t);

  if (wantsLegs) return turn("Legs and abs it is.", [A("start_workout", { workout: "legs-abs" })]);
  if (wantsUpper) {
    const id = /\b(strength|strong|foundation|plan b|skill|skills)\b/.test(t)
      ? "upper-b"
      : /\b(aesthetic|aesthetics|look|looks|physique|anime|plan a)\b/.test(t)
      ? "upper-a"
      : pickUpperPlan(ctx);
    return turn(`Upper body — ${workouts[id].name.split("·")[1]?.trim() ?? "let's go"}.`, [
      A("start_workout", { workout: id }),
    ]);
  }

  /* --- what should I do? --- */
  // Asking which session to do is answered by starting it: start_workout
  // reports the pick and the reasoning, so they learn what and why in one
  // move instead of being handed a menu. show_plan is for the cases above,
  // where committing them to a session would be the wrong call.
  const asksWhat = /\b(what|which|should i|recommend|suggest|pick|choose|decide|dunno|don't know|idea)\b/.test(t);
  if (asksToStart || asksWhat) return turn("", [A("start_workout", { workout: "auto" })]);

  /* --- greetings / help --- */
  if (/\b(hi|hey|hello|yo|help|what can you do|how does this work)\b/.test(t)) {
    return turn(
      inWorkout
        ? "I'm here. Say “done” after a set, “skip” to cut a rest short, “count my reps” for the camera, or “stop” to end the session."
        : "Tell me what you want in plain words — “train me”, “I've only got 20 minutes”, “legs today”, “how do I do pike pushups”, or “put some music on”. I'll set it up."
    );
  }

  /* --- nothing matched --- */
  return turn(
    inWorkout
      ? "I didn't catch that. Try “done”, “skip”, “more time”, “count my reps”, or “stop”."
      : "I didn't catch that. Try “what should I do today”, “legs”, “I'm short on time”, or “how do I do dips”."
  );
}
