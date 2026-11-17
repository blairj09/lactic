// Builds the live app demo on lactic.fit (site/demo/) from the latest *released* Lactic, so the
// homepage always shows the app riders download, never unreleased work on main.
//
//   node scripts/build-demo.mjs            the latest GitHub release (what Vercel runs)
//   DEMO_REF=v0.1.5 node scripts/...       a given tag
//   DEMO_REF=local node scripts/...        this checkout's app/, for trying demo changes before release
//                                          (Vercel's pull request previews do this on their own)
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
// The try-a-ride page (lactic.fit/ride/), from releases that have it (`build:ride`).
const RIDE_OUT = join(SITE, "ride");
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

/** Builds the try-a-ride page when this app has it; `from` is where it lands, to copy here (null: already here). */
function buildRide(app, from) {
  if (!hasScript(app, "build:ride")) return console.log("This release has no try-a-ride page.");
  run("npm", ["run", "build:ride"], app);
  if (from) cpSync(from, RIDE_OUT, { recursive: true });
  const page = join(RIDE_OUT, "index.html");
  if (existsSync(page)) writeFileSync(page, withAnalytics(readFileSync(page, "utf8")));
}

/** Adds the site's visit counting (analytics.js, with our own-traffic opt-out) to a built page. */
export function withAnalytics(html) {
  if (html.includes("/analytics.js")) return html;
  const tag = '<script src="/analytics.js"></script>\n';
  return html.includes("</body>") ? html.replace("</body>", tag + "</body>") : html + tag;
}

export function hasScript(app, name) {
  return Boolean(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).scripts?.[name]);
}

async function main() {
  // Pull request previews show the branch's own app, so app changes to the demo or the try-a-ride
  // page can be checked there before they ship; lactic.fit itself always shows the latest release.
  const ref = process.env.DEMO_REF || (process.env.VERCEL_ENV === "preview" ? "local" : await latestTag());
  rmSync(OUT, { recursive: true, force: true });
  rmSync(RIDE_OUT, { recursive: true, force: true });

  if (ref === "local") {
    const app = join(SITE, "..", "app");
    run("npm", ["ci", "--no-audit", "--no-fund"], app);
    run("npm", ["run", "build:demo"], app);
    buildRide(app, null);
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
    buildRide(app, join(src, "site", "ride"));
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
