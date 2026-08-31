// The optional escape hatch.
//
// Local models handle most errands, but they visibly struggle on long
// multi-step jobs. Rather than pretend otherwise, someone can paste their own
// API key and have hard errands run on a frontier model. It stays off by
// default: the moment this is on, the person is paying per message again, which
// is exactly what the product exists to avoid.

import Anthropic from "@anthropic-ai/sdk";
import type { AssistantReply, ChatMessage, Provider, ToolSchema } from "../types.ts";

const MODEL = "claude-opus-5";

function toAnthropic(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === "system") continue; // hoisted into the system field
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.args,
        });
      }
      if (blocks.length > 0) out.push({ role: "assistant", content: blocks });
    } else if (message.role === "tool") {
      // Tool results are user-role content blocks in the Messages API.
      const last = out[out.length - 1];
      const block: Anthropic.ContentBlockParam = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      if (last?.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

export function cloudProvider(apiKey: string, systemPrompt: string): Provider {
  // The key is the user's own and never leaves their machine except to
  // Anthropic; there is no server of ours in the path.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  return {
    id: "cloud",
    label: "Claude (your own key)",
    async chat(messages, tools): Promise<AssistantReply> {
      const definitions: Anthropic.Tool[] = tools.map((t: ToolSchema) => ({
        name: t.name,
        description: t.description,
        input_schema: {
          type: "object",
          properties: t.parameters.properties,
          required: t.parameters.required,
        },
      }));

      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 4096,
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          system: systemPrompt,
          tools: definitions,
          messages: toAnthropic(messages),
        });

        return {
          text: response.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join(" ")
            .trim(),
          toolCalls: response.content
            .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
            .map((b) => ({
              id: b.id,
              name: b.name,
              args: b.input as Record<string, unknown>,
            })),
        };
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError) {
          throw new Error("That API key was rejected. Check it in Settings.");
        }
        if (error instanceof Anthropic.RateLimitError) {
          throw new Error("Your API account is rate limited. Try again shortly.");
        }
        throw new Error("Couldn't reach Claude. Errand can carry on using the local model.");
      }
    },
  };
}
