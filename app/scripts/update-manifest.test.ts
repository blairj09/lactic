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

  it("turns GitHub's generated notes into a short list", () => {
    const generated = [
      "## What's Changed",
      "* Today: an Indoors / Outside switch with one Start ride button by @blairj09 in https://github.com/blairj09/lactic/pull/29",
      "* In-app updates: check on every start (#30) by @blairj09 in https://github.com/blairj09/lactic/pull/30",
      "",
      "## New Contributors",
      "* @someone made their first contribution in https://github.com/blairj09/lactic/pull/31",
      "",
      "**Full Changelog**: https://github.com/blairj09/lactic/compare/v0.1.2...v0.1.3",
    ].join("\n");
    expect(whatsNew(generated)).toBe("- Today: an Indoors / Outside switch with one Start ride button\n- In-app updates: check on every start");
  });

  it("skips unsigned builds and refuses a release with none", () => {
    expect(() => manifest({ paths: release(["Lactic_0.2.0_aarch64.dmg", "Lactic_0.2.0_amd64.deb"]), version: "0.2.0", repo: "a/b" })).toThrow(/No signed builds/);
  });
});
