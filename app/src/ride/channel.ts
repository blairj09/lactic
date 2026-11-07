// The ride overlay is its own always-on-top window (it floats over Zwift in full screen), so the
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
