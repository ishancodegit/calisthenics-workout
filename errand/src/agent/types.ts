// Shared vocabulary between the model, the tools and the UI.

/** A change the agent wants to make, mirrored from errand-core's Rust enum. */
export type Change =
  | { kind: "create_folder"; path: string }
  | { kind: "move"; from: string; to: string }
  | { kind: "write"; path: string; contents: string }
  | { kind: "trash"; path: string };

/** A batch of changes, shown to the person before anything happens. */
export type Plan = {
  summary: string;
  changes: Change[];
  /** One readable line per change, produced by the Rust side. */
  preview: string[];
};

export type Receipt = { applied: number; token: string };

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

/** What a model provider must do — the only thing local and cloud share. */
export type Provider = {
  id: "local" | "cloud";
  /** Human-facing name, e.g. "Llama 3.1 on this Mac". */
  label: string;
  chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<AssistantReply>;
};

export type AssistantReply = { text: string; toolCalls: ToolCall[] };

export type ToolSchema = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
};

/**
 * Tools are either safe to run on the model's say-so, or they change the
 * person's files and must be approved first. Nothing else distinguishes them,
 * and that one bit is what makes an unreliable local model safe to hand a
 * filesystem to.
 */
export type ToolKind = "read" | "change";

export type Tool = {
  schema: ToolSchema;
  kind: ToolKind;
  /** Read tools return text for the model. Change tools return a Plan. */
  run(args: Record<string, unknown>): Promise<string | Plan>;
};

export type Step =
  | { type: "thinking" }
  | { type: "tool"; name: string; summary: string }
  | { type: "plan"; plan: Plan }
  | { type: "applied"; plan: Plan; receipt: Receipt }
  | { type: "rejected"; plan: Plan }
  | { type: "said"; text: string }
  | { type: "error"; message: string };

export type ErrandResult = {
  reply: string;
  steps: Step[];
  /** Receipts for everything applied, newest last — the undo stack. */
  receipts: { plan: Plan; receipt: Receipt }[];
};
