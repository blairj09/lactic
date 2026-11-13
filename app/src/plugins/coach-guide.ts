// plugin_guide: what the built-in coach reads before drafting a plugin. The rules mirror
// plugins/AI-GUIDE.md, cut down for a model writing plain JavaScript in one go (no bundler, no SDK
// import: the sandbox provides `lactic.register`). The kit and metric types come straight from the
// SDK source, so they can't drift from what Lactic checks.
import sdk from "../../../plugins/sdk/src/index.ts?raw";
import { RIDE_FIELD_LIMITS } from "@/lib/sdk/plugin-fields";

/** The SDK's kit, metrics and handler types, without the definePlugin helper the coach doesn't need. */
const types = sdk.slice(0, sdk.indexOf("/** Register the plugin's handlers.")).trim();

/** The guide's worked example, also run by the tests so it never stops working. */
export const EXAMPLE_MANIFEST = {
  id: "above-ftp",
  name: "Above FTP",
  version: "0.1.0",
  description: "A ride field with your time above FTP this ride.",
  permissions: { read: ["live", "profile"] },
  publishes: [{ id: "seconds", label: "Time above FTP", unit: "s", kind: "number" }],
  contributes: { fields: [{ id: "above-ftp", title: "Above FTP", entry: "field" }] },
};

export const EXAMPLE_CODE = `var seconds = 0;
var last = null;
function clock(s) { return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"); }
lactic.register({
  field: function (input) {
    var p = input.metrics["power"];
    var ftp = input.metrics["profile.ftp"];
    var dt = last === null ? 0 : Math.min(5, Math.max(0, input.now - last));
    last = input.now;
    if (p == null || ftp == null) return { tree: { type: "field", label: "", value: "–", sub: "needs power and FTP", tone: "muted" } };
    if (p > ftp) seconds += dt;
    return { tree: { type: "field", label: "", value: clock(seconds), sub: "this ride" }, metrics: { seconds: Math.round(seconds) } };
  }
});`;

const EXAMPLE = `manifest:\n${JSON.stringify(EXAMPLE_MANIFEST)}\n\ncode:\n${EXAMPLE_CODE}`;

export const PLUGIN_GUIDE = `Writing a Lactic plugin for the rider. Send it with draft_plugin as a manifest object and code.

Code: one plain JavaScript script (no import, require, export or TypeScript). It runs in a bare engine (QuickJS) in a sandbox: no internet, storage, timers, DOM, fetch, setTimeout or console; only the language, Math, JSON, arrays and objects. Call lactic.register({ handlerName: function (input) { ... } }) once at the top level; every manifest "entry" must be a registered handler. Handlers are synchronous and quick: ride fields and cards get 20 ms a call (about once a second, and keep state in ordinary variables between calls); ride page sections ("analyses") get 2 s once per saved ride and input.ride holds the whole ride (ride.watts[i] is the power at second i * ride.stepSeconds). Return { tree, metrics }: tree from the kit below (no HTML, no colours beyond tone, within KIT_LIMITS; a ride field shows its first field or stat node, value up to ${RIDE_FIELD_LIMITS.value} characters, unit up to ${RIDE_FIELD_LIMITS.unit} and sub up to ${RIDE_FIELD_LIMITS.sub}, plus at most one bars, sparkline or meter chart), metrics only for names declared in the manifest's publishes, each a finite number or one of its choices, never text. Any metric can be null (no power meter, no FTP set) and input.ride streams can be null: handle it and show a short muted text or field saying what's needed instead of throwing. Don't compute the rider's training numbers in your reply: the plugin computes them while it runs.

Manifest: id (lowercase letters, digits and dashes, 2 to 40, must not contain "lactic"), name (short, not like "Lactic"), version (0.1.0 first, higher for each change), description (one plain sentence of what it shows), permissions.read (only the groups used: live, rides, fitness, profile, recovery (health data), location (GPS, the rider can decline it)), publishes (optional), contributes: fields (ride fields), analyses (sections on a saved ride's page, need "rides"), widgets (cards in the Plugins tab, never on Today), each { id, title, entry }. Unknown keys are refused; never add network, internet, sites, secrets or write.

Example:
${EXAMPLE}

Types (TypeScript, for reference):
${types}`;
