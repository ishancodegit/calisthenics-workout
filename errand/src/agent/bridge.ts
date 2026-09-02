// The only place the frontend talks to the machine.
//
// Every one of these lands in a Rust command that re-checks the sandbox, so a
// compromised or confused webview can't widen its own access: the frontend can
// only ask, the Rust side decides.

import type { Change, Plan, Receipt } from "./types.ts";

export type Entry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  ext: string;
  modified: number;
};

export type ConnectionStatus = {
  /** False when this build has no Google sign-in configured. */
  available: boolean;
  connected: boolean;
  email: string;
};

/** Emitted by Rust while a model downloads. */
export type PullProgress = {
  model: string;
  /** 0-100, or -1 before Ollama knows the size. */
  percent: number;
  status: string;
  done: boolean;
};

export type Settings = { model: string; api_key: string };

export type OllamaStatus = {
  installed: boolean;
  running: boolean;
  models: string[];
};

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invoke: Invoke | null = null;

/** True when running inside the desktop shell rather than a plain browser. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isDesktop()) return browserFallback<T>(cmd, args);
  if (!invoke) {
    const api = await import("@tauri-apps/api/core");
    invoke = api.invoke as Invoke;
  }
  return invoke<T>(cmd, args);
}

export const machine = {
  grantedFolders: () => call<string[]>("granted_folders"),
  grantFolder: () => call<string | null>("grant_folder"),
  revokeFolder: (path: string) => call<void>("revoke_folder", { path }),

  listFolder: (folder: string) => call<Entry[]>("list_folder", { folder }),
  findFiles: (query: string) => call<Entry[]>("find_files", { query }),
  readFile: (path: string) =>
    call<{ text: string; truncated: boolean }>("read_file", { path }),
  readSheet: (path: string) => call<string[][]>("read_sheet", { path }),
  readWebPage: (url: string) => call<string>("read_web_page", { url }),

  proposeTidy: (folder: string, by: "by_kind" | "by_month") =>
    call<Plan>("propose_tidy", { folder, by }),
  proposeChanges: (summary: string, changes: Change[]) =>
    call<Plan>("propose_changes", { summary, changes }),

  applyPlan: (plan: Plan) => call<Receipt>("apply_plan", { plan }),
  undo: (token: string) => call<number>("undo_plan", { token }),

  searchWeb: (query: string) => call<string>("search_web", { query }),
  readEmail: (query: string) => call<string>("read_email", { query }),
  readCalendar: (days: number) => call<string>("read_calendar", { days }),

  loadSettings: () => call<Settings>("load_settings"),
  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  googleStatus: () => call<ConnectionStatus>("google_status"),
  connectGoogle: () => call<string>("connect_google"),
  disconnectGoogle: () => call<void>("disconnect_google"),

  ollamaStatus: () => call<OllamaStatus>("ollama_status"),
  pullModel: (model: string) => call<void>("pull_model", { model }),
};

/** Subscribe to model-download progress. No-op outside the desktop app. */
export async function onPullProgress(
  handler: (progress: PullProgress) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<PullProgress>("pull-progress", (event) => handler(event.payload));
}

/* ------------------------------------------------------------------ */
/* Browser fallback                                                    */
/* ------------------------------------------------------------------ */
// `npm run dev` in a plain browser has no Rust behind it. Rather than a blank
// screen, the app runs against a small fake machine so the whole flow —
// onboarding, a plan, approving it, undoing it — can be exercised and
// designed without building the desktop bundle.

const demoFiles: Entry[] = [
  ["holiday.jpg", 2_400_000],
  ["beach.png", 1_100_000],
  ["invoice-march.pdf", 84_000],
  ["invoice-april.pdf", 91_000],
  ["budget.csv", 4_200],
  ["Setup.dmg", 140_000_000],
  ["song.mp3", 5_600_000],
].map(([name, size]) => ({
  name: name as string,
  path: `/Users/you/Downloads/${name}`,
  is_dir: false,
  size: size as number,
  ext: (name as string).split(".").pop() ?? "",
  modified: 1_750_000_000,
}));

const KIND: Record<string, string> = {
  jpg: "Pictures",
  png: "Pictures",
  pdf: "Documents",
  csv: "Spreadsheets",
  mp3: "Music",
  dmg: "Installers",
};

async function browserFallback<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const as = <R,>(v: R) => v as unknown as T;
  switch (cmd) {
    case "granted_folders":
      return as(["/Users/you/Downloads"]);
    case "grant_folder":
      return as("/Users/you/Downloads");
    case "list_folder":
      return as(demoFiles);
    case "find_files": {
      const q = String(args.query ?? "").toLowerCase();
      return as(demoFiles.filter((f) => f.name.toLowerCase().includes(q)));
    }
    case "read_file":
      return as({ text: "(demo mode — no real file was read)", truncated: false });
    case "read_sheet":
      return as([
        ["Item", "Cost"],
        ["Rent", "900"],
        ["Food", "260"],
      ]);
    case "read_web_page":
      return as("(demo mode — the desktop app fetches the real page here.)");
    case "propose_tidy": {
      const folders = new Set<string>();
      const changes: Change[] = [];
      for (const f of demoFiles) {
        const bucket = KIND[f.ext] ?? "Other";
        if (!folders.has(bucket)) {
          folders.add(bucket);
          changes.push({ kind: "create_folder", path: `/Users/you/Downloads/${bucket}` });
        }
        changes.push({
          kind: "move",
          from: f.path,
          to: `/Users/you/Downloads/${bucket}/${f.name}`,
        });
      }
      return as({
        summary: `Sort ${demoFiles.length} files in Downloads into ${folders.size} folders.`,
        changes,
        preview: changes.map((c) =>
          c.kind === "move"
            ? `Move ${c.from.split("/").pop()} into ${c.to.split("/").slice(-2)[0]}`
            : c.kind === "create_folder"
              ? `Make a folder called ${c.path.split("/").pop()}`
              : c.kind,
        ),
      } satisfies Plan);
    }
    case "propose_changes": {
      const changes = (args.changes ?? []) as Change[];
      return as({
        summary: String(args.summary ?? ""),
        changes,
        preview: changes.map((c) =>
          c.kind === "write" ? `Write ${c.path.split("/").pop()}` : JSON.stringify(c),
        ),
      } satisfies Plan);
    }
    case "apply_plan":
      return as({ applied: (args.plan as Plan).changes.length, token: "demo" });
    case "undo_plan":
      return as(0);
    case "search_web":
      return as(
        "Bin collection days\nhttps://example.gov.uk/bins\nFind your collection day by postcode.\n\n(demo mode — the desktop app runs a real search here.)",
      );
    case "read_email":
      return as(
        [
          "From: Sarah | Subject: Lunch Thursday? | Mon, 3 Jun | Are you free around 1?",
          "From: EDF Energy | Subject: Your bill is ready | Sun, 2 Jun | Your statement for May…",
        ].join("\n"),
      );
    case "read_calendar":
      return as(
        "2024-06-14T09:30:00Z — Dentist (at High Street)\n2024-06-14T14:00:00Z — Team call",
      );
    case "load_settings":
      return as({ model: "", api_key: "" });
    case "save_settings":
      return as(undefined);
    case "google_status":
      return as({ available: false, connected: false, email: "" });
    case "connect_google":
      throw new Error("Connecting an account only works in the desktop app.");
    case "disconnect_google":
      return as(undefined);
    case "ollama_status":
      return as({ installed: true, running: true, models: ["llama3.1:8b"] });
    case "pull_model":
      return as(undefined);
    default:
      throw new Error(`Not available in the browser preview: ${cmd}`);
  }
}
