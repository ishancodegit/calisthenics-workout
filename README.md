# Calisthenics Workout

A personal workout runner built from the *Beginner Calisthenics Program* PDF. Black/yellow theme matching the program, with countdown timers for timed holds and automatic rest timers between every set.

## Features

- **3 sessions** — Upper Body Plan A (Aesthetic), Upper Body Plan B (Strength), Legs + Abs — all transcribed from the PDF (sets, reps, notes).
- **Guided runner** — step through every set with target reps and form notes.
- **Timers for every exercise** — auto rest timer between sets (30/45/60/90/120s) with a countdown ring + beeps; dedicated hold countdowns for timed exercises (Planche Leans, Hollow Body Hold, L-Sit).
- **Camera rep counter** — on pushup-family exercises, tap "📷 Verify reps with camera" to auto-count reps with on-device pose detection (MediaPipe Pose). It tracks your elbow angle, counts a rep each time you go past ~90° and extend back up, beeps per rep, and shows a live skeleton overlay. Runs entirely in your browser — no video leaves your device. Needs HTTPS (Vercel provides it) and camera permission; works best from a side angle.
- **Progress log** — sessions saved in your browser (localStorage); home screen shows weekly count and last-done dates.
- **Weekly split + tips** from the PDF on the home screen.
- Screen-wake-lock during a session (where supported), mobile-friendly.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

Option A — CLI:

```bash
npm i -g vercel
vercel        # preview
vercel --prod # production
```

Option B — Git: push this folder to a GitHub repo, then "Import Project" on vercel.com. Framework preset auto-detects **Next.js** — no config needed.

Built with Next.js 15 + Tailwind CSS v4. No backend, no env vars.
