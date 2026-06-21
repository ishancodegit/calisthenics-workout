# Calisthenics Workout

A personal workout runner built from the *Beginner Calisthenics Program* PDF. Black/yellow theme matching the program, with countdown timers for timed holds and automatic rest timers between every set.

## Features

- **3 sessions** — Upper Body Plan A (Aesthetic), Upper Body Plan B (Strength), Legs + Abs — all transcribed from the PDF (sets, reps, notes).
- **Guided runner** — step through every set with target reps and form notes.
- **Timers for every exercise** — auto rest timer between sets (30/45/60/90/120s) with a countdown ring + beeps; dedicated hold countdowns for timed exercises (Planche Leans, Hollow Body Hold, L-Sit).
- **Camera rep counter** — on most exercises, tap "📷 Verify reps with camera" to auto-count reps with on-device pose detection (MediaPipe Pose). Supported movements: **pushups & dips** (elbow angle), **squats & lunges** (knee angle), **lying leg raises** (hip angle), and **calf raises** (body rise). It counts **down** from your rep goal, **auto-calibrates to your range of motion** each set, beeps per rep, and shows a live skeleton overlay. Runs entirely in your browser — no video leaves your device. Needs HTTPS (Vercel provides it) and camera permission; each movement shows a framing cue (most work best side-on).
- **Music** — floating player with **Spotify / Apple / YouTube** tabs (remembers your choice). Spotify = full-track playback via the Web Playback SDK (Premium login, see setup below). Apple Music & YouTube = embedded players; paste any link to swap the playlist. Apple/YouTube play full songs when you're signed in (YouTube needs no login). Stays playing as you move from the home screen into a workout.
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

## Spotify full-track playback (optional)

The Music panel has a **Spotify** tab that plays full songs (not 30s previews)
via the Web Playback SDK. This requires a **Spotify Premium** account to log in
with, plus a free one-time setup:

1. Go to <https://developer.spotify.com/dashboard> → **Create app**.
2. Name/description: anything. **Redirect URIs** — add both (with trailing slash):
   - `https://ishansworkout.vercel.app/`  (production)
   - `http://127.0.0.1:3000/`  (local dev — use `127.0.0.1`, not `localhost`)
3. Under "Which API/SDKs are you planning to use" tick **Web Playback SDK** and **Web API**. Save.
4. Copy the **Client ID**.
5. Set it as an env var named `NEXT_PUBLIC_SPOTIFY_CLIENT_ID`:
   - Local: create `.env.local` with `NEXT_PUBLIC_SPOTIFY_CLIENT_ID=your_id`
   - Vercel: `vercel env add NEXT_PUBLIC_SPOTIFY_CLIENT_ID` (Production), then redeploy.

Auth is Authorization Code + PKCE — fully client-side, no secret/backend. The
Client ID is public, so it's safe in the browser.

Built with Next.js 15 + Tailwind CSS v4. No backend.
