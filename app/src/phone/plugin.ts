// The iPhone app's native side (src-tauri/plugins/lactic-phone, Swift): Apple Health, the
// pairing key in the iOS keychain, and the sealed link to the computer.

import type { HealthWorkout } from "@/lib/engine/health-export";
import { invoke } from "~/platform/native";

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(`plugin:lactic-phone|${command}`, args);

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

/** Called when a background wake read new Health data. */
export async function onHealthWake(cb: () => void): Promise<() => void> {
  const core = await import("@tauri-apps/api/core");
  const listener = await core.addPluginListener("lactic-phone", "health", cb);
  return () => void listener.unregister();
}
