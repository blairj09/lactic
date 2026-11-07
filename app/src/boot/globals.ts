// Globals the web app's shared code expects from Node or Next: process.env and Buffer. Imported
// first, before anything else runs.

import { Buffer } from "buffer";

const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> }; Buffer?: typeof Buffer };
g.process ??= { env: {} };
g.process.env ??= {};
// The web code turns sign-in-backed features on when Supabase is configured: here the local
// database stands in, so they're always on.
g.process.env.NEXT_PUBLIC_SUPABASE_URL = "local";
g.process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "local";
g.Buffer ??= Buffer;

export const env = g.process.env;
