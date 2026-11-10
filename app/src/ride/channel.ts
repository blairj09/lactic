// The ride overlay is its own always-on-top window (it stays over other apps, full screen included), so the
// Ride page and the overlay talk over app events: the page sends what to show, the overlay sends
// back button presses and a steady tick that keeps the ride clock running while the page is hidden.

import type { PlayerControls, PlayerData } from "@/app/ride/player";

export const EV = {
  data: "ride:data",
  control: "ride:control",
  tick: "ride:tick",
  ready: "ride:overlay-ready",
  closed: "ride:overlay-closed",
} as const;

export type ControlName = Exclude<keyof PlayerControls, "canPlay"> | "resize";

export interface OverlayPayload {
  data: PlayerData;
  canPlay: boolean;
}

export interface ControlMessage {
  name: ControlName;
  args: unknown[];
}

/**
 * Button arguments that can cross to another window or the phone: numbers, strings, booleans and
 * null. A click handler wired straight to a control hands it the click event, which can't be sent
 * (it links back to the page), and sending it failed silently, so those presses never arrived.
 */
export function sendableArgs(args: unknown[]): unknown[] {
  return args.filter((a) => a === null || ["number", "string", "boolean"].includes(typeof a));
}
