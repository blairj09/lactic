// Builds the live app demo on lactic.fit (site/demo/) from the latest *released* Lactic, so the
// homepage always shows the app riders download, never unreleased work on main.
//
//   node scripts/build-demo.mjs            the latest GitHub release (what Vercel runs)
//   DEMO_REF=v0.1.5 node scripts/...       a given tag
//   DEMO_REF=local node scripts/...        this checkout's app/, for trying demo changes before release
//
// It downloads that tag's source, runs the tag's own `npm run build:demo`, and copies the result
// here with demo/release.json ({ version, tag }), which scripts/should-build.mjs reads back from
// lactic.fit to tell whether a newer release needs a redeploy. If GitHub can't be reached the
// build fails, so Vercel keeps the last good deployment instead of shipping main's app.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(SITE, "demo");
const REPO = process.env.GITHUB_REPO || "blairj09/lactic";

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

// The latest release's tag, from the redirect github.com/<repo>/releases/latest → …/tag/v0.2.0.
// (No API call, so no rate limit on shared build machines. Pre-releases like `preview` never count.)
export async function latestTag(repo = REPO, fetchImpl = fetch) {
  const res = await fetchImpl(`https://github.com/${repo}/releases/latest`, { method: "HEAD", redirect: "manual" });
  const tag = tagFromLocation(res.headers.get("location"));
  if (!tag) throw new Error(`Couldn't find the latest release of ${repo} (HTTP ${res.status})`);
  return tag;
}

export function tagFromLocation(location) {
  const m = /\/releases\/tag\/(v[^/?#]+)$/.exec(location || "");
  return m ? decodeURIComponent(m[1]) : null;
}

async function main() {
  const ref = process.env.DEMO_REF || (await latestTag());
  rmSync(OUT, { recursive: true, force: true });

  if (ref === "local") {
    const app = join(SITE, "..", "app");
    run("npm", ["ci", "--no-audit", "--no-fund"], app);
    run("npm", ["run", "build:demo"], app);
    const version = JSON.parse(readFileSync(join(app, "package.json"), "utf8")).version;
    writeFileSync(join(OUT, "release.json"), JSON.stringify({ version, tag: "local" }) + "\n");
    console.log(`Demo built from this checkout (app ${version}, unreleased).`);
    return;
  }

  console.log(`Building the site demo from ${REPO} ${ref}`);
  const work = mkdtempSync(join(tmpdir(), "lactic-demo-"));
  try {
    const res = await fetch(`https://codeload.github.com/${REPO}/tar.gz/refs/tags/${encodeURIComponent(ref)}`);
    if (!res.ok) throw new Error(`Couldn't download ${ref} (HTTP ${res.status})`);
    const tarball = join(work, "src.tar.gz");
    writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
    const src = join(work, "src");
    mkdirSync(src);
    run("tar", ["-xzf", tarball, "-C", src, "--strip-components=1"]);
    const app = join(src, "app");
    run("npm", ["ci", "--no-audit", "--no-fund"], app);
    // The tag's own script, so a release builds its demo exactly the way it did at the time.
    run("npm", ["run", "build:demo"], app);
    const built = join(src, "site", "demo");
    if (!existsSync(join(built, "index.html"))) throw new Error(`${ref} built no demo/index.html`);
    cpSync(built, OUT, { recursive: true });
    const version = JSON.parse(readFileSync(join(app, "package.json"), "utf8")).version;
    writeFileSync(join(OUT, "release.json"), JSON.stringify({ version, tag: ref }) + "\n");
    console.log(`Demo built from ${ref} (app ${version}).`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
