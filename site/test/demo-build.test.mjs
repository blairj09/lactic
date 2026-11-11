import { test } from "node:test";
import assert from "node:assert/strict";
import { latestTag, tagFromLocation } from "../scripts/build-demo.mjs";
import { decide } from "../scripts/should-build.mjs";

test("reads the tag from the releases/latest redirect", () => {
  assert.equal(tagFromLocation("https://github.com/blairj09/lactic/releases/tag/v0.2.0"), "v0.2.0");
  assert.equal(tagFromLocation("https://github.com/blairj09/lactic/releases"), null);
  assert.equal(tagFromLocation(null), null);
});

test("latestTag fails loudly when there's no redirect", async () => {
  const fake = async () => ({ status: 200, headers: new Headers() });
  await assert.rejects(() => latestTag("x/y", fake), /latest release/);
  const ok = async () => ({ status: 302, headers: new Headers({ location: "https://github.com/x/y/releases/tag/v1.2.3" }) });
  assert.equal(await latestTag("x/y", ok), "v1.2.3");
});

const tags = (latest, live) => ({ latest: async () => latest, live: async () => live });

test("builds when the site changed", async () => {
  assert.equal((await decide({ changed: true, production: false, ...tags("v1", "v1") })).code, 1);
});

test("previews without site changes skip", async () => {
  assert.equal((await decide({ changed: false, production: false, ...tags("v2", "v1") })).code, 0);
});

test("production rebuilds when a newer release is out", async () => {
  assert.equal((await decide({ changed: false, production: true, ...tags("v2", "v1") })).code, 1);
  assert.equal((await decide({ changed: false, production: true, ...tags("v2", null) })).code, 1);
  assert.equal((await decide({ changed: false, production: true, ...tags("v2", "v2") })).code, 0);
});

test("production builds when it can't tell", async () => {
  const r = await decide({ changed: false, production: true, latest: async () => { throw new Error("offline"); }, live: async () => "v1" });
  assert.equal(r.code, 1);
});
