// The intervals.icu API key lives in the keychain under one name. It goes when the rider
// disconnects, when a first connect fails, and (once, for riders who disconnected before this
// existed) at startup when there's no connection left to use it.

import { loadConnection } from "@/lib/intervals/client";
import { createClient } from "~/db/supabase-client";
import { deleteSecret, secretStatus } from "~/platform/secrets";

export const SECRET_INTERVALS = "intervals";
const SWEPT = "lactic.intervals-key-swept";

/** Removes the saved intervals.icu key. A key that's already gone is fine. */
export async function forgetIntervalsKey() {
  await deleteSecret(SECRET_INTERVALS);
}

/** One time per install: a key with no connection is left over from an older disconnect. */
export async function sweepLeftoverIntervalsKey() {
  try {
    if (localStorage.getItem(SWEPT)) return;
    const connection = await loadConnection(createClient());
    if (!connection && (await secretStatus(SECRET_INTERVALS))) await forgetIntervalsKey();
    localStorage.setItem(SWEPT, "1");
  } catch (e) {
    // The keychain was locked or refused: try again next start.
    console.error("Couldn't check for a leftover intervals.icu key:", e);
  }
}
