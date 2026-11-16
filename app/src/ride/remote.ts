// The ride on this computer, for a paired iPhone to show and steer. The Ride page hands over what
// it shows and its controls on every render (RemoteHost); the phone asks for them over the link
// (phone/computer.ts) about once a second while its remote is open, and sends button presses back.

import { useEffect } from "react";
import type { PlayerControls, PlayerData } from "@/app/ride/player";
import { liveActivity, nudgeDue, type LiveActivityState } from "@/lib/ride/live-activity";
import { invoke } from "~/platform/native";
import type { ControlMessage, ControlName, OverlayPayload } from "./channel";

let live: { data: PlayerData; controls: PlayerControls } | null = null;

/** What the beacon last nudged the phone about, and when (ms). */
let nudged: LiveActivityState | null = null;
let nudgedAt = 0;

/**
 * The ride page renders this (desktop only); it keeps `live` current and clears it as the page
 * closes. While it's open, the ride beacon (beacon.rs) nudges a paired, locked iPhone whenever its
 * Live Activity is due fresh numbers or a new interval, so the lock screen keeps up.
 */
export function RemoteHost({ data, controls }: { data: PlayerData; controls: PlayerControls }) {
  live = { data, controls };
  useEffect(() => {
    void invoke("ride_beacon", { on: true }).catch(() => {});
    return () => {
      live = null;
      nudged = null;
      void invoke("ride_beacon", { on: false }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    const now = Date.now();
    const next = liveActivity(data, now);
    if (!nudgeDue(nudged, nudgedAt, next, now)) return;
    nudged = next;
    nudgedAt = now;
    void invoke("ride_beacon_nudge").catch(() => {});
  });
  return null;
}

/**
 * The phone's Live Activity for the ride here, worked out here so the phone can show it from a
 * background wake without its web view (Swift fills in the computer's name).
 */
export function remoteActivity(): LiveActivityState | null {
  return live ? liveActivity(live.data, Date.now()) : null;
}

/** What the phone's remote shows: the ride as the overlay gets it, with a thinned trace. */
export function remoteRide(): OverlayPayload | null {
  if (!live) return null;
  const { data, controls } = live;
  // Every second of a long ride would make each poll's reply big: the last ten minutes in full,
  // and every tenth point before that, which is plenty for the chart on a phone.
  const recent = data.position - 600;
  const trace = data.trace.filter(([t], i) => t >= recent || i % 10 === 0);
  return { data: { ...data, trace }, canPlay: controls.canPlay };
}

const ALLOWED = new Set<Exclude<ControlName, "resize">>(["onPlayPause", "onSkip", "onBack", "onIntensity", "onErg", "onErgMode", "onGrade", "onExtend", "onEnd", "onExtendMinutes", "onExtendWatts", "onExtendKind", "onExtendBlock", "onHold", "onAdaptUndo", "onAdaptYes", "onAdaptNo", "onAdaptive", "onPage"]);

/** Runs a button pressed on the phone, as if pressed here. */
export function runRemoteControl(message: ControlMessage): boolean {
  const name = message.name as Exclude<ControlName, "resize">;
  if (!live || !ALLOWED.has(name) || !Array.isArray(message.args)) return false;
  const fn = live.controls[name] as unknown as ((...a: unknown[]) => void) | undefined;
  if (typeof fn !== "function") return false;
  fn(...message.args);
  return true;
}
