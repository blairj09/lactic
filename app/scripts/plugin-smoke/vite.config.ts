// Builds the plugin sandbox smoke page (scripts/plugin-smoke/run.cjs) with the app's own Vite setup.
import { fileURLToPath, URL } from "node:url";
import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from "vite";
import base from "../../vite.config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig((env: ConfigEnv) =>
  mergeConfig((base as (e: ConfigEnv) => UserConfig)(env), {
    root: here("."),
    build: { outDir: here("../../dist/plugin-smoke"), emptyOutDir: true },
  }),
);
