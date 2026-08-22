// ---------------------------------------------------------------------------
// Calisthenics skill tree.
//
// Every node, every rep/second standard and every unlock gate below comes from
// a published progression chart — nothing here is invented. See `sources` for
// the references; each skill names the one it was taken from.
//
// Unlock rule (the whole point of the tree): a skill stays locked until your
// logged best on each prerequisite reaches that prerequisite's standard. Hit
// 10 clean pushups in one set and Diamond Pushups unlock — you never have to
// already be able to do the harder move to get access to it.
// ---------------------------------------------------------------------------

import type { CameraMove } from "@/lib/workouts";

export type Branch = "push" | "pull" | "core" | "legs" | "skill";
export type Measure = "reps" | "hold";

/** A gate: `skill`'s logged best must reach `value` (reps, or seconds for holds). */
export type Req = { skill: string; value: number };

export type Skill = {
  id: string;
  name: string;
  icon: string;
  branch: Branch;
  /** Named ladder inside the branch, e.g. "Pushup Line". */
  path: string;
  /** Depth within the path — nodes sharing a tier are siblings. */
  tier: number;
  measure: Measure;
  /** One qualifying set. Mastery = `sets` sets at or above this. */
  standard: { value: number; sets: number; perSide?: boolean };
  requires: Req[];
  blurb: string;
  cues: string[];
  /** Reuse the on-device pose rep counter where a detector fits the movement. */
  cameraMove?: CameraMove;
  source: SourceKey;
};

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

export type SourceKey =
  | "rr"
  | "hspu"
  | "muscleup"
  | "planche"
  | "frontlever"
  | "archer"
  | "flag"
  | "pistol";

export const sources: Record<SourceKey, { label: string; url: string }> = {
  rr: {
    label: "r/bodyweightfitness Recommended Routine (3×5–8 to progress)",
    url: "https://gist.github.com/sgup/f10f1d57e54b7876495f4bafb6d697eb",
  },
  hspu: {
    label: "Handstand pushup progression — Barbell Physio / caliskills",
    url: "https://thebarbellphysio.com/handstand-pushup-strength-progression/",
  },
  muscleup: {
    label: "Muscle-up prerequisites — 10 strict pull-ups + 15 dips",
    url: "https://bodyproskills.com/articles/muscle-up-prerequisites/",
  },
  planche: {
    label: "Planche progression — GMB Fitness / Calixpert",
    url: "https://gmb.io/planche/",
  },
  frontlever: {
    label: "Front lever progression — Calisthenics Corner",
    url: "https://www.calisthenics-corner.com/skills/human-flag/",
  },
  archer: {
    label: "Archer → one-arm pushup — Calisthenics Corner",
    url: "https://www.calisthenics-corner.com/articles/archer-push-ups/",
  },
  flag: {
    label: "Clutch/human flag — Hybrid Calisthenics (9s tuck clutch flag)",
    url: "https://www.hybridcalisthenics.com/tuck-clutch-flag",
  },
  pistol: {
    label: "Pistol squat progression — Maximum Potential Calisthenics",
    url: "https://www.mpcalisthenics.com/tutorial/pistol-squat-the-ultimate-progression-guide",
  },
};

export const branches: { id: Branch; label: string; icon: string; blurb: string }[] = [
  { id: "push", label: "Push", icon: "🫸", blurb: "Pushups, dips and the road to the handstand pushup." },
  { id: "pull", label: "Pull", icon: "🫴", blurb: "Rows, pull-ups, the muscle-up and beyond." },
  { id: "core", label: "Core", icon: "🔥", blurb: "Hollow body, L-sit and the front lever." },
  { id: "legs", label: "Legs", icon: "🦵", blurb: "Squats to the pistol, plus posterior chain." },
  { id: "skill", label: "Statics", icon: "✦", blurb: "Handstand, planche and human flag holds." },
];

/* ------------------------------------------------------------------ */
/* The tree                                                            */
/* ------------------------------------------------------------------ */

const s = (x: Skill) => x;

export const skills: Skill[] = [
  /* ============================= PUSH ============================= */
  s({
    id: "wall-pushup", name: "Wall Pushups", icon: "🧱", branch: "push", path: "Pushup Line", tier: 0,
    measure: "reps", standard: { value: 15, sets: 3 }, requires: [], cameraMove: "pushup",
    blurb: "The first rung of the Recommended Routine push ladder — hands on a wall, body in one line.",
    cues: ["Hands at chest height, shoulder width", "Body straight from heel to head", "Chest to the wall, full lockout"],
    source: "rr",
  }),
  s({
    id: "incline-pushup", name: "Incline Pushups", icon: "📐", branch: "push", path: "Pushup Line", tier: 1,
    measure: "reps", standard: { value: 12, sets: 3 }, requires: [{ skill: "wall-pushup", value: 15 }], cameraMove: "pushup",
    blurb: "Hands on a bench or table. Lower the surface as you get stronger — that's the whole progression.",
    cues: ["Lower the surface as it gets easy", "Elbows ~45° from the torso", "Chest touches, then lock out"],
    source: "rr",
  }),
  s({
    id: "pushup", name: "Pushups", icon: "💪", branch: "push", path: "Pushup Line", tier: 2,
    measure: "reps", standard: { value: 10, sets: 3 }, requires: [{ skill: "incline-pushup", value: 12 }], cameraMove: "pushup",
    blurb: "The base of almost everything. Chest to the floor, full lockout, body dead straight.",
    cues: ["Squeeze glutes so the hips don't sag", "Chest to the floor", "Full lockout at the top"],
    source: "rr",
  }),
  s({
    id: "diamond-pushup", name: "Diamond Pushups", icon: "💎", branch: "push", path: "Pushup Line", tier: 3,
    measure: "reps", standard: { value: 8, sets: 3 }, requires: [{ skill: "pushup", value: 10 }], cameraMove: "pushup",
    blurb: "Next rung after the full pushup in the Recommended Routine. Hands together, triceps and inner chest.",
    cues: ["Index fingers and thumbs form a diamond", "Elbows stay close to the ribs", "Chest to the hands"],
    source: "rr",
  }),
  s({
    id: "pseudo-planche-pushup", name: "Pseudo Planche Pushups", icon: "🪁", branch: "push", path: "Pushup Line", tier: 4,
    measure: "reps", standard: { value: 8, sets: 3 }, requires: [{ skill: "diamond-pushup", value: 8 }], cameraMove: "pushup",
    blurb: "Top of the Recommended Routine push ladder — hands by the waist, shoulders driven past the wrists.",
    cues: ["Hands at hip level, fingers turned out", "Lean shoulders forward past the wrists", "Protract: push the floor away hard"],
    source: "rr",
  }),
  s({
    id: "archer-pushup", name: "Archer Pushups", icon: "🏹", branch: "push", path: "Pushup Line", tier: 4,
    measure: "reps", standard: { value: 8, sets: 3, perSide: true }, requires: [{ skill: "pushup", value: 20 }], cameraMove: "pushup",
    blurb: "Unilateral pressing. The standard is 20 clean pushups before you load one arm this way.",
    cues: ["Wide hands, one arm bends, the other stays straight", "Keep the hips square — no rotating", "3 sets of 8 per side before moving on"],
    source: "archer",
  }),
  s({
    id: "one-arm-pushup", name: "One-Arm Pushup", icon: "☝️", branch: "push", path: "Pushup Line", tier: 5,
    measure: "reps", standard: { value: 3, sets: 3, perSide: true }, requires: [{ skill: "archer-pushup", value: 8 }], cameraMove: "pushup",
    blurb: "The unilateral pressing endgame — anti-rotation core plus one-arm strength.",
    cues: ["Feet wide for the base", "Free hand behind the back", "Fight the rotation, chest low"],
    source: "archer",
  }),

  s({
    id: "decline-pushup", name: "Decline Pushups", icon: "📉", branch: "push", path: "Handstand Press Line", tier: 0,
    measure: "reps", standard: { value: 15, sets: 3 }, requires: [{ skill: "pushup", value: 20 }], cameraMove: "pushup",
    blurb: "Feet elevated — shifts load to the upper chest and shoulders. First step of the handstand press ladder.",
    cues: ["Feet on a bench or box", "Body in one line, hips high enough not to pike", "Chest to the floor"],
    source: "hspu",
  }),
  s({
    id: "pike-pushup", name: "Pike Pushups", icon: "⛰️", branch: "push", path: "Handstand Press Line", tier: 1,
    measure: "reps", standard: { value: 15, sets: 3 }, requires: [{ skill: "decline-pushup", value: 15 }], cameraMove: "pike",
    blurb: "Hips high, pressing overhead. This is where handstand pushup strength actually starts.",
    cues: ["Hips stacked over the shoulders", "Crown of the head to the floor", "Elbows track forward, not flared"],
    source: "hspu",
  }),
  s({
    id: "elevated-pike-pushup", name: "Elevated Pike Pushups", icon: "🗻", branch: "push", path: "Handstand Press Line", tier: 2,
    measure: "reps", standard: { value: 10, sets: 3 }, requires: [{ skill: "pike-pushup", value: 15 }], cameraMove: "pike",
    blurb: "Feet on a box so the torso goes near-vertical — the closest thing to a handstand pushup on the floor.",
    cues: ["The higher the feet, the harder", "Keep the elbows in", "Head to the floor between the hands"],
    source: "hspu",
  }),
  s({
    id: "wall-hspu", name: "Wall Handstand Pushups", icon: "🙃", branch: "push", path: "Handstand Press Line", tier: 3,
    measure: "reps", standard: { value: 10, sets: 3 },
    requires: [{ skill: "elevated-pike-pushup", value: 10 }, { skill: "chest-to-wall-handstand", value: 45 }], cameraMove: "pike",
    blurb: "Full inverted press against the wall. Needs both the pressing strength and a solid 45s wall handstand.",
    cues: ["Chest to wall if you can — it keeps the line honest", "Head to the floor, full lockout", "Ribs down, no arching"],
    source: "hspu",
  }),
  s({
    id: "freestanding-hspu", name: "Freestanding HSPU", icon: "👑", branch: "push", path: "Handstand Press Line", tier: 4,
    measure: "reps", standard: { value: 3, sets: 3 },
    requires: [{ skill: "wall-hspu", value: 10 }, { skill: "handstand", value: 30 }], cameraMove: "pike",
    blurb: "The pressing skill everything else was building toward — balance and strength at the same time.",
    cues: ["Balance first: 30s free handstand", "Slow negatives before full reps", "Fingers grip to steer the balance"],
    source: "hspu",
  }),

  s({
    id: "support-hold", name: "Parallel Bar Support Hold", icon: "🤸", branch: "push", path: "Dip Line", tier: 0,
    measure: "hold", standard: { value: 30, sets: 3 }, requires: [],
    blurb: "First rung of the Recommended Routine dip ladder — teach the shoulders to hold you locked out.",
    cues: ["Arms locked, shoulders pushed down away from the ears", "Ribs down, legs together", "Hold 30s before moving on"],
    source: "rr",
  }),
  s({
    id: "negative-dip", name: "Negative Dips", icon: "⬇️", branch: "push", path: "Dip Line", tier: 1,
    measure: "reps", standard: { value: 5, sets: 3 }, requires: [{ skill: "support-hold", value: 30 }], cameraMove: "dip",
    blurb: "Lower slowly, step back up. Builds the bottom-range strength a full dip needs.",
    cues: ["3–5 seconds down", "Shoulders stay down, elbows back", "Stop at shoulders-below-elbows depth"],
    source: "rr",
  }),
  s({
    id: "dip", name: "Parallel Bar Dips", icon: "🏋️", branch: "push", path: "Dip Line", tier: 2,
    measure: "reps", standard: { value: 8, sets: 3 }, requires: [{ skill: "negative-dip", value: 5 }], cameraMove: "dip",
    blurb: "Lower chest, triceps and shoulders. Also half the muscle-up entry requirement.",
    cues: ["Slight forward lean for the chest", "Shoulders below elbows at the bottom", "Lock out fully at the top"],
    source: "rr",
  }),
  s({
    id: "ring-dip", name: "Ring Dips", icon: "⭕", branch: "push", path: "Dip Line", tier: 3,
    measure: "reps", standard: { value: 8, sets: 3 }, requires: [{ skill: "dip", value: 12 }], cameraMove: "dip",
    blurb: "Top of the dip ladder — the rings add a stability tax that bars never charge you.",
    cues: ["Turn the rings out at the top", "Keep them pressed against the body", "No swinging — control the descent"],
    source: "rr",
  }),

  /* ============================= PULL ============================= */
  s({
    id: "dead-hang", name: "Dead Hang", icon: "🪝", branch: "pull", path: "Pull-up Line", tier: 0,
    measure: "hold", standard: { value: 30, sets: 3 }, requires: [],
    blurb: "Grip and shoulder tolerance first. Everything on a bar starts here.",
    cues: ["Full grip, thumb around the bar", "Shoulders relaxed but not collapsed", "Breathe — 30s is the target"],
    source: "rr",
  }),
  s({
    id: "scapular-pull", name: "Scapular Pulls", icon: "🔗", branch: "pull", path: "Pull-up Line", tier: 1,
    measure: "reps", standard: { value: 8, sets: 3 }, requires: [{ skill: "dead-hang", value: 30 }], cameraMove: "pullup",
    blurb: "First rung of the Recommended Routine pull ladder — arms stay straight, only the shoulder blades move.",
    cues: ["Arms locked the whole time", "Pull the shoulder blades down and back", "Small range — that's correct"],
    source: "rr",
  }),
  s({
    id: "arch-hang", name: "Arch Hangs", icon: "🌙", branch: "pull", path: "Pull-up Line", tier: 2,
    measure: "hold", standard: { value: 20, sets: 3 }, requires: [{ skill: "scapular-pull", value: 8 }],
    blurb: "Hang with the chest open and the head through — teaches the top-range position of a pull-up.",
    cues: ["Shoulder blades retracted and down", "Chest up toward the bar", "Hold the arch, don't bend the arms"],
    source: "rr",
  }),
  s({
    id: "negative-pullup", name: "Negative Pull-ups", icon: "🪂", branch: "pull", path: "Pull-up Line", tier: 3,
    measure: "reps", standard: { value: 5, sets: 3 }, requires: [{ skill: "arch-hang", value: 20 }], cameraMove: "pullup",
    blurb: "Jump to the top, lower under control. The fastest honest route to a first pull-up.",
    cues: ["5 seconds down, every rep", "Chin over the bar at the start", "Stay tight — no swinging"],
    source: "rr",
  }),
  s({
    id: "pullup", name: "Pull-ups", icon: "🎯", branch: "pull", path: "Pull-up Line", tier: 4,
    measure: "reps", standard: { value: 8, sets: 3 }, requires: [{ skill: "negative-pullup", value: 5 }], cameraMove: "pullup",
    blurb: "Dead hang to chin over bar, no kip. The gateway to every advanced pulling skill.",
    cues: ["Start from a full dead hang", "Chin clearly over the bar", "Lower all the way down each rep"],
    source: "rr",
  }),
  s({
    id: "chest-to-bar", name: "Chest-to-Bar Pull-ups", icon: "💥", branch: "pull", path: "Pull-up Line", tier: 5,
    measure: "reps", standard: { value: 5, sets: 3 }, requires: [{ skill: "pullup", value: 10 }], cameraMove: "pullup",
    blurb: "Pull higher than a normal rep. This is the height a muscle-up actually needs.",
    cues: ["Chest touches the bar, not the chin", "Lean back slightly at the top", "Pull the elbows down and back hard"],
    source: "muscleup",
  }),
  s({
    id: "weighted-pullup", name: "Weighted Pull-ups", icon: "⚖️", branch: "pull", path: "Pull-up Line", tier: 5,
    measure: "reps", standard: { value: 5, sets: 3 }, requires: [{ skill: "pullup", value: 12 }], cameraMove: "pullup",
    blurb: "Top of the Recommended Routine pull ladder, and the strength base for one-arm work.",
    cues: ["Add weight in small jumps", "Same strict range as bodyweight", "3×5 before adding more"],
    source: "rr",
  }),
  s({
    id: "muscle-up", name: "Muscle-Up", icon: "🚀", branch: "pull", path: "Pull-up Line", tier: 6,
    measure: "reps", standard: { value: 3, sets: 3 },
    requires: [{ skill: "chest-to-bar", value: 5 }, { skill: "pullup", value: 10 }, { skill: "dip", value: 15 }],
    blurb: "Pull over the bar and press out. The commonly cited entry standard is 10 strict pull-ups and 15 dips.",
    cues: ["False grip helps the transition", "Pull to the sternum, then roll the wrists over", "Finish with a full dip lockout"],
    source: "muscleup",
  }),
  s({
    id: "archer-pullup", name: "Archer Pull-ups", icon: "🏹", branch: "pull", path: "Pull-up Line", tier: 6,
    measure: "reps", standard: { value: 5, sets: 3, perSide: true }, requires: [{ skill: "weighted-pullup", value: 5 }], cameraMove: "pullup",
    blurb: "Shift the load onto one arm while the other assists — the standard bridge to a one-arm pull-up.",
    cues: ["Wide grip, pull to one hand", "Assisting arm stays straight", "Chin to the working hand"],
    source: "rr",
  }),
  s({
    id: "one-arm-pullup", name: "One-Arm Pull-up", icon: "👑", branch: "pull", path: "Pull-up Line", tier: 7,
    measure: "reps", standard: { value: 1, sets: 3, perSide: true }, requires: [{ skill: "archer-pullup", value: 5 }],
    blurb: "The rarest pulling feat in calisthenics. Years, not weeks — build it with negatives.",
    cues: ["Train slow one-arm negatives first", "Elbow stays under the bar", "Fight the rotation with the core"],
    source: "rr",
  }),

  s({
    id: "vertical-row", name: "Vertical Rows", icon: "🚪", branch: "pull", path: "Row Line", tier: 0,
    measure: "reps", standard: { value: 12, sets: 3 }, requires: [], cameraMove: "row",
    blurb: "First rung of the Recommended Routine row ladder — nearly upright, minimal load.",
    cues: ["Feet close to the anchor, body near vertical", "Pull the chest to the hands", "Shoulder blades together"],
    source: "rr",
  }),
  s({
    id: "incline-row", name: "Incline Rows", icon: "📐", branch: "pull", path: "Row Line", tier: 1,
    measure: "reps", standard: { value: 10, sets: 3 }, requires: [{ skill: "vertical-row", value: 12 }], cameraMove: "row",
    blurb: "Walk the feet out to lower the angle and raise the load.",
    cues: ["Body in one straight line", "Elbows ~45°", "Pause at the top of each rep"],
    source: "rr",
  }),
  s({
    id: "horizontal-row", name: "Horizontal Rows", icon: "➖", branch: "pull", path: "Row Line", tier: 2,
    measure: "reps", standard: { value: 8, sets: 3 }, requires: [{ skill: "incline-row", value: 10 }], cameraMove: "row",
    blurb: "Body fully horizontal under the bar or rings. This is the real row standard.",
    cues: ["Heels on the floor, hips locked out", "Chest to the bar", "No hip sag"],
    source: "rr",
  }),
  s({
    id: "wide-row", name: "Wide Rows", icon: "↔️", branch: "pull", path: "Row Line", tier: 3,
    measure: "reps", standard: { value: 8, sets: 3 }, requires: [{ skill: "horizontal-row", value: 8 }], cameraMove: "row",
    blurb: "Wide grip biases the upper back and rear delts.",
    cues: ["Hands well outside shoulder width", "Elbows flare out to ~90°", "Squeeze at the top"],
    source: "rr",
  }),
  s({
    id: "archer-row", name: "Archer Rows", icon: "🏹", branch: "pull", path: "Row Line", tier: 4,
    measure: "reps", standard: { value: 8, sets: 3, perSide: true }, requires: [{ skill: "wide-row", value: 8 }], cameraMove: "row",
    blurb: "Top of the row ladder — one arm does the work, the other just guides.",
    cues: ["Pull toward one hand", "Other arm stays straight", "Hips square to the ceiling"],
    source: "rr",
  }),

  /* ============================= CORE ============================= */
  s({
    id: "plank", name: "Plank", icon: "🪵", branch: "core", path: "Hollow & Hanging Line", tier: 0,
    measure: "hold", standard: { value: 60, sets: 3 }, requires: [],
    blurb: "Anti-extension base of the Recommended Routine core work. Everything static needs this first.",
    cues: ["Elbows under shoulders", "Glutes and quads squeezed", "Ribs down — no arch"],
    source: "rr",
  }),
  s({
    id: "hollow-body-hold", name: "Hollow Body Hold", icon: "🌙", branch: "core", path: "Hollow & Hanging Line", tier: 1,
    measure: "hold", standard: { value: 30, sets: 3 }, requires: [{ skill: "plank", value: 60 }],
    blurb: "The body position every static skill borrows — planche, front lever, handstand.",
    cues: ["Lower back pressed flat into the floor", "Arms by the ears, legs straight", "Lower the limbs only as far as the back stays flat"],
    source: "rr",
  }),
  s({
    id: "lying-leg-raise", name: "Lying Leg Raises", icon: "🦶", branch: "core", path: "Hollow & Hanging Line", tier: 2,
    measure: "reps", standard: { value: 12, sets: 3 }, requires: [{ skill: "hollow-body-hold", value: 30 }], cameraMove: "legraise",
    blurb: "Lower abs and hip flexors — the dynamic counterpart to the hollow hold.",
    cues: ["Back stays flat on the floor", "Legs straight, lower slowly", "Stop before the back arches"],
    source: "rr",
  }),
  s({
    id: "hanging-knee-raise", name: "Hanging Knee Raises", icon: "🍤", branch: "core", path: "Hollow & Hanging Line", tier: 3,
    measure: "reps", standard: { value: 12, sets: 3 },
    requires: [{ skill: "lying-leg-raise", value: 12 }, { skill: "dead-hang", value: 30 }],
    blurb: "Same job as the leg raise, now fighting gravity from a hang.",
    cues: ["Knees above hip height", "No swinging — pause at the bottom", "Posteriorly tilt the pelvis at the top"],
    source: "rr",
  }),
  s({
    id: "hanging-leg-raise", name: "Hanging Leg Raises", icon: "📏", branch: "core", path: "Hollow & Hanging Line", tier: 4,
    measure: "reps", standard: { value: 10, sets: 3 }, requires: [{ skill: "hanging-knee-raise", value: 12 }],
    blurb: "Straight legs to horizontal. Also a front lever prerequisite.",
    cues: ["Legs dead straight", "Toes to bar height", "Control the way down"],
    source: "rr",
  }),
  s({
    id: "toes-to-bar", name: "Toes-to-Bar", icon: "🎪", branch: "core", path: "Hollow & Hanging Line", tier: 5,
    measure: "reps", standard: { value: 8, sets: 3 }, requires: [{ skill: "hanging-leg-raise", value: 10 }],
    blurb: "Full-range hanging compression — top of the hanging core ladder.",
    cues: ["Toes actually touch the bar", "Strict, no kip", "Lower under control every rep"],
    source: "rr",
  }),

  s({
    id: "foot-supported-lsit", name: "Foot-Supported L-Sit", icon: "🪑", branch: "core", path: "L-Sit Line", tier: 0,
    measure: "hold", standard: { value: 20, sets: 3 }, requires: [{ skill: "plank", value: 60 }],
    blurb: "Support on parallettes with the heels on the floor. Teaches the lockout and depression.",
    cues: ["Arms locked, shoulders pushed down", "Chest up, legs straight ahead", "Take weight off the heels gradually"],
    source: "rr",
  }),
  s({
    id: "tuck-lsit", name: "Tuck L-Sit", icon: "🥚", branch: "core", path: "L-Sit Line", tier: 1,
    measure: "hold", standard: { value: 15, sets: 3 }, requires: [{ skill: "foot-supported-lsit", value: 20 }],
    blurb: "Knees tucked, feet off the floor. First true L-sit hold.",
    cues: ["Knees to the chest", "Shoulders depressed, arms locked", "Round the lower back slightly"],
    source: "rr",
  }),
  s({
    id: "one-leg-lsit", name: "One-Leg L-Sit", icon: "🦩", branch: "core", path: "L-Sit Line", tier: 2,
    measure: "hold", standard: { value: 10, sets: 3, perSide: true }, requires: [{ skill: "tuck-lsit", value: 15 }],
    blurb: "One leg extended — half the lever, twice the difficulty of the tuck.",
    cues: ["Extended leg dead straight and level", "Alternate sides each set", "Keep the hips square"],
    source: "rr",
  }),
  s({
    id: "lsit", name: "L-Sit", icon: "🅱️", branch: "core", path: "L-Sit Line", tier: 3,
    measure: "hold", standard: { value: 15, sets: 3 }, requires: [{ skill: "one-leg-lsit", value: 10 }],
    blurb: "Both legs straight and horizontal. A genuine calisthenics milestone.",
    cues: ["Legs at or above hip height", "Toes pointed, quads locked", "Shoulders stay pushed down"],
    source: "rr",
  }),
  s({
    id: "vsit", name: "V-Sit", icon: "✌️", branch: "core", path: "L-Sit Line", tier: 4,
    measure: "hold", standard: { value: 5, sets: 3 }, requires: [{ skill: "lsit", value: 15 }],
    blurb: "Legs raised above horizontal — compression strength well past the L-sit.",
    cues: ["Lean the shoulders back", "Actively compress the hips", "Legs above shoulder height"],
    source: "rr",
  }),

  s({
    id: "tuck-front-lever", name: "Tuck Front Lever", icon: "🥚", branch: "core", path: "Front Lever Line", tier: 0,
    measure: "hold", standard: { value: 15, sets: 3 },
    requires: [{ skill: "pullup", value: 8 }, { skill: "hanging-leg-raise", value: 10 }],
    blurb: "Knees to chest, back parallel to the floor. Target is roughly a 10–15s hold.",
    cues: ["Hips level with the shoulders", "Arms straight, shoulder blades depressed", "Back flat, not arched"],
    source: "frontlever",
  }),
  s({
    id: "adv-tuck-front-lever", name: "Advanced Tuck Front Lever", icon: "🐣", branch: "core", path: "Front Lever Line", tier: 1,
    measure: "hold", standard: { value: 20, sets: 3 }, requires: [{ skill: "tuck-front-lever", value: 15 }],
    blurb: "Knees open past 90°, back flat. Roughly 65–70% of bodyweight on the lever.",
    cues: ["Open the knees, keep the back flat", "Push down on the bar with straight arms", "Hips do not drop"],
    source: "frontlever",
  }),
  s({
    id: "one-leg-front-lever", name: "One-Leg Front Lever", icon: "🦩", branch: "core", path: "Front Lever Line", tier: 2,
    measure: "hold", standard: { value: 15, sets: 3, perSide: true }, requires: [{ skill: "adv-tuck-front-lever", value: 20 }],
    blurb: "One leg extended, one tucked. The step between advanced tuck and straddle.",
    cues: ["Extended leg fully locked", "Hips square, body level", "Swap the lead leg each set"],
    source: "frontlever",
  }),
  s({
    id: "straddle-front-lever", name: "Straddle Front Lever", icon: "🔱", branch: "core", path: "Front Lever Line", tier: 3,
    measure: "hold", standard: { value: 10, sets: 3 }, requires: [{ skill: "one-leg-front-lever", value: 15 }],
    blurb: "Legs straight and wide — the last progression before the full lever.",
    cues: ["The wider the straddle, the easier", "Body one flat line", "Straight arms throughout"],
    source: "frontlever",
  }),
  s({
    id: "front-lever", name: "Front Lever", icon: "👑", branch: "core", path: "Front Lever Line", tier: 4,
    measure: "hold", standard: { value: 5, sets: 3 }, requires: [{ skill: "straddle-front-lever", value: 10 }],
    blurb: "Full body horizontal under the bar. One of the signature calisthenics statics.",
    cues: ["Legs together, toes pointed", "Whole body one rigid line", "Pull the bar toward the hips"],
    source: "frontlever",
  }),

  /* ============================= LEGS ============================= */
  s({
    id: "assisted-squat", name: "Assisted Squats", icon: "🪑", branch: "legs", path: "Squat Line", tier: 0,
    measure: "reps", standard: { value: 15, sets: 3 }, requires: [], cameraMove: "squat",
    blurb: "First rung of the Recommended Routine squat ladder — hold a support to learn full depth.",
    cues: ["Hold a doorframe or rack", "Sit all the way down", "Knees track over the toes"],
    source: "rr",
  }),
  s({
    id: "squat", name: "Bodyweight Squats", icon: "🦵", branch: "legs", path: "Squat Line", tier: 1,
    measure: "reps", standard: { value: 20, sets: 3 }, requires: [{ skill: "assisted-squat", value: 15 }], cameraMove: "squat",
    blurb: "Unassisted, full depth. Fifteen clean reps is the usual entry point for single-leg work.",
    cues: ["Hips below the knees", "Heels stay on the floor", "Chest up, neutral spine"],
    source: "rr",
  }),
  s({
    id: "split-squat", name: "Split Squats", icon: "🚶", branch: "legs", path: "Squat Line", tier: 2,
    measure: "reps", standard: { value: 12, sets: 3, perSide: true }, requires: [{ skill: "squat", value: 20 }], cameraMove: "lunge",
    blurb: "Static lunge — the first genuinely single-leg rung.",
    cues: ["Back knee lightly touches the floor", "Front shin near vertical", "Torso upright"],
    source: "rr",
  }),
  s({
    id: "bulgarian-split-squat", name: "Bulgarian Split Squats", icon: "🇧🇬", branch: "legs", path: "Squat Line", tier: 3,
    measure: "reps", standard: { value: 10, sets: 3, perSide: true }, requires: [{ skill: "split-squat", value: 12 }], cameraMove: "lunge",
    blurb: "Back foot elevated — the standard bridge toward the pistol squat.",
    cues: ["Rear foot on a bench behind you", "Front leg takes almost all the load", "Full depth on the front leg"],
    source: "pistol",
  }),
  s({
    id: "box-pistol", name: "Box Pistol Squats", icon: "📦", branch: "legs", path: "Squat Line", tier: 4,
    measure: "reps", standard: { value: 8, sets: 3, perSide: true }, requires: [{ skill: "bulgarian-split-squat", value: 10 }], cameraMove: "squat",
    blurb: "Pistol motion to a bench — same pattern, half the range. Lower the box over time.",
    cues: ["Sit to the box, don't drop", "Free leg straight out front", "Stand up without rocking"],
    source: "pistol",
  }),
  s({
    id: "pistol-squat", name: "Pistol Squat", icon: "🔫", branch: "legs", path: "Squat Line", tier: 5,
    measure: "reps", standard: { value: 5, sets: 3, perSide: true }, requires: [{ skill: "box-pistol", value: 8 }], cameraMove: "squat",
    blurb: "Full-depth one-leg squat. The classic lower-body calisthenics milestone.",
    cues: ["Free leg parallel to the floor", "Heel down the whole rep", "Arms forward for balance"],
    source: "pistol",
  }),

  s({
    id: "beginner-shrimp", name: "Beginner Shrimp Squat", icon: "🦐", branch: "legs", path: "Shrimp Line", tier: 0,
    measure: "reps", standard: { value: 8, sets: 3, perSide: true }, requires: [{ skill: "bulgarian-split-squat", value: 10 }], cameraMove: "lunge",
    blurb: "The Recommended Routine's single-leg line — rear foot held, hands assist on the floor.",
    cues: ["Hold the rear foot behind you", "Back knee to the floor", "Hands may touch down to assist"],
    source: "rr",
  }),
  s({
    id: "intermediate-shrimp", name: "Intermediate Shrimp Squat", icon: "🦐", branch: "legs", path: "Shrimp Line", tier: 1,
    measure: "reps", standard: { value: 6, sets: 3, perSide: true }, requires: [{ skill: "beginner-shrimp", value: 8 }], cameraMove: "lunge",
    blurb: "Same movement, no hand assist.",
    cues: ["No hands on the floor", "Torso upright", "Knee touches lightly, then drive up"],
    source: "rr",
  }),
  s({
    id: "advanced-shrimp", name: "Advanced Shrimp Squat", icon: "🦞", branch: "legs", path: "Shrimp Line", tier: 2,
    measure: "reps", standard: { value: 5, sets: 3, perSide: true }, requires: [{ skill: "intermediate-shrimp", value: 6 }], cameraMove: "lunge",
    blurb: "Top of the squat ladder — from an elevated surface for extra range.",
    cues: ["Stand on a plate or low box", "Full range, knee below the platform", "Stay upright throughout"],
    source: "rr",
  }),

  s({
    id: "romanian-deadlift", name: "Romanian Deadlift", icon: "🍑", branch: "legs", path: "Posterior Chain", tier: 0,
    measure: "reps", standard: { value: 15, sets: 3 }, requires: [],
    blurb: "First rung of the Recommended Routine hinge ladder — hamstrings and glutes.",
    cues: ["Hinge at the hips, not the spine", "Soft knees, long back", "Feel the hamstrings stretch"],
    source: "rr",
  }),
  s({
    id: "single-leg-deadlift", name: "Single-Leg Deadlift", icon: "🦩", branch: "legs", path: "Posterior Chain", tier: 1,
    measure: "reps", standard: { value: 10, sets: 3, perSide: true }, requires: [{ skill: "romanian-deadlift", value: 15 }],
    blurb: "Adds balance and fixes left/right imbalance.",
    cues: ["Back leg and torso form one line", "Hips stay square", "Slow and controlled"],
    source: "rr",
  }),
  s({
    id: "banded-nordic", name: "Banded Nordic Curl", icon: "🎗️", branch: "legs", path: "Posterior Chain", tier: 2,
    measure: "reps", standard: { value: 8, sets: 3 }, requires: [{ skill: "single-leg-deadlift", value: 10 }],
    blurb: "Assisted knee-flexion strength — the hardest hamstring work available with no weights.",
    cues: ["Anchor the ankles securely", "Band assists the lower half", "Hips stay extended — no hinging"],
    source: "rr",
  }),
  s({
    id: "nordic-curl", name: "Nordic Curl", icon: "👑", branch: "legs", path: "Posterior Chain", tier: 3,
    measure: "reps", standard: { value: 5, sets: 3 }, requires: [{ skill: "banded-nordic", value: 8 }],
    blurb: "Unassisted. Top of the Recommended Routine hinge ladder.",
    cues: ["Lower as slowly as you can", "Body in one line from knees to head", "Catch with the hands if needed"],
    source: "rr",
  }),

  s({
    id: "calf-raise", name: "Calf Raises", icon: "🐆", branch: "legs", path: "Calves", tier: 0,
    measure: "reps", standard: { value: 20, sets: 3 }, requires: [], cameraMove: "calf",
    blurb: "Straightforward calf work — full range beats extra reps.",
    cues: ["Full stretch at the bottom", "Pause at the top", "Slow tempo"],
    source: "rr",
  }),
  s({
    id: "single-leg-calf-raise", name: "Single-Leg Calf Raises", icon: "🐅", branch: "legs", path: "Calves", tier: 1,
    measure: "reps", standard: { value: 15, sets: 3, perSide: true }, requires: [{ skill: "calf-raise", value: 20 }], cameraMove: "calf",
    blurb: "Double the load per calf, and it exposes side-to-side differences.",
    cues: ["Stand on a step for full range", "Fingertips on a wall for balance only", "Full stretch, full contraction"],
    source: "rr",
  }),

  /* ============================ STATICS =========================== */
  s({
    id: "wall-plank", name: "Wall Plank (Walk-Up)", icon: "🧗", branch: "skill", path: "Handstand Line", tier: 0,
    measure: "hold", standard: { value: 30, sets: 3 }, requires: [{ skill: "plank", value: 60 }],
    blurb: "Feet walk up the wall until the body is near vertical. Builds the overhead position safely.",
    cues: ["Walk the hands closer as the feet climb", "Push the floor away, shoulders to the ears", "Ribs down, glutes tight"],
    source: "hspu",
  }),
  s({
    id: "chest-to-wall-handstand", name: "Chest-to-Wall Handstand", icon: "🙃", branch: "skill", path: "Handstand Line", tier: 1,
    measure: "hold", standard: { value: 45, sets: 3 }, requires: [{ skill: "wall-plank", value: 30 }],
    blurb: "A solid wall handstand is 30+ seconds chest-to-wall in a straight line — the honest version of the hold.",
    cues: ["Chest and toes touching the wall", "Shoulders fully elevated", "Straight line: wrists, shoulders, hips, heels"],
    source: "hspu",
  }),
  s({
    id: "handstand", name: "Freestanding Handstand", icon: "👑", branch: "skill", path: "Handstand Line", tier: 2,
    measure: "hold", standard: { value: 30, sets: 3 }, requires: [{ skill: "chest-to-wall-handstand", value: 45 }],
    blurb: "No wall. Balance is a skill — train it fresh, daily, in short sets.",
    cues: ["Steer with the fingers, not the hips", "Look between the hands", "Bail by turning out, not folding"],
    source: "hspu",
  }),

  s({
    id: "frog-stand", name: "Frog Stand", icon: "🐸", branch: "skill", path: "Planche Line", tier: 0,
    measure: "hold", standard: { value: 10, sets: 3 }, requires: [],
    blurb: "Knees on the elbows, feet off the floor. A controlled 10s frog stand is the usual tuck planche prerequisite.",
    cues: ["Knees resting on the back of the elbows", "Lean forward until the feet float", "Round the upper back, look down"],
    source: "planche",
  }),
  s({
    id: "planche-lean", name: "Planche Lean", icon: "🪁", branch: "skill", path: "Planche Line", tier: 1,
    measure: "hold", standard: { value: 15, sets: 3 },
    requires: [{ skill: "frog-stand", value: 10 }, { skill: "pushup", value: 15 }],
    blurb: "Plank position with the shoulders driven well past the wrists. 15s here is the gate to the tuck planche.",
    cues: ["Shoulders clearly past the wrists", "Arms locked, elbow pits forward", "Protract hard — push the floor away"],
    source: "planche",
  }),
  s({
    id: "tuck-planche", name: "Tuck Planche", icon: "🥚", branch: "skill", path: "Planche Line", tier: 2,
    measure: "hold", standard: { value: 10, sets: 3 }, requires: [{ skill: "planche-lean", value: 15 }],
    blurb: "Feet off the floor, knees tucked, hips at shoulder height. Only move on at a clean 10s.",
    cues: ["Hips level with the shoulders", "Arms locked — never bend them", "Shoulder blades protracted and depressed"],
    source: "planche",
  }),
  s({
    id: "adv-tuck-planche", name: "Advanced Tuck Planche", icon: "🐣", branch: "skill", path: "Planche Line", tier: 3,
    measure: "hold", standard: { value: 15, sets: 3 }, requires: [{ skill: "tuck-planche", value: 10 }],
    blurb: "Knees open, back flat. The standard step between tuck and straddle.",
    cues: ["Open the hips to ~90°, flatten the back", "Hips at shoulder height", "Aim for 10–15s holds"],
    source: "planche",
  }),
  s({
    id: "straddle-planche", name: "Straddle Planche", icon: "🔱", branch: "skill", path: "Planche Line", tier: 4,
    measure: "hold", standard: { value: 10, sets: 3 }, requires: [{ skill: "adv-tuck-planche", value: 15 }],
    blurb: "Legs straight and wide, body horizontal. Consistent 15s straddle holds are the gate to the full planche.",
    cues: ["Widen the straddle to make it lighter", "Arms locked, lean far forward", "Body one flat line"],
    source: "planche",
  }),
  s({
    id: "full-planche", name: "Full Planche", icon: "👑", branch: "skill", path: "Planche Line", tier: 5,
    measure: "hold", standard: { value: 5, sets: 3 }, requires: [{ skill: "straddle-planche", value: 10 }],
    blurb: "Legs together, body horizontal, hands only. The boss level of pushing statics.",
    cues: ["Legs together, toes pointed", "Maximum protraction", "Straight arms — always"],
    source: "planche",
  }),

  s({
    id: "chamber-hold", name: "Flag Chamber Hold", icon: "🔩", branch: "skill", path: "Human Flag Line", tier: 0,
    measure: "hold", standard: { value: 15, sets: 3 }, requires: [{ skill: "plank", value: 60 }],
    blurb: "First flag progression — knees tucked to the chest on a vertical pole, body off the floor.",
    cues: ["Top hand pulls, bottom hand pushes", "Knees tight to the chest", "Stack the shoulders over the pole"],
    source: "flag",
  }),
  s({
    id: "tuck-clutch-flag", name: "Tuck Clutch Flag", icon: "🥚", branch: "skill", path: "Human Flag Line", tier: 1,
    measure: "hold", standard: { value: 9, sets: 3 }, requires: [{ skill: "chamber-hold", value: 15 }],
    blurb: "Elbow-locked flag with knees tucked. Nine clean seconds is the published gate to the next variation.",
    cues: ["Lower forearm presses hard into the pole", "Upper arm pulls across the chest", "Squeeze the pole with the whole torso"],
    source: "flag",
  }),
  s({
    id: "clutch-flag", name: "Clutch Flag", icon: "🚩", branch: "skill", path: "Human Flag Line", tier: 2,
    measure: "hold", standard: { value: 10, sets: 3 }, requires: [{ skill: "tuck-clutch-flag", value: 9 }],
    blurb: "Legs extended in the clutch grip — full horizontal body with the elbows locked on the pole.",
    cues: ["Legs straight and together", "Obliques doing the work", "Keep the hips from dropping"],
    source: "flag",
  }),
  s({
    id: "tuck-human-flag", name: "Tuck Human Flag", icon: "🐣", branch: "skill", path: "Human Flag Line", tier: 3,
    measure: "hold", standard: { value: 5, sets: 3 },
    requires: [{ skill: "clutch-flag", value: 10 }, { skill: "pullup", value: 10 }],
    blurb: "Straight arms now, knees tucked. This is where the real flag starts.",
    cues: ["Bottom arm pushes, top arm pulls", "Both arms straight", "Enter from the top, lower into the tuck"],
    source: "flag",
  }),
  s({
    id: "human-flag", name: "Human Flag", icon: "👑", branch: "skill", path: "Human Flag Line", tier: 4,
    measure: "hold", standard: { value: 5, sets: 3 }, requires: [{ skill: "tuck-human-flag", value: 5 }],
    blurb: "Body horizontal off a vertical pole, arms straight. The most recognisable feat in calisthenics.",
    cues: ["Straddle the legs to start, then close them", "Push the bottom arm as hard as you pull the top", "Whole body rigid"],
    source: "flag",
  }),
];

export const skillById: Record<string, Skill> = Object.fromEntries(
  skills.map((k) => [k.id, k])
);

/** Children of a node — computed by inverting `requires`. */
export const unlockedBy: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const k of skills)
    for (const r of k.requires) (map[r.skill] ||= []).push(k.id);
  return map;
})();

/**
 * The nearest rep/second target on this skill that still opens something new.
 *
 * A node's own `standard` is the bar for advancing its own ladder, but lateral
 * branches often ask for more — the RR advances the pushup ladder at 3×8-10,
 * while archer pushups want 20 clean pushups first and the muscle-up wants 10
 * strict pull-ups. Both numbers are real; this surfaces the next one you are
 * actually chasing so a "mastered" node never looks like a dead end.
 */
export function nextGate(
  id: string,
  stats: Stats
): { value: number; opens: Skill[] } | null {
  const have = best(stats, id);
  const pending = skills
    .map((k) => ({ k, req: k.requires.find((r) => r.skill === id) }))
    .filter((x) => x.req && x.req.value > have) as { k: Skill; req: Req }[];
  if (!pending.length) return null;
  const value = Math.min(...pending.map((x) => x.req.value));
  return { value, opens: pending.filter((x) => x.req.value === value).map((x) => x.k) };
}

/** Ordered paths within a branch, preserving declaration order. */
export function pathsFor(branch: Branch): { path: string; tiers: Skill[][] }[] {
  const out: { path: string; tiers: Skill[][] }[] = [];
  for (const k of skills) {
    if (k.branch !== branch) continue;
    let entry = out.find((p) => p.path === k.path);
    if (!entry) {
      entry = { path: k.path, tiers: [] };
      out.push(entry);
    }
    (entry.tiers[k.tier] ||= []).push(k);
  }
  for (const e of out) e.tiers = e.tiers.filter(Boolean);
  return out;
}

/* ------------------------------------------------------------------ */
/* Logging + progress                                                  */
/* ------------------------------------------------------------------ */

export type Entry = {
  skill: string;
  /** Reps for rep skills, seconds for holds. */
  value: number;
  at: string;
  src: "camera" | "manual" | "timer";
};

export type Stat = {
  /** Best single set. */
  best: number;
  /** Sets logged at or above the skill's standard. */
  qualifying: number;
  sets: number;
  total: number;
  last?: string;
};

export type Stats = Record<string, Stat>;

export const STORE_KEY = "calisthenics-skilltree-v1";

export function loadEntries(): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.filter((e) => typeof e?.skill === "string" && typeof e?.value === "number")
      : [];
  } catch {
    return [];
  }
}

export function saveEntries(entries: Entry[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entries));
  } catch {
    /* storage full or blocked — progress just won't persist */
  }
}

export function computeStats(entries: Entry[]): Stats {
  const stats: Stats = {};
  for (const e of entries) {
    const skill = skillById[e.skill];
    if (!skill) continue;
    const st = (stats[e.skill] ||= { best: 0, qualifying: 0, sets: 0, total: 0 });
    st.best = Math.max(st.best, e.value);
    st.sets += 1;
    st.total += e.value;
    if (e.value >= skill.standard.value) st.qualifying += 1;
    if (!st.last || e.at > st.last) st.last = e.at;
  }
  return stats;
}

export const best = (stats: Stats, id: string) => stats[id]?.best ?? 0;

export function isUnlocked(skill: Skill, stats: Stats): boolean {
  return skill.requires.every((r) => best(stats, r.skill) >= r.value);
}

export function isMastered(skill: Skill, stats: Stats): boolean {
  return (stats[skill.id]?.qualifying ?? 0) >= skill.standard.sets;
}

export type Status = "locked" | "available" | "training" | "mastered";

export function statusOf(skill: Skill, stats: Stats): Status {
  if (!isUnlocked(skill, stats)) return "locked";
  if (isMastered(skill, stats)) return "mastered";
  return (stats[skill.id]?.sets ?? 0) > 0 ? "training" : "available";
}

/** Skills that were locked under `before` and are unlocked under `after`. */
export function newlyUnlocked(before: Stats, after: Stats): Skill[] {
  return skills.filter((k) => !isUnlocked(k, before) && isUnlocked(k, after));
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function fmtValue(skill: Skill, value: number): string {
  if (skill.measure === "hold") return `${value}s`;
  return `${value}${skill.standard.perSide ? "/side" : ""}`;
}

export function fmtStandard(skill: Skill): string {
  return `${skill.standard.sets} × ${fmtValue(skill, skill.standard.value)}`;
}

/** "Needs 10 Pushups" / "Needs 30s Plank" — for locked nodes. */
export function reqLabel(req: Req): string {
  const target = skillById[req.skill];
  if (!target) return "";
  return target.measure === "hold"
    ? `${req.value}s ${target.name}`
    : `${req.value} ${target.name}`;
}

export function branchProgress(branch: Branch, stats: Stats) {
  const list = skills.filter((k) => k.branch === branch);
  return {
    total: list.length,
    unlocked: list.filter((k) => isUnlocked(k, stats)).length,
    mastered: list.filter((k) => isMastered(k, stats)).length,
  };
}

/* ------------------------------------------------------------------ */
/* Workout runner bridge                                               */
/* ------------------------------------------------------------------ */

/**
 * Maps runner exercise names (lib/workouts.ts) onto tree skills, so reps you
 * count during a session — by camera, or a completed timed hold — advance the
 * tree without logging them twice.
 */
export const workoutSkill: Record<string, string> = {
  "Incline Pushups": "incline-pushup",
  "Decline Pushups": "decline-pushup",
  "Diamond Pushups": "diamond-pushup",
  "Pike Pushups": "pike-pushup",
  "Archer Pushups": "archer-pushup",
  Pushups: "pushup",
  Dips: "dip",
  "Planche Leans": "planche-lean",
  "Hollow Body Hold": "hollow-body-hold",
  "L-Sit (or progression)": "lsit",
  "Lying Leg Raises": "lying-leg-raise",
  "Bodyweight Squats": "squat",
  Lunges: "split-squat",
  "Calf Raises": "calf-raise",
};

/**
 * Append one set and return whatever it just unlocked. Reads and writes
 * storage directly so the runner can log without holding tree state.
 */
export function logSet(skillId: string, value: number, src: Entry["src"]): Skill[] {
  if (!skillById[skillId] || !(value > 0)) return [];
  const prev = loadEntries();
  const next = [...prev, { skill: skillId, value, at: new Date().toISOString(), src }];
  saveEntries(next);
  return newlyUnlocked(computeStats(prev), computeStats(next));
}
