"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { wrapLongitude } from "@/lib/geo/earth";
import type { LatLng } from "@/lib/geo/types";
import styles from "./geo.module.css";

/**
 * The flat maps: the one you guess on and the one that shows how you did.
 * Leaflet with raster tiles rather than a WebGL map, because Street View is
 * already using the graphics chip, and the laptops this gets played on have
 * the integrated kind.
 */

const CARTO = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const CARTO_CREDIT =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';
const OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_CREDIT = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

export type Bounds = [south: number, west: number, north: number, east: number];

const toBounds = ([south, west, north, east]: Bounds) => L.latLngBounds([south, west], [north, east]);

/** A map with CARTO's tiles, falling back to OpenStreetMap's if a school network blocks CARTO. */
function createMap(element: HTMLElement): L.Map {
  const map = L.map(element, {
    zoomControl: false,
    worldCopyJump: true,
    minZoom: 0,
    maxZoom: 18,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90,
    fadeAnimation: false,
  });
  map.attributionControl.setPrefix(false);
  L.control.zoom({ position: "topleft", zoomInTitle: "Zoom in", zoomOutTitle: "Zoom out" }).addTo(map);

  let loaded = 0;
  let failed = 0;
  const primary = L.tileLayer(CARTO, { subdomains: "abcd", maxZoom: 19, attribution: CARTO_CREDIT });
  primary.on("tileload", () => loaded++);
  primary.on("tileerror", () => {
    if (++failed < 4 || loaded > 0 || !map.hasLayer(primary)) return;
    map.removeLayer(primary);
    L.tileLayer(OSM, { maxZoom: 19, attribution: OSM_CREDIT }).addTo(map);
  });
  primary.addTo(map);
  return map;
}

/** Keeps a Leaflet map sized to its box as the box grows and shrinks. */
function follow(map: L.Map, element: HTMLElement): () => void {
  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    // Keep the same spot in the middle as the box grows, the way the corner map grows under the mouse.
    frame = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
  });
  observer.observe(element);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}

function pinIcon(color: string) {
  return L.divIcon({
    className: styles.pin,
    html: `<span style="--pin:${color}"></span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/* ------------------------------------------------------------- guess */

export function GuessMap({
  bounds,
  pin,
  onPin,
  disabled = false,
  label = "Map: click to place your guess",
}: {
  bounds: Bounds;
  pin: LatLng | null;
  onPin: (point: LatLng) => void;
  disabled?: boolean;
  label?: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const latest = useRef({ onPin, disabled });
  const frame = useRef(bounds);

  useEffect(() => {
    latest.current = { onPin, disabled };
  });

  useEffect(() => {
    const box = element.current!;
    const leaflet = createMap(box);
    leaflet.fitBounds(toBounds(frame.current), { animate: false });
    leaflet.on("click", (event: L.LeafletMouseEvent) => {
      if (latest.current.disabled) return;
      latest.current.onPin({ lat: event.latlng.lat, lng: wrapLongitude(event.latlng.lng) });
    });
    map.current = leaflet;
    const stop = follow(leaflet, box);
    return () => {
      stop();
      leaflet.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    const leaflet = map.current;
    if (!leaflet) return;
    if (!pin) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    // Put the pin on the copy of the world being looked at, not always the middle one.
    const center = leaflet.getCenter().lng;
    const at = L.latLng(pin.lat, center + wrapLongitude(pin.lng - center));
    if (marker.current) marker.current.setLatLng(at);
    else marker.current = L.marker(at, { icon: pinIcon("#b7502f"), keyboard: false, interactive: false }).addTo(leaflet);
  }, [pin]);

  // `isolate` keeps Leaflet's stacked panes from rising above whatever is drawn over the map.
  return <div ref={element} role="application" aria-label={label} className={`${styles.map} isolate h-full w-full`} />;
}

/* ------------------------------------------------------------ result */

export interface ResultPin extends LatLng {
  color: string;
  /** One or two letters shown on the pin. */
  label: string;
  mine?: boolean;
  title: string;
}

export interface ResultRound {
  answer: LatLng;
  /** Shown on the answer marker when several rounds are on one map. */
  label?: string;
  guesses: ResultPin[];
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Where it was and where everyone guessed, with a line between. A guess on
 * the far side of the date line is drawn on the neighbouring copy of the
 * world, so the line takes the short way round.
 */
export function ResultMap({
  rounds,
  padding = [40, 40, 40, 40],
  label = "Map of the answer and the guesses",
}: {
  rounds: ResultRound[];
  /** Space to keep clear, top, right, bottom, left, for whatever sits on top of the map. */
  padding?: [number, number, number, number];
  label?: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const box = element.current!;
    const leaflet = createMap(box);
    leaflet.setView([20, 0], 2);
    layer.current = L.layerGroup().addTo(leaflet);
    map.current = leaflet;
    const stop = follow(leaflet, box);
    return () => {
      stop();
      leaflet.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  const [top, right, bottom, left] = padding;
  const drawn = JSON.stringify(rounds);

  useEffect(() => {
    const leaflet = map.current;
    const group = layer.current;
    if (!leaflet || !group) return;
    group.clearLayers();
    const points: L.LatLng[] = [];
    for (const round of JSON.parse(drawn) as ResultRound[]) {
      const answer = L.latLng(round.answer.lat, round.answer.lng);
      points.push(answer);
      for (const guess of round.guesses) {
        const at = L.latLng(guess.lat, answer.lng + wrapLongitude(guess.lng - answer.lng));
        points.push(at);
        L.polyline([at, answer], { color: guess.color, weight: guess.mine ? 3 : 2, opacity: 0.85, dashArray: "6 6", interactive: false }).addTo(group);
        L.marker(at, {
          icon: L.divIcon({
            className: `${styles.guess} ${guess.mine ? styles.mine : ""}`,
            html: `<span style="--pin:${guess.color}">${escape(guess.label)}</span>`,
            iconSize: [0, 0],
          }),
          title: guess.title,
          alt: guess.title,
          keyboard: false,
          zIndexOffset: guess.mine ? 500 : 0,
        }).addTo(group);
      }
      L.marker(answer, {
        icon: L.divIcon({
          className: styles.answer,
          html: `<span></span>${round.label ? `<b>${escape(round.label)}</b>` : ""}`,
          iconSize: [0, 0],
        }),
        title: "Where it was",
        alt: "Where it was",
        keyboard: false,
        zIndexOffset: 1000,
      }).addTo(group);
    }
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points);
    const options = { paddingTopLeft: L.point(left, top), paddingBottomRight: L.point(right, bottom), maxZoom: 14, animate: false };
    // Leaflet can't fit a box it hasn't measured yet; wait a frame for the layout.
    const frame = requestAnimationFrame(() => {
      leaflet.invalidateSize({ animate: false });
      if (points.length === 1 || bounds.getNorthEast().equals(bounds.getSouthWest())) leaflet.setView(points[0], 12, { animate: false });
      else leaflet.fitBounds(bounds, options);
    });
    return () => cancelAnimationFrame(frame);
  }, [drawn, top, right, bottom, left]);

  return <div ref={element} role="img" aria-label={label} className={`${styles.map} isolate h-full w-full`} />;
}
