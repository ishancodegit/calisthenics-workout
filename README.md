# Calisthenics Workout

A personal workout runner built from the *Beginner Calisthenics Program* PDF. Black/yellow theme matching the program, with countdown timers for timed holds and automatic rest timers between every set.

## Features

- **3 sessions** — Upper Body Plan A (Aesthetic), Upper Body Plan B (Strength), Legs + Abs — all transcribed from the PDF (sets, reps, notes).
- **Guided runner** — step through every set with target reps and form notes.
- **Timers for every exercise** — auto rest timer between sets (30/45/60/90/120s) with a countdown ring + beeps; dedicated hold countdowns for timed exercises (Planche Leans, Hollow Body Hold, L-Sit).
- **Camera rep counter** — on most exercises, tap "📷 Verify reps with camera" to auto-count reps with on-device pose detection (MediaPipe Pose, "full" model). Supported movements: **pushups** (elbow angle, strict form), **pike/handstand presses**, **dips**, **pull-ups** and **rows** (elbow angle), **squats & lunges** (knee angle), **lying leg raises** (hip angle), and **calf raises** (body rise). It counts **down** from your rep goal, **auto-calibrates to your range of motion**, beeps per rep, and shows a live skeleton overlay. Runs entirely in your browser — no video leaves your device. Needs HTTPS and camera permission.
  - **Perfect-form pushups** — pushups are judged on real form: full depth (chest low), full lockout, and a straight body line. Only clean reps count, with live cues ("Go lower", "Keep your body straight").
  - **Voice** — toggle 🎤 in the camera to go hands-free: it speaks your rep count out loud and listens for commands ("reset", "done", "close", and "start" in challenges).
- **Skill Tree** — 76 calisthenics skills across 5 branches (Push, Pull, Core, Legs, Statics), laid out as 15 progression ladders. **Every node is gated on reps you actually log**: hit one clean set of 10 pushups and Diamond Pushups unlocks — you never need to already do the harder move to get access to it. Locked nodes state their gate ("Needs 20 Pushups"), unlocked nodes show the next rep target and what it opens ("15 in one set unlocks Planche Lean"), and a node counts as **mastered** at 3 sets at its standard. Log sets by hand, with the **camera rep counter**, or with a **stopwatch** for holds; sets you count during a normal workout feed the tree automatically. Progress is stored in your browser.
  - **Verified standards, not guesses** — every rep and hold target is taken from a published progression chart, and each skill links to its source: the [r/bodyweightfitness Recommended Routine](https://gist.github.com/sgup/f10f1d57e54b7876495f4bafb6d697eb) ladders (3×5–8 to progress), the [handstand pushup progression](https://thebarbellphysio.com/handstand-pushup-strength-progression/), [muscle-up prerequisites](https://bodyproskills.com/articles/muscle-up-prerequisites/) (10 strict pull-ups + 15 dips), [planche](https://gmb.io/planche/) and [front lever](https://www.calisthenics-corner.com/skills/human-flag/) progressions, [archer → one-arm pushup](https://www.calisthenics-corner.com/articles/archer-push-ups/) (20 pushups first), [clutch/human flag](https://www.hybridcalisthenics.com/tuck-clutch-flag) (9s tuck clutch flag), and the [pistol squat progression](https://www.mpcalisthenics.com/tutorial/pistol-squat-the-ultimate-progression-guide).
- **Pushup Challenge** — a max-pushups-in-60s AMRAP (clean form only) that generates a **shareable link**. Send it to a friend; they open it, do the challenge, and the app shows who won. No backend — the score is encoded in the URL.
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
