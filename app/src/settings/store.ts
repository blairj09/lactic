// Lactic's own settings (app_settings), one JSON value per key.

import { sql } from "~/db/sql";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await sql().select(`SELECT value FROM app_settings WHERE key = ?`, [key]);
  if (!rows.length || rows[0].value === null) return fallback;
  try {
    return JSON.parse(String(rows[0].value)) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown) {
  await sql().execute(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), new Date().toISOString()],
  );
  window.dispatchEvent(new CustomEvent("lactic:settings", { detail: key }));
}
