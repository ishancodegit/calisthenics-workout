# Calisthenics Workout

A personal workout runner built from the *Beginner Calisthenics Program* PDF. Black/yellow theme matching the program, with countdown timers for timed holds and automatic rest timers between every set.

## Features

- **Coach** — a “✦ Coach” button on every screen. Say what you want in plain words and it *does* it rather than telling you where to tap: “what should I do today” picks the right session from your split and history and starts it, “I've only got 20 minutes” drops the rests to 30s and begins, “done” finishes a set, “skip” cuts a rest short, “count my reps” opens the camera, “how do I do pike pushups” answers from the program, “put some music on” opens the player. Type it or hold the 🎤 and say it — if you speak, it speaks back. Works offline with no key and no account (see below).
- **3 sessions** — Upper Body Plan A (Aesthetic), Upper Body Plan B (Strength), Legs + Abs — all transcribed from the PDF (sets, reps, notes).
- **Guided runner** — step through every set with target reps and form notes.
- **Timers for every exercise** — auto rest timer between sets (30/45/60/90/120s) with a countdown ring + beeps; dedicated hold countdowns for timed exercises (Planche Leans, Hollow Body Hold, L-Sit).
- **Camera rep counter** — on most exercises, tap "📷 Verify reps with camera" to auto-count reps with on-device pose detection (MediaPipe Pose, "full" model). Supported movements: **pushups & dips** (elbow angle), **squats & lunges** (knee angle), **lying leg raises** (hip angle), and **calf raises** (body rise). It counts **down** from your rep goal, **auto-calibrates to your range of motion**, beeps per rep, and shows a live skeleton overlay. Runs entirely in your browser — no video leaves your device. Needs HTTPS and camera permission.
  - **Perfect-form pushups** — pushups are judged on real form: full depth (chest low), full lockout, and a straight body line. Only clean reps count, with live cues ("Go lower", "Keep your body straight").
  - **Voice** — toggle 🎤 in the camera to go hands-free: it speaks your rep count out loud and listens for commands ("reset", "done", "close", and "start" in challenges).
- **Pushup Challenge** — a max-pushups-in-60s AMRAP (clean form only) that generates a **shareable link**. Send it to a friend; they open it, do the challenge, and the app shows who won. No backend — the score is encoded in the URL.
- **Music** — floating player with **Spotify / Apple / YouTube** tabs (remembers your choice). Spotify = full-track playback via the Web Playback SDK (Premium login, see setup below). Apple Music & YouTube = embedded players; paste any link to swap the playlist. Apple/YouTube play full songs when you're signed in (YouTube needs no login). Stays playing as you move from the home screen into a workout.
- **Progress log** — sessions saved in your browser (localStorage); home screen shows weekly count and last-done dates.
- **Weekly split + tips** from the PDF on the home screen.
- Screen-wake-lock during a session (where supported), mobile-friendly.

## How the Coach works

The coach turns a sentence into **actions in the app** — the same ones the buttons
trigger — instead of a wall of text. There are two brains behind it, and they
share one action list (`lib/agent/actions.ts`), so both drive the app identically:

- **Built in (default).** `lib/agent/offline.ts` matches plain English against
  that action list, entirely in the browser. No key, no account, no network — it
  works in a basement gym on airplane mode, which is the same reason the rest of
  this app has no backend.
- **Claude (optional).** If `ANTHROPIC_API_KEY` is set, `/api/agent` plans the
  turn with Claude using the action list as tool definitions, which handles
  phrasing the built-in matcher won't ("my elbows are cooked, give me something
  that isn't pressing"). Anything at all — no key, no signal, a slow response —
  falls back to the built-in brain, so the coach never dies mid-set.

To enable the Claude path:

1. Get a key at <https://console.anthropic.com>.
2. Local: add `ANTHROPIC_API_KEY=sk-ant-...` to `.env.local`.
   Vercel: `vercel env add ANTHROPIC_API_KEY` (Production), then redeploy.
3. Optional: `ANTHROPIC_MODEL` to override the model (defaults to `claude-opus-5`).

The key is **server-side only** — it is never sent to the browser. Without it the
route returns 501 and the app stays a fully static, backend-free deploy.

It is a workout coach, not a doctor: reported pain gets "stop and get it looked
at", never a session.

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

Built with Next.js 15 + Tailwind CSS v4. No backend required — the only server
code is the optional `/api/agent` route for the Claude-powered coach.
