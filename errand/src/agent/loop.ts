// The agent loop.
//
// Small models running on a laptop are the whole point of this product, and
// they misbehave in specific, predictable ways: they invent tool names, they
// pass the wrong argument names, they call the same tool forever, and they
// answer in prose when they should act. Every guard in here exists because of
// one of those, and each one is what stands between "it works on my machine
// with a 70B" and "it works on my mum's laptop with an 8B".

import type {
  ChatMessage,
  ErrandResult,
  Plan,
  Provider,
  Receipt,
  Step,
  Tool,
  ToolCall,
} from "./types.ts";

export type Deps = {
  provider: Provider;
  tools: Record<string, Tool>;
  /** Show the person a plan; resolve true to apply it. */
  onApproval: (plan: Plan) => Promise<boolean>;
  /** Apply an approved plan (goes to Rust). */
  applyPlan: (plan: Plan) => Promise<Receipt>;
  onStep?: (step: Step) => void;
  /** Cap on model turns. Small models loop; this is the stop. */
  maxSteps?: number;
};

export const SYSTEM_PROMPT = `You are Errand, an assistant that does real jobs on someone's own computer. They are not technical. They are not a programmer. They will never see a file path, an error code, or a tool name — only what you say back.

Rules:
1. Use a tool to find things out. Never guess what is in a folder or a file, and never invent file names.
2. Do the job, don't explain how to do it. If they ask you to tidy something, tidy it.
3. Anything that changes their files is shown to them for approval first. Propose it and stop — do not ask "shall I?" in words, because they will be asked properly by the app.
4. When you have the answer, say it in one or two plain sentences. No file paths, no jargon, no markdown, no bullet lists unless they asked for a list.
5. If a tool fails or a folder is off limits, say so plainly and stop. Never retry the same call twice.
6. If you genuinely cannot do something with the tools you have, say what you can't do in one sentence. Never pretend you did it.`;

const MAX_STEPS_DEFAULT = 8;
const MAX_TOOL_CHARS = 6000;

/** A model that calls the same tool with the same arguments is stuck. */
function callSignature(call: ToolCall): string {
  return `${call.name}:${JSON.stringify(call.args ?? {})}`;
}

function isPlan(value: unknown): value is Plan {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Plan).changes) &&
    typeof (value as Plan).summary === "string"
  );
}

function clip(text: string): string {
  return text.length > MAX_TOOL_CHARS
    ? `${text.slice(0, MAX_TOOL_CHARS)}\n…(truncated)`
    : text;
}

export async function runErrand(goal: string, deps: Deps): Promise<ErrandResult> {
  const { provider, tools, onApproval, applyPlan, onStep } = deps;
  const maxSteps = deps.maxSteps ?? MAX_STEPS_DEFAULT;

  const schemas = Object.values(tools).map((t) => t.schema);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: goal },
  ];

  const steps: Step[] = [];
  const receipts: { plan: Plan; receipt: Receipt }[] = [];
  const seen = new Set<string>();
  const emit = (step: Step) => {
    steps.push(step);
    onStep?.(step);
  };

  for (let turn = 0; turn < maxSteps; turn++) {
    emit({ type: "thinking" });

    let reply;
    try {
      reply = await provider.chat(messages, schemas);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "error", message });
      return { reply: message, steps, receipts };
    }

    // No tool calls means the model is talking to the person: we're done.
    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      const text = reply.text.trim() || "I'm not sure how to help with that one.";
      emit({ type: "said", text });
      return { reply: text, steps, receipts };
    }

    messages.push({
      role: "assistant",
      content: reply.text,
      toolCalls: reply.toolCalls,
    });

    for (const call of reply.toolCalls) {
      const tool = tools[call.name];

      // Invented tool name — tell the model what it actually has rather than
      // failing the whole errand.
      if (!tool) {
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: `There is no tool called "${call.name}". Available: ${Object.keys(tools).join(", ")}.`,
        });
        continue;
      }

      const signature = callSignature(call);
      if (seen.has(signature)) {
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content:
            "You already ran exactly this. Use what you got back, or tell the person what you found.",
        });
        continue;
      }
      seen.add(signature);

      let outcome: string | Plan;
      try {
        outcome = await tool.run(call.args ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: "error", message });
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: `That didn't work: ${message}`,
        });
        continue;
      }

      if (tool.kind === "change" && isPlan(outcome)) {
        const plan = outcome;
        if (plan.changes.length === 0) {
          messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: `Nothing to do: ${plan.summary}`,
          });
          continue;
        }

        emit({ type: "plan", plan });
        const approved = await onApproval(plan);
        if (!approved) {
          emit({ type: "rejected", plan });
          // Stop the errand outright. Letting the model "try something else"
          // after a refusal is how an agent talks someone into a change they
          // already said no to.
          const text = "Left everything as it was.";
          emit({ type: "said", text });
          return { reply: text, steps, receipts };
        }

        try {
          const receipt = await applyPlan(plan);
          receipts.push({ plan, receipt });
          emit({ type: "applied", plan, receipt });
          messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: `Done: ${plan.summary} (${receipt.applied} changes applied).`,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          emit({ type: "error", message });
          messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: `That didn't work: ${message}`,
          });
        }
        continue;
      }

      const text = typeof outcome === "string" ? outcome : JSON.stringify(outcome);
      emit({ type: "tool", name: call.name, summary: summarise(call.name, text) });
      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: clip(text),
      });
    }
  }

  // Ran out of turns — say so rather than leaving them staring at a spinner.
  const text =
    "I got stuck part way through that one. Try telling me a smaller piece of it.";
  emit({ type: "said", text });
  return { reply: text, steps, receipts };
}

/** One short line for the activity list, e.g. "Looked in Downloads". */
function summarise(name: string, result: string): string {
  const lines = result.split("\n").filter(Boolean).length;
  switch (name) {
    case "list_folder":
      return `Looked through ${lines} item${lines === 1 ? "" : "s"}`;
    case "find_files":
      return `Found ${lines} matching file${lines === 1 ? "" : "s"}`;
    case "read_file":
      return "Read a file";
    case "read_spreadsheet":
      return "Read a spreadsheet";
    case "search_web":
      return "Searched the web";
    case "read_web_page":
      return "Read a web page";
    default:
      return name.replace(/_/g, " ");
  }
}
