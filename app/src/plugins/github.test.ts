// Adding plugins from GitHub: link parsing, picking the release file, and update offers.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSqlJs } from "~/db/sqljs";
import { setSql, sql } from "~/db/sql";
import { migrate } from "~/db/migrate";
import { setDeviceIdForTests } from "./device";
import { packagePlugin, parsePackage } from "./package";
import { fetchFromGitHub, GitHubError, latestPluginFile, originOf, parseOrigin, parseRepoLink, type Fetch } from "./github";
import { installPlugin, listPlugins, updatePlugin } from "./store";
import { checkForUpdates, forgetUpdateChecks } from "./updates";

const manifest = (version: string, over: Record<string, unknown> = {}) => ({
  apiVersion: 1,
  id: "wprime-tools",
  name: "W′ Tools",
  version,
  description: "W′ balance.",
  author: "riderlabs",
  main: "main.js",
  permissions: { read: ["live"] },
  publishes: [],
  contributes: { widgets: [], fields: [{ id: "balance", title: "W′ balance", entry: "field" }] },
  ...over,
});
const CODE = "lactic.register({ field() { return {} } });";
const REPO = { owner: "riderlabs", repo: "wprime-tools" };
const DL = "https://github.com/riderlabs/wprime-tools/releases/download/v0.5.0/wprime-tools.lacticplugin";

function fakeGitHub(release: unknown, files: Record<string, string> = {}, status = 200): Fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    if (url.startsWith("https://api.github.com/")) return new Response(JSON.stringify(release), { status });
    if (url in files) return new Response(files[url]);
    return new Response("", { status: 404 });
  }) as Fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

const release = (assets: unknown[], extra: Record<string, unknown> = {}) => ({ tag_name: "v0.5.0", prerelease: false, draft: false, assets, ...extra });
const asset = (name = "wprime-tools.lacticplugin", url = DL, size = 100) => ({ name, browser_download_url: url, size });

describe("GitHub links", () => {
  it("takes repository links in the usual shapes", () => {
    for (const t of ["https://github.com/riderlabs/wprime-tools", "github.com/riderlabs/wprime-tools/releases/tag/v1", "riderlabs/wprime-tools", "https://github.com/riderlabs/wprime-tools.git", " http://www.github.com/riderlabs/wprime-tools?tab=readme "]) {
      expect(parseRepoLink(t)).toEqual(REPO);
    }
  });

  it("refuses other sites and junk", () => {
    for (const t of ["https://gitlab.com/riderlabs/wprime-tools", "evil.example/riderlabs/x", "riderlabs", "", "https://github.com/riderlabs/..", "github.com/-bad/x", "github.com/a b/c"]) {
      expect(parseRepoLink(t)).toBeNull();
    }
  });

  it("round-trips the stored origin", () => {
    expect(parseOrigin(originOf(REPO))).toEqual(REPO);
    expect(parseOrigin("github:../x/y")).toBeNull();
    expect(parseOrigin(null)).toBeNull();
  });
});

describe("the release file", () => {
  it("takes the one .lacticplugin file of the latest release", async () => {
    const text = packagePlugin(manifest("0.5.0"), CODE);
    const f = fakeGitHub(release([asset("notes.txt", "https://github.com/riderlabs/wprime-tools/releases/download/v0.5.0/notes.txt"), asset()]), { [DL]: text });
    const got = await fetchFromGitHub(REPO, f);
    expect(got.text).toBe(text);
    expect(got.file.tag).toBe("v0.5.0");
    expect(f.calls[0]).toBe("https://api.github.com/repos/riderlabs/wprime-tools/releases/latest");
  });

  it("says why when there's nothing to add", async () => {
    await expect(latestPluginFile(REPO, fakeGitHub({}, {}, 404))).rejects.toThrow("No release found there.");
    await expect(latestPluginFile(REPO, fakeGitHub(release([])))).rejects.toThrow(/no \.lacticplugin file/);
    await expect(latestPluginFile(REPO, fakeGitHub(release([asset(), asset("b.lacticplugin")])))).rejects.toThrow(/more than one/);
    await expect(latestPluginFile(REPO, fakeGitHub(release([asset()], { prerelease: true })))).rejects.toThrow("No release found there.");
    await expect(latestPluginFile(REPO, fakeGitHub(release([asset(undefined, undefined, 2 * 1024 * 1024)])))).rejects.toThrow(/1 MB/);
    await expect(latestPluginFile(REPO, (async () => Promise.reject(new Error("offline"))) as Fetch)).rejects.toBeInstanceOf(GitHubError);
  });

  it("only downloads from the repository's own release downloads", async () => {
    for (const url of ["https://evil.example/x.lacticplugin", "http://github.com/riderlabs/wprime-tools/releases/download/v1/x.lacticplugin", "https://github.com/someone-else/repo/releases/download/v1/x.lacticplugin"]) {
      await expect(latestPluginFile(REPO, fakeGitHub(release([asset(undefined, url)])))).rejects.toThrow("That release file isn't on GitHub.");
    }
  });
});

describe("update offers", () => {
  beforeAll(async () => {
    const db = await openSqlJs({ persist: false });
    await migrate(db);
    setSql(db);
  });

  beforeEach(async () => {
    setDeviceIdForTests("11111111-1111-4111-8111-111111111111");
    forgetUpdateChecks();
    await sql().batch(["plugins", "plugin_grants", "plugin_values"].map((t) => ({ sql: `DELETE FROM ${t}` })));
  });

  async function install(version: string, origin: string | null) {
    const r = await parsePackage(packagePlugin(manifest(version), CODE));
    if (!r.ok) throw new Error("bad");
    await installPlugin(r.pkg, {}, origin);
  }

  it("offers a newer GitHub release, and only offers it", async () => {
    await install("0.4.0", originOf(REPO));
    const f = fakeGitHub(release([asset()]), { [DL]: packagePlugin(manifest("0.5.0"), CODE) });
    const offers = await checkForUpdates(await listPlugins(), f);
    expect(offers.get("wprime-tools")?.changes.to).toBe("0.5.0");
    expect((await listPlugins())[0].manifest.version).toBe("0.4.0");
  });

  it("checks once an hour, never for file plugins, and offers nothing older", async () => {
    await install("0.4.0", null);
    const f = fakeGitHub(release([asset()]), { [DL]: packagePlugin(manifest("0.5.0"), CODE) });
    expect((await checkForUpdates(await listPlugins(), f)).size).toBe(0);
    expect(f.calls).toHaveLength(0);

    await sql().execute(`UPDATE plugins SET origin = ?`, [originOf(REPO)]);
    const older = fakeGitHub(release([asset()]), { [DL]: packagePlugin(manifest("0.3.0"), CODE) });
    expect((await checkForUpdates(await listPlugins(), older)).size).toBe(0);
    await checkForUpdates(await listPlugins(), older);
    expect(older.calls).toHaveLength(2); // one check: the release, then the file
  });

  it("keeps the GitHub origin when updated from a file", async () => {
    await install("0.4.0", originOf(REPO));
    const r = await parsePackage(packagePlugin(manifest("0.5.0"), CODE));
    if (!r.ok) throw new Error("bad");
    await updatePlugin(r.pkg);
    expect((await listPlugins())[0].origin).toBe(originOf(REPO));
  });
});
