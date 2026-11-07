import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// `@shared` is the web app's pure TypeScript (engine, FIT, BLE protocol, ride logic), shared so the
// two apps never have two training engines. `~` is the desktop app's own code.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    // Specific overrides first: the web app's server-only modules swap for local versions.
    alias: [
      { find: /^@\/lib\/coach\/openrouter$/, replacement: here("./src/ai/client.ts") },
      { find: /^\.\/openrouter$/, replacement: here("./src/ai/client.ts") },
      { find: /^@\/components\/nav$/, replacement: here("./src/app/nav.tsx") },
      { find: /^\.\/use-pip-window$/, replacement: here("./src/ride/use-pip-window.ts") },
      { find: /^\.\/overlay-portal$/, replacement: here("./src/ride/overlay-portal.tsx") },
      { find: /^node:zlib$/, replacement: here("./src/shims/node-zlib.ts") },
      { find: /^next\/headers$/, replacement: here("./src/shims/next-headers.ts") },
      { find: /^next\/cache$/, replacement: here("./src/shims/next-cache.ts") },
      { find: /^next\/navigation$/, replacement: here("./src/shims/next-navigation.ts") },
      { find: /^next\/link$/, replacement: here("./src/shims/next-link.tsx") },
      { find: /^@shared\//, replacement: here("./web/lib/") },
      { find: /^@\//, replacement: here("./web/") },
      { find: /^~\//, replacement: here("./src/") },
    ],
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "safari16",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "web/**/*.test.ts", "evals/**/*.test.ts"],
  },
});
