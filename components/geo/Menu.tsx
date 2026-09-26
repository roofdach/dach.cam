"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DAILY_MAP, DAILY_ROUNDS, DAILY_TIME, dailyDate, dailyNumber, dailySeed, msUntilNextDaily } from "@/lib/geo/daily";
import { MAPS, MAP_BY_ID, isMapId, type MapId } from "@/lib/geo/maps";
import { CODE_LENGTH, NOT_CODE_LETTERS } from "@/lib/rooms/codes";
import { MAX_POINTS, formatPoints } from "@/lib/geo/score";
import { forgetPlaces, usePlaces } from "./places";
import { PlacesError } from "./Room";
import { isSoloGame, newSoloGame, scoreGame, type SoloGame } from "./Solo";
import { KEYS, isString, load, save } from "@/components/game/storage";
import { Button, Choice, Spinner, formatWait, plural } from "@/components/game/ui";

const SOLO_ROUNDS = 5;
const TIMES: { value: number | null; label: string }[] = [
  { value: null, label: "no limit" },
  { value: 30, label: "30s" },
  { value: 60, label: "1 min" },
  { value: 120, label: "2 min" },
  { value: 300, label: "5 min" },
];

interface Choices {
  map: MapId;
  time: number | null;
}

const isChoices = (value: unknown): value is Choices =>
  !!value &&
  typeof value === "object" &&
  isMapId((value as Choices).map) &&
  TIMES.some((t) => t.value === (value as Choices).time);

export function Menu({
  multiplayer,
  streetView,
  autostart,
  onPlay,
}: {
  multiplayer: boolean;
  /** Both Google keys are there: the page's, to show Street View, and the server's, to find it. */
  streetView: boolean;
  /** Start a solo game with the last choices as soon as places are found. */
  autostart: boolean;
  onPlay: (game: SoloGame) => void;
}) {
  const ready = streetView;
  const [choices, setChoices] = useState<Choices>(() => load(KEYS.menu, isChoices) ?? { map: "world", time: null });
  const [nonce] = useState(() => Math.random().toString(36).slice(2));
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState<"solo" | "daily" | null>(autostart ? "solo" : null);
  const [saved] = useState(() => {
    const game = load(KEYS.solo, isSoloGame);
    return game && game.phase !== "done" ? game : null;
  });
  const today = dailyDate();
  const [daily] = useState(() => {
    const game = load(KEYS.daily, isSoloGame);
    return game && game.date === today ? game : null;
  });

  const soloKey = `solo:${choices.map}:${nonce}`;
  const solo = usePlaces(ready ? { key: soloKey, map: choices.map, count: SOLO_ROUNDS } : null, attempt);
  // Places found for a menu that's gone won't be used; let them go.
  const lastKey = useRef(soloKey);
  useEffect(() => {
    lastKey.current = soloKey;
  }, [soloKey]);
  useEffect(() => () => forgetPlaces(lastKey.current), []);
  const dailyKey = `daily:${today}`;
  const dailyPlaces = usePlaces(ready && !daily ? { key: dailyKey, map: DAILY_MAP, count: DAILY_ROUNDS, seed: dailySeed(today) } : null, attempt);

  const choose = (patch: Partial<Choices>) => {
    const next = { ...choices, ...patch };
    if (next.map !== choices.map) forgetPlaces(soloKey);
    setChoices(next);
    save(KEYS.menu, next);
  };

  // Once asked to start, go the moment the places are in.
  useEffect(() => {
    if (starting === "solo" && solo.places) {
      forgetPlaces(soloKey);
      onPlay(newSoloGame("solo", choices.map, choices.time, solo.places));
    } else if (starting === "daily" && dailyPlaces.places) {
      forgetPlaces(dailyKey);
      onPlay(newSoloGame("daily", DAILY_MAP, DAILY_TIME, dailyPlaces.places, today));
    }
  }, [starting, solo.places, dailyPlaces.places, soloKey, dailyKey, choices.map, choices.time, onPlay, today]);

  const error = (starting === "daily" ? dailyPlaces.error : null) ?? solo.error ?? dailyPlaces.error;

  return (
    <div className="mx-auto w-full max-w-[40rem] px-6 py-10 text-[14px] sm:py-16">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13.5px]">
        <Link href="/" className="text-muted transition-colors hover:text-ink">
          dach
        </Link>
        <span aria-hidden className="text-faint">
          /
        </span>
        <span className="font-medium text-ink">geo</span>
      </nav>

      <main className="mt-10">
        <h1 className="text-[28px] font-semibold tracking-tight">geo</h1>
        <p className="mt-2 text-muted">
          you get dropped into google street view somewhere on earth. look around, walk down the road, then put a pin where you
          think you are. the closer you are, the more points you get, up to 5,000 a round.
        </p>

        {!ready && (
          <div role="alert" className="mt-6 rounded-lg border border-accent/40 bg-accent/5 p-4 text-[13.5px]">
            <p className="font-medium text-accent">street view isn&rsquo;t set up on this site yet.</p>
            <p className="mt-1 text-muted">
              whoever runs it needs to add two google maps keys (they&rsquo;re free for this). the readme has the steps.
            </p>
          </div>
        )}

        {saved && ready && (
          <Section title="carry on">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>
                your game on <span className="font-medium">{MAP_BY_ID[saved.map].name}</span>, round {saved.round + 1} of {saved.places.length} ·{" "}
                {formatPoints(scoreGame(saved).reduce((sum, s) => sum + s.points, 0))} points
              </p>
              <Button tone="solid" onClick={() => onPlay(saved)}>
                continue
              </Button>
            </div>
          </Section>
        )}

        <Section title="play">
          <div className="space-y-4">
            <Group label="map">
              {MAPS.map((map) => (
                <Choice key={map.id} selected={choices.map === map.id} onSelect={() => choose({ map: map.id })} title={map.blurb}>
                  {map.name}
                </Choice>
              ))}
            </Group>
            <p className="-mt-2 text-[12.5px] text-muted">{MAP_BY_ID[choices.map].blurb}.</p>
            <Group label="time per round">
              {TIMES.map((time) => (
                <Choice key={String(time.value)} selected={choices.time === time.value} onSelect={() => choose({ time: time.value })}>
                  {time.label}
                </Choice>
              ))}
            </Group>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button tone="solid" disabled={!ready || starting !== null} onClick={() => setStarting("solo")} className="min-h-10 px-5">
              {starting === "solo" && !solo.error ? (
                <>
                  <Spinner /> finding places {solo.found}/{SOLO_ROUNDS}
                </>
              ) : (
                `play ${SOLO_ROUNDS} rounds`
              )}
            </Button>
            {saved && <span className="text-[12.5px] text-muted">starting over replaces the game above</span>}
          </div>
        </Section>

        <Section title={`daily #${dailyNumber(today)}`}>
          {daily?.phase === "done" ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>
                you scored <span className="font-medium">{formatPoints(scoreGame(daily).reduce((sum, s) => sum + s.points, 0))}</span> of{" "}
                {formatPoints(MAX_POINTS * daily.places.length)} today. the next one is in {formatWait(msUntilNextDaily())}.
              </p>
              <Button onClick={() => onPlay(daily)}>see it again</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted">
                the same {DAILY_ROUNDS} places for everyone today, on the world map, {DAILY_TIME / 60} minutes a round. one go each.
              </p>
              {daily ? (
                <Button tone="solid" disabled={!ready} onClick={() => onPlay(daily)}>
                  continue the daily
                </Button>
              ) : (
                <Button tone="solid" disabled={!ready || starting !== null} onClick={() => setStarting("daily")}>
                  {starting === "daily" && !dailyPlaces.error ? (
                    <>
                      <Spinner /> finding places {dailyPlaces.found}/{DAILY_ROUNDS}
                    </>
                  ) : (
                    "play the daily"
                  )}
                </Button>
              )}
            </div>
          )}
        </Section>

        {error && ready && (
          <PlacesError
            error={error}
            onRetry={() => {
              setStarting(null);
              setAttempt((a) => a + 1);
            }}
          />
        )}

        <Friends multiplayer={multiplayer} ready={ready} />
      </main>

      <footer className="mt-16 text-[12px] leading-relaxed text-muted">
        imagery from google street view. maps © openstreetmap contributors and carto. towns from geonames (cc by 4.0), borders
        from natural earth.
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `section-${title.replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-muted">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[12.5px] text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}


function Friends({ multiplayer, ready }: { multiplayer: boolean; ready: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(() => load(KEYS.name, isString) ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/geo/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; you?: { id: string; token: string }; room?: { code: string } } | null;
      if (!response.ok || !body?.you || !body.room) throw new Error(body?.error ?? "couldn't make a room");
      save(KEYS.name, trimmed);
      save(KEYS.room(body.room.code), body.you);
      router.push(`/geo/${body.room.code}`);
    } catch (e) {
      setError(e instanceof TypeError ? "couldn't reach the server; check your connection" : (e as Error).message);
      setBusy(false);
    }
  };

  const join = (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) return;
    if (name.trim()) save(KEYS.name, name.trim());
    router.push(`/geo/${code}`);
  };

  return (
    <Section title="with friends">
      {!multiplayer ? (
        <p className="text-muted">multiplayer isn&rsquo;t set up on this site yet: it needs a small free database, and the readme says how.</p>
      ) : (
        <div className="space-y-6">
          <p className="text-muted">
            make a room and send people the code. everyone gets the same places at the same time, sees each other&rsquo;s guesses after
            each round, and the host picks the map. up to fifty players, so a whole class fits.
          </p>
          <form onSubmit={create} className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
              <span className="text-[12.5px] text-muted">your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={16}
                autoComplete="nickname"
                className="min-h-10 rounded-lg border border-faint bg-paper px-3 text-[15px] outline-none focus:border-ink"
              />
            </label>
            <Button tone="solid" type="submit" disabled={!ready || !name.trim() || busy} className="min-h-10">
              {busy ? <Spinner /> : "make a room"}
            </Button>
          </form>
          <form onSubmit={join} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] text-muted">got a code?</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(NOT_CODE_LETTERS, "").slice(0, CODE_LENGTH))}
                placeholder="BCDF"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="code-hint"
                className="min-h-10 w-[9rem] rounded-lg border border-faint bg-paper px-3 font-mono text-[16px] tracking-[0.2em] uppercase outline-none placeholder:text-faint focus:border-ink"
              />
            </label>
            <Button type="submit" disabled={code.length !== CODE_LENGTH} className="min-h-10">
              join
            </Button>
            <span id="code-hint" className="basis-full text-[12px] text-muted">
              codes are {plural(CODE_LENGTH, "letter")}, no vowels.
            </span>
          </form>
          {error && (
            <p role="alert" className="text-[13px] text-accent">
              {error}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
