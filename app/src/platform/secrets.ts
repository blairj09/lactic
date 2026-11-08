// API keys, kept in the system keychain by the Rust core. The web layer can save, delete and ask
// about a key but never read it: requests that need one carry a placeholder (`keychain:<name>`),
// and the Rust core swaps the real key in on the way out (see fetch.ts).

import { invoke, isDesktop } from "./native";

const DEV_PREFIX = "lactic.secret.";

export const placeholder = (name: string) => `keychain:${name}`;

/** The intervals.icu API key. */
export const SECRET_INTERVALS = "intervals";

export async function saveSecret(name: string, value: string) {
  if (isDesktop) return invoke<void>("secret_set", { name, value: value.trim() });
  localStorage.setItem(DEV_PREFIX + name, value.trim());
}

export async function deleteSecret(name: string) {
  if (isDesktop) return invoke<void>("secret_delete", { name });
  localStorage.removeItem(DEV_PREFIX + name);
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
