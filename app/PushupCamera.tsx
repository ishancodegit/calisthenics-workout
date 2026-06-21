"use client";

import { useEffect, useRef, useState } from "react";
import type { CameraMove } from "@/lib/workouts";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// MediaPipe Pose landmark indices
const LM = {
  lShoulder: 11, rShoulder: 12,
  lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28,
} as const;

type Pt = { x: number; y: number; visibility?: number };

// Per-move config: the joint triples whose angle we track, how to aggregate
// both sides, the skeleton segments to draw, a framing cue, and the minimum
// range of motion (degrees for angles, normalized units for vertical moves).
const MOVES: Record<
  CameraMove,
  {
    kind: "angle" | "vertical";
    joints: [number, number, number][];
    agg: "avg" | "min";
    segments: [number, number][];
    cue: string;
    minRange: number;
  }
> = {
  pushup: {
    kind: "angle",
    joints: [[LM.lShoulder, LM.lElbow, LM.lWrist], [LM.rShoulder, LM.rElbow, LM.rWrist]],
    agg: "avg",
    segments: [[LM.lShoulder, LM.rShoulder], [LM.lShoulder, LM.lElbow], [LM.lElbow, LM.lWrist], [LM.rShoulder, LM.rElbow], [LM.rElbow, LM.rWrist]],
    cue: "Side angle — shoulders & arms in frame",
    minRange: 30,
  },
  squat: {
    kind: "angle",
    joints: [[LM.lHip, LM.lKnee, LM.lAnkle], [LM.rHip, LM.rKnee, LM.rAnkle]],
    agg: "avg",
    segments: [[LM.lHip, LM.rHip], [LM.lHip, LM.lKnee], [LM.lKnee, LM.lAnkle], [LM.rHip, LM.rKnee], [LM.rKnee, LM.rAnkle]],
    cue: "Side-on — whole body in frame",
    minRange: 35,
  },
  lunge: {
    kind: "angle",
    joints: [[LM.lHip, LM.lKnee, LM.lAnkle], [LM.rHip, LM.rKnee, LM.rAnkle]],
    agg: "min", // the front (bending) leg drives the rep
    segments: [[LM.lHip, LM.rHip], [LM.lHip, LM.lKnee], [LM.lKnee, LM.lAnkle], [LM.rHip, LM.rKnee], [LM.rKnee, LM.rAnkle]],
    cue: "Side-on — whole body in frame",
    minRange: 35,
  },
  legraise: {
    kind: "angle",
    joints: [[LM.lShoulder, LM.lHip, LM.lAnkle], [LM.rShoulder, LM.rHip, LM.rAnkle]],
    agg: "avg",
    segments: [[LM.lShoulder, LM.lHip], [LM.lHip, LM.lKnee], [LM.lKnee, LM.lAnkle], [LM.rShoulder, LM.rHip], [LM.rHip, LM.rKnee], [LM.rKnee, LM.rAnkle]],
    cue: "Lie with your side to the camera — whole body in frame",
    minRange: 35,
  },
  calf: {
    kind: "vertical",
    joints: [],
    agg: "avg",
    segments: [[LM.lShoulder, LM.lHip], [LM.lHip, LM.lKnee], [LM.lKnee, LM.lAnkle], [LM.rShoulder, LM.rHip], [LM.rHip, LM.rKnee], [LM.rKnee, LM.rAnkle]],
    cue: "Stand facing the camera — whole body in frame",
    minRange: 0.018, // normalized vertical travel of the shoulders
  },
};

const FALLBACK_DOWN = 105;
const FALLBACK_UP = 150;

function angleAt(a: Pt, b: Pt, c: Pt): number | null {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag === 0) return null;
  let cos = dot / mag;
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

function parseTarget(t: string): number {
  const nums = t.match(/\d+/g);
  if (!nums) return 10;
  return parseInt(nums[nums.length - 1], 10);
}

export default function PushupCamera({
  exerciseName,
  target,
  move,
  onClose,
  onUseCount,
}: {
  exerciseName: string;
  target: string;
  move: CameraMove;
  onClose: () => void;
  onUseCount: (reps: number) => void;
}) {
  const cfg = MOVES[move];

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [targetReps, setTargetReps] = useState(() => parseTarget(target));
  const [done, setDone] = useState(0);
  const [stage, setStage] = useState<"up" | "down" | "—">("—");
  const [metric, setMetric] = useState<number | null>(null);
  const [tracking, setTracking] = useState(false);

  const remaining = Math.max(0, targetReps - done);
  const finished = done >= targetReps;

  const stageRef = useRef<"up" | "down">("up");
  const doneRef = useRef(0);
  const targetRef = useRef(targetReps);
  targetRef.current = targetReps;
  const smoothRef = useRef<number | null>(null);
  const minRef = useRef<number | null>(null);
  const maxRef = useRef<number | null>(null);
  const runningRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  const lmRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  function beep(freq = 880, dur = 0.18) {
    try {
      if (!audioRef.current) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        audioRef.current = new AC();
      }
      const ctx = audioRef.current!;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Camera not supported on this device/browser.");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        const vision = await import("@mediapipe/tasks-vision");
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
        const makeOpts = (delegate: "GPU" | "CPU") => ({
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: "VIDEO" as const,
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        let landmarker;
        try {
          landmarker = await vision.PoseLandmarker.createFromOptions(fileset, makeOpts("GPU"));
        } catch {
          landmarker = await vision.PoseLandmarker.createFromOptions(fileset, makeOpts("CPU"));
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        lmRef.current = landmarker;
        setStatus("ready");
        runningRef.current = true;
        rafRef.current = requestAnimationFrame(loop);
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(
          e?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access and reopen."
            : e?.message || "Could not start the camera."
        );
        setStatus("error");
      }
    })();

    function loop() {
      if (!runningRef.current) return;
      const video = videoRef.current;
      const lm = lmRef.current;
      const canvas = canvasRef.current;
      if (video && lm && canvas && video.readyState >= 2) {
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const res = lm.detectForVideo(video, performance.now());
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const pose = res.landmarks?.[0] as Pt[] | undefined;
        if (pose) {
          const vis = (i: number) => (pose[i]?.visibility ?? 0) > 0.5;

          // ---- compute the scalar we track for this movement ----
          let value: number | null = null;
          if (cfg.kind === "vertical") {
            if (vis(LM.lShoulder) && vis(LM.rShoulder))
              value = (pose[LM.lShoulder].y + pose[LM.rShoulder].y) / 2;
          } else {
            const vals: number[] = [];
            for (const [a, b, c] of cfg.joints) {
              if (vis(a) && vis(b) && vis(c)) {
                const ang = angleAt(pose[a], pose[b], pose[c]);
                if (ang != null) vals.push(ang);
              }
            }
            if (vals.length)
              value = cfg.agg === "min" ? Math.min(...vals) : vals.reduce((s, v) => s + v, 0) / vals.length;
          }

          if (value != null) {
            const sm = smoothRef.current == null ? value : smoothRef.current * 0.6 + value * 0.4;
            smoothRef.current = sm;
            setMetric(sm);
            setTracking(true);

            minRef.current = minRef.current == null ? sm : Math.min(minRef.current, sm);
            maxRef.current = maxRef.current == null ? sm : Math.max(maxRef.current, sm);
            const lo = minRef.current!;
            const hi = maxRef.current!;
            const range = hi - lo;
            const hasRange = range >= cfg.minRange;

            let downT: number | null;
            let upT: number | null;
            if (hasRange) {
              downT = lo + range * 0.32;
              upT = lo + range * 0.68;
            } else if (cfg.kind === "angle") {
              downT = FALLBACK_DOWN;
              upT = FALLBACK_UP;
            } else {
              downT = upT = null; // vertical needs an established range first
            }

            if (downT != null && upT != null) {
              if (stageRef.current === "up" && sm < downT) {
                stageRef.current = "down";
                setStage("down");
              } else if (stageRef.current === "down" && sm > upT) {
                stageRef.current = "up";
                setStage("up");
                doneRef.current += 1;
                setDone(doneRef.current);
                if (doneRef.current >= targetRef.current) {
                  beep(660, 0.18);
                  beep(990, 0.3);
                } else {
                  beep(880);
                }
              }
            }
            drawPose(ctx, canvas, pose, stageRef.current);
          } else {
            setTracking(false);
          }
        } else {
          setTracking(false);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    return () => {
      cancelled = true;
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try {
        lmRef.current?.close?.();
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move]);

  function drawPose(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    pose: Pt[],
    st: "up" | "down"
  ) {
    const W = canvas.width, H = canvas.height;
    const color = st === "down" ? "#22c55e" : "#f5e000";
    ctx.lineWidth = Math.max(3, W / 160);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    const pts = new Set<number>();
    for (const [a, b] of cfg.segments) {
      if ((pose[a]?.visibility ?? 0) < 0.5 || (pose[b]?.visibility ?? 0) < 0.5) continue;
      ctx.beginPath();
      ctx.moveTo((1 - pose[a].x) * W, pose[a].y * H);
      ctx.lineTo((1 - pose[b].x) * W, pose[b].y * H);
      ctx.stroke();
      pts.add(a);
      pts.add(b);
    }
    pts.forEach((i) => {
      ctx.beginPath();
      ctx.arc((1 - pose[i].x) * W, pose[i].y * H, ctx.lineWidth * 1.4, 0, 7);
      ctx.fill();
    });
  }

  function reset() {
    doneRef.current = 0;
    stageRef.current = "up";
    smoothRef.current = null;
    minRef.current = null;
    maxRef.current = null;
    setDone(0);
    setStage("—");
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} className="text-sm text-white/60 hover:text-white">
          ✕ Close
        </button>
        <span className="truncate px-2 text-sm font-semibold">{exerciseName}</span>
        <span className="text-sm text-white/50">Target {target}</span>
      </div>

      <div className="relative mx-auto w-full max-w-2xl flex-1 overflow-hidden">
        <div className="relative mx-3 mt-1 overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
          <video ref={videoRef} playsInline muted className="block w-full -scale-x-100" />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

          <div className="absolute left-0 top-0 flex items-start gap-3 p-4">
            <div className={`rounded-2xl px-5 py-3 text-center ${finished ? "bg-green-500/80" : "bg-black/60"}`}>
              <div className={`text-6xl font-black leading-none tabular-nums ${finished ? "text-black" : "text-[var(--accent)]"}`}>
                {finished ? "✓" : remaining}
              </div>
              <div className={`mt-1 text-[10px] uppercase tracking-widest ${finished ? "text-black/70" : "text-white/60"}`}>
                {finished ? "done" : "reps left"}
              </div>
            </div>
            {status === "ready" && (
              <div className={`rounded-xl px-3 py-2 text-sm font-bold ${
                stage === "down" ? "bg-green-500 text-black" : stage === "up" ? "bg-[var(--accent)] text-black" : "bg-white/10 text-white/60"
              }`}>
                {stage === "down" ? "▼" : stage === "up" ? "▲" : "…"}
                {cfg.kind === "angle" && metric != null && (
                  <span className="ml-2 font-normal opacity-70">{Math.round(metric)}°</span>
                )}
                <span className="ml-2 block text-[10px] font-normal opacity-60">{done} done</span>
              </div>
            )}
          </div>

          {status !== "ready" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              {status === "loading" && (
                <>
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
                  <p className="text-sm text-white/70">Starting camera &amp; loading pose model…</p>
                </>
              )}
              {status === "error" && <p className="max-w-xs text-sm text-red-400">{errorMsg}</p>}
            </div>
          )}

          {status === "ready" && !tracking && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-center text-xs text-white/70">
              {cfg.cue}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 py-4">
        <div className="mb-3 flex items-center justify-center gap-4">
          <span className="text-xs uppercase tracking-wider text-white/40">Goal</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setTargetReps((n) => Math.max(1, n - 1))} className="h-9 w-9 rounded-lg bg-white/10 text-lg font-bold active:scale-90">−</button>
            <span className="w-10 text-center text-2xl font-black tabular-nums">{targetReps}</span>
            <button onClick={() => setTargetReps((n) => n + 1)} className="h-9 w-9 rounded-lg bg-white/10 text-lg font-bold active:scale-90">+</button>
          </div>
        </div>

        <p className="mb-3 text-center text-xs text-white/40">
          Counts down each rep — it auto-calibrates to your range of motion. {cfg.cue}.
        </p>
        <div className="flex gap-3">
          <button onClick={reset} className="rounded-xl bg-white/10 px-5 py-3 font-semibold active:scale-95">Reset</button>
          <button onClick={() => onUseCount(done)} className="flex-1 rounded-xl bg-[var(--accent)] py-3 font-black text-black active:scale-[0.98]">
            ✓ Use {done} &amp; Complete Set
          </button>
        </div>
      </div>
    </div>
  );
}
