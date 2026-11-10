"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { routeBetween, type Route } from "@/lib/engine/ride-detail";
import type { Span } from "./ride-chart";

/**
 * The ride's GPS track on OpenStreetMap. A chart zoom (`zoom`) is drawn bold over a faded route and
 * the map fits to it; `selecting` (a span still being dragged on the chart) is drawn the same way
 * without moving the map; `highlight` (a best effort) is drawn over both. Scrolling over the map
 * zooms it.
 */
export default function RouteMap(props: { route: Route; zoom: Span | null; selecting?: Span | null; highlight: Span | null }) {
  return (
    <MapBoundary>
      <LiveMap {...props} />
    </MapBoundary>
  );
}

/** A map is a nice-to-have: if Leaflet ever throws, show a note in its place instead of taking down the ride page. */
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Route map failed", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-80 w-full flex-col items-center justify-center gap-3 rounded-md bg-raised text-sm text-muted sm:h-96">
        <p>The map couldn&apos;t be drawn.</p>
        <button type="button" className="h-8 rounded-md border border-line px-3 text-ink" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}

type Live = { L: typeof Leaflet; map: Leaflet.Map; line: Leaflet.Polyline; gone: boolean };

/** Runs `draw` against the map only while it is still on the page; a Leaflet error is logged, not thrown. */
function safely<T>(live: Live | null, draw: (live: Live) => T): T | undefined {
  if (!live || live.gone) return undefined;
  try {
    return draw(live);
  } catch (e) {
    console.error("Route map", e);
    return undefined;
  }
}

function LiveMap({
  route: given,
  zoom,
  selecting = null,
  highlight,
}: {
  route: Route;
  zoom: Span | null;
  selecting?: Span | null;
  highlight: Span | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Live | null>(null);
  // The page reloads its data (and hands over a fresh route array) whenever anything is saved; keep the
  // same map unless the track itself changed.
  const sig = routeSig(given);
  const route = useMemo(() => given, [sig]);

  useEffect(() => {
    let live: Live | undefined;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      const made = L.map(box.current, { scrollWheelZoom: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(made);
      const points = route.map((p) => [p[0], p[1]] as [number, number]);
      const line = L.polyline(points, { color: cssColor("--accent", "#2b55d6"), weight: 4, opacity: 0.9 }).addTo(made);
      L.circleMarker(points[0], { radius: 6, color: "#ffffff", weight: 2, fillColor: "#247b50", fillOpacity: 1 }).bindTooltip("Start").addTo(made);
      L.circleMarker(points[points.length - 1], { radius: 6, color: "#ffffff", weight: 2, fillColor: "#b8232a", fillOpacity: 1 }).bindTooltip("Finish").addTo(made);
      made.fitBounds(line.getBounds(), { padding: [24, 24], animate: false });
      live = { L, map: made, line, gone: false };
      setMap(live);
    }).catch((e) => console.error("Route map", e));
    return () => {
      cancelled = true;
      // Mark it gone first: the other effects can still run once with this map before the state clears.
      if (live) {
        live.gone = true;
        const m = live.map;
        try {
          m.stop();
          m.remove();
        } catch (e) {
          console.error("Route map", e);
        }
      }
      setMap(null);
    };
  }, [route]);

  // The zoomed part and the best effort, redrawn (and the map refitted) whenever either changes.
  useEffect(() => {
    const layers = safely(map, ({ L, map: m, line }) => {
      const zoomed = zoom ? routeBetween(route, zoom[0], zoom[1]) : [];
      const drawn = zoomed.length > 1 ? section(L, zoomed, cssColor("--accent", "#2b55d6")) : [];
      const effort = highlight ? routeBetween(route, highlight[0], highlight[1]) : [];
      if (effort.length > 1) drawn.push(...section(L, effort, cssColor("--warning", "#8f3f0c"), 7));
      drawn.forEach((l) => l.addTo(m));
      const focus = effort.length > 1 ? effort : zoomed.length > 1 ? zoomed : null;
      m.stop();
      m.fitBounds(focus ? L.latLngBounds(focus) : line.getBounds(), { padding: [32, 32], maxZoom: 16 });
      return drawn;
    });
    return () => clear(map, layers);
  }, [map, route, zoom, highlight]);

  // The span being dragged, drawn live; the map stays put until the drag ends.
  useEffect(() => {
    const layers = safely(map, ({ L, map: m }) => {
      const dragged = selecting ? routeBetween(route, selecting[0], selecting[1]) : [];
      const drawn = dragged.length > 1 ? section(L, dragged, cssColor("--accent", "#2b55d6")) : [];
      drawn.forEach((l) => l.addTo(m));
      return drawn;
    });
    return () => clear(map, layers);
  }, [map, route, selecting]);

  // Fade the rest of the route while any part of it is picked out.
  useEffect(() => {
    safely(map, ({ line }) => {
      const picked = [zoom, selecting].some((span) => span && routeBetween(route, span[0], span[1]).length > 1);
      line.setStyle({ opacity: picked ? 0.25 : 0.9, weight: picked ? 3 : 4 });
    });
  }, [map, route, zoom, selecting]);

  const timed = route.some((p) => p.length === 3);
  return (
    <div className="space-y-2">
      <div ref={box} className="relative z-0 h-80 w-full overflow-hidden rounded-md bg-raised sm:h-96" role="img" aria-label="Map of the ride's route" />
      {!timed && (zoom || selecting || highlight) && <p className="text-sm text-muted">This route has no timing, so it can&apos;t show that part. Re-import the ride to add it.</p>}
    </div>
  );
}

/** Same track, same signature: length plus the first, middle and last points. */
function routeSig(route: Route): string {
  const at = (i: number) => route[i]?.join(",") ?? "";
  return `${route.length}|${at(0)}|${at(route.length >> 1)}|${at(route.length - 1)}`;
}

function clear(map: Live | null, layers: Leaflet.Layer[] | undefined) {
  if (!layers?.length) return;
  safely(map, () => layers.forEach((l) => l.remove()));
}

const cssColor = (token: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;

/** A picked-out part of the route: a white casing under a bold line, so it stands out on any tiles. */
function section(L: typeof Leaflet, points: [number, number][], color: string, weight = 6): Leaflet.Layer[] {
  return [
    L.polyline(points, { color: "#ffffff", weight: weight + 4, opacity: 0.9, interactive: false }),
    L.polyline(points, { color, weight, opacity: 1, interactive: false }),
  ];
}
