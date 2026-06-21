// Data transcribed directly from "Beginner Calisthenics Program" PDF.

// Movement types the camera rep-counter knows how to detect.
export type CameraMove = "pushup" | "squat" | "lunge" | "legraise" | "calf";

export type Exercise = {
  name: string;
  sets: number;
  /** Display target, e.g. "10–15", "Max reps", "10/leg" */
  target: string;
  /** If set, this exercise is timed (a hold). Number of seconds to count down per set. */
  holdSeconds?: number;
  /** If set, offer the camera rep counter using this movement's pose detector. */
  cameraMove?: CameraMove;
  notes: string;
};

export type WorkoutSection = {
  title: string;
  exercises: Exercise[];
};

export type Workout = {
  id: string;
  name: string;
  blurb: string;
  sections: WorkoutSection[];
};

// ---- Upper Body: Plan A (Aesthetic Focus) ----
export const upperA: Workout = {
  id: "upper-a",
  name: "Upper Body — Plan A · Aesthetic",
  blurb:
    "Targets specific muscle groups responsible for that typical anime-build aesthetic.",
  sections: [
    {
      title: "Aesthetic Focus",
      exercises: [
        { name: "Incline Pushups", sets: 3, target: "10–15", cameraMove: "pushup", notes: "Target the lower chest." },
        { name: "Decline Pushups", sets: 3, target: "10–15", cameraMove: "pushup", notes: "Target the upper chest — increase the angle for difficulty." },
        { name: "Diamond Pushups", sets: 3, target: "10–15", cameraMove: "pushup", notes: "Target the triceps, as well as your inner chest." },
        { name: "Pike Pushups", sets: 3, target: "6–10", cameraMove: "pushup", notes: "Help to build massive shoulders." },
        { name: "Archer Pushups", sets: 2, target: "6–10", cameraMove: "pushup", notes: "Combine everything — main purpose is improving stability and unilateral strength (like a one-arm pushup)." },
      ],
    },
  ],
};

// ---- Upper Body: Plan B (Strength Foundation) ----
export const upperB: Workout = {
  id: "upper-b",
  name: "Upper Body — Plan B · Strength",
  blurb:
    "Builds the foundational strength needed to progress to advanced skills (handstand pushup, L-sit, planche, front lever, etc.).",
  sections: [
    {
      title: "Upper Body",
      exercises: [
        { name: "Pushups", sets: 3, target: "Max reps", cameraMove: "pushup", notes: "The base exercise for almost everything — build strength and endurance here!" },
        { name: "Planche Leans", sets: 3, target: "10–20 sec", holdSeconds: 20, notes: "Helps your shoulders manage higher torque when doing more advanced exercises." },
        { name: "Pike Pushups", sets: 3, target: "5–10", cameraMove: "pushup", notes: "Build strength for the handstand pushup." },
        { name: "Dips", sets: 3, target: "6–10", cameraMove: "pushup", notes: "Give you even more strength in the lower chest, triceps and shoulders." },
      ],
    },
  ],
};

// ---- Legs + Abs ----
export const legsAbs: Workout = {
  id: "legs-abs",
  name: "Legs + Abs",
  blurb: "Core training plus legs — build a balanced foundation and the core tension every skill needs.",
  sections: [
    {
      title: "Core Training",
      exercises: [
        { name: "Hollow Body Hold", sets: 3, target: "20–40 sec", holdSeconds: 30, notes: "Builds core tension and teaches you to keep your body straight and tight — essential for almost every skill (planche, handstand, front lever)." },
        { name: "L-Sit (or progression)", sets: 3, target: "10–15 sec", holdSeconds: 12, notes: "Develops strong abs & hip flexors." },
        { name: "Lying Leg Raises", sets: 3, target: "10", cameraMove: "legraise", notes: "Build lower abs and core strength." },
      ],
    },
    {
      title: "Legs",
      exercises: [
        { name: "Bodyweight Squats", sets: 3, target: "12–20", cameraMove: "squat", notes: "Build overall leg strength — mainly quads." },
        { name: "Lunges", sets: 3, target: "10/leg", cameraMove: "lunge", notes: "Improve stability and fix strength imbalances between legs." },
        { name: "Calf Raises", sets: 3, target: "15–20", cameraMove: "calf", notes: "Build your calf muscles." },
      ],
    },
  ],
};

export const workouts: Record<string, Workout> = {
  "upper-a": upperA,
  "upper-b": upperB,
  "legs-abs": legsAbs,
};

// Weekly training split from the PDF.
export type SplitDay = { day: number; label: string; type: "upper" | "legs" | "rest" };

export const split: SplitDay[] = [
  { day: 1, label: "Upper Body", type: "upper" },
  { day: 2, label: "Legs + Abs", type: "legs" },
  { day: 3, label: "Upper Body", type: "upper" },
  { day: 4, label: "Legs + Abs", type: "legs" },
  { day: 5, label: "Upper Body", type: "upper" },
  { day: 6, label: "Legs + Abs", type: "legs" },
  { day: 7, label: "Rest", type: "rest" },
];

export const tips = [
  "Don't train the same muscles every day",
  "Rest is required for growth",
  "Focus on clean form",
  "Stay consistent",
];

// Flatten a workout into an ordered list of sets for the runner.
export type SetStep = {
  exercise: Exercise;
  sectionTitle: string;
  setNumber: number;
  totalSets: number;
  exerciseIndex: number;
  totalExercises: number;
};

export function buildSteps(workout: Workout): SetStep[] {
  const allExercises = workout.sections.flatMap((s) =>
    s.exercises.map((e) => ({ exercise: e, sectionTitle: s.title }))
  );
  const steps: SetStep[] = [];
  allExercises.forEach((item, exIdx) => {
    for (let s = 1; s <= item.exercise.sets; s++) {
      steps.push({
        exercise: item.exercise,
        sectionTitle: item.sectionTitle,
        setNumber: s,
        totalSets: item.exercise.sets,
        exerciseIndex: exIdx,
        totalExercises: allExercises.length,
      });
    }
  });
  return steps;
}
