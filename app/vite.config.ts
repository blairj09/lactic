import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { build, defineConfig, searchForWorkspaceRoot, type Alias, type Plugin } from "vite";

const host = process.env.TAURI_DEV_HOST;
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const RIDE_TITLE = "Ride a workout in your browser · Lactic";
const RIDE_DESCRIPTION =
  "Connect your smart trainer in Chrome or Edge and ride a structured ERG workout, or a free FTP ramp test, with Lactic. No download, no account. Save your ride as a .fit file.";

/** The try-a-ride page's head and a text summary for readers without JavaScript (search engines, link previews). */
function rideHead(html: string): string {
  const head = [
    `<meta name="description" content="${RIDE_DESCRIPTION}" />`,
    `<link rel="canonical" href="https://lactic.fit/ride/" />`,
    `<meta property="og:title" content="${RIDE_TITLE}" />`,
    `<meta property="og:description" content="${RIDE_DESCRIPTION}" />`,
    `<meta property="og:url" content="https://lactic.fit/ride/" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Lactic" />`,
    `<meta property="og:image" content="https://lactic.fit/og-image.png" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join("\n    ");
  const summary =
    `<noscript><h1>${RIDE_TITLE}</h1><p>${RIDE_DESCRIPTION}</p>` +
    `<p>Lactic is a free, open-source cycling training app for Mac, Windows and Linux. <a href="https://lactic.fit/">Learn more and download</a>.</p></noscript>`;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${RIDE_TITLE}</title>\n    ${head}`)
    .replace('<div id="root"></div>', `<div id="root"></div>\n    ${summary}`);
}

/**
 * Lactic's card for AI apps that show MCP Apps (src/mcp/view): built on its own into one HTML file
 * with everything inline (the AI app shows it in a sandboxed frame with no network), and handed to
 * the app as `virtual:lactic-mcp-view` for the MCP server to serve (src/mcp/bridge.ts).
 */
function mcpView(alias: Alias[], skip: boolean): Plugin {
  const id = "virtual:lactic-mcp-view";
  let html: Promise<string> | null = null;
  return {
    name: "lactic-mcp-view",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    async load(source) {
      if (source !== `\0${id}`) return;
      if (skip) return "export default '';";
      html ??= buildMcpView(alias);
      return `export default ${JSON.stringify(await html)};`;
    },
  };
}

export async function buildMcpView(alias: Alias[]): Promise<string> {
  const root = here("./src/mcp/view");
  const out = await build({
    configFile: false,
    root,
    logLevel: "warn",
    plugins: [react(), tailwindcss()],
    resolve: { alias, dedupe: ["react", "react-dom"] },
    build: {
      write: false,
      target: "safari16",
      modulePreload: false,
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      rollupOptions: { input: `${root}/index.html`, output: { inlineDynamicImports: true } },
    },
  });
  const files = (Array.isArray(out) ? out : [out]).flatMap((o) => ("output" in o ? o.output : []));
  const text = (f: (typeof files)[number]) => ("code" in f ? f.code : typeof f.source === "string" ? f.source : new TextDecoder().decode(f.source));
  const page = files.find((f) => f.fileName.endsWith(".html"));
  if (!page) throw new Error("The MCP card page didn't build");
  const js = files.filter((f) => f.fileName.endsWith(".js")).map(text).join("\n").replace(/<\/script/gi, "<\\/script");
  const css = files.filter((f) => f.fileName.endsWith(".css")).map(text).join("\n").replace(/<\/style/gi, "<\\/style");
  return text(page)
    .replace(/<script\b[^>]*\bsrc="[^"]*"[^>]*><\/script>/g, "")
    .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, "")
    .replace("</head>", () => `<style>${css}</style>\n</head>`)
    .replace("</body>", () => `<script type="module">${js}</script>\n</body>`);
}

// Specific overrides first: the web app's server-only modules swap for local versions.
export const ALIAS: Alias[] = [
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
];

// `@shared` is the web app's pure TypeScript (engine, FIT, BLE protocol, ride logic), shared so the
// two apps never have two training engines. `~` is the desktop app's own code.
export default defineConfig(({ command, mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // The website demo (npm run build:demo, served at lactic.fit/demo/) stays out of search results.
    mode === "demo" && { name: "demo-noindex", transformIndexHtml: (html: string) => html.replace("<head>", '<head>\n    <meta name="robots" content="noindex" />') },
    // lactic.fit/ride/ gets a real title, description and link preview so search and AI answers can find it.
    mode === "ride" && { name: "ride-head", transformIndexHtml: rideHead },
    // The website builds have no MCP server, so no card to build.
    mcpView(ALIAS, mode === "demo" || mode === "ride"),
  ],
  clearScreen: false,
  resolve: {
    alias: ALIAS,
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    
    watch: { ignored: ["**/src-tauri/**"] },
    // Lactic's own plugins (src/plugins/catalog.ts) are bundled from the repo's plugins/catalog.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), here("../plugins/catalog")] },
  },
  // Vite's build swaps `process.env` for `{}`, which froze every setting the app writes at boot
  // (src/boot/env.ts) to undefined in packaged builds. Point it at the live object globals.ts makes.
  // Build only: in dev, Vite's client writes each define onto globalThis before globals.ts has made
  // `process`, which throws and stops the page loading.
  define:
    command === "build"
      ? {
          "process.env": "globalThis.process.env",
          "global.process.env": "globalThis.process.env",
          "globalThis.process.env": "globalThis.process.env",
        }
      : {},
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  // Plugin workers (src/plugins/worker.ts) are module workers: the QuickJS engine loads in chunks.
  worker: { format: "es" },
  build: {
    target: "safari16",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    include: ["scripts/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx", "web/**/*.test.ts", "evals/**/*.test.ts"],
  },
}));
