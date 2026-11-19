// The test drive handoff on the app's side: lactic.fit/ride's "Open Lactic" link (src/try/handoff.ts)
// reaches the Rust core (src-tauri/src/handoff.rs), which holds it until this takes it. First run's
// "About you" comes prefilled from it; a rider who's already set up gets HandoffSheet.

import { decodeFit } from "@shared/fit/decode";
import { rideFromFit, type ImportedRide } from "@shared/fit/ride";
import { importRides, setFtp } from "@/app/actions";
import { isDesktop, invoke, listen } from "~/platform/native";
import { readHandoff, type Handoff } from "~/try/handoff";

export interface TestDrive {
  ftp: number;
  method: Handoff["method"];
  ride: ImportedRide | null;
}

let current: TestDrive | null = null;

function fromHandoff(h: Handoff): TestDrive {
  let ride: ImportedRide | null = null;
  if (h.ride) {
    try {
      ride = rideFromFit(decodeFit(h.ride.fit), `${h.ride.name}.fit`);
    } catch {
      ride = null;
    }
  }
  return { ftp: h.ftp, method: h.method, ride };
}

/** The test drive waiting to be used, collecting a new link from the Rust core first. */
export async function pendingTestDrive(): Promise<TestDrive | null> {
  if (!isDesktop) return current;
  const url = await invoke<string | null>("handoff_take").catch(() => null);
  const h = url ? readHandoff(url) : null;
  if (h) current = fromHandoff(h);
  return current;
}

/** Done with it: used, or turned down. */
export function clearTestDrive() {
  current = null;
}

/** Calls back with each test drive link that arrives while the app is open. */
export function watchTestDrive(on: (t: TestDrive) => void): () => void {
  if (!isDesktop) return () => undefined;
  const check = () => void pendingTestDrive().then((t) => t && on(t));
  check();
  const stop = listen("lactic:handoff", check);
  return () => void stop.then((s) => s());
}

/**
 * Puts the test drive in: its FTP (when `useFtp`, recorded as the test it came from) and then its
 * ride, so the ride's stress is worked out from that FTP.
 */
export async function applyTestDrive(t: TestDrive, { useFtp, addRide }: { useFtp: boolean; addRide: boolean }): Promise<{ ok: boolean; message: string }> {
  if (useFtp) {
    const r = await setFtp(t.ftp, t.method);
    if (!r.ok) return r;
  }
  if (addRide && t.ride) {
    const r = await importRides([t.ride]);
    if (!r.ok) return r;
  }
  clearTestDrive();
  return { ok: true, message: "" };
}
