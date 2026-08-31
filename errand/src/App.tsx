import { useCallback, useEffect, useRef, useState } from "react";
import Setup from "./ui/Setup.tsx";
import PlanCard from "./ui/PlanCard.tsx";
import { runErrand, SYSTEM_PROMPT } from "./agent/loop.ts";
import { buildTools, CAPABILITY_SUMMARY } from "./agent/tools.ts";
import { localProvider } from "./agent/providers/ollama.ts";
import { demoProvider } from "./agent/providers/demo.ts";
import { machine, isDesktop } from "./agent/bridge.ts";
import type { ConnectionStatus } from "./agent/bridge.ts";
import type { Plan, Receipt, Step } from "./agent/types.ts";

type Entry =
  | { role: "you"; text: string }
  | { role: "errand"; text: string }
  | { role: "activity"; text: string }
  | { role: "done"; text: string; receipt: Receipt; undone?: boolean };

const EXAMPLES = [
  "Tidy up my Downloads folder",
  "Find everything with 'invoice' in the name",
  "What's in my budget spreadsheet?",
  "What's on my calendar today?",
];

export default function App() {
  const [setup, setSetup] = useState<{ model: string; folder: string } | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Plan | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [google, setGoogle] = useState<ConnectionStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  useEffect(() => {
    void machine.googleStatus().then(setGoogle).catch(() => setGoogle(null));
  }, []);

  async function connectGoogle() {
    setConnecting(true);
    setConnectError("");
    try {
      await machine.connectGoogle();
      setGoogle(await machine.googleStatus());
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : "That didn't connect.");
    } finally {
      setConnecting(false);
    }
  }

  // Resolves when the person presses Do it / No thanks on a plan.
  const decision = useRef<((approved: boolean) => void) | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const push = useCallback((entry: Entry) => {
    setEntries((list) => [...list, entry]);
    requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  const onApproval = useCallback(
    (plan: Plan) =>
      new Promise<boolean>((resolve) => {
        setPending(plan);
        decision.current = (approved) => {
          setPending(null);
          decision.current = null;
          resolve(approved);
        };
      }),
    [],
  );

  async function send(goal: string) {
    const text = goal.trim();
    if (!text || busy) return;
    setInput("");
    push({ role: "you", text });
    setBusy(true);

    // Local by default. The cloud SDK is loaded only if someone opted in, so
    // the local-first path doesn't ship a megabyte of code it never runs.
    let provider;
    if (!isDesktop()) {
      provider = demoProvider();
    } else if (apiKey) {
      const { cloudProvider } = await import("./agent/providers/cloud.ts");
      provider = cloudProvider(apiKey, SYSTEM_PROMPT);
    } else {
      provider = localProvider(setup!.model);
    }

    const onStep = (step: Step) => {
      if (step.type === "tool") push({ role: "activity", text: step.summary });
      if (step.type === "applied")
        push({
          role: "done",
          text: step.plan.summary,
          receipt: step.receipt,
        });
    };

    try {
      const result = await runErrand(text, {
        provider,
        tools: buildTools(),
        onApproval,
        applyPlan: (plan) => machine.applyPlan(plan),
        onStep,
      });
      push({ role: "errand", text: result.reply });
    } finally {
      setBusy(false);
    }
  }

  async function undo(index: number, receipt: Receipt) {
    await machine.undo(receipt.token);
    setEntries((list) =>
      list.map((e, i) => (i === index && e.role === "done" ? { ...e, undone: true } : e)),
    );
  }

  if (!setup) return <Setup onReady={setSetup} />;

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-4">
      <header
        className="flex items-center justify-between border-b py-3"
        style={{ borderColor: "var(--line)" }}
      >
        <div>
          <h1 className="font-semibold">Errand</h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {!isDesktop()
              ? "Browser preview · made-up files"
              : apiKey
                ? "Using your Claude key"
                : `Thinking on this computer · ${setup.model}`}
          </p>
        </div>
        <button
          onClick={() => setShowSettings((s) => !s)}
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--line)" }}
        >
          Settings
        </button>
      </header>

      {showSettings && (
        <div
          className="mt-3 rounded-xl border p-4 text-sm"
          style={{ borderColor: "var(--line)", background: "var(--paper)" }}
        >
          <p className="font-medium">Allowed folders</p>
          <p className="mt-1" style={{ color: "var(--muted)" }}>
            {setup.folder}
          </p>
          <button
            onClick={async () => {
              const chosen = await machine.grantFolder();
              if (chosen) setSetup({ ...setup, folder: chosen });
            }}
            className="mt-2 rounded-lg border px-3 py-1.5"
            style={{ borderColor: "var(--line)" }}
          >
            Add another folder
          </button>

          <p className="mt-5 font-medium">Email and calendar</p>
          {google?.connected ? (
            <>
              <p className="mt-1" style={{ color: "var(--muted)" }}>
                Connected as {google.email}. Errand can read your mail and calendar; it
                cannot send, delete or change anything.
              </p>
              <button
                onClick={async () => {
                  await machine.disconnectGoogle();
                  setGoogle(await machine.googleStatus());
                }}
                className="mt-2 rounded-lg border px-3 py-1.5"
                style={{ borderColor: "var(--line)" }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <p className="mt-1" style={{ color: "var(--muted)" }}>
                {google?.available === false
                  ? "This build doesn't have Google sign-in set up yet."
                  : "Connect Google so Errand can answer questions about your inbox and what's on today. Read-only — it can't send or delete anything."}
              </p>
              <button
                onClick={connectGoogle}
                disabled={connecting || google?.available === false}
                className="mt-2 rounded-lg border px-3 py-1.5 disabled:opacity-40"
                style={{ borderColor: "var(--line)" }}
              >
                {connecting ? "Waiting for your browser…" : "Connect Google"}
              </button>
              {connectError && (
                <p className="mt-2" style={{ color: "var(--warn)" }}>
                  {connectError}
                </p>
              )}
            </>
          )}

          <p className="mt-5 font-medium">Harder jobs (optional)</p>
          <p className="mt-1" style={{ color: "var(--muted)" }}>
            Paste an Anthropic API key to send difficult errands to Claude instead. You'll pay
            Anthropic per message — the local brain stays free.
          </p>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type="password"
            placeholder="sk-ant-… (leave empty to stay local)"
            className="mt-2 w-full rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
          />
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto py-6">
        {entries.length === 0 && (
          <div>
            <p className="text-lg font-medium">What needs doing?</p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Errand can:
            </p>
            <ul className="mt-2 space-y-1 text-sm" style={{ color: "var(--muted)" }}>
              {CAPABILITY_SUMMARY.map((c) => (
                <li key={c}>· {c}</li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  onClick={() => send(e)}
                  className="rounded-full border px-3 py-1.5 text-sm"
                  style={{ borderColor: "var(--line)", background: "var(--paper)" }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {entries.map((entry, i) => {
          if (entry.role === "you")
            return (
              <p
                key={i}
                className="ml-auto max-w-[80%] rounded-xl px-3 py-2 text-sm text-white"
                style={{ background: "var(--accent)" }}
              >
                {entry.text}
              </p>
            );
          if (entry.role === "activity")
            return (
              <p key={i} className="text-sm" style={{ color: "var(--muted)" }}>
                {entry.text}
              </p>
            );
          if (entry.role === "done")
            return (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border p-3 text-sm"
                style={{ borderColor: "var(--line)", background: "var(--paper)" }}
              >
                <span className="flex-1">
                  {entry.undone ? "Put back the way it was." : entry.text}
                </span>
                {!entry.undone && (
                  <button
                    onClick={() => undo(i, entry.receipt)}
                    className="rounded-lg border px-3 py-1.5 font-medium"
                    style={{ borderColor: "var(--line)" }}
                  >
                    Undo
                  </button>
                )}
              </div>
            );
          return (
            <p key={i} className="max-w-[85%] text-sm">
              {entry.text}
            </p>
          );
        })}

        {pending && (
          <PlanCard plan={pending} onDecide={(ok) => decision.current?.(ok)} />
        )}
        {busy && !pending && (
          <p className="text-sm breathe" style={{ color: "var(--muted)" }}>
            Working on it…
          </p>
        )}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t py-3"
        style={{ borderColor: "var(--line)" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask for something in plain words…"
          aria-label="What needs doing?"
          className="flex-1 rounded-lg border px-3 py-2.5"
          style={{ borderColor: "var(--line)", background: "var(--paper)" }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg px-4 py-2.5 font-semibold text-white disabled:opacity-30"
          style={{ background: "var(--accent)" }}
        >
          Go
        </button>
      </form>
    </div>
  );
}
