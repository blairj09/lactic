// Globals the web app's shared code expects from Node or Next: process.env and Buffer. Imported
// first, before anything else runs.

import { Buffer } from "buffer";

const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> }; Buffer?: typeof Buffer };
g.process ??= { env: {} };
g.process.env ??= {};
g.Buffer ??= Buffer;

export const env = g.process.env;
