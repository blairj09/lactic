// API keys, kept in the system keychain by the Rust core. The web layer can save, delete and ask
// about a key but never read it: requests that need one carry a placeholder (`keychain:<name>`),
// and the Rust core swaps the real key in on the way out (see fetch.ts).

import { invoke, isDesktop } from "./native";

const DEV_PREFIX = "lactic.secret.";

export const placeholder = (name: string) => `keychain:${name}`;

/** The intervals.icu API key. */
export const SECRET_INTERVALS = "intervals";
/** Every key Lactic saves (the coach's AI key is "ai"). */
export const ALL_SECRETS = ["ai", SECRET_INTERVALS, "strava", "strava.refresh", "strava.expires"];

/** The site part of an address ("models.example.org:8443" → "models.example.org"), or null. */
export function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase() || null : null;
  } catch {
    return null;
  }
}

/**
 * Saves a key. `forUrl` is where a custom AI provider lives: the Rust core then only ever sends
 * the key to that site (or the built-in providers), whatever a request asks for.
 */
export async function saveSecret(name: string, value: string, forUrl?: string | null) {
  if (isDesktop) return invoke<void>("secret_set", { name, value: value.trim(), host: hostOf(forUrl) });
  localStorage.setItem(DEV_PREFIX + name, value.trim());
}

export async function deleteSecret(name: string) {
  if (isDesktop) return invoke<void>("secret_delete", { name });
  localStorage.removeItem(DEV_PREFIX + name);
}

/**
 * A custom AI provider's address changed while its key is saved: the system asks the rider before
 * the key may go to the new site. False when they said no.
 */
export async function rebindSecret(name: string, forUrl: string): Promise<boolean> {
  const host = hostOf(forUrl);
  if (!isDesktop || !host) return true;
  return invoke<boolean>("secret_rebind", { name, host });
}

/** "…abcd" when a key is saved, else null. */
export async function secretStatus(name: string): Promise<string | null> {
  if (isDesktop) return invoke<string | null>("secret_status", { name });
  const v = localStorage.getItem(DEV_PREFIX + name);
  return v ? `…${v.slice(-4)}` : null;
}

/** Browser development only: the real key, since there's no Rust core to add it. */
export function devSecret(name: string): string | null {
  return isDesktop ? null : localStorage.getItem(DEV_PREFIX + name);
}
