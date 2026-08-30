// Front door for the planner: ask Claude if a key is configured, otherwise use
// the built-in brain. Any failure — offline, no key, rate limit, a malformed
// reply — silently degrades to the offline planner, so the coach never dies on
// the user mid-workout.

import { isActionName, type AgentAction, type AgentContext, type Turn } from "./actions";
import { planOffline } from "./offline";

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** Once the route tells us there's no key, stop paying for the round trip. */
let cloudAvailable: boolean | null = null;
export function cloudStatus() {
  return cloudAvailable;
}

export async function planTurn(
  input: string,
  ctx: AgentContext,
  history: ChatMessage[] = []
): Promise<Turn> {
  if (cloudAvailable === false) return planOffline(input, ctx);

  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, context: ctx, history: history.slice(-8) }),
      // Someone mid-set won't wait: give up early and answer from the
      // built-in planner rather than leaving them staring at "Thinking…".
      signal: AbortSignal.timeout(12000),
    });

    if (res.status === 501) {
      cloudAvailable = false; // no API key configured — this is the normal case
      return planOffline(input, ctx);
    }
    if (!res.ok) throw new Error(String(res.status));

    const data = await res.json();
    const actions: AgentAction[] = Array.isArray(data.actions)
      ? data.actions
          .filter((a: any) => isActionName(a?.name))
          .map((a: any) => ({ name: a.name, args: a.args ?? {} }))
      : [];
    const say = typeof data.say === "string" ? data.say : "";
    if (!say && actions.length === 0) throw new Error("empty plan");

    cloudAvailable = true;
    return { say, actions, source: "claude" };
  } catch {
    return planOffline(input, ctx);
  }
}
