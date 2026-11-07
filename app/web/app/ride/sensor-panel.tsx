"use client";

import { useEffect, useState } from "react";
import { canReconnectSilently, isPickerCancel, remembered } from "@/lib/ble/devices";
import type { LinkStatus, SensorHub, SensorKind, SensorState } from "@/lib/ble/sensor-hub";
import { deviceKind } from "@/lib/ble/catalog";
import PairSheet from "@/components/pair-sheet";
import { Dash, button } from "@/components/ui";

const SENSORS: { kind: SensorKind; label: string; unit: string }[] = [
  { kind: "trainer", label: "Trainer", unit: "W" },
  { kind: "heartRate", label: "Heart rate", unit: "bpm" },
  { kind: "powerMeter", label: "Power meter", unit: "W" },
];

const DOT: Record<LinkStatus, string> = {
  idle: "bg-active",
  connecting: "bg-warning animate-pulse",
  reconnecting: "bg-warning animate-pulse",
  connected: "bg-accent",
  lost: "bg-negative",
};

function statusLine(status: LinkStatus, name: string | undefined, waiting?: boolean) {
  if (waiting && status === "idle") return `Waiting for ${name ?? "the sensor"}. Wake it up and it connects.`;
  if (waiting && status === "lost") return `Lost ${name ?? "the sensor"}. It reconnects when it wakes up.`;
  switch (status) {
    case "connected":
      return name;
    case "connecting":
      return `Connecting to ${name ?? "sensor"}...`;
    case "reconnecting":
      return `Signal dropped. Reconnecting to ${name ?? "sensor"}...`;
    case "lost":
      return `Lost ${name ?? "the sensor"}. Wake it and press Connect.`;
    default:
      return name ? `${name} · remembered` : "Not paired yet";
  }
}

/**
 * The three ride sensors: status, live reading and one action each, plus an in-app pairing sheet.
 * Once the trainer is connected they fold to one status line, unless a sensor is lost.
 */
export default function SensorPanel({
  hub,
  state,
  supported,
  onError,
}: {
  hub: SensorHub;
  state: SensorState;
  supported: boolean;
  onError: (message: string | null) => void;
}) {
  const [pairing, setPairing] = useState<SensorKind | null>(null);
  const [silent, setSilent] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setSilent(canReconnectSilently());
    // Show remembered sensors right away, and connect the ones Chrome lets us reach without a click.
    // Asleep ones are listened for and connect the moment they wake.
    hub.restore().catch(() => undefined);
    return () => hub.stopWaitingAll();
  }, [hub]);

  const run = async (kind: SensorKind, choose: boolean) => {
    onError(null);
    try {
      await hub.connect(kind, { choose });
    } catch (e) {
      if (!isPickerCancel(e)) onError(e instanceof Error ? e.message : String(e));
    }
  };

  const connect = (kind: SensorKind) => {
    // First time: explain before Chrome's list appears. Remembered: go straight there.
    if (!remembered(kind) && !state.links[kind].name) setPairing(kind);
    else run(kind, false);
  };

  // Each power device shows its own reading, so the two can be compared whichever is in use.
  const reading = (kind: SensorKind) => (kind === "heartRate" ? state.heartRate : kind === "trainer" ? state.trainerWatts : state.meterWatts);

  const sensor = SENSORS.find((s) => s.kind === pairing);
  const ready = !!state.connected.trainer && !Object.values(state.links).some((l) => l.status === "lost");

  if (ready && !expanded) {
    return (
      <section aria-label="Sensors" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-surface px-5 py-3 text-sm">
        {SENSORS.map(({ kind, label }) => {
          const { status, name, waiting } = state.links[kind];
          if (status === "idle" && !name) return null;
          return (
            <span key={kind} className="flex items-center gap-2" aria-live="polite">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[status]}`} />
              <span className={status === "connected" ? undefined : "text-muted"}>{status === "connected" ? (name ?? label) : `${label} ${waiting ? "waiting" : status === "idle" ? "off" : "connecting"}`}</span>
            </span>
          );
        })}
        <button className="ml-auto text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => setExpanded(true)}>
          Sensors
        </button>
      </section>
    );
  }

  return (
    <>
      <section aria-label="Sensors" className="space-y-3">
        {ready && (
          <div className="flex justify-end">
            <button className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => setExpanded(false)}>
              Hide sensors
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg bg-line sm:grid-cols-3">
          {SENSORS.map(({ kind, label, unit }) => {
            const { status, name, waiting } = state.links[kind];
            const busy = status === "connecting" || status === "reconnecting";
            const value = status === "connected" ? reading(kind) : undefined;
            return (
              <div key={kind} className="flex items-center gap-4 bg-surface px-5 py-4">
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[status]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{label}</span>
                    {status === "connected" && (
                      <span className="num text-sm">
                        {value === undefined ? <Dash /> : Math.round(value)}
                        <span className="ml-1 text-muted">{kind === "trainer" && state.connected.powerMeter ? "W target" : unit}</span>
                      </span>
                    )}
                  </div>
                  <div className="truncate text-sm text-muted" aria-live="polite">
                    {statusLine(status, name, waiting)}
                  </div>
                  {name && status !== "connected" && !busy && (
                    <button className="text-sm text-faint underline-offset-4 hover:text-ink hover:underline" onClick={() => setPairing(kind)}>
                      Use a different {label.toLowerCase()}
                    </button>
                  )}
                </div>
                {status === "connected" || busy ? (
                  <button className={button.small} onClick={() => hub.disconnect(kind)}>
                    {busy ? "Cancel" : "Disconnect"}
                  </button>
                ) : (
                  <button className={button.smallPrimary} disabled={!supported} onClick={() => connect(kind)}>
                    {name ? "Connect" : "Pair"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {supported && !silent && Object.values(state.links).some((l) => l.name && l.status === "idle") && (
          <p className="text-sm text-faint">
            Chrome asks you to pick each sensor once per visit. To have them reconnect on their own, open{" "}
            <span className="text-muted">chrome://flags</span>, turn on &quot;Use the new permissions backend for Web Bluetooth&quot; and
            &quot;Experimental Web Platform features&quot;, then relaunch Chrome.
          </p>
        )}
      </section>

      <PairSheet kind={sensor ? deviceKind(sensor.kind) : null} onFind={(k) => run(k.key as SensorKind, true)} onClose={() => setPairing(null)} />
    </>
  );
}
