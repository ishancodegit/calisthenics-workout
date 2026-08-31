import { useEffect, useState } from "react";
import { RECOMMENDED, probeOllama } from "../agent/providers/ollama.ts";
import { machine, isDesktop, onPullProgress } from "../agent/bridge.ts";

/**
 * Onboarding is the product's hardest problem: the pitch only works if the
 * model runs on their machine, and they have never installed a model. So this
 * screen does the work rather than explaining it — check, download, done — and
 * it never uses the words "inference", "quantised", "runtime" or "terminal".
 */
export default function Setup({
  onReady,
}: {
  onReady: (state: { model: string; folder: string }) => void;
}) {
  const [checking, setChecking] = useState(true);
  const [running, setRunning] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<{ percent: number; status: string } | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function check() {
    setChecking(true);
    // In the browser preview there is no Ollama to probe — the bridge's fake
    // machine answers instead, so the flow can still be walked through.
    const status = isDesktop() ? await probeOllama() : await machine.ollamaStatus();
    setRunning(status.running);
    setModels(status.models);
    setChecking(false);
  }

  useEffect(() => {
    void check();
    void machine.grantedFolders().then((f) => setFolder(f[0] ?? null));
    // Rust streams Ollama's own progress while a model downloads.
    let stop: (() => void) | undefined;
    void onPullProgress((p) => setProgress({ percent: p.percent, status: p.status })).then(
      (off) => (stop = off),
    );
    return () => stop?.();
  }, []);

  const installed = (id: string) => models.some((m) => m === id || m.startsWith(`${id.split(":")[0]}:`));
  const ready = models.length > 0 && folder;

  async function download(id: string) {
    setBusy(id);
    setError("");
    setProgress({ percent: -1, status: "starting" });
    try {
      await machine.pullModel(id);
      await check();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "That download didn't finish. Try again.",
      );
    } finally {
      setBusy("");
      setProgress(null);
    }
  }

  async function pickFolder() {
    const chosen = await machine.grantFolder();
    if (chosen) setFolder(chosen);
  }

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-bold">Let's get you set up</h1>
      <p className="mt-1" style={{ color: "var(--muted)" }}>
        Two things, once. Then it's yours to use as much as you like.
      </p>

      {/* 1. The brain */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          1 · The assistant's brain
        </h2>
        <p className="mt-2 text-sm">
          Errand thinks on <strong>your</strong> computer, so nothing you ask it goes to a
          company, and it costs nothing per message.
        </p>

        {checking ? (
          <p className="mt-3 text-sm breathe">Checking…</p>
        ) : !running ? (
          <div
            className="mt-3 rounded-lg border p-4"
            style={{ borderColor: "var(--line)", background: "var(--paper)" }}
          >
            <p className="text-sm font-medium">One free download is needed first.</p>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Errand uses Ollama to run the brain. Install it, open it once, then come back
              here.
            </p>
            <div className="mt-3 flex gap-2">
              <a
                href="https://ollama.com/download"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
                style={{ background: "var(--accent)" }}
              >
                Get Ollama
              </a>
              <button
                onClick={check}
                className="rounded-lg border px-4 py-2 text-sm font-medium"
                style={{ borderColor: "var(--line)" }}
              >
                I've done that
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {RECOMMENDED.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-lg border p-3"
                style={{ borderColor: "var(--line)", background: "var(--paper)" }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {m.label} <span style={{ color: "var(--muted)" }}>· {m.size}</span>
                  </p>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {m.blurb}
                  </p>
                </div>
                {installed(m.id) ? (
                  <span className="text-sm font-medium" style={{ color: "var(--accent)" }}>
                    Ready
                  </span>
                ) : (
                  <button
                    onClick={() => download(m.id)}
                    disabled={busy !== ""}
                    className="shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                    style={{ borderColor: "var(--line)" }}
                  >
                    {busy === m.id ? "Downloading…" : "Download"}
                  </button>
                )}
              </div>
            ))}
            {busy && (
              <div>
                {/* A multi-gigabyte download with no feedback looks like a
                    crash, at exactly the moment someone decides to trust this. */}
                <div
                  className="h-2 w-full overflow-hidden rounded-full"
                  style={{ background: "var(--line)" }}
                  role="progressbar"
                  aria-label="Download progress"
                  aria-valuenow={progress && progress.percent >= 0 ? progress.percent : undefined}
                >
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      progress && progress.percent >= 0 ? "" : "breathe"
                    }`}
                    style={{
                      background: "var(--accent)",
                      width:
                        progress && progress.percent >= 0 ? `${progress.percent}%` : "100%",
                    }}
                  />
                </div>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  {progress && progress.percent >= 0
                    ? `${progress.percent}% — ${progress.status}`
                    : "Starting the download…"}{" "}
                  It's a big file; you can leave this open.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. The folder */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          2 · What it's allowed to touch
        </h2>
        <p className="mt-2 text-sm">
          Pick one folder to start with — Downloads is a good first one. Errand can't see
          anything outside the folders you choose, and you can add or remove them any time.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={pickFolder}
            className="rounded-lg border px-4 py-2 text-sm font-medium"
            style={{ borderColor: "var(--line)" }}
          >
            {folder ? "Choose a different folder" : "Choose a folder"}
          </button>
          {folder && (
            <span className="truncate text-sm" style={{ color: "var(--muted)" }}>
              {folder}
            </span>
          )}
        </div>
      </section>

      {error && (
        <p className="mt-4 text-sm" style={{ color: "var(--warn)" }}>
          {error}
        </p>
      )}

      <button
        disabled={!ready}
        onClick={() => onReady({ model: models[0], folder: folder! })}
        className="mt-10 rounded-lg px-5 py-3 font-semibold text-white disabled:opacity-30"
        style={{ background: "var(--accent)" }}
      >
        Start using Errand
      </button>

      {!isDesktop() && (
        <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
          Browser preview — folders and files here are made up, so you can see how it works
          without installing anything.
        </p>
      )}
    </div>
  );
}
