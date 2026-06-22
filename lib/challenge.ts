// URL-encoded pushup challenges (no backend — the score rides in the link).

export type Challenge = {
  n: string; // challenger name
  r: number; // reps achieved
  s: number; // duration in seconds
};

function b64urlEncode(s: string) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return decodeURIComponent(
    escape(atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad))
  );
}

export function encodeChallenge(c: Challenge): string {
  return b64urlEncode(JSON.stringify(c));
}

export function decodeChallenge(s: string): Challenge | null {
  try {
    const o = JSON.parse(b64urlDecode(s));
    if (typeof o?.r === "number" && typeof o?.s === "number")
      return { n: String(o.n || "A friend"), r: o.r, s: o.s };
  } catch {
    /* ignore */
  }
  return null;
}

export function challengeUrl(c: Challenge): string {
  return `${window.location.origin}/?c=${encodeChallenge(c)}`;
}
