"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { MAP_BOUNDS } from "@/lib/geo/data/scales";
import { MAPS, MAP_BY_ID } from "@/lib/geo/maps";
import { ROUND_CHOICES, TIME_CHOICES, type GameView, type PlayerView, type RoomView, type Settings } from "@/lib/geo/room";
import { MAX_POINTS, formatDistance, formatPoints } from "@/lib/geo/score";
import type { LatLng } from "@/lib/geo/types";
import { serverNow, useServerNow } from "@/components/game/clock";
import { Play } from "./Play";
import { forgetPlaces, usePlaces } from "./places";
import { PlaceFacts, PointsBar, ResultsLayout, Verdict, useAdvanceKey } from "./Results";
import { useRoom, type RoomClient, type RoomSnapshot } from "./room-client";
import { StreetView } from "./StreetView";
import { KEYS, isString, load } from "@/components/game/storage";
import { Button, Choice, Spinner, formatClock, initials, ordinal, plural } from "@/components/game/ui";

export function Room({ code, streetView }: { code: string; streetView: boolean }) {
  const [snapshot, client] = useRoom(code);
  const { status, view, me } = snapshot;

  if (!streetView) return <Notice title="street view isn't set up here yet">whoever runs this site needs to add its google maps keys; the readme says how.</Notice>;
  if (status === "unavailable") return <Notice title="multiplayer isn't set up here yet">whoever runs this site needs to connect a database; the readme says how.</Notice>;
  if (status === "missing") return <Notice title={`there's no room called ${code}`}>it may have expired: rooms close a few hours after the last game.</Notice>;
  if (status === "kicked") return <Notice title="the host removed you from this room">you can still play on your own, or make a room of your own.</Notice>;
  if (!view) {
    return (
      <Shell code={code}>
        <p className="text-muted">
          <Spinner className="mr-2" /> connecting to room {code}…
        </p>
      </Shell>
    );
  }

  const seated = me !== null && view.players.some((p) => p.id === me && p.active);
  if (!seated) return <JoinForm code={code} view={view} snapshot={snapshot} client={client} />;

  const game = view.game;
  if (!game) return <Lobby view={view} me={me!} snapshot={snapshot} client={client} />;
  return <InGame view={view} game={game} me={me!} snapshot={snapshot} client={client} />;
}

/* -------------------------------------------------------------- frames */

function Shell({ code, children }: { code?: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[40rem] px-6 py-10 text-[14px] sm:py-16">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13.5px]">
        <Link href="/" className="text-muted transition-colors hover:text-ink">
          dach
        </Link>
        <span aria-hidden className="text-faint">
          /
        </span>
        <Link href="/geo" className="text-muted transition-colors hover:text-ink">
          geo
        </Link>
        {code && (
          <>
            <span aria-hidden className="text-faint">
              /
            </span>
            <span className="font-medium tracking-wider text-ink">{code}</span>
          </>
        )}
      </nav>
      <main className="mt-10">{children}</main>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Shell>
      <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted">{children}</p>
      <p className="mt-6">
        <Link href="/geo" className="font-medium underline decoration-faint underline-offset-4 hover:decoration-ink">
          back to geo
        </Link>
      </p>
    </Shell>
  );
}

function ErrorLine({ snapshot, client }: { snapshot: RoomSnapshot; client: RoomClient }) {
  if (!snapshot.error && !snapshot.offline) return null;
  return (
    <p role="alert" className="mt-3 text-[13px] text-accent">
      {snapshot.offline ? "lost touch with the room; trying again…" : snapshot.error}{" "}
      {snapshot.error && (
        <button type="button" onClick={() => client.clearError()} className="text-muted underline underline-offset-2 hover:text-ink">
          ok
        </button>
      )}
    </p>
  );
}

/* ---------------------------------------------------------------- join */

function JoinForm({ code, view, snapshot, client }: { code: string; view: RoomView; snapshot: RoomSnapshot; client: RoomClient }) {
  const [name, setName] = useState(() => load(KEYS.name, isString) ?? "");
  const here = view.players.filter((p) => p.active);
  const names = here.length > 5 ? `${here.slice(0, 4).map((p) => p.name).join(", ")} and ${here.length - 4} others` : here.map((p) => p.name).join(", ");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) void client.join(name.trim());
  };
  return (
    <Shell code={code}>
      <h1 className="text-[20px] font-semibold tracking-tight">join room {code}</h1>
      <p className="mt-2 text-muted">
        {here.length === 0 ? "nobody's here yet." : `${names} ${here.length === 1 ? "is" : "are"} here.`}{" "}
        {view.game && view.game.phase !== "final" ? "a game is on, and you'll join it straight away." : ""}
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[12.5px] text-muted">your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            autoFocus
            autoComplete="nickname"
            className="min-h-10 rounded-lg border border-faint bg-paper px-3 text-[15px] outline-none focus:border-ink"
          />
        </label>
        <Button tone="solid" type="submit" disabled={!name.trim() || snapshot.busy} className="min-h-10">
          {snapshot.busy ? <Spinner /> : "join"}
        </Button>
      </form>
      <ErrorLine snapshot={snapshot} client={client} />
    </Shell>
  );
}

/* --------------------------------------------------------------- lobby */

const TIME_LABELS: Record<number, string> = { 30: "30s", 60: "1 min", 90: "1½ min", 120: "2 min", 180: "3 min", 300: "5 min" };

/**
 * The host looks for places while everyone waits, and again as soon as a
 * game starts, so "play again" can go straight away.
 */
function useHostPlaces(view: RoomView, me: string) {
  const host = view.host === me;
  const settings = view.settings;
  const [attempt, setAttempt] = useState(0);
  const key = `room:${view.code}:${settings.map}:${settings.rounds}:${view.game?.index ?? 0}`;
  const state = usePlaces(host ? { key, map: settings.map, count: settings.rounds } : null, attempt);
  const previous = useRef(key);
  useEffect(() => {
    if (previous.current !== key) forgetPlaces(previous.current);
    previous.current = key;
  }, [key]);
  useEffect(() => () => forgetPlaces(previous.current), []);
  return { ...state, key, retry: () => setAttempt((a) => a + 1) };
}

function inviteLink(code: string) {
  return `${window.location.origin}/geo/${code}`;
}

function Lobby({ view, me, snapshot, client }: { view: RoomView; me: string; snapshot: RoomSnapshot; client: RoomClient }) {
  const host = view.host === me;
  const places = useHostPlaces(view, me);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const players = view.players.filter((p) => p.active);
  const hostName = players.find((p) => p.id === view.host)?.name ?? "the host";

  // Show a choice the moment it's made, not when the server has it.
  const [pending, setPending] = useState<Settings | null>(null);
  const settings = pending ?? view.settings;
  const change = async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setPending(next);
    await client.act("settings", { settings: next });
    setPending((current) => (current === next ? null : current));
  };
  const start = async () => {
    if (!places.places) return;
    if (await client.act("start", { settings: view.settings, places: places.places })) forgetPlaces(places.key);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(view.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", inviteLink(view.code));
    }
  };

  return (
    <Shell code={view.code}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12.5px] text-muted">room code</p>
          <h1 className="font-mono text-[40px] font-semibold leading-none tracking-[0.18em]">{view.code}</h1>
        </div>
        <Button onClick={copy}>{copied ? "link copied" : "copy invite link"}</Button>
      </div>
      <p className="mt-3 text-muted">
        friends go to <span className="text-ink">{typeof window !== "undefined" ? window.location.host : ""}/geo</span> and type the code.
      </p>

      <section aria-labelledby="players" className="mt-10">
        <h2 id="players" className="text-muted">
          {plural(players.length, "player")}
        </h2>
        <ul className="mt-3 space-y-1.5">
          {players.map((player) => (
            <PlayerRow key={player.id} player={player} me={me} host={view.host}>
              {host && player.id !== me && (
                <button type="button" onClick={() => void client.act("kick", { target: player.id })} className="text-[12.5px] text-muted hover:text-accent">
                  remove
                </button>
              )}
            </PlayerRow>
          ))}
        </ul>
      </section>

      <section aria-labelledby="settings" className="mt-10">
        <h2 id="settings" className="text-muted">
          game {host ? "" : `· ${hostName} picks`}
        </h2>
        <div className="mt-3 space-y-4">
          <Row label="map">
            {MAPS.map((map) => (
              <Choice key={map.id} selected={settings.map === map.id} onSelect={() => void change({ map: map.id })} disabled={!host} title={map.blurb}>
                {map.name}
              </Choice>
            ))}
          </Row>
          <Row label="rounds">
            {ROUND_CHOICES.map((rounds) => (
              <Choice key={rounds} selected={settings.rounds === rounds} onSelect={() => void change({ rounds })} disabled={!host}>
                {rounds}
              </Choice>
            ))}
          </Row>
          <Row label="time per round">
            {TIME_CHOICES.map((time) => (
              <Choice key={time} selected={settings.time === time} onSelect={() => void change({ time })} disabled={!host}>
                {TIME_LABELS[time]}
              </Choice>
            ))}
          </Row>
        </div>
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-3">
        {host ? (
          <>
            <Button tone="solid" onClick={start} disabled={!places.places || snapshot.busy || pending !== null} className="min-h-10 px-5">
              {places.places ? "start the game" : places.error ? "can't start" : (
                <>
                  <Spinner /> finding places {places.found}/{view.settings.rounds}
                </>
              )}
            </Button>
            {players.length === 1 && <span className="text-muted">you can start on your own, but it&rsquo;s better with friends.</span>}
          </>
        ) : (
          <p className="text-muted">waiting for {hostName} to start…</p>
        )}
        <span className="flex-1" />
        {leaving ? (
          <span className="flex items-center gap-2">
            <span className="text-muted">leave the room?</span>
            <Button onClick={() => setLeaving(false)}>stay</Button>
            <LeaveButton client={client} />
          </span>
        ) : (
          <Button tone="quiet" onClick={() => setLeaving(true)}>
            leave room
          </Button>
        )}
      </div>
      {places.error && host && <PlacesError error={places.error} onRetry={places.retry} />}
      <ErrorLine snapshot={snapshot} client={client} />
    </Shell>
  );
}

function LeaveButton({ client, label = "leave" }: { client: RoomClient; label?: string }) {
  return (
    <Link
      href="/geo"
      onClick={() => void client.leave()}
      className="inline-flex min-h-9 items-center rounded-lg bg-ink px-3.5 text-[13.5px] font-medium text-paper hover:bg-ink/85"
    >
      {label}
    </Link>
  );
}

export function PlacesError({ error, onRetry }: { error: { message: string; denied: boolean }; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-3 text-[13px]">
      {error.denied ? (
        <>
          <p className="font-medium text-accent">this site can&rsquo;t look up street view.</p>
          <p className="mt-1 text-muted">
            &ldquo;{error.message}&rdquo;. the server&rsquo;s key (<code>GOOGLE_MAPS_SERVER_KEY</code>) needs the street view static api
            switched on. the readme has the steps.
          </p>
        </>
      ) : (
        <p className="text-accent">{error.message}.</p>
      )}
      <button type="button" onClick={onRetry} className="mt-2 font-medium underline underline-offset-2">
        try again
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[12.5px] text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function PlayerRow({ player, me, host, children }: { player: PlayerView; me: string; host: string | null; children?: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: player.color }} />
      <span className="min-w-0 truncate">{player.name}</span>
      {player.id === me && <span className="text-muted">(you)</span>}
      {player.id === host && <span className="rounded bg-ink/[0.07] px-1.5 text-[11.5px] text-muted">host</span>}
      {player.away && <span className="text-[12px] text-muted">away</span>}
      <span className="flex-1" />
      {children}
    </li>
  );
}

/* -------------------------------------------------------------- in game */

interface Standing {
  player: PlayerView;
  total: number;
  rank: number;
}

function standings(view: RoomView, game: GameView): Standing[] {
  const rows = view.players.map((player) => ({ player, total: game.totals[player.id] ?? 0 }));
  rows.sort((a, b) => b.total - a.total || a.player.name.localeCompare(b.player.name));
  // Equal scores share a place.
  return rows.map((row) => ({ ...row, rank: rows.findIndex((r) => r.total === row.total) + 1 }));
}

function InGame({ view, game, me, snapshot, client }: { view: RoomView; game: GameView; me: string; snapshot: RoomSnapshot; client: RoomClient }) {
  const now = useServerNow(250);
  const round = game.rounds[game.current];
  const host = view.host === me;
  const [pins, setPins] = useState<Record<string, LatLng>>({});
  const [reset, setReset] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const pinKey = `${game.index}:${game.current}`;
  const pin = pins[pinKey] ?? null;
  const guessed = round.guessed.includes(me);
  const sent = useRef<string | null>(null);

  // Keep the next game's places coming for the host.
  const places = useHostPlaces(view, me);

  const gameIndex = game.index;
  const roundIndex = game.current;
  const guess = useCallback(
    async (at: LatLng, automatic = false) => {
      if (sent.current === pinKey) return;
      sent.current = pinKey;
      const ok = await client.act("guess", { g: gameIndex, r: roundIndex, lat: at.lat, lng: at.lng });
      // A guess you sent can be sent again; the one sent for you as time ran out gets one go.
      if (!ok && !automatic) sent.current = null;
    },
    [client, gameIndex, roundIndex, pinKey],
  );

  // With a pin down when time runs out, it goes in as the guess, a moment early to beat the network.
  const phase = game.phase;
  useEffect(() => {
    if (phase !== "playing" || guessed || !pin) return;
    const timer = setInterval(() => {
      if (serverNow() >= round.deadline - 400) void guess(pin, true);
    }, 100);
    return () => clearInterval(timer);
  }, [phase, guessed, pin, round.deadline, guess]);

  const map = MAP_BY_ID[game.settings.map];
  const myTotal = game.totals[me] ?? 0;
  const players = view.players;
  const activeCount = players.filter((p) => p.active).length;
  const waitingOn = players.filter((p) => p.active && !round.guessed.includes(p.id)).length;

  // What to show: the round, or the next round loading out of sight behind the results.
  const playing = phase === "playing" || phase === "countdown";
  const shown = playing ? round.place : game.upcoming;
  const started = now >= round.start;
  const timeUp = phase === "playing" && now >= round.deadline;

  const leaveButton = leaving ? (
    <span className="pointer-events-auto flex items-center gap-2 rounded-lg bg-paper/95 p-1.5 pl-3 text-[13px] shadow">
      leave the room?
      <Button onClick={() => setLeaving(false)}>stay</Button>
      <LeaveButton client={client} />
    </span>
  ) : null;

  return (
    <div className="fixed inset-0 touch-manipulation overflow-hidden bg-[#2b2a27] text-ink">
      {shown && <StreetView key={shown.pano} pano={shown.pano} heading={shown.heading} visible={playing && started} reset={reset} />}

      {playing && (
        <Play
          mapName={map.name}
          bounds={MAP_BOUNDS[game.settings.map]}
          round={game.current + 1}
          rounds={game.settings.rounds}
          score={myTotal}
          deadline={round.deadline}
          limit={game.settings.time * 1000}
          clock={serverNow}
          pin={pin}
          onPin={(point) => !guessed && setPins((p) => ({ ...p, [pinKey]: point }))}
          onGuess={() => pin && void guess(pin)}
          guessed={guessed || timeUp}
          waiting={timeUp ? "time's up" : waitingOn > 0 ? `waiting for ${plural(waitingOn, "other")}…` : "guessed"}
          onReset={() => setReset((r) => r + 1)}
          onLeave={() => setLeaving(true)}
          side={leaveButton ?? <Guessers players={players} guessed={round.guessed} me={me} />}
        />
      )}

      {phase === "countdown" && !started && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-[#2b2a27]/80 text-white">
          <div role="status" className="text-center">
            <p className="text-[15px] text-[#d8d4ca]">
              {map.name} · {plural(game.settings.rounds, "round")} · {formatClock(game.settings.time * 1000)} each
            </p>
            <p className="mt-2 text-[56px] font-semibold tabular-nums">{Math.max(1, Math.ceil((round.start - now) / 1000))}</p>
          </div>
        </div>
      )}

      {phase === "results" && (
        <RoundResults view={view} game={game} me={me} now={now} host={host} client={client} activeCount={activeCount} />
      )}

      {phase === "final" && (
        <Final view={view} game={game} me={me} host={host} client={client} places={places} snapshot={snapshot} />
      )}

      {snapshot.offline && (
        <p role="alert" className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white shadow">
          lost touch with the room; trying again…
        </p>
      )}
      {snapshot.error && !snapshot.offline && (
        <button
          type="button"
          onClick={() => client.clearError()}
          className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg bg-ink px-3 py-1.5 text-[13px] text-paper shadow"
        >
          {snapshot.error} · ok
        </button>
      )}
    </div>
  );
}

/** Who has guessed, in the corner during a round. */
function Guessers({ players, guessed, me }: { players: PlayerView[]; guessed: string[]; me: string }) {
  const active = players.filter((p) => p.active);
  const shown = active.slice(0, 8);
  return (
    <div className="pointer-events-auto rounded-xl bg-paper/92 px-3 py-2 text-[12.5px] shadow-[0_1px_6px_rgb(0_0_0/0.25)] backdrop-blur">
      <p className="text-muted">
        {guessed.filter((id) => active.some((p) => p.id === id)).length} of {active.length} guessed
      </p>
      <ul className="mt-1 space-y-0.5">
        {shown.map((player) => (
          <li key={player.id} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: player.color }} />
            <span className={`max-w-[9rem] truncate ${player.id === me ? "font-medium" : ""}`}>{player.name}</span>
            <span className={guessed.includes(player.id) ? "text-[#2b8a3e]" : "text-faint"}>{guessed.includes(player.id) ? "✓" : "…"}</span>
          </li>
        ))}
        {active.length > shown.length && <li className="text-muted">and {active.length - shown.length} more</li>}
      </ul>
    </div>
  );
}

function RoundResults({
  view,
  game,
  me,
  now,
  host,
  client,
  activeCount,
}: {
  view: RoomView;
  game: GameView;
  me: string;
  now: number;
  host: boolean;
  client: RoomClient;
  activeCount: number;
}) {
  const round = game.rounds[game.current];
  const byId = useMemo(() => new Map(view.players.map((p) => [p.id, p])), [view.players]);
  const guesses = [...(round.guesses ?? [])].sort((a, b) => b.points - a.points);
  const mine = guesses.find((g) => g.player === me);
  const last = game.current + 1 >= game.settings.rounds;
  const next = () => void client.act("next", { g: game.index, r: game.current });
  useAdvanceKey(host ? next : null);

  const place = round.place;
  if (place.lat === undefined || place.lng === undefined) return null;
  const pins = guesses.map((g) => {
    const player = byId.get(g.player);
    return {
      lat: g.lat,
      lng: g.lng,
      color: player?.color ?? "#495057",
      label: initials(player?.name ?? "?"),
      title: `${player?.name ?? "someone"}: ${formatDistance(g.km)}`,
      mine: g.player === me,
    };
  });
  const missing = view.players.filter((p) => p.active && !round.guessed.includes(p.id));

  return (
    <ResultsLayout rounds={[{ answer: { lat: place.lat, lng: place.lng }, guesses: pins }]} label="Map of where it was and everyone's guesses">
      <div className="flex items-center justify-between gap-3 text-muted">
        <h2>
          round {game.current + 1} of {game.settings.rounds}
        </h2>
        {round.next !== null && (
          <span className="tabular-nums">
            {last ? "final scores" : "next round"} in {formatClock(round.next - now)}
          </span>
        )}
      </div>
      <div role="status" className="mt-2">
        <Verdict km={mine?.km ?? null} points={mine?.points ?? 0} />
      </div>
      <PointsBar points={mine?.points ?? 0} className="mt-3" />
      <div className="mt-3">
        <PlaceFacts place={{ ...place, lat: place.lat, lng: place.lng, country: place.country ?? "" }} />
      </div>
      {activeCount > 1 || guesses.length > 1 ? (
        <ol className="mt-4 divide-y divide-faint/40">
          {guesses.map((g, i) => {
            const player = byId.get(g.player);
            return (
              <li key={g.player} className={`flex items-baseline gap-3 py-1.5 ${g.player === me ? "font-medium" : ""}`}>
                <span className="w-5 text-muted tabular-nums">{i + 1}</span>
                <span aria-hidden className="size-2.5 shrink-0 self-center rounded-full" style={{ background: player?.color }} />
                <span className="min-w-0 flex-1 truncate">{player?.name ?? "someone"}</span>
                <span className="text-muted tabular-nums">{formatDistance(g.km)}</span>
                <span className="w-14 text-right tabular-nums">{formatPoints(g.points)}</span>
              </li>
            );
          })}
          {missing.map((player) => (
            <li key={player.id} className="flex items-baseline gap-3 py-1.5 text-muted">
              <span className="w-5" />
              <span aria-hidden className="size-2.5 shrink-0 self-center rounded-full" style={{ background: player.color }} />
              <span className="min-w-0 flex-1 truncate">{player.name}</span>
              <span>no guess</span>
              <span className="w-14 text-right tabular-nums">0</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="mt-4 flex items-center justify-end gap-3">
        {host ? (
          <>
            <span className="text-[12px] text-muted max-sm:hidden">or press space</span>
            <Button tone="solid" onClick={next} autoFocus>
              {last ? "final scores" : "next round now"} <span aria-hidden>→</span>
            </Button>
          </>
        ) : (
          <span className="text-muted">the host can skip ahead</span>
        )}
      </div>
    </ResultsLayout>
  );
}

function Final({
  view,
  game,
  me,
  host,
  client,
  places,
  snapshot,
}: {
  view: RoomView;
  game: GameView;
  me: string;
  host: boolean;
  client: RoomClient;
  places: ReturnType<typeof useHostPlaces>;
  snapshot: RoomSnapshot;
}) {
  const rows = standings(view, game);
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const [leaving, setLeaving] = useState(false);
  const rounds = game.rounds.map((round, i) => ({
    answer: { lat: round.place.lat ?? 0, lng: round.place.lng ?? 0 },
    label: String(i + 1),
    guesses: (round.guesses ?? []).map((g) => {
      const player = byId.get(g.player);
      return {
        lat: g.lat,
        lng: g.lng,
        color: player?.color ?? "#495057",
        label: initials(player?.name ?? "?"),
        title: `${player?.name ?? "someone"}, round ${i + 1}`,
        mine: g.player === me,
      };
    }),
  }));
  const again = async () => {
    if (!places.places) return;
    if (await client.act("start", { settings: view.settings, places: places.places })) forgetPlaces(places.key);
  };
  const winner = rows[0];
  const me_ = rows.find((r) => r.player.id === me);

  return (
    <ResultsLayout rounds={rounds} label="Map of every round and everyone's guesses">
      <div className="flex items-center justify-between gap-3 text-muted">
        <h2>
          final scores · {MAP_BY_ID[game.settings.map].name}, {plural(game.settings.rounds, "round")}
        </h2>
      </div>
      <p role="status" className="mt-2 text-[22px] font-semibold tracking-tight">
        {rows.length > 1 && winner ? (winner.player.id === me ? "you won!" : `${winner.player.name} wins`) : `${formatPoints(me_?.total ?? 0)} points`}
      </p>
      {me_ && rows.length > 1 && (
        <p className="text-muted">
          you came {ordinal(me_.rank)} with {formatPoints(me_.total)} of {formatPoints(MAX_POINTS * game.settings.rounds)}
        </p>
      )}
      <PointsBar points={(me_?.total ?? 0) / game.settings.rounds} className="mt-3" />
      <ol className="mt-4 divide-y divide-faint/40">
        {rows.map((row) => (
          <li key={row.player.id} className={`flex items-baseline gap-3 py-1.5 ${row.player.id === me ? "font-medium" : ""}`}>
            <span className="w-6 text-muted tabular-nums">{ordinal(row.rank)}</span>
            <span aria-hidden className="size-2.5 shrink-0 self-center rounded-full" style={{ background: row.player.color }} />
            <span className="min-w-0 flex-1 truncate">
              {row.player.name}
              {!row.player.active && <span className="text-muted"> (left)</span>}
            </span>
            <span className="tabular-nums">{formatPoints(row.total)}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {leaving ? (
          <>
            <span className="mr-auto text-muted">leave the room?</span>
            <Button onClick={() => setLeaving(false)}>stay</Button>
            <LeaveButton client={client} />
          </>
        ) : host ? (
          <>
            <Button tone="quiet" onClick={() => setLeaving(true)} className="mr-auto">
              leave room
            </Button>
            <Button onClick={() => void client.act("lobby")}>change settings</Button>
            <Button tone="solid" onClick={again} disabled={!places.places || snapshot.busy} autoFocus>
              {places.places ? "play again" : (
                <>
                  <Spinner /> finding places
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            <Button tone="quiet" onClick={() => setLeaving(true)} className="mr-auto">
              leave room
            </Button>
            <span className="text-muted">waiting for the host to start another game…</span>
          </>
        )}
      </div>
      {places.error && host && <PlacesError error={places.error} onRetry={places.retry} />}
    </ResultsLayout>
  );
}

