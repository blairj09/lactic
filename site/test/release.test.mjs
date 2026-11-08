// node --test test/  (from site/)
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, summarize } from "../api/release.js";

const release = {
  tag_name: "v0.1.2",
  published_at: "2026-11-08T01:07:50Z",
  html_url: "https://github.com/blairj09/lactic/releases/tag/v0.1.2",
  assets: ["Lactic_0.1.2_aarch64.dmg", "Lactic_0.1.2_amd64.AppImage", "Lactic_0.1.2_amd64.deb", "Lactic_0.1.2_x64-setup.exe", "latest.json"].map((name, i) => ({
    name, size: 1000 + i, browser_download_url: `https://github.com/blairj09/lactic/releases/download/v0.1.2/${name}`,
  })),
};

test("summarize picks one installer per platform", () => {
  const s = summarize(release);
  assert.equal(s.version, "0.1.2");
  assert.deepEqual(Object.keys(s.installers).sort(), ["appimage", "deb", "mac", "windows"]);
  assert.equal(s.installers.mac.name, "Lactic_0.1.2_aarch64.dmg");
  assert.equal(s.installers.windows.name, "Lactic_0.1.2_x64-setup.exe");
});

test("redirects to the installer and answers the page with sizes", async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(release), { status: 200 });
    let res = await GET(new Request("https://lactic.fit/api/release?get=windows"));
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location"), /x64-setup\.exe$/);
    res = await GET(new Request("https://lactic.fit/api/release"));
    assert.equal((await res.json()).installers.deb.size, 1002);
  } finally {
    globalThis.fetch = real;
  }
});
