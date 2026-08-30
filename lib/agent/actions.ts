// The coach's action catalog — the complete set of things it can DO in the app.
//
// One list, used three ways: the offline planner maps phrases onto it, the
// Claude planner gets it as tool definitions, and the bus dispatches it to
// whichever component is currently mounted.

export type ActionName =
  | "start_workout"
  | "end_workout"
  | "next_set"
  | "skip_rest"
  | "add_rest"
  | "set_rest"
  | "open_camera"
  | "open_challenge"
  | "open_music"
  | "close_music"
  | "show_plan"
  | "show_progress"
  | "explain";

export type AgentAction = { name: ActionName; args?: Record<string, unknown> };

/** What the coach decided to do, plus what it says while doing it. */
export type Turn = {
  say: string;
  actions: AgentAction[];
  source: "claude" | "offline";
};

/** A snapshot of where the user is, so the planner can act in context. */
export type AgentContext = {
  screen: "home" | "workout" | "challenge";
  workoutName?: string;
  exercise?: string;
  phase?: "work" | "rest";
  setNumber?: number;
  totalSets?: number;
  setsLeft?: number;
  restSeconds?: number;
  hasCamera?: boolean;
  workoutsThisWeek?: number;
  /** Workout id the app would pick if asked to choose. */
  suggestedWorkout?: string;
  /** Actions that are dispatchable right now (depends on the current screen). */
  available: ActionName[];
};

type ActionSpec = {
  name: ActionName;
  /** Written for the model — says when to use it, not just what it is. */
  description: string;
  properties: Record<string, unknown>;
  required: string[];
};

export const ACTION_SPECS: ActionSpec[] = [
  {
    name: "start_workout",
    description:
      "Start a training session. Use 'auto' whenever the person hasn't named a specific session — e.g. 'what should I do today', 'just pick something', 'let's train' — and the app will choose the right one from their weekly split and history.",
    properties: {
      workout: {
        type: "string",
        enum: ["upper-a", "upper-b", "legs-abs", "auto"],
        description:
          "upper-a = upper body, aesthetic focus (pushup variations). upper-b = upper body, strength foundation. legs-abs = legs and core. auto = let the app choose.",
      },
    },
    required: ["workout"],
  },
  {
    name: "end_workout",
    description: "Leave the current session and go back to the home screen.",
    properties: {},
    required: [],
  },
  {
    name: "next_set",
    description:
      "Mark the current set as finished and move on — this starts the rest timer automatically. Use for 'done', 'finished that', 'next'.",
    properties: {},
    required: [],
  },
  {
    name: "skip_rest",
    description: "Cut the rest timer short and go straight to the next set.",
    properties: {},
    required: [],
  },
  {
    name: "add_rest",
    description: "Add more time to the rest timer that is currently running.",
    properties: {
      seconds: { type: "number", description: "Seconds to add, e.g. 15 or 30." },
    },
    required: ["seconds"],
  },
  {
    name: "set_rest",
    description:
      "Change how long the rest between every set is. Use for 'rest less', 'give me two minutes between sets'. Snaps to the nearest supported length (30, 45, 60, 90 or 120 seconds).",
    properties: {
      seconds: { type: "number", description: "Desired rest length in seconds." },
    },
    required: ["seconds"],
  },
  {
    name: "open_camera",
    description:
      "Open the camera rep counter so the phone counts and form-checks the reps of the current exercise. Use for 'count for me', 'watch my form'.",
    properties: {},
    required: [],
  },
  {
    name: "open_challenge",
    description:
      "Open the 60-second max-pushups challenge, which produces a link to send to a friend.",
    properties: {},
    required: [],
  },
  {
    name: "open_music",
    description: "Open the music player.",
    properties: {},
    required: [],
  },
  { name: "close_music", description: "Close the music player.", properties: {}, required: [] },
  {
    name: "show_plan",
    description:
      "Name today's session and the reasoning without starting it. Use this only when starting would be wrong — they're sore, out of time, or on a rest day — and you're offering rather than committing them. If they simply asked what to do, start_workout with 'auto' answers and begins in one move.",
    properties: {},
    required: [],
  },
  {
    name: "show_progress",
    description: "Report how much the person has trained recently.",
    properties: {},
    required: [],
  },
  {
    name: "explain",
    description:
      "Look up an exercise in the program and explain how to do it and what it's for.",
    properties: {
      topic: { type: "string", description: "Exercise name, e.g. 'pike pushups'." },
    },
    required: ["topic"],
  },
];

/** Anthropic tool definitions, derived from the one catalog above. */
export function toolDefinitions() {
  return ACTION_SPECS.map((a) => ({
    name: a.name,
    description: a.description,
    strict: true,
    input_schema: {
      type: "object" as const,
      properties: a.properties,
      required: a.required,
      additionalProperties: false,
    },
  }));
}

const NAMES = new Set<string>(ACTION_SPECS.map((a) => a.name));
export function isActionName(s: unknown): s is ActionName {
  return typeof s === "string" && NAMES.has(s);
}
