// Vercel's "ignored build step" (vercel.json ignoreCommand): exit 1 to build, 0 to skip.
// Builds when the site itself changed, or (production only) when lactic.fit's demo isn't from the
// latest release yet. So a new release reaches the homepage on the release workflow's deploy hook,
// or failing that on the next push to main of any kind.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { latestTag } from "./build-demo.mjs";

const SITE_URL = process.env.SITE_URL || "https://lactic.fit";
const BUILD = 1;
const SKIP = 0;

function siteChanged() {
  const prev = process.env.VERCEL_GIT_PREVIOUS_SHA;
  for (const base of [prev, "HEAD^"].filter(Boolean)) {
    try {
      execFileSync("git", ["diff", "--quiet", base, "HEAD", "--", "."], { stdio: "ignore" });
      return false;
    } catch (err) {
      if (err.status === 1) return true; // differences
      // base isn't in this (shallow) clone: try the next one
    }
  }
  return true;
}

async function liveTag() {
  const res = await fetch(`${SITE_URL}/demo/release.json`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()).tag || null;
}

export async function decide({ changed, production, latest, live }) {
  if (changed) return { code: BUILD, why: "the site changed" };
  if (!production) return { code: SKIP, why: "no site changes" };
  let want, have;
  try {
    [want, have] = await Promise.all([latest(), live()]);
  } catch (err) {
    return { code: BUILD, why: `couldn't compare releases (${err.message})` };
  }
  if (want !== have) return { code: BUILD, why: `lactic.fit shows ${have || "no release"}, latest is ${want}` };
  return { code: SKIP, why: `lactic.fit already shows ${want}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, why } = await decide({
    changed: siteChanged(),
    production: process.env.VERCEL_ENV === "production",
    latest: () => latestTag(),
    live: liveTag,
  });
  console.log(code === BUILD ? `Building: ${why}.` : `Skipping: ${why}.`);
  process.exit(code);
}
