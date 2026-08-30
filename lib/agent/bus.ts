// Dispatch layer between the coach and the running app.
//
// Components register the actions they can service while they're mounted (the
// runner owns "next_set", the music player owns "open_music", and so on), so
// what the coach can do is always exactly what's on screen. A module-level
// registry keeps the wiring out of the component tree — this is a single-page
// client app, so there is only ever one of each.

import type { ActionName, AgentContext } from "./actions";

export type ActionResult = { ok: boolean; message?: string };
type Handler = (args: Record<string, unknown>) => ActionResult | void | Promise<ActionResult | void>;

type ContextLayer = () => Partial<Omit<AgentContext, "available">>;

const handlers = new Map<ActionName, Handler>();
// Layered so the runner can describe the current set on top of the page's
// base description, and unmounting the runner leaves the base intact.
const contextLayers: ContextLayer[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

/** Subscribe to availability changes (so the UI can re-render its suggestions). */
export function onAvailabilityChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Register a batch of handlers; returns a cleanup for useEffect. */
export function registerActions(map: Partial<Record<ActionName, Handler>>) {
  const entries = Object.entries(map) as [ActionName, Handler][];
  entries.forEach(([name, fn]) => handlers.set(name, fn));
  notify();
  return () => {
    // Only retract our own handler — a remount may already have replaced it.
    entries.forEach(([name, fn]) => {
      if (handlers.get(name) === fn) handlers.delete(name);
    });
    notify();
  };
}

export function registerContext(fn: ContextLayer) {
  contextLayers.push(fn);
  return () => {
    const i = contextLayers.indexOf(fn);
    if (i !== -1) contextLayers.splice(i, 1);
  };
}

export function availableActions(): ActionName[] {
  return [...handlers.keys()];
}

export function snapshot(): AgentContext {
  const merged = contextLayers.reduce<Partial<AgentContext>>(
    (acc, layer) => ({ ...acc, ...layer() }),
    {}
  );
  return { screen: "home", ...merged, available: availableActions() };
}

export async function runAction(
  name: ActionName,
  args: Record<string, unknown> = {}
): Promise<ActionResult> {
  const fn = handlers.get(name);
  if (!fn) return { ok: false, message: `Can't do that from here.` };
  try {
    return (await fn(args)) || { ok: true };
  } catch {
    return { ok: false, message: "That didn't work." };
  }
}
