"use client";

import { useEffect, useState, type FocusEvent, type PointerEvent } from "react";
import { BUILDINGS } from "@/lib/cookie/buildings";
import * as engine from "@/lib/cookie/engine";
import { UPGRADE_BY_ID } from "@/lib/cookie/upgrades";
import { useCookieGame, useFormat, useGame } from "./context";
import { Segmented } from "./ui";

export function Shop() {
  return (
    <div className="space-y-6 px-4 py-4 select-none">
      <Upgrades />
      <Buildings />
    </div>
  );
}

const heading = "text-[12px] font-medium uppercase tracking-[0.08em] text-muted";

/* -------------------------------------------------------------- upgrades */

/** Enough to see what's next without pushing the buildings off the screen. */
const FIRST_UPGRADES = 5;

function Upgrades() {
  const ids = useGame((state) =>
    engine
      .availableUpgrades(state)
      .map((u) => u.id)
      .join(" "),
  );
  const [showAll, setShowAll] = useState(false);
  const list = ids ? ids.split(" ") : [];
  const shown = showAll ? list : list.slice(0, FIRST_UPGRADES);

  return (
    <section aria-labelledby="upgrades-heading">
      <h2 id="upgrades-heading" tabIndex={-1} className={`${heading} outline-none`}>
        Upgrades
      </h2>
      {list.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">Nothing new yet. Upgrades turn up here as you go.</p>
      ) : (
        <>
          <ul className="mt-2 space-y-1">
            {shown.map((id) => (
              <UpgradeRow key={id} id={id} />
            ))}
          </ul>
          {list.length > FIRST_UPGRADES && (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="mt-2 text-[12.5px] text-muted underline decoration-faint underline-offset-4 hover:text-ink hover:decoration-accent"
            >
              {showAll ? "Show fewer" : `Show all ${list.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function UpgradeRow({ id }: { id: string }) {
  const game = useCookieGame();
  const format = useFormat();
  const upgrade = UPGRADE_BY_ID.get(id)!;
  const price = useGame((state) => engine.upgradePrice(state, upgrade));
  const affordable = useGame((state) => state.run.cookies >= engine.upgradePrice(state, upgrade));
  return (
    <li>
      <button
        type="button"
        aria-disabled={!affordable}
        aria-label={`${upgrade.name}. ${upgrade.effect} Costs ${format(price)} cookies.`}
        title={upgrade.quote}
        onClick={(event) => {
          // A bought upgrade leaves the list, so focus moves on to its neighbour
          // rather than dropping back to the top of the page.
          const button = event.currentTarget;
          const item = button.closest("li");
          const next = (item?.nextElementSibling ?? item?.previousElementSibling)?.querySelector("button");
          const focused = document.activeElement === button;
          if (game.buyUpgrade(id) && focused) {
            requestAnimationFrame(() => (next?.isConnected ? next : document.getElementById("upgrades-heading"))?.focus());
          }
        }}
        className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-ink/5 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
      >
        <span aria-hidden className="w-8 shrink-0 text-center text-[22px] group-aria-disabled:opacity-50">
          {upgrade.icon}
        </span>
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block text-[14px] text-ink group-aria-disabled:text-muted">{upgrade.name}</span>
          <span className="block text-[12.5px] text-muted">{upgrade.effect}</span>
        </span>
        <span
          className={`shrink-0 text-[13px] tabular-nums ${affordable ? "text-accent" : "text-muted"}`}
        >
          {format(price)}
        </span>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------- buildings */

type Mode = "buy" | "sell";

interface HoverEvents {
  onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerLeave: () => void;
  onFocus: (event: FocusEvent<HTMLButtonElement>) => void;
  onBlur: () => void;
}

function Buildings() {
  const game = useCookieGame();
  const bulk = useGame((state) => state.settings.bulk);
  const [mode, setMode] = useState<Mode>("buy");
  const [sellAll, setSellAll] = useState(false);
  const [hovered, setHovered] = useState<{ index: number; top: number; left: number } | null>(null);
  // Everything up to the furthest building the player could have, then one mystery.
  const shown = useGame((state) => {
    let last = -1;
    BUILDINGS.forEach((_, i) => {
      if (engine.buildingVisible(state, i)) last = i;
    });
    return last + 1;
  });
  const amount = mode === "sell" && sellAll ? Number.MAX_SAFE_INTEGER : bulk;

  const hover = (index: number): HoverEvents => ({
    onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "touch") return;
      const rect = event.currentTarget.getBoundingClientRect();
      setHovered({ index, top: rect.top + rect.height / 2, left: rect.left });
    },
    onPointerLeave: () => setHovered(null),
    onFocus: (event: FocusEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.matches(":focus-visible")) return;
      const rect = event.currentTarget.getBoundingClientRect();
      setHovered({ index, top: rect.top + rect.height / 2, left: rect.left });
    },
    onBlur: () => setHovered(null),
  });

  return (
    <section aria-labelledby="buildings-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="buildings-heading" className={heading}>
          Buildings
        </h2>
        <div className="flex gap-1.5">
          <Segmented
            label="Buy or sell"
            value={mode}
            options={[
              { value: "buy", label: "buy" },
              { value: "sell", label: "sell" },
            ]}
            onChange={(next) => {
              setMode(next);
              setSellAll(false);
            }}
          />
          <Segmented
            label="How many"
            value={mode === "sell" && sellAll ? "all" : bulk}
            options={[
              { value: 1, label: "1" },
              { value: 10, label: "10" },
              { value: 100, label: "100" },
              ...(mode === "sell" ? [{ value: "all" as const, label: "all" }] : []),
            ]}
            onChange={(next) => {
              if (next === "all") {
                setSellAll(true);
              } else {
                setSellAll(false);
                game.setSettings({ bulk: next });
              }
            }}
          />
        </div>
      </div>
      <ul className="mt-2 space-y-1" onMouseLeave={() => setHovered(null)}>
        {BUILDINGS.slice(0, shown).map((building, index) => (
          <BuildingRow key={building.id} index={index} mode={mode} amount={amount} events={hover(index)} />
        ))}
        {shown < BUILDINGS.length && <MysteryRow index={shown} />}
      </ul>
      {hovered && <BuildingTooltip {...hovered} onClose={() => setHovered(null)} />}
    </section>
  );
}

function BuildingRow({
  index,
  mode,
  amount,
  events,
}: {
  index: number;
  mode: Mode;
  amount: number;
  events: HoverEvents;
}) {
  const game = useCookieGame();
  const format = useFormat();
  const building = BUILDINGS[index];
  const owned = useGame((state) => state.run.owned[index]);
  const count = mode === "sell" ? Math.min(owned, amount) : amount;
  const price = useGame((state) =>
    mode === "buy" ? engine.buildingPrice(state, index, amount) : engine.sellValue(state, index, amount),
  );
  const possible = useGame((state) =>
    mode === "buy" ? state.run.cookies >= engine.buildingPrice(state, index, amount) : state.run.owned[index] > 0,
  );
  const making = useGame((state, g) => state.run.owned[index] * g.production().each[index]);
  const label =
    mode === "buy"
      ? `Buy ${count === 1 ? `a ${building.single}` : `${format(count)} ${building.plural}`} for ${format(price)} cookies.`
      : owned > 0
        ? `Sell ${count === 1 ? `a ${building.single}` : `${format(count)} ${building.plural}`} for ${format(price)} cookies.`
        : `No ${building.plural} to sell.`;

  return (
    <li>
      <button
        type="button"
        aria-disabled={!possible}
        aria-label={`${building.name}, ${format(owned)} owned. ${label}`}
        onClick={() => (mode === "buy" ? game.buyBuilding(index, amount) : game.sellBuilding(index, amount))}
        className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-ink/5 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
        {...events}
      >
        <span aria-hidden className="w-9 shrink-0 text-center text-[26px] leading-none group-aria-disabled:opacity-60">
          {building.icon}
        </span>
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block truncate text-[15px] text-ink group-aria-disabled:text-muted">
            {building.name}
            {count > 1 && <span className="text-muted"> ×{format(count)}</span>}
          </span>
          <span className={`block text-[13px] tabular-nums ${possible ? "text-accent" : "text-muted"}`}>
            {mode === "sell" ? "+" : ""}
            {format(price)}
          </span>
        </span>
        <span className="shrink-0 text-right leading-tight">
          <span className={`block text-[22px] tabular-nums ${owned > 0 ? "text-ink" : "text-faint"}`}>{format(owned)}</span>
          {making > 0 && (
            <span className="block text-[11.5px] text-muted tabular-nums">{format(making, { decimal: true })}/s</span>
          )}
        </span>
      </button>
    </li>
  );
}

function MysteryRow({ index }: { index: number }) {
  const format = useFormat();
  const building = BUILDINGS[index];
  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-2 opacity-55">
      <span className="sr-only">Something new, for {format(building.price)} cookies.</span>
      <span aria-hidden className="w-9 shrink-0 text-center text-[26px] leading-none brightness-0 opacity-25 dark:invert">
        {building.icon}
      </span>
      <span className="min-w-0 flex-1 leading-snug" aria-hidden>
        <span className="block text-[15px] text-muted">???</span>
        <span className="block text-[13px] text-muted tabular-nums">{format(building.price)}</span>
      </span>
    </li>
  );
}

/* --------------------------------------------------------------- tooltip */

function BuildingTooltip({ index, top, left, onClose }: { index: number; top: number; left: number; onClose: () => void }) {
  const format = useFormat();
  // It's pinned to where the row was, so it goes as soon as anything scrolls.
  useEffect(() => {
    window.addEventListener("scroll", onClose, true);
    return () => window.removeEventListener("scroll", onClose, true);
  }, [onClose]);
  const building = BUILDINGS[index];
  const owned = useGame((state) => state.run.owned[index]);
  const each = useGame((_, game) => game.production().each[index]);
  const total = useGame((_, game) => game.production().total);
  const produced = useGame((state) => state.run.produced[index]);
  const share = total > 0 ? ((each * owned) / total) * 100 : 0;
  const clampedTop = Math.min(Math.max(top, 110), window.innerHeight - 110);

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-30 hidden w-72 -translate-x-full -translate-y-1/2 rounded-xl border border-faint/60 bg-paper p-4 text-[13px] leading-relaxed shadow-xl md:block"
      style={{ top: clampedTop, left: left - 12 }}
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-medium text-ink">
          <span aria-hidden>{building.icon}</span> {building.name}
        </span>
        <span className="text-muted">{format(owned)} owned</span>
      </p>
      <p className="mt-1 text-muted">{building.desc}</p>
      <ul className="mt-2 space-y-1 text-ink">
        <li>
          Each {building.single} makes <b className="font-medium">{format(each, { decimal: true })}</b> cookies a second.
        </li>
        {owned > 0 && (
          <>
            <li>
              {format(owned)} {owned === 1 ? building.single : building.plural} make{" "}
              <b className="font-medium">{format(each * owned, { decimal: true })}</b> a second,{" "}
              {share < 0.1 ? "under 0.1" : Math.round(share * 10) / 10}% of the total.
            </li>
            <li>
              <b className="font-medium">{format(produced)}</b> baked so far this run.
            </li>
          </>
        )}
      </ul>
    </div>
  );
}
