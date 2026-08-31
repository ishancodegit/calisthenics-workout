# Errand

An assistant that does real jobs on your own computer — tidies a folder, finds
a file, reads a spreadsheet, drafts a document — for people who are not
technical and shouldn't have to be.

It thinks on **your machine**, using a model that runs locally. That is the
whole idea: there is no per-message cost, so the app can be a small flat
monthly fee instead of a meter running in the background. Your files are never
uploaded to anyone.

---

## Why it's built this way

Three decisions follow from "for non-coders, on their own model":

**1. The model is local, so the price can be flat.**
Cloud assistants have to charge per token because every message costs them
money. A 7B model on the user's own laptop costs them nothing per message, and
nothing to us. The subscription pays for the app, the updates and the
onboarding — not for inference.

**2. Small models are unreliable, so nothing destructive happens
unsupervised.**
A 7B model *will* misread "tidy my downloads" occasionally. So the agent cannot
change a file directly. Any change becomes a **plan** — a list of plain English
sentences ("Move holiday.jpg into Pictures") — that the person reads and
approves. Then it can be undone in one click. This is the core of the product,
not a safety afterthought: it's what makes an imperfect local model safe to
point at somebody's documents.

**3. Access is granted by folder, and enforced in Rust.**
The agent can only see folders the person picked in a native folder dialog.
Every path it names is resolved and checked against those folders before it
reaches the filesystem, symlinks included. The frontend can only *ask*; the
Rust side decides.

## What it can do

- Look through your folders and find files
- Tidy a messy folder into sensible sub-folders — by kind, or by month
- Read documents and spreadsheets and answer questions about them
- Write summaries, drafts, and spreadsheets you can open in Excel
- Read a web page you point it at

Everything that changes a file goes through the approve-and-undo flow above.

## Architecture

```
errand/
├── core/          Rust. All the rules that protect the user's files.
│   ├── sandbox.rs   which folders are reachable (symlink-safe)
│   ├── plan.rs      propose → approve → apply → undo
│   ├── files.rs     list, search, read, and the tidy-up planner
│   └── text.rs      HTML → text, CSV parsing
├── src-tauri/     Rust. Thin desktop shell: window, folder picker, commands.
└── src/           TypeScript. The agent loop and the interface.
    ├── agent/loop.ts        the loop, and the guards that keep small models sane
    ├── agent/tools.ts       what the agent can do, described for a 7B model
    ├── agent/bridge.ts      the only path from the UI to the machine
    └── agent/providers/     ollama (default) · cloud (optional) · demo (preview)
```

`core` has no Tauri dependency on purpose — the rules that keep people's files
safe are unit-tested on their own, without a windowing system.

The **agent loop** exists to survive a small model. It stops repeated identical
tool calls, corrects invented tool names, caps the number of turns, and ends the
errand outright when someone declines a plan rather than letting the model
propose a second one. Each of those is a real failure mode of an 8B model with
tools.

## Models

| | |
|---|---|
| **Default — local** | Ollama on the user's machine. `qwen2.5:7b` by default; the app installs it. Free per message, private, works offline. |
| **Optional — cloud** | Paste your own Anthropic key for hard errands. Off by default, because the moment it's on you're paying per message again. |

## Running it

Browser preview — no install, made-up files, shows the real flow:

```bash
npm install
npm run dev        # http://localhost:5173
```

Desktop app (needs [Rust](https://rustup.rs) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS):

```bash
npm run tauri dev
npm run tauri build      # produces the installable app
npm run tauri icon src-tauri/icons/icon.png   # once, for platform icon formats
```

## Tests

```bash
cd core && cargo test          # 13 tests: sandbox escapes, undo, rollback, parsing
npm test                       # 11 tests: the agent loop under a misbehaving model
```

The Rust tests are the product promise in executable form — that the agent
can't reach outside its folders, can't silently overwrite, and can't do
anything that isn't reversible.

## Where this is unfinished

Being straight about it:

- **The desktop shell has not been compiled yet.** `core/` and the frontend are
  tested; `src-tauri/src/main.rs` is thin plumbing over them but needs a machine
  with the GTK/WebKit development libraries to build and try.
- **Email and calendar aren't connected.** They need OAuth per provider, which
  is the next real milestone. The tool interface is ready for them.
- **Web search isn't wired up** — the agent can read a page you give it, but
  can't go looking. A search API is a subscription-funded addition.
- **Model downloads show no progress bar.** Ollama streams progress; the UI
  currently just says "this can take a few minutes".
- **Granted folders aren't remembered between launches** yet.
