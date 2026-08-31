// The default brain: a model running on the person's own machine.
//
// This is the whole economic argument for the product — inference costs the
// user nothing per message, so the subscription can be small and flat. It also
// means their files are never uploaded anywhere, which is the honest reason to
// prefer this over a chat window in a browser.

import type { AssistantReply, ChatMessage, Provider, ToolSchema } from "../types.ts";

const HOST = "http://127.0.0.1:11434";

/** Models we know handle tool-calling well enough to drive this app. */
export const RECOMMENDED = [
  {
    id: "qwen2.5:7b",
    label: "Balanced",
    size: "4.7 GB",
    blurb: "The default. Good at following instructions on an ordinary laptop.",
  },
  {
    id: "llama3.1:8b",
    label: "Alternative",
    size: "4.9 GB",
    blurb: "Similar size, a little chattier.",
  },
  {
    id: "qwen2.5:14b",
    label: "Sharper",
    size: "9 GB",
    blurb: "Noticeably better at multi-step jobs. Needs 16 GB of memory.",
  },
];

type OllamaToolCall = { function?: { name?: string; arguments?: unknown } };

function toOllamaMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content, name: m.name };
    }
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                function: { name: c.name, arguments: c.args },
              })),
            }
          : {}),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function toOllamaTools(tools: ToolSchema[]) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Small models sometimes return arguments as a JSON *string* rather than an
 * object, and sometimes double-encode it. Accept both rather than failing the
 * call — this is the single most common cause of a local model "not working".
 */
function normaliseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      return normaliseArgs(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return {};
}

export function localProvider(model: string): Provider {
  return {
    id: "local",
    label: `${model} on this computer`,
    async chat(messages, tools): Promise<AssistantReply> {
      let response: Response;
      try {
        response = await fetch(`${HOST}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages: toOllamaMessages(messages),
            tools: toOllamaTools(tools),
            stream: false,
            options: { temperature: 0.1 },
          }),
        });
      } catch {
        throw new Error(
          "I can't reach the model on this computer. Open Ollama and try again.",
        );
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `The model “${model}” isn't downloaded yet. Pick it again in Settings to fetch it.`,
          );
        }
        throw new Error("The local model didn't respond properly. Try again in a moment.");
      }

      const data = (await response.json()) as {
        message?: { content?: string; tool_calls?: OllamaToolCall[] };
      };
      const calls = data.message?.tool_calls ?? [];

      return {
        text: data.message?.content ?? "",
        toolCalls: calls
          .filter((c) => typeof c.function?.name === "string")
          .map((c, i) => ({
            id: `${i}`,
            name: c.function!.name as string,
            args: normaliseArgs(c.function?.arguments),
          })),
      };
    },
  };
}

/** Is Ollama installed and up? Used by onboarding, so it must never throw. */
export async function probeOllama(): Promise<{ running: boolean; models: string[] }> {
  try {
    const response = await fetch(`${HOST}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return { running: false, models: [] };
    const data = (await response.json()) as { models?: { name: string }[] };
    return { running: true, models: (data.models ?? []).map((m) => m.name) };
  } catch {
    return { running: false, models: [] };
  }
}
