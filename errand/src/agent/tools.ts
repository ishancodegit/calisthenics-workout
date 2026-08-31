// What the agent can actually do.
//
// Tool descriptions here are prompt engineering, not documentation: a small
// local model decides what to call almost entirely from these strings, so they
// say when to use a tool, not just what it is.

import { machine } from "./bridge.ts";
import type { Change, Plan, Tool } from "./types.ts";

const str = (v: unknown, fallback = "") =>
  typeof v === "string" ? v : v == null ? fallback : String(v);

function describeEntries(entries: { name: string; is_dir: boolean; size: number }[]): string {
  if (entries.length === 0) return "(empty)";
  return entries
    .map((e) => (e.is_dir ? `${e.name}/ (folder)` : `${e.name} (${Math.round(e.size / 1024)} KB)`))
    .join("\n");
}

export function buildTools(): Record<string, Tool> {
  const tools: Tool[] = [
    /* ---------------- their files and computer ---------------- */
    {
      kind: "read",
      schema: {
        name: "list_folder",
        description:
          "See what is inside one of the folders the person has given access to. Use this before doing anything to a folder, so you know what is actually in it.",
        parameters: {
          type: "object",
          properties: {
            folder: { type: "string", description: "The folder to look in." },
          },
          required: ["folder"],
        },
      },
      run: async (args) => describeEntries(await machine.listFolder(str(args.folder))),
    },
    {
      kind: "read",
      schema: {
        name: "find_files",
        description:
          "Search every allowed folder for files whose name contains some text. Use this when the person mentions a file but not where it is.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Part of a file name, e.g. 'invoice'." },
          },
          required: ["query"],
        },
      },
      run: async (args) => {
        const found = await machine.findFiles(str(args.query));
        if (found.length === 0) return "No files matched.";
        return found.map((f) => f.path).join("\n");
      },
    },
    {
      kind: "read",
      schema: {
        name: "read_file",
        description:
          "Read what is inside a text document. Use it to answer questions about a file's contents, or before rewriting one.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "The file to read." } },
          required: ["path"],
        },
      },
      run: async (args) => {
        const { text, truncated } = await machine.readFile(str(args.path));
        return truncated ? `${text}\n…(only the start of the file)` : text;
      },
    },
    {
      kind: "change",
      schema: {
        name: "tidy_folder",
        description:
          "Sort the loose files in a folder into sensible sub-folders. Use this for any 'tidy up', 'sort out', 'organise' or 'it's a mess' request. Folders the person already made are left alone.",
        parameters: {
          type: "object",
          properties: {
            folder: { type: "string", description: "The folder to tidy." },
            by: {
              type: "string",
              enum: ["kind", "month"],
              description:
                "'kind' groups into Pictures, Documents, Spreadsheets and so on. 'month' groups by when the file was last changed — better for photo dumps and scanned post.",
            },
          },
          required: ["folder", "by"],
        },
      },
      run: (args) =>
        machine.proposeTidy(
          str(args.folder),
          str(args.by) === "month" ? "by_month" : "by_kind",
        ),
    },
    {
      kind: "change",
      schema: {
        name: "move_files",
        description:
          "Move specific files into a folder, or rename them. Use this when the person names the files themselves, rather than asking for a whole folder to be tidied.",
        parameters: {
          type: "object",
          properties: {
            files: {
              type: "array",
              items: { type: "string" },
              description: "Full paths of the files to move.",
            },
            into: { type: "string", description: "The folder they should end up in." },
          },
          required: ["files", "into"],
        },
      },
      run: async (args) => {
        const files = Array.isArray(args.files) ? args.files.map((f) => str(f)) : [];
        const into = str(args.into).replace(/\/+$/, "");
        const changes: Change[] = [{ kind: "create_folder", path: into }];
        for (const path of files) {
          changes.push({
            kind: "move",
            from: path,
            to: `${into}/${path.split("/").pop()}`,
          });
        }
        return machine.proposeChanges(
          `Move ${files.length} file${files.length === 1 ? "" : "s"} into ${into.split("/").pop()}.`,
          changes,
        );
      },
    },
    {
      kind: "change",
      schema: {
        name: "trash_files",
        description:
          "Put files in the trash. They can always be brought back, but still only do this when the person clearly asked to get rid of something.",
        parameters: {
          type: "object",
          properties: {
            files: { type: "array", items: { type: "string" }, description: "Full paths." },
          },
          required: ["files"],
        },
      },
      run: async (args) => {
        const files = Array.isArray(args.files) ? args.files.map((f) => str(f)) : [];
        return machine.proposeChanges(
          `Move ${files.length} file${files.length === 1 ? "" : "s"} to the trash.`,
          files.map((path) => ({ kind: "trash", path }) as Change),
        );
      },
    },

    /* ---------------- writing ---------------- */
    {
      kind: "change",
      schema: {
        name: "write_file",
        description:
          "Save text into a file — a summary, a draft letter, notes, a list. Write the finished text yourself; don't describe it.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Where to save it, including the file name." },
            contents: { type: "string", description: "The full text of the document." },
          },
          required: ["path", "contents"],
        },
      },
      run: async (args) => {
        const path = str(args.path);
        return machine.proposeChanges(`Save ${path.split("/").pop()}.`, [
          { kind: "write", path, contents: str(args.contents) },
        ]);
      },
    },

    /* ---------------- spreadsheets ---------------- */
    {
      kind: "read",
      schema: {
        name: "read_spreadsheet",
        description:
          "Read the rows of a spreadsheet or CSV so you can total it up, find something in it, or answer a question about it.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "The spreadsheet file." } },
          required: ["path"],
        },
      },
      run: async (args) => {
        const rows = await machine.readSheet(str(args.path));
        if (rows.length === 0) return "(the spreadsheet is empty)";
        return rows
          .slice(0, 200)
          .map((r) => r.join(" | "))
          .join("\n");
      },
    },
    {
      kind: "change",
      schema: {
        name: "save_spreadsheet",
        description:
          "Save rows into a spreadsheet the person can open in Excel or Numbers. Use this whenever the answer is a table — expenses pulled out of receipts, a list of files, a summary by month.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Where to save it. End it with .csv" },
            rows: {
              type: "array",
              description: "Rows of cells. The first row should be the column headings.",
              items: { type: "array", items: { type: "string" } },
            },
          },
          required: ["path", "rows"],
        },
      },
      run: async (args) => {
        const path = str(args.path);
        const rows = Array.isArray(args.rows) ? (args.rows as unknown[][]) : [];
        const csv = rows
          .map((row) =>
            (Array.isArray(row) ? row : [row])
              .map((cell) => {
                const text = str(cell);
                return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
              })
              .join(","),
          )
          .join("\n");
        return machine.proposeChanges(
          `Save a spreadsheet with ${Math.max(0, rows.length - 1)} rows.`,
          [{ kind: "write", path, contents: csv }],
        );
      },
    },

    /* ---------------- the web ---------------- */
    {
      kind: "read",
      schema: {
        name: "read_web_page",
        description:
          "Fetch a web page and read its text. Use it when the person gives you a link, or asks what a page says.",
        parameters: {
          type: "object",
          properties: { url: { type: "string", description: "The full web address." } },
          required: ["url"],
        },
      },
      run: (args) => machine.readWebPage(str(args.url)),
    },
  ];

  return Object.fromEntries(tools.map((t) => [t.schema.name, t]));
}

/** Used by the UI to explain, in plain words, what the agent is allowed to do. */
export const CAPABILITY_SUMMARY = [
  "Look through your folders and find files",
  "Tidy up a messy folder, and undo it",
  "Read documents and spreadsheets, and answer questions about them",
  "Write summaries, drafts and spreadsheets",
  "Read a web page you point it at",
];

export type { Plan };
