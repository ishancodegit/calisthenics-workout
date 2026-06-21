// Client-side Spotify auth (Authorization Code + PKCE) + helpers.
// No backend / secret needed — the Client ID is public.

const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || "";

const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

const TOKEN_KEY = "spotify-token-v1";
const VERIFIER_KEY = "spotify-verifier";

export function hasClientId() {
  return !!CLIENT_ID;
}

function redirectUri() {
  return window.location.origin + "/";
}

function b64url(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => ("0" + (b & 0xff).toString(16)).slice(-2))
    .join("")
    .slice(0, len);
}

async function sha256(s: string) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
}

type Tokens = { access_token: string; refresh_token: string; expires_at: number };

function loadTokens(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
  } catch {
    return null;
  }
}

function saveTokens(t: any): Tokens {
  const prev = loadTokens();
  const tok: Tokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || prev?.refresh_token || "",
    expires_at: Date.now() + t.expires_in * 1000 - 60_000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tok));
  return tok;
}

export function isConnected() {
  return !!loadTokens();
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function login() {
  const verifier = randomString(64);
  localStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = b64url(await sha256(verifier));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
  });
  window.location.href =
    "https://accounts.spotify.com/authorize?" + params.toString();
}

/** Call on load: if we came back from Spotify with ?code=, exchange it. */
export async function handleRedirect(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!code || !verifier) return false;

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  localStorage.removeItem(VERIFIER_KEY);
  // Strip the code from the URL so a refresh doesn't re-trigger.
  window.history.replaceState({}, "", url.pathname);
  if (!res.ok) return false;
  saveTokens(await res.json());
  return true;
}

async function refresh(): Promise<Tokens | null> {
  const t = loadTokens();
  if (!t?.refresh_token) return null;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    logout();
    return null;
  }
  return saveTokens(await res.json());
}

export async function getAccessToken(): Promise<string | null> {
  let t = loadTokens();
  if (!t) return null;
  if (Date.now() >= t.expires_at) t = await refresh();
  return t?.access_token || null;
}

export async function api(path: string, init?: RequestInit) {
  const token = await getAccessToken();
  if (!token) throw new Error("not connected");
  return fetch("https://api.spotify.com/v1" + path, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: "Bearer " + token },
  });
}

const TYPES = ["playlist", "album", "artist", "track", "show", "episode"];

/** Convert a Spotify link / URI into a context URI for playback. */
export function toContextUri(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  if (raw.startsWith("spotify:")) return raw;
  try {
    const u = new URL(raw);
    if (!u.hostname.includes("spotify.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.findIndex((p) => TYPES.includes(p));
    if (i >= 0 && parts[i + 1]) {
      return `spotify:${parts[i]}:${parts[i + 1].split("?")[0]}`;
    }
  } catch {
    /* not a url */
  }
  return null;
}
