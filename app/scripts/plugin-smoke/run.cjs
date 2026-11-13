// Build the smoke page, serve it, open it in Playwright's Chromium and print what the hostile test
// plugin managed. Expect every "reached" to be 0, every attack refused, the main thread's longest gap
// to stay a few milliseconds, and the plugin ready again at the end. Run from app/.
const { execSync, spawn } = require("node:child_process");
const { chromium } = require("playwright");

execSync("npx vite build -c scripts/plugin-smoke/vite.config.ts", { stdio: "inherit" });
// Run Vite's own binary (not via npx) so killing it stops the server.
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "-c", "scripts/plugin-smoke/vite.config.ts", "--port", "4599", "--strictPort"], { stdio: "ignore" });
(async () => {
  try {
    await new Promise((r) => setTimeout(r, 2000));
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto("http://localhost:4599/");
    await page.waitForFunction(() => window.__smoke, null, { timeout: 120000 });
    const out = await page.evaluate(() => window.__smoke);
    for (const c of out) console.log(c.pass ? "pass" : "FAIL", c.name.padEnd(58), c.detail);
    const failed = out.filter((c) => !c.pass).length;
    console.log(failed ? `${failed} check(s) failed` : "all checks passed");
    if (errors.length) console.log("console errors:", errors);
    await browser.close();
  } finally {
    server.kill();
  }
})();
