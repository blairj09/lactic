// Deleting everything: every table emptied and the file compacted so nothing is left in it, every
// saved API key removed from the keychain, and this computer's app storage (paired gear, ride
// preferences, theme) cleared. Lactic then starts again at setup. Files the rider saved elsewhere
// (backups, exports, the Apple Health folder) and anything already sent to other services stay.

import { TABLES } from "~/db/schema";
import { sql } from "~/db/sql";
import { ALL_SECRETS, deleteSecret } from "~/platform/secrets";

/** The word typed to confirm. */
export const CONFIRM_WORD = "delete";

export async function deleteEverything(): Promise<void> {
  // One transaction: every table empties, or none does. Foreign keys all cascade or set null.
  await sql().batch(Object.keys(TABLES).map((t) => ({ sql: `DELETE FROM "${t}"` })));
  // Rewrites the file without the deleted rows' old pages.
  await sql().script("VACUUM");
  for (const name of ALL_SECRETS) await deleteSecret(name);
  try {
    localStorage.clear();
  } catch {
    // Nothing stored, or storage blocked.
  }
}
