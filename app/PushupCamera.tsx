"use client";

import { useEffect, useRef, useState } from "react";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// MediaPipe Pose landmark indices
const L_SHOULDER = 11,
  R_SHOULDER = 12,
  L_ELBOW = 13,
  R_ELBOW = 14,
  L_WRIST = 15,
  R_WRIST = 16;

// Minimum elbow-angle travel (deg) before we trust adaptive thresholds.
const MIN_RANGE = 30;
// Fallback thresholds used until we've seen a full range of motion.
const FALLBACK_DOWN = 105;
const FALLBACK_UP = 150;

type Pt = { x: number; y: number; visibility?: number };

function angleAt(a: Pt, b: Pt, c: Pt): number | null {
  const abx = a.x - b.x,
    aby = a.y - b.y;
  const cbx = c.x - b.x,
    cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag === 0) return null;
  let cos = dot / mag;
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

// Default rep goal parsed from the exercise target string ("10–15" -> 15).
function parseTarget(t: string): number {
  const nums = t.match(/\d+/g);
  if (!nums) return 10; // e.g. "Max reps"
  return parseInt(nums[nums.length - 1], 10); // top of the range
}

export default function PushupCamera({
  exerciseName,
  target,
  onClose,
  onUseCount,
}: {
  exerciseName: string;
  target: string;
  onClose: () => void;
  onUseCount: (reps: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [targetReps, setTargetReps] = useState(() => parseTarget(target));
  const [done, setDone] = useState(0);
  const [stage, setStage] = useState<"up" | "down" | "—">("—");
  const [angle, setAngle] = useState<number | null>(null);
  const [tracking, setTracking] = useState(false);

  const remaining = Math.max(0, targetReps - done);
  const finished = done >= targetReps;

  // refs the rAF loop reads/writes without re-rendering
  const stageRef = useRef<"up" | "down">("up");
  const doneRef = useRef(0);
  const targetRef = useRef(targetReps);
  targetRef.current = targetReps;
  const smoothRef = useRef<number | null>(null);
  const minRef = useRef<number | null>(null); // deepest (smallest) angle seen
  const maxRef = useRef<number | null>(null); // most extended (largest) angle
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
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera not supported on this device/browser.");
        }
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
          landmarker = await vision.PoseLandmarker.createFromOptions(
            fileset,
            makeOpts("GPU")
          );
        } catch {
          landmarker = await vision.PoseLandmarker.createFromOptions(
            fileset,
            makeOpts("CPU")
          );
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
        const name = e?.name;
        setErrorMsg(
          name === "NotAllowedError"
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
          const angles: number[] = [];
          if (vis(L_SHOULDER) && vis(L_ELBOW) && vis(L_WRIST)) {
            const a = angleAt(pose[L_SHOULDER], pose[L_ELBOW], pose[L_WRIST]);
            if (a != null) angles.push(a);
          }
          if (vis(R_SHOULDER) && vis(R_ELBOW) && vis(R_WRIST)) {
            const a = angleAt(pose[R_SHOULDER], pose[R_ELBOW], pose[R_WRIST]);
            if (a != null) angles.push(a);
          }

          if (angles.length) {
            const raw = angles.reduce((s, v) => s + v, 0) / angles.length;
            const sm =
              smoothRef.current == null
                ? raw
                : smoothRef.current * 0.6 + raw * 0.4;
            smoothRef.current = sm;
            setAngle(sm);
            setTracking(true);

            // Track the per-set range of motion so the counter adapts to the
            // variant (incline = shallow bend, decline/standard = deeper).
            minRef.current = minRef.current == null ? sm : Math.min(minRef.current, sm);
            maxRef.current = maxRef.current == null ? sm : Math.max(maxRef.current, sm);
            const lo = minRef.current!;
            const hi = maxRef.current!;
            const range = hi - lo;
            const hasRange = range >= MIN_RANGE;
            const downT = hasRange ? lo + range * 0.32 : FALLBACK_DOWN;
            const upT = hasRange ? lo + range * 0.68 : FALLBACK_UP;

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
            drawArms(ctx, canvas, pose, stageRef.current);
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
  }, []);

  function drawArms(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    pose: Pt[],
    st: "up" | "down"
  ) {
    const W = canvas.width,
      H = canvas.height;
    const color = st === "down" ? "#22c55e" : "#f5e000";
    ctx.lineWidth = Math.max(3, W / 160);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    const seg = (a: number, b: number) => {
      if ((pose[a]?.visibility ?? 0) < 0.5 || (pose[b]?.visibility ?? 0) < 0.5)
        return;
      ctx.beginPath();
      ctx.moveTo((1 - pose[a].x) * W, pose[a].y * H);
      ctx.lineTo((1 - pose[b].x) * W, pose[b].y * H);
      ctx.stroke();
    };
    seg(L_SHOULDER, L_ELBOW);
    seg(L_ELBOW, L_WRIST);
    seg(R_SHOULDER, R_ELBOW);
    seg(R_ELBOW, R_WRIST);
    seg(L_SHOULDER, R_SHOULDER);
    [L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST].forEach((i) => {
      if ((pose[i]?.visibility ?? 0) < 0.5) return;
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
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onClose} className="text-sm text-white/60 hover:text-white">
          ✕ Close
        </button>
        <span className="truncate px-2 text-sm font-semibold">{exerciseName}</span>
        <span className="text-sm text-white/50">Target {target}</span>
      </div>

      {/* camera */}
      <div className="relative mx-auto w-full max-w-2xl flex-1 overflow-hidden">
        <div className="relative mx-3 mt-1 overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
          <video
            ref={videoRef}
            playsInline
            muted
            className="block w-full -scale-x-100"
          />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />

          {/* countdown overlay */}
          <div className="absolute left-0 top-0 flex items-start gap-3 p-4">
            <div
              className={`rounded-2xl px-5 py-3 text-center ${
                finished ? "bg-green-500/80" : "bg-black/60"
              }`}
            >
              <div
                className={`text-6xl font-black leading-none tabular-nums ${
                  finished ? "text-black" : "text-[var(--accent)]"
                }`}
              >
                {finished ? "✓" : remaining}
              </div>
              <div
                className={`mt-1 text-[10px] uppercase tracking-widest ${
                  finished ? "text-black/70" : "text-white/60"
                }`}
              >
                {finished ? "done" : "reps left"}
              </div>
            </div>
            {status === "ready" && (
              <div
                className={`rounded-xl px-3 py-2 text-sm font-bold ${
                  stage === "down"
                    ? "bg-green-500 text-black"
                    : stage === "up"
                    ? "bg-[var(--accent)] text-black"
                    : "bg-white/10 text-white/60"
                }`}
              >
                {stage === "down" ? "DOWN" : stage === "up" ? "UP" : "…"}
                {angle != null && (
                  <span className="ml-2 font-normal opacity-70">
                    {Math.round(angle)}°
                  </span>
                )}
                <span className="ml-2 block text-[10px] font-normal opacity-60">
                  {done} done
                </span>
              </div>
            )}
          </div>

          {/* loading / error */}
          {status !== "ready" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              {status === "loading" && (
                <>
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
                  <p className="text-sm text-white/70">
                    Starting camera &amp; loading pose model…
                  </p>
                </>
              )}
              {status === "error" && (
                <p className="max-w-xs text-sm text-red-400">{errorMsg}</p>
              )}
            </div>
          )}

          {status === "ready" && !tracking && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-center text-xs text-white/70">
              Position your phone (side angle) so your upper body &amp; arms are in frame
            </div>
          )}
        </div>
      </div>

      {/* controls */}
      <div className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* target adjuster */}
        <div className="mb-3 flex items-center justify-center gap-4">
          <span className="text-xs uppercase tracking-wider text-white/40">Goal</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTargetReps((n) => Math.max(1, n - 1))}
              className="h-9 w-9 rounded-lg bg-white/10 text-lg font-bold active:scale-90"
            >
              −
            </button>
            <span className="w-10 text-center text-2xl font-black tabular-nums">
              {targetReps}
            </span>
            <button
              onClick={() => setTargetReps((n) => n + 1)}
              className="h-9 w-9 rounded-lg bg-white/10 text-lg font-bold active:scale-90"
            >
              +
            </button>
          </div>
        </div>

        <p className="mb-3 text-center text-xs text-white/40">
          Counts down each rep — it auto-calibrates to your range of motion, so
          incline &amp; decline angles both work. Best from a side angle.
        </p>
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="rounded-xl bg-white/10 px-5 py-3 font-semibold active:scale-95"
          >
            Reset
          </button>
          <button
            onClick={() => onUseCount(done)}
            className="flex-1 rounded-xl bg-[var(--accent)] py-3 font-black text-black active:scale-[0.98]"
          >
            ✓ Use {done} &amp; Complete Set
          </button>
        </div>
      </div>
    </div>
  );
}
