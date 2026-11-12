import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, summarize } from "../api/stats.js";

const files = (v, counts) => Object.entries(counts).map(([suffix, download_count]) => ({ name: suffix === "latest.json" ? suffix : `Lactic_${v}_${suffix}`, download_count }));

const releases = [
  { tag_name: "preview", prerelease: true, published_at: "2026-11-12T00:00:00Z", assets: files("0.2.0-preview.1", { "universal.dmg": 50 }) },
  { tag_name: "v0.2.0", published_at: "2026-11-11T00:00:00Z", assets: files("0.2.0", { "universal.dmg": 4, "universal.app.tar.gz": 9, "universal.app.tar.gz.sig": 9, "x64-setup.exe": 3, "x64-setup.exe.sig": 3, "amd64.AppImage": 2, "amd64.deb": 1, "latest.json": 20 }) },
  { tag_name: "v0.1.5", published_at: "2026-11-09T00:00:00Z", assets: files("0.1.5", { "universal.dmg": 7, "x64-setup.exe": 7 }) },
];

test("counts installers, updates and checks per release, skipping previews and signatures", () => {
  const s = summarize(releases);
  assert.deepEqual(s.releases.map((r) => r.version), ["0.2.0", "0.1.5"]);
  assert.deepEqual(s.releases[0].counts, { mac: 4, macUpdate: 9, windows: 3, appimage: 2, deb: 1, checks: 20 });
  assert.equal(s.releases[0].downloads, 10);
  assert.equal(s.totals.mac, 11);
  assert.equal(s.totals.downloads, 24);
});

test("answers JSON, or 502 when GitHub is down", async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(releases), { status: 200 });
    const res = await GET();
    assert.equal(res.status, 200);
    assert.equal((await res.json()).totals.windows, 10);
  } finally {
    globalThis.fetch = real;
  }
});
