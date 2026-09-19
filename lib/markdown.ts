/* ------------------------------------------------------------------ */
/* Markdown — a small renderer with Obsidian's link syntax             */
/*                                                                     */
/* Dependency-free on purpose: the whole app has to work offline on an */
/* iPad, and everything here is escaped before a single tag is emitted */
/* so the output is safe to drop in with dangerouslySetInnerHTML.      */
/* ------------------------------------------------------------------ */

export type LinkResolver = (target: string) => { id: string | null; title: string };

const WIKILINK = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const TAG = /(^|[\s(])#([A-Za-z][\w/-]*)/g;
const QUOTE = /^\s*&gt;\s?/;

/** Link targets are matched case- and whitespace-insensitively, like Obsidian. */
export function normalizeTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}

export function extractLinks(body: string): { links: string[]; tags: string[] } {
  const links = new Set<string>();
  const tags = new Set<string>();
  const stripped = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  for (const m of stripped.matchAll(WIKILINK)) {
    const t = normalizeTitle(m[1]);
    if (t) links.add(t);
  }
  for (const m of stripped.replace(WIKILINK, " ").matchAll(TAG)) tags.add(m[2].toLowerCase());
  return { links: [...links], tags: [...tags] };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------ inline ---------------------------- */

function inline(src: string, resolve: LinkResolver): string {
  // Code spans are carved out first so nothing else rewrites their insides.
  const parts = src.split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
        return `<code class="md-code">${part.slice(1, -1)}</code>`;
      }
      let out = part;

      out = out.replace(WIKILINK, (_m, target: string, heading?: string, alias?: string) => {
        const key = normalizeTitle(target);
        const hit = resolve(key);
        const label = alias ?? (heading ? `${target} › ${heading}` : target);
        const cls = hit.id ? "wikilink" : "wikilink wikilink-new";
        return `<a class="${cls}" data-wikilink="${attr(key)}" data-label="${attr(
          target.trim()
        )}" href="#">${label}</a>`;
      });

      out = out.replace(TAG, (_m, pre: string, tag: string) =>
        `${pre}<a class="md-tag" data-tag="${attr(tag.toLowerCase())}" href="#">#${tag}</a>`
      );

      out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) =>
        safeUrl(url) ? `<img class="md-img" alt="${attr(alt)}" src="${attr(url)}" />` : _m
      );

      // An unsafe scheme (javascript:, data:) is left as plain markdown text.
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) =>
        safeUrl(url)
          ? `<a class="md-link" href="${attr(url)}" target="_blank" rel="noreferrer">${text}</a>`
          : _m
      );

      out = out.replace(/==([^=]+)==/g, '<mark class="md-mark">$1</mark>');
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
      out = out.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");
      out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
      return out;
    })
    .join("");
}

function attr(s: string) {
  // Everything reaching here has already been escaped once by renderMarkdown;
  // escaping again would turn a URL's `&amp;` into `&amp;amp;`.
  return s.replace(/"/g, "&quot;");
}

function safeUrl(url: string) {
  return /^(https?:|mailto:|#|\/)/i.test(url.trim());
}

/* ------------------------------ blocks ---------------------------- */

export function renderMarkdown(body: string, resolve: LinkResolver): string {
  const lines = escapeHtml(body).split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  // Task checkboxes carry their source line so a tap can toggle them.
  const listStack: string[] = [];

  const closeLists = (toDepth = 0) => {
    while (listStack.length > toDepth) out.push(`</${listStack.pop()}>`);
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      closeLists();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(
        `<pre class="md-pre"${fence[1] ? ` data-lang="${attr(fence[1])}"` : ""}><code>${buf.join(
          "\n"
        )}</code></pre>`
      );
      continue;
    }

    if (!line.trim()) {
      closeLists();
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      out.push(`<h${level} class="md-h md-h${level}">${inline(heading[2], resolve)}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeLists();
      out.push('<hr class="md-hr" />');
      i++;
      continue;
    }

    // NB: `lines` is already HTML-escaped, so a quote marker reads as `&gt;`.
    if (QUOTE.test(line)) {
      closeLists();
      const buf: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) buf.push(lines[i++].replace(QUOTE, ""));
      out.push(`<blockquote class="md-quote">${renderMarkdown(unescapeHtml(buf.join("\n")), resolve)}</blockquote>`);
      continue;
    }

    // tables
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      closeLists();
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push(
        `<table class="md-table"><thead><tr>${header
          .map((c) => `<th>${inline(c, resolve)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c, resolve)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`
      );
      continue;
    }

    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const depth = Math.floor(li[1].replace(/\t/g, "  ").length / 2) + 1;
      const ordered = /\d/.test(li[2]);
      const tag = ordered ? "ol" : "ul";
      while (listStack.length > depth) out.push(`</${listStack.pop()}>`);
      if (listStack.length < depth) {
        while (listStack.length < depth) {
          out.push(`<${tag} class="md-list">`);
          listStack.push(tag);
        }
      } else if (listStack[depth - 1] !== tag) {
        out.push(`</${listStack.pop()}>`);
        out.push(`<${tag} class="md-list">`);
        listStack.push(tag);
      }
      const task = li[3].match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        const checked = task[1].toLowerCase() === "x";
        out.push(
          `<li class="md-task${checked ? " md-task-done" : ""}"><input type="checkbox" data-task-line="${i}"${
            checked ? " checked" : ""
          } />${inline(task[2], resolve)}</li>`
        );
      } else {
        out.push(`<li>${inline(li[3], resolve)}</li>`);
      }
      i++;
      continue;
    }

    closeLists();
    // Always consume the current line first. A line that looks like the start of
    // a block but isn't one (a lone `|` while a table is half typed, say) would
    // otherwise match nothing, advance nothing, and spin forever.
    const buf: string[] = [lines[i++]];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|&gt;|```|\||([-*+]|\d+[.)])\s)/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    out.push(`<p class="md-p">${inline(buf.join("\n"), resolve).replace(/\n/g, "<br />")}</p>`);
  }
  closeLists();
  return out.join("\n");
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function unescapeHtml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/* ------------------------------ helpers --------------------------- */

/** Plain-text preview for the note list. */
export function excerpt(body: string, max = 120): string {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(WIKILINK, (_m, t: string, _h?: string, alias?: string) => alias ?? t)
    .replace(/[#*_>`~=|]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Toggles the checkbox on a given source line — used by the preview. */
export function toggleTask(body: string, lineIndex: number): string {
  const lines = body.split(/\r?\n/);
  const line = lines[lineIndex];
  if (line === undefined) return body;
  lines[lineIndex] = line.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/, (_m, pre: string, mark: string) =>
    `${pre}[${mark.toLowerCase() === "x" ? " " : "x"}]`
  );
  return lines.join("\n");
}
