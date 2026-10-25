// Assassins Lite: a no-server battle royale. The whole game (who hunts whom,
// secret words, start time, storm) rides in each player's link, and every phone
// works out the same storm from the same numbers.

export type Storm =
  | { k: "none" }
  | { k: "gps"; lat: number; lon: number; r: number }
  | { k: "rooms"; rooms: string[] };

export type LiteGame = {
  id: string;
  n: string[]; // names in chain order: n[i] hunts n[i + 1], the last hunts the first
  w: string[]; // secret words, same order
  t: number; // when targets go live (ms since epoch)
  m: number; // match length in minutes
  s: Storm;
  seed: number;
};

export type Invite = { g: LiteGame; me: number };

const WORDS = [
  "TIGER", "NINJA", "TACO", "ROCKET", "PICKLE", "WAFFLE", "COBRA", "PANDA", "LASER", "MANGO",
  "GHOST", "VIPER", "NACHO", "COMET", "FALCON", "DONUT", "SHARK", "BISON", "PIXEL", "TURBO",
  "BANJO", "CACTUS", "LLAMA", "RAVEN", "SUSHI", "YETI", "ZEBRA", "MOOSE", "OTTER", "KOALA",
  "BLAZE", "FROST", "STORM", "NOODLE", "PRETZEL", "JELLY", "HIPPO", "GECKO", "WALRUS", "PUFFIN",
  "BACON", "MUFFIN", "QUASAR", "NEBULA", "DRAGON", "PHOENIX", "GOBLIN", "WIZARD", "PIRATE", "ROBOT",
];

// ---------- encoding ----------

const KEY = "storm-is-coming";

function xor(bytes: Uint8Array): Uint8Array {
  return bytes.map((b, i) => b ^ KEY.charCodeAt(i % KEY.length));
}

function toB64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Lightly scrambled so nobody spots their friends' targets by glancing at a link. */
export function encodeInvite(inv: Invite): string {
  return toB64url(xor(new TextEncoder().encode(JSON.stringify(inv))));
}

export function decodeInvite(s: string): Invite | null {
  try {
    const inv = JSON.parse(new TextDecoder().decode(xor(fromB64url(s)))) as Invite;
    const g = inv?.g;
    if (!g || !Array.isArray(g.n) || g.n.length < 2 || g.w?.length !== g.n.length) return null;
    if (typeof inv.me !== "number" || inv.me < 0 || inv.me >= g.n.length) return null;
    return inv;
  } catch {
    return null;
  }
}

export function inviteUrl(g: LiteGame, me: number): string {
  return `${window.location.origin}/assassins?i=${encodeInvite({ g, me })}`;
}

// ---------- setup ----------

function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createGame(opts: {
  names: string[];
  minutes: number;
  headStartMinutes: number;
  storm: Storm;
  now?: number;
}): LiteGame {
  const names = shuffle(opts.names.map((n) => n.trim()).filter(Boolean));
  const words = shuffle(WORDS).slice(0, names.length);
  return {
    id: Math.random().toString(36).slice(2, 10),
    n: names,
    w: words,
    t: (opts.now ?? Date.now()) + opts.headStartMinutes * 60_000,
    m: opts.minutes,
    s: opts.storm,
    seed: Math.floor(Math.random() * 2 ** 31),
  };
}

export function endTime(g: LiteGame): number {
  return g.t + g.m * 60_000;
}

// ---------- targets ----------

/**
 * Walk the chain from me, skipping everyone whose word I've collected.
 * Returns null when the walk comes back to me: everyone else is out, I win.
 */
export function currentTarget(g: LiteGame, me: number, collected: number[]): number | null {
  const got = new Set(collected);
  let t = (me + 1) % g.n.length;
  while (t !== me) {
    if (!got.has(t)) return t;
    t = (t + 1) % g.n.length;
  }
  return null;
}

/**
 * What a player hands over when they go down: their word plus everyone they had
 * already collected (so their hunter knows who to skip). Example: "TIGER-25A".
 */
export function handoffCode(g: LiteGame, me: number, collected: number[]): string {
  const extra = [...new Set(collected)].filter((i) => i !== me).map((i) => i.toString(36).toUpperCase()).join("");
  return extra ? `${g.w[me]}-${extra}` : g.w[me];
}

export function parseHandoff(g: LiteGame, code: string): { victim: number; collected: number[] } | null {
  const [word, extra = ""] = code.trim().toUpperCase().replace(/\s+/g, "").split("-");
  const victim = g.w.indexOf(word);
  if (victim < 0) return null;
  const collected = [...extra]
    .map((c) => parseInt(c, 36))
    .filter((i) => Number.isInteger(i) && i >= 0 && i < g.n.length && i !== victim);
  return { victim, collected };
}

// ---------- storm ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Circle = { lat: number; lon: number; r: number; shrinkStart: number; shrinkEnd: number };

const EARTH = 6_371_000;

export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((bLon - aLon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function offset(lat: number, lon: number, meters: number, bearing: number) {
  const dLat = (meters * Math.cos(bearing)) / EARTH;
  const dLon = (meters * Math.sin(bearing)) / (EARTH * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + (dLat * 180) / Math.PI, lon: lon + (dLon * 180) / Math.PI };
}

/** 4 shrinks. Each phase holds, then closes into the next circle. The last 10% is the final circle. */
export function stormCircles(g: LiteGame): Circle[] {
  if (g.s.k !== "gps") return [];
  const rand = mulberry32(g.seed);
  const phase = (g.m * 60_000 * 0.9) / 4;
  const circles: Circle[] = [{ lat: g.s.lat, lon: g.s.lon, r: g.s.r, shrinkStart: g.t, shrinkEnd: g.t }];
  for (let k = 1; k <= 4; k++) {
    const prev = circles[k - 1];
    const r = g.s.r * 0.55 ** k;
    const c = offset(prev.lat, prev.lon, rand() * (prev.r - r), rand() * 2 * Math.PI);
    const start = g.t + (k - 1) * phase;
    circles.push({ ...c, r, shrinkStart: start + phase * 0.6, shrinkEnd: start + phase });
  }
  return circles;
}

export type StormNow = {
  lat: number;
  lon: number;
  r: number;
  next: Circle | null;
  shrinking: boolean;
  nextChangeAt: number | null;
};

export function stormAt(circles: Circle[], now: number): StormNow | null {
  if (!circles.length) return null;
  let cur = { lat: circles[0].lat, lon: circles[0].lon, r: circles[0].r };
  for (const c of circles.slice(1)) {
    if (now < c.shrinkStart) return { ...cur, next: c, shrinking: false, nextChangeAt: c.shrinkStart };
    if (now < c.shrinkEnd) {
      const p = (now - c.shrinkStart) / (c.shrinkEnd - c.shrinkStart);
      return {
        lat: cur.lat + (c.lat - cur.lat) * p,
        lon: cur.lon + (c.lon - cur.lon) * p,
        r: cur.r + (c.r - cur.r) * p,
        next: c,
        shrinking: true,
        nextChangeAt: c.shrinkEnd,
      };
    }
    cur = { lat: c.lat, lon: c.lon, r: c.r };
  }
  return { ...cur, next: null, shrinking: false, nextChangeAt: null };
}

/** Indoor storm: rooms close one at a time until one is left. */
export function roomClosures(g: LiteGame): { room: string; at: number }[] {
  if (g.s.k !== "rooms" || g.s.rooms.length < 2) return [];
  const order = shuffle(g.s.rooms, mulberry32(g.seed));
  const step = (g.m * 60_000 * 0.9) / (order.length - 1);
  return order.slice(0, -1).map((room, i) => ({ room, at: g.t + (i + 1) * step }));
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
