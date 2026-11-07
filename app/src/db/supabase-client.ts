// Stands in for the web app's src/lib/supabase/{server,client,admin}.ts, so its data code gets the
// local SQLite client instead of a hosted Supabase one. createClient is sync here; the server
// version's `await createClient()` works on it all the same.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createLocalClient } from "./supa";

const client = createLocalClient();

// Typed as supabase-js's client, which the web code expects; this imitates the part it uses.
type AnyClient = SupabaseClient;

export function createClient(): AnyClient {
  return client as unknown as AnyClient;
}

export function createAdminClient(): AnyClient {
  return client as unknown as AnyClient;
}

export const localClient = client;
