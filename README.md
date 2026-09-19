# Calisthenics Workout

A personal workout runner built from the *Beginner Calisthenics Program* PDF. Black/yellow theme matching the program, with countdown timers for timed holds and automatic rest timers between every set.

## Features

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

## Notes device (`/device`)

The front door for writing. It opens on a blank page and nothing else: no
colour anywhere, no panels, no menus, two hairline strips that fade back while
the nib is down.

- **One page at a time**, fitted to the screen in A-series proportions. `‹` `›`
  or the arrow keys turn pages; `+` starts a new one; `☰` lists them all.
- **Pen, pencil, eraser, three nib widths, undo.** That is the whole toolbox,
  and the ink is black.
- **Pencil only**: a finger never draws, so a resting palm is harmless.
- **✎ Write / ⌨ Type** on the same page, for when a keyboard is faster.
- It reopens on the page you left, and keeps the screen awake while you write.
- Same vault as `/notes`, so anything written here shows up there with links,
  search and backlinks, and vice versa.
- **Back up** in the page index writes the same JSON file the full app does.

**Install it like a device.** On iPad, open `/device` in Safari, Share →
*Add to Home Screen*. It launches fullscreen with no browser chrome, works with
no network (a service worker caches the shell), and keeps your pages in the
browser's own storage.

## Notebook (`/notes`)

A second app lives at **/notes**: an Obsidian-style vault in a notebook form
factor, built for the Apple Pencil. Open it from the 📓 Notebook card on the
home screen.

### Three modes, one page

| Mode | What you get |
| --- | --- |
| **✎ Write** | Markdown with live shortcuts — ⌘B bold, ⌘I italic, ⌘E ==highlight==, ⌘L `[[link]]`, Tab to indent, Enter continues bullets, numbers and checkboxes |
| **👁 Read** | Rendered markdown: headings, tables, code fences, quotes, images, task boxes you can tick with a tap |
| **✍️ Draw** | The Pencil layer, sitting *on top of* your text so you can annotate what you typed |

The ink layer is always visible — only its input is switched off outside Draw
mode — so a page can be half typed, half handwritten.

### Apple Pencil

- **Pressure and tilt.** The pen tapers with pressure; the pencil widens as you
  tilt it (via `altitudeAngle`, with a `tiltX`/`tiltY` fallback). Coalesced
  pointer events are replayed, so all ~240 samples a second shape the line
  rather than the handful React would otherwise see.
- **Palm rejection (✋ Palm).** On by default: fingers scroll, only the Pencil
  draws. Turn it off to draw with touch.
- **Stroke eraser.** Removes whole strokes, not pixels. The barrel button and a
  pointer that reports itself as an eraser switch to it mid-stroke.
- **Lasso (⬚).** Circle some ink to select it, drag to move it, Delete or
  Backspace to remove it.
- **Shape snap (📐).** Draw a rough line, circle or box and it straightens the
  moment you lift. Near-horizontal and near-vertical lines snap flat.
- **Vector ink.** Strokes are stored in page space (1000 units wide), so they
  stay sharp at any zoom and identical across iPad, phone and desktop.
- Undo/redo (⌘Z / ⇧⌘Z) covers drawing, erasing and moving.

### The Obsidian part

- `[[Wikilinks]]` with autocomplete — type `[[` and pick a note. `[[Note|alias]]`
  and `[[Note#heading]]` both work.
- Unresolved links are still links: tap one and the note is created.
- **Backlinks**, outgoing links and a document outline in the right panel.
- **Graph view** of the whole vault in the sidebar — tap a node to open it.
- `#tags` anywhere in a line, indexed in the sidebar.
- Renaming a note rewrites every `[[link]]` that pointed at its old title.
- **⌘K** quick switcher, **⌘N** new note, **📅 Today** for a daily note.
- Notebooks group notes; each page picks its own ruling (ruled / grid / dots /
  plain) and tint (cream / white / slate).

### Storage

Everything is in **IndexedDB** in your browser — no account, no server. Notes
and ink are kept in separate stores, so the sidebar, search, backlinks and graph
never load a single stroke: thousands of notes stay fast while handwriting is
fetched only for the page you have open. Both are saved automatically a beat
after you stop.

**Export** in the sidebar footer writes a JSON backup of every notebook, note
and stroke; **Import** merges one back in. A single note can also be saved as
`.md`. The footer shows how much storage the vault is using.

### Not losing any of it

Browser storage is *best effort* by default: with the disk under pressure the
browser is free to evict the whole vault, and the first you hear about it is an
empty notebook. Two things guard against that.

- On boot both apps call `navigator.storage.persist()`, which asks the browser
  to keep this data through a squeeze. Chrome grants it silently to engaged or
  installed sites, Firefox may ask, and Safari grants it to apps added to the
  home screen. When it is refused the sidebar footer says `not durable`, so the
  state is never a mystery.
- Once there are five written pages, a quiet strip offers a backup: **Back up**
  saves the JSON file, **Later** holds it off for a week. It returns if a
  backup ever gets more than two weeks stale with edits since.

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
