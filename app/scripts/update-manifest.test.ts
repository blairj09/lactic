import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: plain ESM script for CI, no types
import { manifest, whatsNew } from "./update-manifest.mjs";

function release(names: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "lactic-release-"));
  const paths: string[] = [];
  for (const name of names) {
    writeFileSync(join(dir, name), name.endsWith(".sig") ? `sig of ${name.slice(0, -4)}\n` : "build");
    paths.push(join(dir, name));
  }
  return paths;
}

describe("update manifest", () => {
  it("lists each signed build under the names the updater looks for", () => {
    const paths = release([
      "Lactic_0.2.0_aarch64.dmg",
      "Lactic_0.2.0_aarch64.app.tar.gz",
      "Lactic_0.2.0_aarch64.app.tar.gz.sig",
      "Lactic_0.2.0_x64-setup.exe",
      "Lactic_0.2.0_x64-setup.exe.sig",
      "Lactic_0.2.0_amd64.AppImage",
      "Lactic_0.2.0_amd64.AppImage.sig",
      "Lactic_0.2.0_amd64.deb",
      "Lactic_0.2.0_amd64.deb.sig",
    ]);
    const m = manifest({ paths, version: "0.2.0", repo: "blairj09/lactic", date: new Date("2026-11-08T01:02:03.456Z") });
    expect(m.version).toBe("0.2.0");
    expect(m.pub_date).toBe("2026-11-08T01:02:03Z");
    expect(Object.keys(m.platforms).sort()).toEqual(["darwin-aarch64", "darwin-aarch64-app", "linux-x86_64", "linux-x86_64-appimage", "linux-x86_64-deb", "windows-x86_64", "windows-x86_64-nsis"]);
    expect(m.platforms["darwin-aarch64"]).toEqual({
      signature: "sig of Lactic_0.2.0_aarch64.app.tar.gz",
      url: "https://github.com/blairj09/lactic/releases/download/v0.2.0/Lactic_0.2.0_aarch64.app.tar.gz",
    });
    expect(m.platforms["linux-x86_64"].url).toMatch(/\.AppImage$/);
    expect(m.platforms["linux-x86_64-deb"].url).toMatch(/\.deb$/);
  });

  it("lists a universal Mac app for both Apple silicon and Intel", () => {
    const paths = release(["Lactic_0.2.0_universal.dmg", "Lactic_0.2.0_universal.app.tar.gz", "Lactic_0.2.0_universal.app.tar.gz.sig"]);
    const m = manifest({ paths, version: "0.2.0", repo: "blairj09/lactic" });
    expect(Object.keys(m.platforms).sort()).toEqual(["darwin-aarch64", "darwin-aarch64-app", "darwin-x86_64", "darwin-x86_64-app"]);
    expect(m.platforms["darwin-x86_64"]).toEqual(m.platforms["darwin-aarch64"]);
    expect(m.platforms["darwin-x86_64"].url).toMatch(/Lactic_0\.2\.0_universal\.app\.tar\.gz$/);
  });

  it("takes one release's rider-facing notes from whats-new.md", () => {
    const md = ["# What's new in Lactic", "", "Intro text.", "", "## Next", "", "- Not shipped yet", "", "## 0.1.3", "", "- Lactic checks for updates when it starts.", "* Release notes in the app.", "", "## 0.1.2", "", "- Older"].join("\n");
    expect(whatsNew(md, "0.1.3")).toBe("- Lactic checks for updates when it starts.\n- Release notes in the app.");
    expect(whatsNew(md, "v0.1.2")).toBe("- Older");
    expect(whatsNew(md, "0.9.0")).toBe("");
  });

  it("skips unsigned builds and refuses a release with none", () => {
    expect(() => manifest({ paths: release(["Lactic_0.2.0_aarch64.dmg", "Lactic_0.2.0_amd64.deb"]), version: "0.2.0", repo: "a/b" })).toThrow(/No signed builds/);
  });
});
