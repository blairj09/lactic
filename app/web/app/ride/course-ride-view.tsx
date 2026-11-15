"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as MapLibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { STEP, type CourseProfile } from "@/lib/engine/course/profile";
import { climbAhead, elevationAt, gradeAt, placeAt, roadAhead, type CourseRideState, type CourseSection } from "@/lib/ride/course-ride";
import { TERRAIN_TILES, imageryFor } from "@/lib/course-imagery";
import { distanceIn, distanceUnit, elevationIn, elevationUnit, speedIn, speedUnit, type UnitSystem } from "@/lib/units";
import { useUnits } from "@/lib/use-units";

/** Where the camera sits: behind and above the rider, or at the rider's eye. */
export type CourseCamera = "chase" | "rider";

const CAMERA_PREF = "ride.courseCamera";
const AHEAD_SPAN = 2000;

/** A point `meters` from another along a compass bearing; fine over the few hundred meters used here. */
function offset(lat: number, lng: number, bearing: number, meters: number): [number, number] {
  const r = Math.PI / 180;
  const dLat = (meters * Math.cos(bearing * r)) / 111320;
  const dLng = (meters * Math.sin(bearing * r)) / (111320 * Math.cos(lat * r));
  return [lng + dLng, lat + dLat];
}

/** Grade colors, easy to steep, the same steps a head unit's climb screen uses. */
export function gradeColor(grade: number): string {
  const g = grade * 100;
  if (g < -1) return "#5b9bd5";
  if (g < 2) return "#4caf7d";
  if (g < 5) return "#e0b93b";
  if (g < 8) return "#e8853a";
  return "#d6453d";
}

function sectionLine(profile: CourseProfile, from: number, to: number): [number, number][] {
  const a = Math.max(0, Math.floor(from / STEP));
  const b = Math.min(profile.lat.length - 1, Math.ceil(to / STEP));
  const out: [number, number][] = [];
  for (let i = a; i <= b; i++) out.push([profile.lng[i], profile.lat[i]]);
  return out;
}

const line = (coordinates: [number, number][]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } });
const point = (coordinates: [number, number]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates } });

/**
 * The course in 3D as you ride it: real terrain with aerial imagery over it, the road drawn on, and
 * the camera following where your power has taken you. Over it: the grade now, the climb you're on
 * and the next stretch of road.
 */
export default function CourseRideView({
  profile,
  section,
  state,
  running,
  eventName,
}: {
  profile: CourseProfile;
  section: CourseSection;
  /** How far into the section the ride is, and how fast; updated each second. */
  state: CourseRideState;
  running: boolean;
  eventName: string;
}) {
  const units = useUnits();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [camera, setCamera] = useState<CourseCamera>(() => {
    try {
      return localStorage.getItem(CAMERA_PREF) === "rider" ? "rider" : "chase";
    } catch {
      return "chase";
    }
  });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  // The frame loop reads the latest ride through refs, and glides between the once-a-second updates.
  const target = useRef({ meters: state.meters, speed: state.speed, at: 0, running });
  const shown = useRef(state.meters);
  useEffect(() => {
    target.current = { meters: state.meters, speed: state.speed, at: performance.now(), running };
  }, [state.meters, state.speed, running]);

  useEffect(() => {
    let cancelled = false;
    let made: MapLibre.Map | undefined;
    let frame = 0;
    import("maplibre-gl")
      .then(({ default: maplibre }) => {
        if (cancelled || !box.current) return;
        const start = placeAt(profile, section.from);
        const imagery = imageryFor(start.lat, start.lng);
        made = new maplibre.Map({
          container: box.current,
          interactive: false,
          attributionControl: { compact: true },
          maxPitch: 85,
          center: [start.lng, start.lat],
          zoom: 14,
          style: {
            version: 8,
            sources: {
              imagery: { type: "raster", tiles: [imagery.tiles], tileSize: 256, maxzoom: imagery.maxZoom, attribution: imagery.attribution },
              terrain: { type: "raster-dem", tiles: [TERRAIN_TILES.tiles], encoding: "terrarium", tileSize: 256, maxzoom: TERRAIN_TILES.maxZoom, attribution: TERRAIN_TILES.attribution },
              course: { type: "geojson", data: line(sectionLine(profile, 0, profile.meters)) },
              section: { type: "geojson", data: line(sectionLine(profile, section.from, section.to)) },
              rider: { type: "geojson", data: point([start.lng, start.lat]) },
              finish: { type: "geojson", data: point(sectionLine(profile, section.to, section.to)[0]) },
            },
            layers: [
              // The land without imagery (offline, or a tile that hasn't come): still the terrain's shape, never blank.
              { id: "land", type: "background", paint: { "background-color": "#8a9478" } },
              { id: "imagery", type: "raster", source: "imagery", paint: { "raster-fade-duration": 200 } },
              { id: "course", type: "line", source: "course", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 3, "line-opacity": 0.55 } },
              { id: "section-case", type: "line", source: "section", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 } },
              { id: "section", type: "line", source: "section", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2b55d6", "line-width": 5 } },
              { id: "finish", type: "circle", source: "finish", paint: { "circle-radius": 7, "circle-color": "#b8232a", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-pitch-alignment": "map" } },
              { id: "rider", type: "circle", source: "rider", paint: { "circle-radius": 9, "circle-color": "#2b55d6", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3, "circle-pitch-alignment": "map" } },
            ],
            terrain: { source: "terrain", exaggeration: 1 },
            sky: { "sky-color": "#8fb8e8", "horizon-color": "#dfe9f2", "fog-color": "#dfe9f2", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.2, "atmosphere-blend": 0.5 },
          },
        });
        mapRef.current = made;
        made.on("error", () => undefined);
        made.once("load", () => {
          if (cancelled) return;
          // Credits stay a tap away rather than spread over the view.
          box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
          setReady(true);
        });

        let last = performance.now();
        let drawn = "";
        const draw = (now: number) => {
          frame = requestAnimationFrame(draw);
          const map = made;
          if (!map) return;
          const dt = Math.min(0.25, (now - last) / 1000);
          last = now;
          const t = target.current;
          const length = section.to - section.from;
          // Between updates, carry on at the last speed (for at most a second and a half).
          const guess = t.running ? Math.min(length, t.meters + t.speed * Math.min(1.5, (now - t.at) / 1000)) : t.meters;
          shown.current += (guess - shown.current) * Math.min(1, dt * 4);
          // Standing still, there's nothing new to draw.
          const key = `${cameraRef.current}:${shown.current.toFixed(1)}`;
          if (key === drawn) return;
          drawn = key;
          const at = section.from + shown.current;
          const here = placeAt(profile, at);
          const ground = elevationAt(profile, at);
          // The camera follows the road itself, so it swings through bends the way you do.
          const rider = cameraRef.current === "rider";
          const back = rider ? 12 : 260;
          const front = rider ? 150 : 100;
          const behind = placeAt(profile, Math.max(0, at - back));
          const ahead = placeAt(profile, Math.min(profile.meters, at + front));
          const from: [number, number] = at - back < 0 ? offset(here.lat, here.lng, here.bearing + 180, back) : [behind.lng, behind.lat];
          const fromGround = Math.max(elevationAt(profile, Math.max(0, at - back)), ground - 40);
          const to: [number, number] = at + front > profile.meters ? offset(here.lat, here.lng, here.bearing, front) : [ahead.lng, ahead.lat];
          const toGround = elevationAt(profile, Math.min(profile.meters, at + front));
          const view = map.calculateCameraOptionsFromTo(new maplibre.LngLat(from[0], from[1]), fromGround + (rider ? 4 : 90), new maplibre.LngLat(to[0], to[1]), toGround + (rider ? 2 : 0));
          map.jumpTo(view);
          // From the saddle you don't see yourself.
          if (map.getLayer("rider")) map.setPaintProperty("rider", "circle-opacity", rider ? 0 : 1);
          if (map.getLayer("rider")) map.setPaintProperty("rider", "circle-stroke-opacity", rider ? 0 : 1);
          (map.getSource("rider") as MapLibre.GeoJSONSource | undefined)?.setData(point([here.lng, here.lat]));
        };
        frame = requestAnimationFrame(draw);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      made?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [profile, section]);

  const pickCamera = (next: CourseCamera) => {
    setCamera(next);
    try {
      localStorage.setItem(CAMERA_PREF, next);
    } catch {}
  };

  const at = section.from + state.meters;
  const length = section.to - section.from;
  const grade = gradeAt(profile, at);
  const climb = climbAhead(profile, section, state.meters);
  const done = state.meters >= length;

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-[#8a9478]" data-course-ride>
      <div ref={box} className="h-[46vh] min-h-72 w-full" aria-label={`3D view of ${section.name}, ${eventName}`} />
      {failed && <p className="absolute inset-0 grid place-items-center bg-raised text-sm text-muted">The 3D view couldn&apos;t start here. The trainer still follows the course.</p>}

      {/* Over the view: where you are, the grade, and the camera. Dark glass so it reads on any imagery. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="rounded-lg bg-black/55 px-3 py-2 text-white backdrop-blur-sm">
          <div className="text-xs opacity-80">
            {eventName} · {section.name}
          </div>
          <div className="num text-sm font-medium">
            {done ? "Done" : `${distanceIn(length - state.meters, units).toFixed(1)} ${distanceUnit(units)} to go`}
            <span className="opacity-70">
              {" "}
              · {speedIn(state.speed, units).toFixed(1)} {speedUnit(units)}
            </span>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="pointer-events-auto flex overflow-hidden rounded-lg bg-black/55 text-xs text-white backdrop-blur-sm" role="group" aria-label="Camera">
            {(["chase", "rider"] as const).map((c) => (
              <button key={c} type="button" aria-pressed={camera === c} className={`px-2.5 py-1.5 ${camera === c ? "bg-white/25 font-medium" : "opacity-80 hover:opacity-100"}`} onClick={() => pickCamera(c)}>
                {c === "chase" ? "Above" : "Road"}
              </button>
            ))}
          </div>
          <div className="num rounded-lg px-3 py-1.5 text-right text-white" style={{ background: gradeColor(grade) }}>
            <div className="text-2xl leading-none font-semibold">{(grade * 100).toFixed(1)}%</div>
            <div className="text-[10px] tracking-wide uppercase opacity-90">Grade</div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-9 p-3">
        <div className="rounded-lg bg-black/55 px-3 pt-2 pb-1.5 text-white backdrop-blur-sm">
          <div className="num mb-1 flex items-baseline justify-between text-xs">
            <span>{climbLine(climb, units)}</span>
            <span className="opacity-70">
              Next {distanceIn(AHEAD_SPAN, units).toFixed(1)} {distanceUnit(units)}
            </span>
          </div>
          <RoadAhead profile={profile} section={section} meters={state.meters} />
        </div>
      </div>
      {!ready && !failed && <p className="absolute inset-0 grid place-items-center text-sm text-white/90">Loading the course…</p>}
    </div>
  );
}

function climbLine(climb: ReturnType<typeof climbAhead>, units: UnitSystem): string {
  if (!climb) return "No climbs left";
  const d = (m: number) => `${distanceIn(m, units).toFixed(1)} ${distanceUnit(units)}`;
  if (climb.toStart > 0) return `Climb ${climb.n} in ${d(climb.toStart)}`;
  return `Climb ${climb.n} · ${d(climb.toTop)} to the top · ${Math.round(elevationIn(climb.gainLeft, units))} ${elevationUnit(units)} · ${(climb.grade * 100).toFixed(1)}%`;
}

/** The next stretch of road as a profile, each piece colored by its grade. */
function RoadAhead({ profile, section, meters }: { profile: CourseProfile; section: CourseSection; meters: number }) {
  const W = 600;
  const H = 44;
  const bars = useMemo(() => {
    // Redrawn every 25 m, not every frame.
    const from = Math.floor(meters / 25) * 25;
    const ele = roadAhead(profile, section, from, AHEAD_SPAN, 50);
    const lo = Math.min(...ele);
    const hi = Math.max(lo + 30, ...ele);
    const y = (e: number) => H - 4 - ((e - lo) / (hi - lo)) * (H - 8);
    const w = W / (ele.length - 1);
    return ele.slice(0, -1).map((e, i) => ({
      d: `M${i * w},${H} L${i * w},${y(e)} L${(i + 1) * w + 0.5},${y(ele[i + 1])} L${(i + 1) * w + 0.5},${H} Z`,
      fill: gradeColor((ele[i + 1] - e) / 50),
    }));
  }, [profile, section, Math.floor(meters / 25)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-11 w-full" role="img" aria-label="The road ahead">
      {bars.map((b, i) => (
        <path key={i} d={b.d} fill={b.fill} />
      ))}
    </svg>
  );
}
