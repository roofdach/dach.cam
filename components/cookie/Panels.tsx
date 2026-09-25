"use client";

import { useState, type ReactNode } from "react";
import { ACHIEVEMENTS, type AchievementGroup } from "@/lib/cookie/achievements";
import * as engine from "@/lib/cookie/engine";
import { formatDuration } from "@/lib/cookie/format";
import { HEAVENLY, UPGRADES } from "@/lib/cookie/upgrades";
import { useCookieGame, useFormat, useGame } from "./context";
import { Modal, Segmented, milkFlavour } from "./ui";

const heading = "text-[12px] font-medium uppercase tracking-[0.08em] text-muted";
const outline =
  "rounded-lg border border-faint/80 px-3 py-1.5 text-[13px] transition-colors hover:border-ink disabled:cursor-default disabled:opacity-50 disabled:hover:border-faint/80";
const button = `${outline} text-ink`;
const primary =
  "rounded-lg bg-ink px-4 py-2 text-[14px] font-medium text-paper transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-40";

/* ---------------------------------------------------------- achievements */

const GROUPS: [AchievementGroup, string][] = [
  ["baking", "Baking"],
  ["buildings", "Buildings"],
  ["golden", "Golden cookies"],
  ["other", "Everything else"],
  ["legacy", "Legacy"],
];

export function Achievements() {
  const game = useCookieGame();
  // The set itself is read below; this is what says it changed.
  const count = useGame((state, g) => `${g.generation}:${state.achievements.size}`).split(":")[1];
  const milk = useGame((state) => engine.milk(state));
  const owned = game.state.achievements;
  const flavour = milkFlavour(milk);

  return (
    <div className="px-4 py-4">
      <p className="text-[13px] text-muted">
        <b className="font-medium text-ink">{count}</b> of {ACHIEVEMENTS.length} unlocked. Each one adds 4% milk, and
        kitten upgrades turn milk into cookies. You have {Math.round(milk * 100)}% ({flavour.name.toLowerCase()}).
      </p>
      {GROUPS.map(([group, title]) => {
        const list = ACHIEVEMENTS.filter((a) => a.group === group);
        const done = list.filter((a) => owned.has(a.id)).length;
        return (
          <section key={group} className="mt-5" aria-labelledby={`achievements-${group}`}>
            <h3 id={`achievements-${group}`} className={heading}>
              {title} <span className="tabular-nums">· {done}/{list.length}</span>
            </h3>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {list.map((achievement) => {
                const unlocked = owned.has(achievement.id);
                return (
                  <li
                    key={achievement.id}
                    className={`flex gap-2.5 rounded-lg px-2 py-1.5 ${unlocked ? "bg-amber-100/50 dark:bg-amber-300/10" : ""}`}
                  >
                    <span aria-hidden className={`text-[17px] leading-6 ${unlocked ? "" : "opacity-35 grayscale"}`}>
                      {unlocked ? "🏆" : "🔒"}
                    </span>
                    <span className="min-w-0 leading-snug">
                      <span className={`block text-[13.5px] ${unlocked ? "text-ink" : "text-muted"}`}>
                        {achievement.name}
                        <span className="sr-only">{unlocked ? ", unlocked" : ", locked"}</span>
                      </span>
                      <span className="block text-[12px] text-muted">{achievement.desc}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- stats */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-faint/40 py-2 text-[13.5px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right tabular-nums text-ink">{children}</dd>
    </div>
  );
}

export function Stats() {
  const format = useFormat();
  const cookies = useGame((state) => Math.floor(state.run.cookies));
  const baked = useGame((state) => Math.floor(state.run.baked));
  const allTime = useGame((state) => Math.floor(engine.bakedAllTime(state)));
  const perSecond = useGame((_, game) => game.production().total);
  const unbuffed = useGame((state) => engine.production(state, false).total);
  const perClick = useGame((state, game) => engine.clickValue(state, game.production()));
  const clicks = useGame((state) => state.run.clicks);
  const clicksAllTime = useGame((state) => state.totals.clicks);
  const handmade = useGame((state) => Math.floor(state.run.handmade));
  const buildings = useGame((state) => engine.totalOwned(state));
  const upgrades = useGame((state) => state.run.upgrades.size);
  const achievements = useGame((state) => state.achievements.size);
  const milk = useGame((state) => engine.milk(state));
  const golden = useGame((state) => state.run.goldenClicks);
  const goldenAllTime = useGame((state) => state.totals.goldenClicks);
  const missed = useGame((state) => state.totals.goldenMissed);
  const runSeconds = useGame((state, game) => Math.max(0, Math.floor((game.now - state.run.startedAt) / 1000)));
  const played = useGame((state) => Math.floor(state.totals.played));
  const prestige = useGame((state) => state.legacy.prestige);
  const ascensions = useGame((state) => state.legacy.ascensions);

  return (
    <div className="px-4 py-4">
      <h2 className={heading}>This run</h2>
      <dl className="mt-1">
        <Row label="Cookies in the bank">{format(cookies)}</Row>
        <Row label="Cookies baked">{format(baked)}</Row>
        <Row label="Cookies per second">
          {format(perSecond, { decimal: true })}
          {perSecond !== unbuffed && <span className="text-muted"> ({format(unbuffed, { decimal: true })} without boosts)</span>}
        </Row>
        <Row label="Cookies per click">{format(perClick, { decimal: true })}</Row>
        <Row label="Cookie clicks">{format(clicks)}</Row>
        <Row label="Made by clicking">{format(handmade)}</Row>
        <Row label="Buildings">{format(buildings)}</Row>
        <Row label="Upgrades">
          {format(upgrades)} of {format(UPGRADES.length)}
        </Row>
        <Row label="Golden cookies clicked">{format(golden)}</Row>
        <Row label="Started">{formatDuration(runSeconds)} ago</Row>
      </dl>
      <h2 className={`${heading} mt-6`}>Every run</h2>
      <dl className="mt-1">
        <Row label="Cookies baked">{format(allTime)}</Row>
        <Row label="Cookie clicks">{format(clicksAllTime)}</Row>
        <Row label="Golden cookies">
          {format(goldenAllTime)} clicked, {format(missed)} missed
        </Row>
        <Row label="Achievements">
          {achievements} of {ACHIEVEMENTS.length}
        </Row>
        <Row label="Milk">
          {Math.round(milk * 100)}% · {milkFlavour(milk).name.toLowerCase()}
        </Row>
        <Row label="Time played">{formatDuration(played)}</Row>
        {ascensions > 0 && (
          <>
            <Row label="Prestige">
              level {format(prestige)} (+{format(prestige)}% production)
            </Row>
            <Row label="Ascensions">{format(ascensions)}</Row>
          </>
        )}
      </dl>
    </div>
  );
}

/* --------------------------------------------------------------- options */

export function Options() {
  const game = useCookieGame();
  const numbers = useGame((state) => state.settings.numbers);
  const effects = useGame((state) => state.settings.effects);
  const canSave = useGame((_, g) => g.canSave);
  const [saved, setSaved] = useState<"" | "saved" | "failed">("");
  const [exported, setExported] = useState("");
  const [copied, setCopied] = useState(false);
  const [imported, setImported] = useState("");
  const [importResult, setImportResult] = useState<"" | "done" | "bad">("");
  const [wiping, setWiping] = useState(false);

  return (
    <div className="space-y-7 px-4 py-4 text-[13.5px]">
      <section aria-labelledby="options-display">
        <h2 id="options-display" className={heading}>
          Display
        </h2>
        <div className="mt-3 flex items-center justify-between gap-4">
          <span>Big numbers</span>
          <Segmented
            label="Big numbers"
            value={numbers}
            options={[
              { value: "long", label: "1.5 million" },
              { value: "short", label: "1.5M" },
            ]}
            onChange={(value) => game.setSettings({ numbers: value })}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-4">
          <span>Crumbs, numbers and moving milk</span>
          <Segmented
            label="Effects"
            value={effects ? "on" : "off"}
            options={[
              { value: "on", label: "on" },
              { value: "off", label: "off" },
            ]}
            onChange={(value) => game.setSettings({ effects: value === "on" })}
          />
        </div>
      </section>

      <section aria-labelledby="options-save">
        <h2 id="options-save" className={heading}>
          Saving
        </h2>
        <p className="mt-2 text-muted">
          {canSave
            ? "The game saves itself every 30 seconds, and whenever you leave the page."
            : "This browser isn't letting the game save, so progress will be lost when the page closes. Exporting still works."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={button}
            onClick={() => {
              setSaved(game.save() ? "saved" : "failed");
              window.setTimeout(() => setSaved(""), 2000);
            }}
          >
            Save now
          </button>
          <span role="status" className="text-muted">
            {saved === "saved" ? "Saved." : saved === "failed" ? "Couldn't save." : ""}
          </span>
        </div>

        <div className="mt-5">
          <button
            type="button"
            className={button}
            onClick={() => {
              setExported(game.exportSave());
              setCopied(false);
            }}
          >
            Export save
          </button>
          {exported && (
            <div className="mt-2">
              <label htmlFor="export-code" className="text-muted">
                Keep this somewhere safe. Pasting it back in below restores the game exactly as it is now.
              </label>
              <textarea
                id="export-code"
                readOnly
                value={exported}
                rows={4}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-2 w-full resize-none rounded-lg border border-faint/80 bg-transparent p-2 font-mono text-[11px] break-all"
              />
              <button
                type="button"
                className={`${button} mt-1`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(exported);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>

        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault();
            const ok = game.importSave(imported);
            setImportResult(ok ? "done" : "bad");
            if (ok) setImported("");
          }}
        >
          <label htmlFor="import-code">Import a save</label>
          <textarea
            id="import-code"
            value={imported}
            onChange={(event) => {
              setImported(event.target.value);
              setImportResult("");
            }}
            rows={3}
            placeholder="Paste an exported save here."
            className="mt-2 w-full resize-none rounded-lg border border-faint/80 bg-transparent p-2 font-mono text-[11px] break-all placeholder:font-sans placeholder:text-[13px] placeholder:text-muted"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button type="submit" className={button} disabled={!imported.trim()}>
              Load it
            </button>
            <span role="status" className={importResult === "bad" ? "text-accent" : "text-muted"}>
              {importResult === "done"
                ? "Loaded."
                : importResult === "bad"
                  ? "That doesn't look like a save from this game. Nothing was changed."
                  : ""}
            </span>
          </div>
        </form>
      </section>

      <section aria-labelledby="options-wipe">
        <h2 id="options-wipe" className={heading}>
          Start over
        </h2>
        <p className="mt-2 text-muted">Wiping deletes everything, prestige and achievements included. Settings stay.</p>
        <button type="button" className={`${outline} mt-3 text-accent`} onClick={() => setWiping(true)}>
          Wipe save
        </button>
        {wiping && (
          <Modal labelledBy="wipe-title" onCancel={() => setWiping(false)}>
            <h2 id="wipe-title" className="text-[17px] font-semibold">
              Wipe everything?
            </h2>
            <p className="mt-2 text-[14px] text-muted">
              Every cookie, building, upgrade, achievement and prestige level goes, and it can&rsquo;t be undone. If you
              might want it back, export your save first.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={button} onClick={() => setWiping(false)} autoFocus>
                Keep playing
              </button>
              <button
                type="button"
                className="rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-paper hover:opacity-90"
                onClick={() => {
                  game.wipe();
                  setWiping(false);
                }}
              >
                Wipe it
              </button>
            </div>
          </Modal>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- legacy */

export function Legacy() {
  const game = useCookieGame();
  const format = useFormat();
  const prestige = useGame((state) => state.legacy.prestige);
  const chips = useGame((state) => state.legacy.chips);
  const allTime = useGame((state) => engine.bakedAllTime(state));
  const [asking, setAsking] = useState(false);
  const reachable = engine.prestigeFor(allTime);
  const gain = Math.max(0, reachable - prestige);
  const nextLevelAt = engine.bakedForPrestige(Math.max(prestige, reachable) + 1);

  return (
    <div className="space-y-5 px-4 py-4 text-[13.5px]">
      <p className="text-muted">
        Ascending ends this run. You keep your achievements, and every trillion cookies you&rsquo;ve ever baked counts
        towards prestige: each level adds 1% to production for good, and comes with a heavenly chip to spend on
        upgrades that carry over between runs.
      </p>
      <dl>
        <Row label="Prestige level">
          {format(prestige)} (+{format(prestige)}%)
        </Row>
        <Row label="Heavenly chips">{format(chips)}</Row>
        <Row label="Baked across every run">{format(allTime)}</Row>
        <Row label="Ascending now would add">
          {format(gain)} {gain === 1 ? "level" : "levels"}
        </Row>
        <Row label={gain > 0 ? "One level more than that" : "The next level"}>
          {format(Math.max(0, nextLevelAt - allTime))} more cookies
        </Row>
      </dl>
      <button type="button" className={primary} onClick={() => setAsking(true)}>
        Ascend
      </button>
      {asking && (
        <Modal labelledBy="ascend-title" onCancel={() => setAsking(false)}>
          <h2 id="ascend-title" className="text-[17px] font-semibold">
            Ascend?
          </h2>
          <p className="mt-2 text-[14px] text-muted">
            {gain > 0
              ? `You'll gain ${format(gain)} prestige ${gain === 1 ? "level" : "levels"} and ${format(gain)} heavenly ${gain === 1 ? "chip" : "chips"}.`
              : "You won't gain any prestige yet: the next level needs more cookies baked."}{" "}
            Your cookies, buildings and upgrades will be gone. Achievements stay.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={button} onClick={() => setAsking(false)} autoFocus>
              Not yet
            </button>
            <button
              type="button"
              className={primary}
              onClick={() => {
                setAsking(false);
                game.ascend();
              }}
            >
              Ascend
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- heaven */

/** Between runs. Heavenly upgrades are bought here, then the next run starts. */
export function Heaven() {
  const game = useCookieGame();
  const format = useFormat();
  const prestige = useGame((state) => state.legacy.prestige);
  const chips = useGame((state) => state.legacy.chips);
  const owned = useGame((state) => [...state.legacy.heavenly].sort().join(" "));

  return (
    <Modal labelledBy="heaven-title" className="w-[min(40rem,calc(100vw-2rem))]">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Ascended</p>
      <h2 id="heaven-title" className="mt-1 text-[22px] font-semibold tracking-tight">
        Prestige level {format(prestige)}
      </h2>
      <p className="mt-1 text-[14px] text-muted">
        Production is up {format(prestige)}% for good. You have <b className="font-medium text-ink">{format(chips)}</b>{" "}
        heavenly {chips === 1 ? "chip" : "chips"} to spend.
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {HEAVENLY.map((upgrade) => {
          const has = owned.split(" ").includes(upgrade.id);
          const affordable = chips >= upgrade.price;
          return (
            <li key={upgrade.id}>
              <button
                type="button"
                aria-disabled={has || !affordable}
                onClick={() => game.buyHeavenly(upgrade.id)}
                className="group flex h-full w-full gap-3 rounded-xl border border-faint/60 p-3 text-left transition-colors hover:border-ink aria-disabled:cursor-default aria-disabled:hover:border-faint/60"
              >
                <span aria-hidden className="text-[22px] leading-7 group-aria-disabled:opacity-60">
                  {upgrade.icon}
                </span>
                <span className="min-w-0 leading-snug">
                  <span className="block text-[14px] font-medium">{upgrade.name}</span>
                  <span className="block text-[12.5px] text-muted">{upgrade.effect}</span>
                  <span className={`mt-1 block text-[12.5px] tabular-nums ${has ? "text-muted" : affordable ? "text-accent" : "text-muted"}`}>
                    {has ? "Yours" : `${format(upgrade.price)} ${upgrade.price === 1 ? "chip" : "chips"}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex justify-end">
        <button type="button" className={primary} onClick={() => game.reincarnate()}>
          Start the next run
        </button>
      </div>
    </Modal>
  );
}
