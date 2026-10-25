"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createGame,
  currentTarget,
  decodeInvite,
  distanceM,
  endTime,
  formatClock,
  formatDistance,
  handoffCode,
  inviteUrl,
  parseHandoff,
  roomClosures,
  stormAt,
  stormCircles,
  type Invite,
  type LiteGame,
  type Storm,
} from "@/lib/assassins";

const StormMap = dynamic(() => import("./StormMap"), { ssr: false });

/** Seconds you can stand in the storm before it takes you out. */
const STORM_GRACE = 60;
const HOSTED_KEY = "assassins:hosted";

export default function AssassinsPage() {
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const [bad, setBad] = useState(false);

  useEffect(() => {
    const raw = new URL(window.location.href).searchParams.get("i");
    if (!raw) return setInvite(null);
    const inv = decodeInvite(raw);
    setBad(!inv);
    setInvite(inv);
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-md bg-gradient-to-b from-[#1e0c40] via-[#0a0912] to-[#0a0912] px-4 pb-16 pt-6">
      {invite === undefined ? null : invite ? (
        <PlayerView invite={invite} />
      ) : (
        <>
          {bad && (
            <p className="mb-4 rounded-xl bg-red-500/20 p-3 text-sm">That link looks broken. Ask whoever made the game to resend it.</p>
          )}
          <SetupView />
        </>
      )}
    </main>
  );
}

function Title({ sub }: { sub?: string }) {
  return (
    <div className="mb-6 text-center">
      <div className="text-5xl">🎯</div>
      <h1 className="text-4xl font-black italic tracking-tight text-[#ffc72e] drop-shadow-[0_0_18px_rgba(255,199,46,0.45)]">
        ASSASSINS
      </h1>
      {sub && <p className="mt-1 text-sm font-semibold text-white/60">{sub}</p>}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white/[0.06] p-4 ${className}`}>{children}</div>;
}

function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  label: (v: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={String(o)}
          onClick={() => onChange(o)}
          className={`rounded-full px-4 py-2 text-sm font-bold ${o === value ? "bg-[#ffc72e] text-black" : "bg-white/10"}`}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

const bigButton =
  "w-full rounded-2xl py-4 text-lg font-black italic uppercase tracking-tight active:scale-[0.98] disabled:opacity-40";

// ---------------------------------------------------------------- setup

function SetupView() {
  const [names, setNames] = useState<string[]>(["", "", ""]);
  const [minutes, setMinutes] = useState(30);
  const [head, setHead] = useState(2);
  const [stormKind, setStormKind] = useState<Storm["k"]>("gps");
  const [radius, setRadius] = useState(400);
  const [rooms, setRooms] = useState("Kitchen, Living Room, Upstairs, Basement");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [game, setGame] = useState<LiteGame | null>(null);
  const [sent, setSent] = useState<Set<number>>(new Set());
  const now = useNow();

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(HOSTED_KEY) || "null") as LiteGame | null;
      if (saved && endTime(saved) > Date.now()) setGame(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const cleanNames = names.map((n) => n.trim()).filter(Boolean);
  const dupes = new Set(cleanNames.map((n) => n.toLowerCase())).size !== cleanNames.length;
  const problem =
    cleanNames.length < 3 ? "Add at least 3 players" : cleanNames.length > 36 ? "36 players max" : dupes ? "Two players have the same name" : "";

  function finish(storm: Storm) {
    const g = createGame({ names: cleanNames, minutes, headStartMinutes: head, storm });
    localStorage.setItem(HOSTED_KEY, JSON.stringify(g));
    setGame(g);
    setSent(new Set());
    setBusy(false);
  }

  function start() {
    setError("");
    if (stormKind === "none") return finish({ k: "none" });
    if (stormKind === "rooms") {
      const list = rooms.split(",").map((r) => r.trim()).filter(Boolean);
      if (list.length < 2) return setError("Add at least 2 rooms (comma separated).");
      return finish({ k: "rooms", rooms: list });
    }
    if (!navigator.geolocation) return setError("This browser can't get your location. Pick Indoor or No storm.");
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => finish({ k: "gps", lat: pos.coords.latitude, lon: pos.coords.longitude, r: radius }),
      () => {
        setBusy(false);
        setError("Couldn't get your location. Allow location access, or pick Indoor or No storm.");
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function send(i: number) {
    if (!game) return;
    const url = inviteUrl(game, i);
    const text = `🎯 ${game.n[i]}, here's your secret Assassins link. Don't show anyone!`;
    try {
      if (navigator.share) await navigator.share({ title: "Assassins", text, url });
      else await navigator.clipboard.writeText(`${text} ${url}`);
      setSent((s) => new Set(s).add(i));
    } catch {
      /* share sheet closed */
    }
  }

  if (game) {
    return (
      <>
        <Title sub="Send everyone their own link" />
        <Card className="mb-4">
          <p className="mb-3 text-sm text-white/70">
            Send each link <b>privately</b> (DM, not the group chat). Each link shows that person their target.
            {now < game.t ? (
              <>
                Targets drop in <b>{formatClock(game.t - now)}</b>.
              </>
            ) : (
              <b>Targets are live!</b>
            )}
          </p>
          <div className="space-y-2">
            {game.n
              .map((name, i) => ({ name, i }))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(({ name, i }) => (
                <div key={i} className="flex items-center gap-2 rounded-xl bg-white/5 p-2 pl-3">
                  <span className="flex-1 font-bold">{name}</span>
                  <a href={inviteUrl(game, i)} className="rounded-full bg-white/10 px-3 py-2 text-xs font-bold">
                    This is me
                  </a>
                  <button
                    onClick={() => send(i)}
                    className={`rounded-full px-4 py-2 text-xs font-black ${sent.has(i) ? "bg-green-500 text-black" : "bg-[#ffc72e] text-black"}`}
                  >
                    {sent.has(i) ? "Sent ✓" : "Send"}
                  </button>
                </div>
              ))}
          </div>
        </Card>
        <button
          onClick={() => {
            localStorage.removeItem(HOSTED_KEY);
            setGame(null);
          }}
          className="w-full py-3 text-sm font-bold text-white/50"
        >
          Start over
        </button>
      </>
    );
  }

  return (
    <>
      <Title sub="Everyone has a target. Nobody knows who's hunting them." />

      <Card className="mb-4">
        <h2 className="mb-2 text-xs font-black uppercase text-white/50">Players</h2>
        <div className="space-y-2">
          {names.map((n, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={n}
                onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`Player ${i + 1}`}
                className="flex-1 rounded-xl bg-white/10 px-3 py-2.5 font-bold outline-none placeholder:text-white/30"
              />
              {names.length > 3 && (
                <button onClick={() => setNames(names.filter((_, j) => j !== i))} className="px-2 text-white/40">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button onClick={() => setNames([...names, ""])} className="mt-3 text-sm font-bold text-[#ffc72e]">
          + Add player
        </button>
      </Card>

      <Card className="mb-4 space-y-4">
        <div>
          <h2 className="mb-2 text-xs font-black uppercase text-white/50">Match length</h2>
          <Chips options={[15, 30, 60, 120]} value={minutes} onChange={setMinutes} label={(m) => (m < 60 ? `${m} min` : `${m / 60} hr`)} />
        </div>
        <div>
          <h2 className="mb-2 text-xs font-black uppercase text-white/50">Head start (to send links and scatter)</h2>
          <Chips options={[1, 2, 5]} value={head} onChange={setHead} label={(m) => `${m} min`} />
        </div>
      </Card>

      <Card className="mb-4 space-y-4">
        <div>
          <h2 className="mb-2 text-xs font-black uppercase text-white/50">⛈️ The storm</h2>
          <Chips
            options={["gps", "rooms", "none"] as Storm["k"][]}
            value={stormKind}
            onChange={setStormKind}
            label={(k) => (k === "gps" ? "🌳 Outdoor" : k === "rooms" ? "🏠 Indoor" : "Off")}
          />
        </div>
        {stormKind === "gps" && (
          <div>
            <h2 className="mb-2 text-xs font-black uppercase text-white/50">Starting circle</h2>
            <Chips options={[150, 400, 1000]} value={radius} onChange={setRadius} label={(r) => (r === 150 ? "Small" : r === 400 ? "Medium" : "Big")} />
            <p className="mt-2 text-xs text-white/50">
              Centered where you're standing now. It shrinks 4 times. Anyone caught outside for {STORM_GRACE}s is out.
            </p>
          </div>
        )}
        {stormKind === "rooms" && (
          <div>
            <h2 className="mb-2 text-xs font-black uppercase text-white/50">Rooms (comma separated)</h2>
            <input
              value={rooms}
              onChange={(e) => setRooms(e.target.value)}
              className="w-full rounded-xl bg-white/10 px-3 py-2.5 font-bold outline-none"
            />
            <p className="mt-2 text-xs text-white/50">Rooms close one by one until one is left. Get caught in a closed room and you're out.</p>
          </div>
        )}
      </Card>

      {error && <p className="mb-3 rounded-xl bg-red-500/20 p-3 text-sm">{error}</p>}
      <button onClick={start} disabled={!!problem || busy} className={`${bigButton} bg-[#ffc72e] text-black`}>
        {busy ? "Finding you…" : problem || "Start game 🚌"}
      </button>

      <Rules />
    </>
  );
}

function Rules() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6">
      <button onClick={() => setOpen(!open)} className="w-full text-center text-sm font-bold text-[#ffc72e]">
        {open ? "Hide rules" : "How to play"}
      </button>
      {open && (
        <ul className="mt-3 space-y-3 text-sm text-white/80">
          <li>🎯 <b>Your target:</b> your link shows who you're hunting. Keep it secret.</li>
          <li>🔫 <b>Get them:</b> tag them, or hit them with a Nerf dart. Your call as a group.</li>
          <li>🤫 <b>Secret code:</b> when you get someone, they show you their code. Type it in and you take over their target.</li>
          <li>⛈️ <b>The storm:</b> outdoors, a circle shrinks on the map. Stay outside it for {STORM_GRACE}s and you're out. Indoors, rooms close one by one.</li>
          <li>💀 <b>Out?</b> Give your code to whoever got you. Storm got you? Post your code in the group chat. Your hunter will claim it.</li>
          <li>👑 <b>Victory Royale:</b> last one standing wins. If time runs out, most eliminations among survivors wins.</li>
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- player

type Saved = { collected: number[]; kills: number; dead: null | "tagged" | "storm" };

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported (iPhone) */
  }
}

function PlayerView({ invite }: { invite: Invite }) {
  const { g, me } = invite;
  const key = `assassins:${g.id}:${me}`;
  const now = useNow();
  const [saved, setSaved] = useState<Saved>({ collected: [], kills: 0, dead: null });
  const [loaded, setLoaded] = useState(false);
  const [entering, setEntering] = useState(false);
  const [confirmOut, setConfirmOut] = useState<null | "tagged" | "storm">(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(key) || "null") as Saved | null;
      if (s) setSaved(s);
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, [key]);

  function save(next: Saved) {
    setSaved(next);
    localStorage.setItem(key, JSON.stringify(next));
  }

  const target = currentTarget(g, me, saved.collected);
  const started = now >= g.t;
  const over = now >= endTime(g);
  const alive = !saved.dead;
  const fighting = started && !over && alive && target !== null;

  // ----- outdoor storm
  const circles = useMemo(() => stormCircles(g), [g]);
  const storm = stormAt(circles, Math.max(now, g.t));
  const pos = useGeolocation(g.s.k === "gps" && alive && !over);
  const outsideBy = storm && pos ? distanceM(pos.lat, pos.lon, storm.lat, storm.lon) - storm.r : null;
  // Give GPS the benefit of the doubt: only count it if you're out by more than its accuracy.
  const inStorm = fighting && outsideBy !== null && pos !== null && outsideBy > Math.min(pos.acc, 30);
  const outsideSince = useRef<number | null>(null);
  if (inStorm && outsideSince.current === null) outsideSince.current = now;
  if (!inStorm) outsideSince.current = null;
  const stormLeft = outsideSince.current !== null ? STORM_GRACE - (now - outsideSince.current) / 1000 : null;

  useEffect(() => {
    if (stormLeft === null || !alive) return;
    if (stormLeft <= 0) save({ ...saved, dead: "storm" });
    else if (Math.ceil(stormLeft) % 10 === 0) buzz(300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.ceil(stormLeft ?? 999), alive]);

  // ----- indoor storm
  const closures = useMemo(() => roomClosures(g), [g]);
  const closed = closures.filter((c) => c.at <= now);
  const nextClosure = closures.find((c) => c.at > now);
  const justClosed = closed.length ? closed[closed.length - 1] : null;
  const recentlyClosed = justClosed && now - justClosed.at < 30_000 ? justClosed : null;

  useEffect(() => {
    if (recentlyClosed) buzz([400, 200, 400]);
  }, [recentlyClosed?.room]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  function claim(code: string): string | null {
    const parsed = parseHandoff(g, code);
    if (!parsed) return "That code doesn't match anyone. Check the spelling.";
    if (parsed.victim === me) return "That's your own code 😅";
    if (parsed.victim !== target) return "That's not your target's code. Only your target's code works.";
    const collected = [...new Set([...saved.collected, parsed.victim, ...parsed.collected])].filter((i) => i !== me);
    save({ ...saved, collected, kills: saved.kills + 1 });
    const next = currentTarget(g, me, collected);
    setFlash(next === null ? "👑 That was the last one!" : `🎯 ${g.n[parsed.victim]} eliminated! New target: ${g.n[next]}`);
    buzz([100, 50, 100]);
    return null;
  }

  if (!loaded) return null;

  // ----- screens

  if (saved.dead) {
    const code = handoffCode(g, me, saved.collected);
    return (
      <>
        <Title />
        <div className="mb-6 text-center">
          <div className="text-6xl">{saved.dead === "storm" ? "⛈️" : "💀"}</div>
          <h2 className="mt-2 text-4xl font-black italic text-red-400">ELIMINATED</h2>
          <p className="mt-1 text-white/60">
            {saved.dead === "storm" ? "The storm got you." : "Someone got you."} {saved.kills} elimination{saved.kills === 1 ? "" : "s"}.
          </p>
        </div>
        <Card className="text-center">
          <p className="text-sm text-white/70">
            {saved.dead === "storm" ? "Post this code in the group chat so your hunter can claim it:" : "Show this code to whoever got you:"}
          </p>
          <p className="my-4 select-all break-all font-mono text-4xl font-black tracking-wider text-[#ffc72e]">{code}</p>
          <button
            onClick={async () => {
              const text = `⛈️ ${g.n[me]} is out! Hunter, claim me with: ${code}`;
              try {
                if (navigator.share && saved.dead === "storm") await navigator.share({ text });
                else await navigator.clipboard.writeText(code);
              } catch {
                /* closed */
              }
            }}
            className="rounded-full bg-white/10 px-5 py-2 text-sm font-bold"
          >
            {saved.dead === "storm" ? "Share to group chat" : "Copy code"}
          </button>
        </Card>
        <p className="mt-6 text-center text-sm text-white/50">You're a spectator now. GG.</p>
      </>
    );
  }

  if (started && target === null) {
    return (
      <>
        <Title />
        <div className="mt-10 text-center">
          <div className="text-7xl">👑</div>
          <h2 className="mt-3 text-4xl font-black italic text-[#ffc72e]">#1 VICTORY ROYALE</h2>
          <p className="mt-2 text-white/70">
            {g.n[me]} is the last one standing with {saved.kills} elimination{saved.kills === 1 ? "" : "s"}.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <Title sub={`Playing as ${g.n[me]}`} />

      {flash && (
        <div className="fixed inset-x-4 top-4 z-[1000] mx-auto max-w-md rounded-2xl border-2 border-[#ffc72e] bg-black/90 p-4 text-center font-black italic shadow-[0_0_24px_rgba(255,199,46,0.5)]">
          {flash}
        </div>
      )}

      {!started ? (
        <Card className="mb-4 text-center">
          <div className="text-5xl">🚌</div>
          <p className="mt-2 text-xs font-black uppercase text-white/50">Targets drop in</p>
          <p className="font-mono text-5xl font-black">{formatClock(g.t - now)}</p>
          <p className="mt-2 text-sm text-white/70">Scatter! Don&apos;t let anyone see your screen.</p>
        </Card>
      ) : over ? (
        <Card className="mb-4 text-center">
          <div className="text-5xl">⏱</div>
          <h2 className="text-3xl font-black italic">TIME&apos;S UP</h2>
          <p className="mt-2 text-white/70">
            You survived with <b>{saved.kills}</b> elimination{saved.kills === 1 ? "" : "s"}. Compare with the other survivors: most eliminations wins.
          </p>
        </Card>
      ) : (
        <Card className="mb-4 border border-red-400/40">
          <p className="text-xs font-black uppercase text-red-400">Your target</p>
          <p className="text-4xl font-black italic">{g.n[target!]}</p>
          <p className="mt-1 text-sm text-white/60">
            {saved.kills} elimination{saved.kills === 1 ? "" : "s"} · {formatClock(endTime(g) - now)} left
          </p>
        </Card>
      )}

      {fighting && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <button onClick={() => setEntering(true)} className={`${bigButton} bg-[#ffc72e] text-black`}>
            🎯 Got them
          </button>
          <button onClick={() => setConfirmOut("tagged")} className={`${bigButton} bg-red-500 text-white`}>
            💀 I&apos;m out
          </button>
        </div>
      )}

      {g.s.k === "gps" && storm && (
        <div className="mb-4 space-y-3">
          {inStorm && stormLeft !== null && (
            <div className="rounded-2xl border-2 border-white/80 bg-[#6d2fd6] p-4 text-center text-white shadow-[0_0_30px_rgba(157,92,255,0.7)]">
              <p className="animate-pulse text-lg font-black italic">⛈️ YOU&apos;RE IN THE STORM</p>
              <p className="text-sm font-bold">
                Out in {Math.max(0, Math.ceil(stormLeft))}s. Get {formatDistance(outsideBy!)} back inside!
              </p>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="font-black uppercase text-white/50">
              {!started ? "⛈️ Starting circle" : storm.nextChangeAt ? (storm.shrinking ? "⛈️ Storm closing" : "⛈️ Storm shrinks in") : "⛈️ Final circle"}
            </span>
            {started && storm.nextChangeAt && (
              <span className={`font-mono text-lg font-black ${storm.shrinking ? "text-[#9d5cff]" : ""}`}>
                {formatClock(storm.nextChangeAt - now)}
              </span>
            )}
          </div>
          <StormMap storm={storm} me={pos} />
          <p className="text-xs text-white/50">
            {pos === null
              ? "Turn on location so the storm knows where you are."
              : outsideBy !== null && outsideBy <= 0
                ? `Safe: ${formatDistance(-outsideBy)} from the edge.`
                : "Purple is the safe zone. The dashed circle is where it's going next."}
          </p>
        </div>
      )}

      {g.s.k === "rooms" && (
        <Card className="mb-4">
          {recentlyClosed && (
            <div className="mb-3 rounded-xl border-2 border-white/80 bg-[#6d2fd6] p-3 text-center font-black italic text-white">
              ⛈️ {recentlyClosed.room.toUpperCase()} JUST CLOSED. GET OUT!
            </div>
          )}
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="font-black uppercase text-white/50">⛈️ {nextClosure ? `${nextClosure.room} closes in` : "Final room"}</span>
            {nextClosure && started && <span className="font-mono text-lg font-black">{formatClock(nextClosure.at - now)}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {g.s.rooms.map((r) => {
              const isClosed = closed.some((c) => c.room === r);
              const isNext = nextClosure?.room === r;
              return (
                <span
                  key={r}
                  className={`rounded-full px-3 py-1.5 text-sm font-bold ${
                    isClosed ? "bg-[#9d5cff]/30 text-white/40 line-through" : isNext ? "bg-orange-500/30" : "bg-white/10"
                  }`}
                >
                  {isClosed ? "⛈️ " : ""}
                  {r}
                </span>
              );
            })}
          </div>
          {fighting && (
            <button onClick={() => setConfirmOut("storm")} className="mt-4 w-full text-sm font-bold text-[#c9a6ff]">
              ⛈️ The storm got me (I was in a closed room)
            </button>
          )}
        </Card>
      )}

      <Rules />

      {entering && <CodeEntry onClose={() => setEntering(false)} onSubmit={claim} target={g.n[target ?? me]} />}

      {confirmOut && (
        <Modal onClose={() => setConfirmOut(null)}>
          <p className="text-xl font-black italic">{confirmOut === "storm" ? "Storm got you?" : "Did someone get you?"}</p>
          <p className="mt-1 text-sm text-white/60">You&apos;ll be out and get a code to hand over.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button onClick={() => setConfirmOut(null)} className="rounded-xl bg-white/10 py-3 font-bold">
              Cancel
            </button>
            <button
              onClick={() => {
                save({ ...saved, dead: confirmOut });
                setConfirmOut(null);
                buzz(500);
              }}
              className="rounded-xl bg-red-500 py-3 font-black"
            >
              I&apos;m out
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-[#14121f] p-5" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function CodeEntry({ onClose, onSubmit, target }: { onClose: () => void; onSubmit: (code: string) => string | null; target: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal onClose={onClose}>
      <p className="text-xl font-black italic">Got {target}?</p>
      <p className="mt-1 text-sm text-white/60">Type the code from their screen.</p>
      <input
        autoFocus
        value={code}
        onChange={(e) => {
          setCode(e.target.value.toUpperCase());
          setError("");
        }}
        placeholder="TIGER-25"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="mt-4 w-full rounded-xl bg-white/10 px-4 py-3 text-center font-mono text-2xl font-black tracking-wider outline-none placeholder:text-white/20"
      />
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <button
        onClick={() => {
          const err = onSubmit(code);
          if (err) setError(err);
          else onClose();
        }}
        disabled={!code.trim()}
        className={`${bigButton} mt-4 bg-[#ffc72e] text-black`}
      >
        Claim
      </button>
    </Modal>
  );
}

function useGeolocation(enabled: boolean) {
  const [pos, setPos] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      () => setPos(null),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return pos;
}
