"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { StormNow } from "@/lib/assassins";

/** Dark map with the safe zone (purple), where it's heading (dashed white) and you (gold). */
export default function StormMap({
  storm,
  me,
}: {
  storm: StormNow;
  me: { lat: number; lon: number } | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const zone = useRef<L.Circle | null>(null);
  const next = useRef<L.Circle | null>(null);
  const dot = useRef<L.CircleMarker | null>(null);
  const fitted = useRef<"zone" | "both" | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    // Leaflet needs a view before anything can be measured on it.
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([storm.lat, storm.lon], 15);
    // Free OpenStreetMap tiles, darkened with a CSS filter to match the game.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
      className: "storm-tiles",
    }).addTo(m);
    zone.current = L.circle([storm.lat, storm.lon], { radius: storm.r, color: "#9d5cff", weight: 3, fillColor: "#9d5cff", fillOpacity: 0.08 }).addTo(m);
    next.current = L.circle([0, 0], { radius: 1, color: "#ffffff", weight: 2, dashArray: "8 6", fill: false });
    dot.current = L.circleMarker([0, 0], { radius: 8, color: "#000", weight: 2, fillColor: "#ffc72e", fillOpacity: 1 });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !zone.current || !next.current || !dot.current) return;
    zone.current.setLatLng([storm.lat, storm.lon]).setRadius(storm.r);
    if (storm.next) {
      next.current.setLatLng([storm.next.lat, storm.next.lon]).setRadius(storm.next.r).addTo(m);
    } else {
      next.current.remove();
    }
    if (me) dot.current.setLatLng([me.lat, me.lon]).addTo(m);
    // Frame the zone, then reframe once to include you when GPS first comes in.
    if (!fitted.current || (fitted.current === "zone" && me)) {
      recenter();
      fitted.current = me ? "both" : "zone";
    }
  }, [storm.lat, storm.lon, storm.r, storm.next, me]);

  function zoneBounds() {
    return L.latLng(storm.lat, storm.lon).toBounds(storm.r * 2);
  }

  function recenter() {
    const m = map.current;
    if (!m || !zone.current) return;
    const bounds = zoneBounds();
    if (me) bounds.extend([me.lat, me.lon]);
    m.fitBounds(bounds, { padding: [20, 20] });
  }

  return (
    <div className="relative h-72 w-full overflow-hidden rounded-2xl border border-white/10">
      <div ref={el} className="h-full w-full" />
      <button
        onClick={recenter}
        className="absolute bottom-3 right-3 z-[500] rounded-full bg-black/70 px-3 py-1.5 text-xs font-bold"
      >
        Recenter
      </button>
    </div>
  );
}
