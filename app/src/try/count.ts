// Test drive counts for lactic.fit/ride. Each step a visitor reaches shows in Vercel Web Analytics
// (Pages) as a visit to /test-drive/<gear>/<step>, the same way downloads show as /download/<system>.
// No personal data: Web Analytics is cookieless, and the site's analytics.js (with its ?count=off
// opt-out, robot and preview filters) decides whether anything is sent at all.

export type TestDriveStep =
  | "connected"
  | "started"
  | "finished"
  | "saved-fit"
  | "posted-strava"
  | "opened-app";

/** The counted path: `trainer` for the visitor's own trainer, `simulated` for Lactic's sim. */
export function testDrivePath(step: TestDriveStep, simulated: boolean): string {
  return `/test-drive/${simulated ? "simulated" : "trainer"}/${step}`;
}

type Va = (event: "pageview", props: { route: string; path: string }) => void;

/** Counts one test drive step. Does nothing where analytics.js isn't on the page. */
export function countTestDrive(step: TestDriveStep, simulated: boolean): void {
  const va = (globalThis as { va?: Va }).va ?? parentVa();
  if (typeof va === "function")
    va("pageview", {
      route: "/test-drive/[gear]/[step]",
      path: testDrivePath(step, simulated),
    });
}

/** The homepage's analytics, when this runs in its live app window (same origin). */
function parentVa(): Va | undefined {
  try {
    const parent = (globalThis as { parent?: { va?: Va } }).parent;
    return parent && parent !== (globalThis as unknown) ? parent.va : undefined;
  } catch {
    return undefined;
  }
}
