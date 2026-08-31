// A scripted stand-in used only by the browser preview (`npm run dev` outside
// the desktop app), where there is no Ollama to talk to. It is deliberately
// dumb — it pattern-matches the request and calls one tool — so the preview can
// show the real flow (propose → approve → undo) to someone evaluating the
// product without asking them to install anything first.
//
// Never reachable from the desktop build: App.tsx only selects it when
// isDesktop() is false.

import type { AssistantReply, ChatMessage, Provider } from "../types.ts";

const FOLDER = "/Users/you/Downloads";

export function demoProvider(): Provider {
  return {
    id: "local",
    label: "Preview",
    async chat(messages: ChatMessage[]): Promise<AssistantReply> {
      await new Promise((r) => setTimeout(r, 450)); // let the UI breathe

      const alreadyActed = messages.some((m) => m.role === "tool");
      const goal =
        [...messages].reverse().find((m) => m.role === "user")?.content.toLowerCase() ?? "";

      if (alreadyActed) {
        // Echo what the tool returned, so the preview shows a real answer
        // rather than a canned one.
        const last = [...messages].reverse().find((m) => m.role === "tool");
        const body = last && "content" in last ? last.content : "";
        return {
          text: body && body.length < 400 ? body : "All done — that's sorted.",
          toolCalls: [],
        };
      }

      if (/tidy|sort|organis|organiz|mess|clean/.test(goal)) {
        return {
          text: "",
          toolCalls: [
            {
              id: "1",
              name: "tidy_folder",
              args: { folder: FOLDER, by: /month|photo|date/.test(goal) ? "month" : "kind" },
            },
          ],
        };
      }
      if (/calendar|diary|schedule|today|on today|appointment/.test(goal)) {
        return {
          text: "",
          toolCalls: [
            { id: "1", name: "read_calendar", args: { days: /week/.test(goal) ? 7 : 1 } },
          ],
        };
      }
      if (/email|inbox|mail|message/.test(goal)) {
        return {
          text: "",
          toolCalls: [{ id: "1", name: "read_email", args: { query: "" } }],
        };
      }
      if (/look up|search the web|google|what is|who is/.test(goal)) {
        return {
          text: "",
          toolCalls: [{ id: "1", name: "search_web", args: { query: goal } }],
        };
      }
      if (/find|search|where|look for/.test(goal)) {
        const match = goal.match(/['"]([^'"]+)['"]/);
        return {
          text: "",
          toolCalls: [
            { id: "1", name: "find_files", args: { query: match?.[1] ?? "invoice" } },
          ],
        };
      }
      if (/spreadsheet|budget|csv|total/.test(goal)) {
        return {
          text: "",
          toolCalls: [
            { id: "1", name: "read_spreadsheet", args: { path: `${FOLDER}/budget.csv` } },
          ],
        };
      }
      if (/what.*in|list|show/.test(goal)) {
        return {
          text: "",
          toolCalls: [{ id: "1", name: "list_folder", args: { folder: FOLDER } }],
        };
      }
      return {
        text: "This is a preview with made-up files. Try “tidy up my Downloads folder”.",
        toolCalls: [],
      };
    },
  };
}
