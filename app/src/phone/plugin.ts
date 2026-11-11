// The iPhone app's native side (src-tauri/plugins/lactic-phone, Swift): Apple Health, the
// pairing key in the iOS keychain, and the sealed link to the computer.

import type { HealthWorkout } from "@/lib/engine/health-export";
import type { EndAlert } from "@/lib/ride/end-alert";
import type { WidgetSnapshot } from "@/lib/widget-snapshot";
import { invoke } from "~/platform/native";

/** A rejection from Swift arrives as a plain value or an object with a message; make it an Error that reads. */
export function readable(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === "string") return new Error(e);
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return new Error(e.message);
  try {
    return new Error(JSON.stringify(e));
  } catch {
    return new Error(String(e));
  }
}

const call = <T>(command: string, args?: Record<string, unknown>) =>
  invoke<T>(`plugin:lactic-phone|${command}`, args).catch((e: unknown) => {
    throw readable(e);
  });

export interface PhoneStatus {
  healthAvailable: boolean;
  /** The rider has seen the Health permission sheet (iOS never says what they allowed). */
  healthAsked: boolean;
  /** Health reads from background wakes waiting to be imported here. */
  pending: number;
  paired: { computer: string; deviceId: string; lastSentAt: number | null } | null;
}

export const phoneStatus = () => call<PhoneStatus>("status");
export const authorizeHealth = () => call<{ granted: boolean }>("authorize_health");
/** The last `days` days of Health, in the Lactic Shortcut's column format. */
export const readHealth = (days: number) => call<Record<string, unknown>>("read_health", { days });
export const takePending = () => call<{ id: string; body: Record<string, unknown> }[]>("take_pending");
export const ackPending = (ids: string[]) => call<void>("ack_pending", { ids });
export const saveWorkout = (workout: HealthWorkout) => call<{ saved: boolean; reason: string | null }>("save_workout", { ...workout });
/** Pairs with the computer whose QR code (a https://lactic.fit/pair#... link) was scanned. */
export const pair = (url: string) => call<{ computer: string }>("pair", { url });
export const unpair = () => call<void>("unpair");
/** One sealed request to the computer; resolves with its answer. */
export const send = <T>(kind: string, body: unknown, timeout?: number) => call<T>("send", { kind, body, timeout });

/**
 * Has the ride-end notification (with Extend and End buttons) waiting for `inSeconds` from now,
 * replacing any earlier one. Asks for notification permission the first time.
 */
export const scheduleRideEnd = (alert: EndAlert & { computer: string; workoutName: string; duration: number }) => call<void>("schedule_ride_end", { ...alert });
/** No ride end to tell about any more (paused, ended, closed): drops the waiting notification. */
export const cancelRideEnd = () => call<void>("cancel_ride_end");

/** Hands the home and lock screen widgets today's snapshot (widget-snapshot.ts) and has them redraw. */
export const saveWidget = (snapshot: WidgetSnapshot) => call<void>("save_widget", { json: JSON.stringify(snapshot) });

/** Called when a background wake read new Health data. */
export async function onHealthWake(cb: () => void): Promise<() => void> {
  const core = await import("@tauri-apps/api/core");
  const listener = await core.addPluginListener("lactic-phone", "health", cb);
  return () => void listener.unregister();
}
