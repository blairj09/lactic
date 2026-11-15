// Browser smoke test for the plugin sandbox: runs the sandbox self-check (src/plugins/selfcheck.ts)
// through real module workers under the app's production CSP (copied into index.html) and puts the
// results on window.__smoke. Run with `node scripts/plugin-smoke/run.cjs` from app/.
import { runSandboxCheck } from "~/plugins/selfcheck";

(async () => {
  let out: unknown;
  try {
    out = await runSandboxCheck();
  } catch (e) {
    out = [{ name: "self-check", pass: false, detail: String(e) }];
  }
  (window as unknown as { __smoke: unknown }).__smoke = out;
})();
