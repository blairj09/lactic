"use client";

import { useMemo, useState } from "react";
import PowerCurveChart from "@/components/power-curve-chart";
import { shortDuration } from "@/components/chart-utils";
import { Panel } from "@/components/ui";
import type { PowerCurve } from "@/lib/engine/power";
import { bestWindow, type ChartStream, type Route } from "@/lib/engine/ride-detail";
import RideChart, { type Span } from "./ride-chart";
import RouteMap from "./route-map";

/**
 * The map, the Ride Overview chart and the power curve, tied together: a span dragged or zoomed on
 * the chart is highlighted on the map, and a duration picked on the power curve marks where that best effort was.
 */
export default function RideExplorer({
  stream,
  targetLabel,
  targetNote,
  route,
  distance,
  curve,
  best,
  bestLabel,
  between,
  aside,
}: {
  stream: ChartStream | null;
  targetLabel: string;
  targetNote?: string;
  route: Route | null;
  distance?: string;
  curve: PowerCurve | null;
  best: PowerCurve | null;
  bestLabel: string;
  /** Rendered between the chart and the power curve. */
  between?: React.ReactNode;
  /** Beside the power curve. */
  aside?: React.ReactNode;
}) {
  const [zoom, setZoom] = useState<Span | null>(null);
  // The span being dragged on the chart, shown on the map before it becomes the zoom.
  const [selecting, setSelecting] = useState<Span | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const effort = useMemo(
    () => (picked !== null && stream?.watts ? bestWindow(stream.watts, stream.step, picked) : null),
    [picked, stream],
  );
  const highlight: Span | null = effort ? [effort.from, effort.to] : null;

  const pick = (duration: number | null) => {
    setPicked(duration);
    // Bring a best effort outside the zoom back into view.
    const found = duration !== null && stream?.watts ? bestWindow(stream.watts, stream.step, duration) : null;
    if (found && zoom && (found.from < zoom[0] || found.to > zoom[1])) setZoom(null);
  };

  return (
    <>
      {route && route.length > 1 && (
        <Panel title="Route" meta={distance}>
          <RouteMap route={route} zoom={zoom} selecting={selecting} highlight={highlight} />
        </Panel>
      )}

      <Panel title="Ride Overview" meta={targetNote}>
        {stream ? (
          <RideChart stream={stream} targetLabel={targetLabel} zoom={zoom} onZoom={setZoom} onSelecting={setSelecting} highlight={highlight} />
        ) : (
          <p className="text-sm text-muted">
            This ride was saved before rides kept their readings. Rides from now on have charts; for older ones, re-import the last 2 years from intervals.icu.
          </p>
        )}
      </Panel>

      {between}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Panel
          title="Power curve"
          meta={
            picked !== null ? (
              <span className="flex items-center gap-3">
                <span>
                  Best {shortDuration(picked)}
                  {effort && stream?.watts ? `: ${effort.watts} W, marked on the ${route ? "map and chart" : "chart"}` : ""}
                </span>
                <button type="button" className="underline hover:text-ink" onClick={() => pick(null)}>
                  Clear
                </button>
              </span>
            ) : (
              `This ride against ${bestLabel}. Click a duration to find that effort.`
            )
          }
          className="min-w-0 lg:col-span-2"
        >
          {curve ? (
            <PowerCurveChart
              series={[{ label: "This ride", curve }, ...(best ? [{ label: bestLabel, curve: best }] : [])]}
              picked={picked}
              onPick={(d) => pick(d === picked ? null : d)}
            />
          ) : (
            <p className="text-sm text-muted">No power on this ride.</p>
          )}
        </Panel>
        {aside}
      </div>
    </>
  );
}
