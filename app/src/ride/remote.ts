// The ride on this computer, for a paired iPhone to show and steer. The Ride page hands over what
// it shows and its controls on every render (RemoteHost); the phone asks for them over the link
// (phone/computer.ts) about once a second while its remote is open, and sends button presses back.

import { useEffect } from "react";
import type { PlayerControls, PlayerData } from "@/app/ride/player";
import type { ControlMessage, ControlName, OverlayPayload } from "./channel";

let live: { data: PlayerData; controls: PlayerControls } | null = null;

/** The ride page renders this (desktop only); it keeps `live` current and clears it as the page closes. */
export function RemoteHost({ data, controls }: { data: PlayerData; controls: PlayerControls }) {
  live = { data, controls };
  useEffect(
    () => () => {
      live = null;
    },
    [],
  );
  return null;
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

const ALLOWED = new Set<Exclude<ControlName, "resize">>(["onPlayPause", "onSkip", "onBack", "onIntensity", "onErg", "onErgMode", "onGrade", "onExtend", "onEnd", "onExtendMinutes", "onExtendWatts", "onExtendKind", "onExtendBlock", "onHold", "onAdaptUndo", "onAdaptYes", "onAdaptNo", "onAdaptive"]);

/** Runs a button pressed on the phone, as if pressed here. */
export function runRemoteControl(message: ControlMessage): boolean {
  const name = message.name as Exclude<ControlName, "resize">;
  if (!live || !ALLOWED.has(name) || !Array.isArray(message.args)) return false;
  const fn = live.controls[name] as unknown as ((...a: unknown[]) => void) | undefined;
  if (typeof fn !== "function") return false;
  fn(...message.args);
  return true;
}
