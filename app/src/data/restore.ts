// Moving to a new computer: Back up… on the old one saves the whole database as one .db file, and
// Restore… here swaps it in. Rides, plan, workouts, favorites, recovery, weight, coach chats and
// settings all come across. What can't come across in the file: API keys (they live in the old
// computer's keychain), paired Bluetooth gear (pair again; it's per computer), and an AI app's
// connection to Lactic's MCP server. After a restore, Lactic tidies up what pointed at the old
// computer and shows the rider what to set up again.

import { coachSetup } from "~/ai/settings";
import { sql } from "~/db/sql";
import { invoke } from "~/platform/native";
import { SECRET_INTERVALS, secretStatus } from "~/platform/secrets";
import { getSetting, setSetting } from "~/settings/store";

/** Set right after a restore; Settings → Your data reads it to say what to do next. */
export const RESTORED_SETTING = "data.restored";

export interface RestoredNotice {
  at: string;
  /** API keys the backup expects that this computer's keychain doesn't have. */
  keys: ("ai" | "intervals")[];
  /** Apple Health files were read from a folder chosen on the old computer. */
  healthFolder: boolean;
  /** An AI app coached over MCP on the old computer. */
  mcp: boolean;
}

/** Asks for the backup file, then replaces this computer's data with it. Null if cancelled. */
export async function pickAndRestore(): Promise<RestoredNotice | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const from = await open({ title: "Pick your Lactic backup", multiple: false, directory: false, filters: [{ name: "Lactic backup", extensions: ["db"] }] });
  if (!from || Array.isArray(from)) return null;
  await invoke("db_restore", { from });
  return afterRestore();
}

/**
 * Fixes what came from the old computer and records what the rider needs to redo. Runs on the
 * restored database, before the app reloads (which brings its tables up to date).
 */
export async function afterRestore(now = new Date()): Promise<RestoredNotice> {
  const setup = await coachSetup();
  const aiKey = await secretStatus("ai");
  const keys: RestoredNotice["keys"] = [];
  if (setup.provider?.hasKey && !aiKey) {
    keys.push("ai");
    await setSetting("coach.setup", { ...setup, provider: { ...setup.provider, hasKey: false } });
  }
  const icu = await sql()
    .select(`SELECT count(*) AS n FROM intervals_connections`)
    .catch(() => [{ n: 0 }]);
  if (Number(icu[0]?.n ?? 0) > 0 && !(await secretStatus(SECRET_INTERVALS))) keys.push("intervals");

  // A folder picked on the old computer may not exist here; iCloud Drive/Lactic is the default.
  const healthFolder = Boolean(await getSetting<string | null>("health.folder", null));
  if (healthFolder) await setSetting("health.folder", null);

  const notice: RestoredNotice = { at: now.toISOString(), keys, healthFolder, mcp: setup.mode === "external" || (setup.mode === "builtin" && Boolean(setup.alongside)) };
  await setSetting(RESTORED_SETTING, notice);
  return notice;
}

export async function restoredNotice(): Promise<RestoredNotice | null> {
  return getSetting<RestoredNotice | null>(RESTORED_SETTING, null);
}

export async function dismissRestoredNotice() {
  await setSetting(RESTORED_SETTING, null);
}
