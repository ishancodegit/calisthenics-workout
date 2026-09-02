// The loop's job is to stay sane while an 8B model misbehaves. Each test here
// is one way a small model actually goes wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runErrand } from "./loop.ts";
import type { AssistantReply, Plan, Provider, Tool } from "./types.ts";

/** A provider that replays a fixed script of replies, one per turn. */
function scriptedProvider(script: AssistantReply[]): Provider & { turns: number } {
  let turns = 0;
  const provider = {
    id: "local" as const,
    label: "test model",
    async chat(): Promise<AssistantReply> {
      const reply = script[turns] ?? { text: "done", toolCalls: [] };
      turns += 1;
      provider.turns = turns;
      return reply;
    },
    turns: 0,
  };
  return provider;
}

const plan: Plan = {
  summary: "Sort 2 files in Downloads into 2 folders.",
  changes: [
    { kind: "create_folder", path: "/d/Pictures" },
    { kind: "move", from: "/d/a.jpg", to: "/d/Pictures/a.jpg" },
  ],
  preview: ["Make a folder called Pictures", "Move a.jpg into Pictures"],
};

function tools(overrides: Record<string, Tool> = {}): Record<string, Tool> {
  return {
    list_folder: {
      kind: "read",
      schema: {
        name: "list_folder",
        description: "list",
        parameters: { type: "object", properties: {}, required: [] },
      },
      async run() {
        return "a.jpg\nb.pdf";
      },
    },
    tidy_folder: {
      kind: "change",
      schema: {
        name: "tidy_folder",
        description: "tidy",
        parameters: { type: "object", properties: {}, required: [] },
      },
      async run() {
        return plan;
      },
    },
    ...overrides,
  };
}

const call = (name: string, args: Record<string, unknown> = {}, id = "1") => ({
  id,
  name,
  args,
});

const never = async () => {
  throw new Error("should not have been asked to apply anything");
};

test("plain answer with no tools ends the errand", async () => {
  const result = await runErrand("what can you do", {
    provider: scriptedProvider([{ text: "I can tidy your folders.", toolCalls: [] }]),
    tools: tools(),
    onApproval: async () => false,
    applyPlan: never,
  });
  assert.equal(result.reply, "I can tidy your folders.");
  assert.equal(result.receipts.length, 0);
});

test("a read tool runs without asking, and its result feeds the answer", async () => {
  let sawResult = false;
  const provider = scriptedProvider([
    { text: "", toolCalls: [call("list_folder")] },
    { text: "You've got 2 files in there.", toolCalls: [] },
  ]);
  const original = provider.chat.bind(provider);
  provider.chat = async (messages, schemas) => {
    sawResult ||= messages.some(
      (m) => m.role === "tool" && m.content.includes("a.jpg"),
    );
    return original(messages, schemas);
  };

  const result = await runErrand("what's in my downloads", {
    provider,
    tools: tools(),
    onApproval: async () => false,
    applyPlan: never,
  });

  assert.equal(result.reply, "You've got 2 files in there.");
  assert.ok(sawResult, "tool output was never shown to the model");
  assert.ok(result.steps.some((s) => s.type === "tool"));
});

test("a change tool is never applied without approval", async () => {
  let asked = 0;
  const result = await runErrand("tidy my downloads", {
    provider: scriptedProvider([{ text: "", toolCalls: [call("tidy_folder")] }]),
    tools: tools(),
    onApproval: async (p) => {
      asked += 1;
      assert.equal(p.summary, plan.summary);
      return false;
    },
    applyPlan: never, // throws if called
  });

  assert.equal(asked, 1);
  assert.equal(result.receipts.length, 0);
  assert.ok(result.steps.some((s) => s.type === "rejected"));
});

test("saying no ends the errand instead of letting the model try again", async () => {
  // The model would happily propose a second, sneakier plan if we let it.
  const provider = scriptedProvider([
    { text: "", toolCalls: [call("tidy_folder")] },
    { text: "", toolCalls: [call("tidy_folder", { by: "month" }, "2")] },
  ]);
  const result = await runErrand("tidy up", {
    provider,
    tools: tools(),
    onApproval: async () => false,
    applyPlan: never,
  });

  assert.equal(provider.turns, 1, "model got another turn after a refusal");
  assert.equal(result.reply, "Left everything as it was.");
});

test("approval applies the plan once and records an undo receipt", async () => {
  const applied: Plan[] = [];
  const result = await runErrand("tidy my downloads", {
    provider: scriptedProvider([
      { text: "", toolCalls: [call("tidy_folder")] },
      { text: "All tidied up.", toolCalls: [] },
    ]),
    tools: tools(),
    onApproval: async () => true,
    applyPlan: async (p) => {
      applied.push(p);
      return { applied: p.changes.length, token: "r1" };
    },
  });

  assert.equal(applied.length, 1);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.receipts[0].receipt.applied, 2);
  assert.equal(result.reply, "All tidied up.");
});

test("an invented tool name is corrected, not fatal", async () => {
  const result = await runErrand("do a thing", {
    provider: scriptedProvider([
      { text: "", toolCalls: [call("delete_everything")] },
      { text: "I can't do that one.", toolCalls: [] },
    ]),
    tools: tools(),
    onApproval: async () => false,
    applyPlan: never,
  });
  assert.equal(result.reply, "I can't do that one.");
});

test("repeating an identical call is blocked so the model can't spin", async () => {
  let runs = 0;
  const counting = tools({
    list_folder: {
      kind: "read",
      schema: {
        name: "list_folder",
        description: "list",
        parameters: { type: "object", properties: {}, required: [] },
      },
      async run() {
        runs += 1;
        return "a.jpg";
      },
    },
  });

  await runErrand("look", {
    provider: scriptedProvider([
      { text: "", toolCalls: [call("list_folder", { folder: "d" })] },
      { text: "", toolCalls: [call("list_folder", { folder: "d" }, "2")] },
      { text: "", toolCalls: [call("list_folder", { folder: "d" }, "3")] },
      { text: "Two files.", toolCalls: [] },
    ]),
    tools: counting,
    onApproval: async () => false,
    applyPlan: never,
  });

  assert.equal(runs, 1, "the same call ran more than once");
});

test("a model that never stops is cut off with something a person can act on", async () => {
  const spinning: Provider = {
    id: "local",
    label: "spinner",
    async chat() {
      // Distinct args each time, so the repeat-guard doesn't catch it.
      return { text: "", toolCalls: [call("list_folder", { n: Math.random() })] };
    },
  };
  const result = await runErrand("go", {
    provider: spinning,
    tools: tools(),
    onApproval: async () => false,
    applyPlan: never,
    maxSteps: 3,
  });
  assert.match(result.reply, /smaller piece/);
});

test("a failing tool is reported to the model, not thrown at the person", async () => {
  const broken = tools({
    list_folder: {
      kind: "read",
      schema: {
        name: "list_folder",
        description: "list",
        parameters: { type: "object", properties: {}, required: [] },
      },
      async run(): Promise<string> {
        throw new Error("That folder is outside the ones you've allowed.");
      },
    },
  });
  const result = await runErrand("look in there", {
    provider: scriptedProvider([
      { text: "", toolCalls: [call("list_folder")] },
      { text: "I can't see that folder.", toolCalls: [] },
    ]),
    tools: broken,
    onApproval: async () => false,
    applyPlan: never,
  });
  assert.equal(result.reply, "I can't see that folder.");
  assert.ok(result.steps.some((s) => s.type === "error"));
});

test("the activity line counts what came back, not the fence around it", async () => {
  const fenced: Record<string, Tool> = {
    read_email: {
      kind: "read",
      schema: {
        name: "read_email",
        description: "email",
        parameters: { type: "object", properties: {}, required: [] },
      },
      async run() {
        return "--- begin outside content ---\nfrom a\nfrom b\n--- end outside content ---";
      },
    },
  };
  const result = await runErrand("check my email", {
    provider: scriptedProvider([
      { text: "", toolCalls: [call("read_email")] },
      { text: "Two messages.", toolCalls: [] },
    ]),
    tools: fenced,
    onApproval: async () => false,
    applyPlan: never,
  });
  const step = result.steps.find((s) => s.type === "tool");
  assert.equal(step && step.type === "tool" ? step.summary : "", "Looked at 2 messages");
});

test("a dead model surfaces as a sentence, not a stack trace", async () => {
  const dead: Provider = {
    id: "local",
    label: "offline",
    async chat(): Promise<AssistantReply> {
      throw new Error("Ollama isn't running.");
    },
  };
  const result = await runErrand("hello", {
    provider: dead,
    tools: tools(),
    onApproval: async () => false,
    applyPlan: never,
  });
  assert.equal(result.reply, "Ollama isn't running.");
});

test("an empty plan is not put in front of the person", async () => {
  const empty = tools({
    tidy_folder: {
      kind: "change",
      schema: {
        name: "tidy_folder",
        description: "tidy",
        parameters: { type: "object", properties: {}, required: [] },
      },
      async run(): Promise<Plan> {
        return { summary: "Nothing loose to tidy.", changes: [], preview: [] };
      },
    },
  });
  let asked = 0;
  const result = await runErrand("tidy", {
    provider: scriptedProvider([
      { text: "", toolCalls: [call("tidy_folder")] },
      { text: "It's already tidy.", toolCalls: [] },
    ]),
    tools: empty,
    onApproval: async () => {
      asked += 1;
      return true;
    },
    applyPlan: never,
  });
  assert.equal(asked, 0, "asked to approve a plan that does nothing");
  assert.equal(result.reply, "It's already tidy.");
});
