// Optional upgrade path for the coach.
//
// With ANTHROPIC_API_KEY set, plain-language requests are planned by Claude
// against the same action catalog the offline planner uses; without a key this
// returns 501 and the browser quietly keeps using the built-in brain, so the
// app still deploys as a static, backend-free site.

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { toolDefinitions, type AgentContext } from "@/lib/agent/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

const SYSTEM = `You are the coach inside a beginner calisthenics app. The person using it is not a gym expert and not technical — they are standing in a room in their gym clothes, often mid-set and out of breath.

Your job is to DO things, not explain how to do them. When someone says what they want, call the matching tool. Never tell them which button to press; press it for them.

How to talk:
- One or two short sentences. No preamble, no lists, no markdown, no emoji.
- Plain words. Never say "tool", "action", "app", "workout ID", or any jargon.
- Encouraging but not fawning. Never invent reps, dates, or progress you were not told.
- If they ask something you have no tool for, answer briefly from the program itself.
- If a request is ambiguous, pick the most likely reading and act — do not interrogate them.

Safety: you are not a doctor. If someone reports pain (as opposed to ordinary soreness), say plainly that they should stop and get it looked at rather than train through it, and do not start a session for them.`;

function describe(ctx: AgentContext) {
  const lines = [`Screen: ${ctx.screen}`];
  if (ctx.workoutName) lines.push(`Session: ${ctx.workoutName}`);
  if (ctx.exercise)
    lines.push(
      `Current exercise: ${ctx.exercise}${
        ctx.setNumber ? ` (set ${ctx.setNumber} of ${ctx.totalSets})` : ""
      }`
    );
  if (ctx.phase) lines.push(`Right now they are: ${ctx.phase === "rest" ? "resting between sets" : "doing a set"}`);
  if (ctx.restSeconds) lines.push(`Rest between sets: ${ctx.restSeconds}s`);
  if (typeof ctx.workoutsThisWeek === "number")
    lines.push(`Sessions in the last 7 days: ${ctx.workoutsThisWeek}`);
  if (ctx.suggestedWorkout) lines.push(`The app would pick next: ${ctx.suggestedWorkout}`);
  lines.push(`Tools that will work from this screen: ${ctx.available.join(", ") || "none"}`);
  return lines.join("\n");
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "no_key" }, { status: 501 });
  }

  let body: { input?: string; context?: AgentContext; history?: { role: string; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const input = String(body.input ?? "").slice(0, 500).trim();
  if (!input) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const ctx: AgentContext = body.context ?? { screen: "home", available: [] };
  const history: Anthropic.MessageParam[] = (body.history ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8)
    .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 500) }));

  const client = new Anthropic();

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      // Latency matters more than depth here — this is a router, and the
      // person is mid-set waiting for the app to react.
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      system: [
        // Stable prefix first so it caches; the volatile screen state goes last.
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      tools: toolDefinitions(),
      messages: [
        ...history,
        { role: "user", content: `${describe(ctx)}\n\nThey said: ${input}` },
      ],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({
        say: "I can't help with that one — but I can get you training.",
        actions: [],
      });
    }

    const say = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join(" ");

    const actions = response.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
      .map((b) => ({ name: b.name, args: b.input as Record<string, unknown> }));

    return NextResponse.json({ say, actions });
  } catch (error) {
    // Every failure here is recoverable: the browser falls back to the
    // built-in planner, so log the reason and keep the response shape boring.
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("[agent] bad ANTHROPIC_API_KEY");
      return NextResponse.json({ error: "auth" }, { status: 501 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "rate_limit" }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`[agent] API error ${error.status}:`, error.message);
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }
    console.error("[agent] unexpected error:", error);
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  }
}
