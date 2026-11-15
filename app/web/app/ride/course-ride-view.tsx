"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as MapLibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { STEP, type CourseProfile } from "@/lib/engine/course/profile";
import { climbAhead, elevationAt, gradeAt, placeAt, roadAhead, type CourseRideState, type CourseSection } from "@/lib/ride/course-ride";
import { FEATURE_TILES, TERRAIN_TILES } from "@/lib/course-imagery";
import { LANDSCAPE_LOOKS, PALETTES, doubleHeights, metersPerPixel, paintLandscape, terrariumHeights, tileLat, type LandscapeLook } from "@/lib/ride/landscape";
import { distanceIn, distanceUnit, elevationIn, elevationUnit, speedIn, speedUnit, type UnitSystem } from "@/lib/units";
import { useUnits } from "@/lib/use-units";

/** Where the camera sits: behind and above the rider, or at the rider's eye. */
export type CourseCamera = "chase" | "rider";

const CAMERA_PREF = "ride.courseCamera";
const LOOK_PREF = "ride.courseLook";
const LAND = "lactic-land";

/**
 * Lactic's landscape tiles: `lactic-land://<look>/<low>/<high>/<z>/<x>/<y>` fetches that tile's
 * heights and paints them (lib/ride/landscape), so the land is drawn here, on the rider's computer.
 */
async function landTile(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const [look, low, high, z, x, y] = url.slice(`${LAND}://`.length).split("/");
  const res = await fetch(TERRAIN_TILES.tiles.replace("{z}", z).replace("{x}", x).replace("{y}", y), { signal });
  if (!res.ok) throw new Error(`Terrain tile ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const size = bitmap.width;
  const read = new OffscreenCanvas(size, size).getContext("2d", { willReadFrequently: true })!;
  read.drawImage(bitmap, 0, 0);
  // Painted at twice the terrain's detail, so contours stay fine lines close to the rider.
  const heights = doubleHeights(terrariumHeights(read.getImageData(0, 0, size, size).data), size);
  const pixels = paintLandscape(heights, size * 2, metersPerPixel(Number(z), tileLat(Number(z), Number(y))) * (256 / size / 2), Number(low), Number(high), look as LandscapeLook);
  const canvas = new OffscreenCanvas(size * 2, size * 2);
  canvas.getContext("2d")!.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, size * 2, size * 2), 0, 0);
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

/** The section's line colored by its grade, as a gradient along its length. */
function gradeGradient(profile: CourseProfile, section: CourseSection): unknown[] {
  const length = section.to - section.from;
  const step = Math.max(STEP, Math.ceil(length / 300 / STEP) * STEP);
  const stops: unknown[] = [];
  for (let m = 0; m < length; m += step) stops.push(m / length, gradeColor(gradeAt(profile, section.from + m + step / 2)));
  if (stops.length < 4) stops.push(1, stops[1]);
  return ["interpolate", ["linear"], ["line-progress"], ...stops];
}
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
 * The course in 3D as you ride it: the real terrain drawn as Lactic's own landscape (contours and
 * light, not photos) with its rivers, lakes, forests and roads, the course colored by its grade, and the camera following where your power has
 * taken you. Over it: the grade now, the climb you're on
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
  const [look, setLook] = useState<LandscapeLook>(() => {
    try {
      return localStorage.getItem(LOOK_PREF) === "day" ? "day" : "night";
    } catch {
      return "night";
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
        const palette = PALETTES[look];
        const low = Math.round(Math.min(...profile.ele));
        const high = Math.round(Math.max(...profile.ele));
        maplibre.addProtocol(LAND, async (request, abort) => ({ data: await landTile(request.url, abort.signal) }));
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
              land: { type: "raster", tiles: [`${LAND}://${look}/${low}/${high}/{z}/{x}/{y}`], tileSize: 256, maxzoom: TERRAIN_TILES.maxZoom },
              terrain: { type: "raster-dem", tiles: [TERRAIN_TILES.tiles], encoding: "terrarium", tileSize: 256, maxzoom: TERRAIN_TILES.maxZoom, attribution: TERRAIN_TILES.attribution },
              features: { type: "vector", url: FEATURE_TILES.url, attribution: FEATURE_TILES.attribution },
              course: { type: "geojson", data: line(sectionLine(profile, 0, profile.meters)) },
              section: { type: "geojson", lineMetrics: true, data: line(sectionLine(profile, section.from, section.to)) },
              rider: { type: "geojson", data: point([start.lng, start.lat]) },
              finish: { type: "geojson", data: point(sectionLine(profile, section.to, section.to)[0]) },
            },
            layers: [
              { id: "ground", type: "background", paint: { "background-color": `rgb(${palette.ramp[1].join(",")})` } },
              { id: "land", type: "raster", source: "land", paint: { "raster-fade-duration": 200, "raster-resampling": "linear" } },
              // What's on the land, in the look's own colors: forest as a tint, water bright, the roads you cross faint.
              { id: "forest", type: "fill", source: "features", "source-layer": "landcover", filter: ["==", ["get", "class"], "wood"], paint: { "fill-color": palette.forest, "fill-opacity": palette.forestOpacity, "fill-antialias": false } },
              { id: "streams", type: "line", source: "features", "source-layer": "waterway", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": palette.water, "line-opacity": 0.85, "line-width": ["match", ["get", "class"], "river", 4, "canal", 2, 1.6] } },
              { id: "water", type: "fill", source: "features", "source-layer": "water", paint: { "fill-color": palette.water, "fill-opacity": 0.9 } },
              {
                id: "roads",
                type: "line",
                source: "features",
                "source-layer": "transportation",
                filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor"]]],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": palette.roads, "line-opacity": 0.45, "line-width": ["match", ["get", "class"], ["motorway", "trunk", "primary"], 2.5, 1.2] },
              },
              { id: "course", type: "line", source: "course", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": palette.road, "line-width": 3, "line-opacity": 0.6 } },
              { id: "section-case", type: "line", source: "section", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": palette.casing, "line-width": 10, "line-opacity": 0.9 } },
              // The road wears its grade: green easy, through yellow and orange, to red steep.
              { id: "section", type: "line", source: "section", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 6, "line-gradient": gradeGradient(profile, section) as never } },
              { id: "finish", type: "circle", source: "finish", paint: { "circle-radius": 7, "circle-color": "#b8232a", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-pitch-alignment": "map" } },
              { id: "rider", type: "circle", source: "rider", paint: { "circle-radius": 9, "circle-color": "#ffffff", "circle-stroke-color": "#2b55d6", "circle-stroke-width": 4, "circle-pitch-alignment": "map" } },
            ],
            terrain: { source: "terrain", exaggeration: 1 },
            sky: { "sky-color": palette.sky.sky, "horizon-color": palette.sky.horizon, "fog-color": palette.sky.fog, "sky-horizon-blend": 0.7, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.35, "atmosphere-blend": 0.6 },
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
  }, [profile, section, look]);

  const pickLook = (next: LandscapeLook) => {
    setLook(next);
    try {
      localStorage.setItem(LOOK_PREF, next);
    } catch {}
  };

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
    <div className="relative overflow-hidden rounded-xl border border-line" style={{ background: PALETTES[look].sky.sky }} data-course-ride>
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
          <div className="pointer-events-auto flex overflow-hidden rounded-lg bg-black/55 text-xs text-white backdrop-blur-sm" role="group" aria-label="Look">
            {LANDSCAPE_LOOKS.map((l) => (
              <button key={l} type="button" aria-pressed={look === l} className={`px-2.5 py-1.5 ${look === l ? "bg-white/25 font-medium" : "opacity-80 hover:opacity-100"}`} onClick={() => pickLook(l)}>
                {l === "night" ? "Night" : "Day"}
              </button>
            ))}
          </div>
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
