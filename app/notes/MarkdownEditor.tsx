"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeTitle } from "@/lib/markdown";

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** every note title in the vault, for [[ autocomplete */
  titles: string[];
  onCreateLink?: (title: string) => void;
  fontSize: number;
  placeholder?: string;
};

export default function MarkdownEditor({ value, onChange, titles, fontSize, placeholder }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [suggest, setSuggest] = useState<{
    query: string;
    from: number;
    index: number;
    top: number;
    left: number;
  } | null>(null);

  // Grow with the content so the page scrolls as one sheet with the ink layer.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, fontSize]);

  const matches = useMemo(() => {
    if (!suggest) return [];
    const q = normalizeTitle(suggest.query);
    const pool = q
      ? titles.filter((t) => normalizeTitle(t).includes(q))
      : titles;
    return pool
      .sort((a, b) => {
        const an = normalizeTitle(a).startsWith(q) ? 0 : 1;
        const bn = normalizeTitle(b).startsWith(q) ? 0 : 1;
        return an - bn || a.length - b.length;
      })
      .slice(0, 6);
  }, [suggest, titles]);

  const refreshSuggest = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart;
    const before = el.value.slice(0, caret);
    const open = before.lastIndexOf("[[");
    if (open === -1 || before.slice(open).includes("]]") || before.slice(open).includes("\n")) {
      setSuggest(null);
      return;
    }
    const at = caretCoords(el, caret);
    setSuggest((prev) => ({
      query: before.slice(open + 2),
      from: open,
      index: prev && prev.from === open ? prev.index : 0,
      top: at.top,
      left: at.left,
    }));
  };

  const accept = (title: string) => {
    const el = ref.current;
    if (!el || !suggest) return;
    const caret = el.selectionStart;
    const next = `${value.slice(0, suggest.from)}[[${title}]]${value.slice(caret)}`;
    const pos = suggest.from + title.length + 4;
    onChange(next);
    setSuggest(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const wrap = (before: string, after = before) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const picked = value.slice(s, e);
    onChange(`${value.slice(0, s)}${before}${picked}${after}${value.slice(e)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, e + before.length);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;

    if (suggest && matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSuggest({
          ...suggest,
          index: (suggest.index + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length,
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        accept(matches[suggest.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuggest(null);
        return;
      }
    }

    if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      wrap("**");
      return;
    }
    if (mod && e.key.toLowerCase() === "i") {
      e.preventDefault();
      wrap("*");
      return;
    }
    if (mod && e.key.toLowerCase() === "e") {
      e.preventDefault();
      wrap("==");
      return;
    }
    if (mod && e.key.toLowerCase() === "l") {
      e.preventDefault();
      wrap("[[", "]]");
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = el;
      if (e.shiftKey) {
        const lineStart = value.lastIndexOf("\n", s - 1) + 1;
        if (value.slice(lineStart, lineStart + 2) === "  ") {
          onChange(value.slice(0, lineStart) + value.slice(lineStart + 2));
          requestAnimationFrame(() => el.setSelectionRange(s - 2, en - 2));
        }
      } else {
        onChange(`${value.slice(0, s)}  ${value.slice(en)}`);
        requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
      }
      return;
    }

    // Enter continues the list you are in — bullets, numbers and checkboxes.
    if (e.key === "Enter" && !e.shiftKey && !mod) {
      const s = el.selectionStart;
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const line = value.slice(lineStart, s);
      const m = line.match(/^(\s*)(([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?)/);
      if (m) {
        e.preventDefault();
        const isEmptyItem = line.trim() === m[2].trim();
        if (isEmptyItem) {
          onChange(`${value.slice(0, lineStart)}${value.slice(s)}`);
          requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
          return;
        }
        const bullet = /\d/.test(m[3])
          ? `${parseInt(m[3], 10) + 1}. `
          : `${m[3]} `;
        const box = m[4] ? "[ ] " : "";
        const insert = `\n${m[1]}${bullet}${box}`;
        onChange(`${value.slice(0, s)}${insert}${value.slice(el.selectionEnd)}`);
        requestAnimationFrame(() => el.setSelectionRange(s + insert.length, s + insert.length));
      }
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          refreshSuggest(e.target);
        }}
        onKeyUp={(e) => refreshSuggest(e.currentTarget)}
        onClick={(e) => refreshSuggest(e.currentTarget)}
        onBlur={() => setTimeout(() => setSuggest(null), 150)}
        spellCheck
        className="w-full resize-none border-0 bg-transparent p-0 leading-[1.7] text-[#1a1a1a] outline-none placeholder:text-black/25"
        style={{ fontSize, minHeight: "60vh", lineHeight: "1.7" }}
      />
      {suggest && matches.length > 0 && (
        <div
          className="absolute z-30 w-72 max-w-[85vw] overflow-hidden rounded-xl bg-[#141414] text-white shadow-2xl ring-1 ring-white/10"
          style={{ top: suggest.top, left: Math.min(suggest.left, 220) }}
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
            Link to note
          </div>
          {matches.map((t, i) => (
            <button
              key={`${t}-${i}`}
              onMouseDown={(e) => {
                e.preventDefault();
                accept(t);
              }}
              className={`block w-full truncate px-3 py-2 text-left text-sm ${
                i === suggest.index ? "bg-[var(--accent)] text-black" : "hover:bg-white/10"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* Mirrors the textarea in a hidden div to find where the caret actually is,
   so the [[ picker opens under the word you are typing. */
function caretCoords(el: HTMLTextAreaElement, index: number): { top: number; left: number } {
  const style = window.getComputedStyle(el);
  const mirror = document.createElement("div");
  const copy = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
    "lineHeight", "textTransform", "wordSpacing", "paddingTop", "paddingRight",
    "paddingBottom", "paddingLeft", "borderWidth",
  ] as const;
  for (const prop of copy) mirror.style[prop] = style[prop];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.width = `${el.clientWidth}px`;
  mirror.textContent = el.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop + parseFloat(style.lineHeight || "20") + 4;
  const left = marker.offsetLeft;
  document.body.removeChild(mirror);
  return { top, left };
}
