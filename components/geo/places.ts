"use client";

import { useEffect, useState } from "react";
import { LookupError } from "@/lib/geo/errors";
import type { MapId } from "@/lib/geo/maps";
import { seededRandom, randomId } from "@/lib/geo/random";
import type { Metadata } from "@/lib/geo/streetview";
import type { Place } from "@/lib/geo/types";

export interface PlacesRequest {
  /** Requests with the same key share one search. */
  key: string;
  map: MapId;
  count: number;
  /** Fixes the places, for the daily; otherwise they're fresh every time. */
  seed?: string;
}

export interface PlacesState {
  places: Place[] | null;
  found: number;
  error: { message: string; denied: boolean } | null;
}

interface Search {
  promise: Promise<Place[]>;
  found: number;
  listeners: Set<(found: number) => void>;
  controller: AbortController;
}

const searches = new Map<string, Search>();

/** Asks the site's own server, which holds the key for Street View lookups. */
async function lookThroughServer(probes: [number, number, number][], signal?: AbortSignal): Promise<Metadata[]> {
  const response = await fetch("/api/geo/streetview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ probes }),
    signal,
  });
  const body = (await response.json().catch(() => null)) as { results?: Metadata[]; error?: string } | null;
  if (response.status === 503) throw new LookupError(body?.error ?? "street view lookups aren't set up on this site yet", true);
  if (!response.ok || !Array.isArray(body?.results) || body.results.length !== probes.length) {
    throw new Error(body?.error ?? `the server replied ${response.status}`);
  }
  return body.results;
}

/**
 * Starts looking for places, or joins a search already under way, so the
 * menu can start looking while you're still choosing and the game picks up
 * the result. The finder, and its 150 KB of towns, only load now.
 */
export function findPlacesFor(request: PlacesRequest): Search {
  const existing = searches.get(request.key);
  if (existing) return existing;
  const controller = new AbortController();
  const search: Search = { promise: Promise.resolve([]), found: 0, listeners: new Set(), controller };
  search.promise = (async () => {
    const { findPlaces } = await import("@/lib/geo/finder");
    return findPlaces({
      lookup: lookThroughServer,
      map: request.map,
      count: request.count,
      random: seededRandom(request.seed ?? randomId(16)),
      signal: controller.signal,
      onProgress: (found) => {
        search.found = found;
        for (const listener of search.listeners) listener(found);
      },
    });
  })();
  // A failed search is forgotten so the next attempt starts over.
  search.promise.catch(() => {
    if (searches.get(request.key) === search) searches.delete(request.key);
  });
  searches.set(request.key, search);
  return search;
}

/** Drops a finished or unwanted search, cancelling it if it's still going. */
export function forgetPlaces(key: string): void {
  const search = searches.get(key);
  if (!search) return;
  searches.delete(key);
  search.controller.abort();
}

function describe(error: unknown): PlacesState["error"] {
  if (error instanceof LookupError) return { message: error.message, denied: error.denied };
  return { message: "couldn't reach Google Street View", denied: false };
}

/** Follows a search in React. Pass null to follow nothing; bump `attempt` to try again after a failure. */
export function usePlaces(request: PlacesRequest | null, attempt = 0): PlacesState {
  const id = request ? `${request.key}#${attempt}` : null;
  const [state, setState] = useState<PlacesState & { id: string | null }>({ places: null, found: 0, error: null, id: null });
  const key = request?.key;
  const map = request?.map;
  const count = request?.count;
  const seed = request?.seed;

  useEffect(() => {
    if (!id || !key || !map || !count) return;
    let live = true;
    const search = findPlacesFor({ key, map, count, seed });
    const onFound = (found: number) => {
      if (live) setState((s) => (s.id === id ? { ...s, found } : { places: null, found, error: null, id }));
    };
    search.listeners.add(onFound);
    search.promise.then(
      (places) => {
        if (live) setState({ places, found: places.length, error: null, id });
      },
      (error: unknown) => {
        if (live && (error as Error)?.name !== "AbortError") setState({ places: null, found: 0, error: describe(error), id });
      },
    );
    return () => {
      live = false;
      search.listeners.delete(onFound);
    };
  }, [id, key, map, count, seed]);

  if (state.id === id) return state;
  return { places: null, found: key ? (searches.get(key)?.found ?? 0) : 0, error: null };
}
