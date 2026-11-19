// The test drive handoff: lactic.fit/ride's "Open Lactic" link carries the rider's FTP (and the
// ride, as a FIT file) into the app, so setup comes prefilled. Nothing goes through a server: the
// browser opens a lactic:// link and the app reads it (src-tauri/src/handoff.rs passes it on).
//
// lactic://lactic.fit/test-drive?ftp=245&method=rampTest&name=Ramp%20test&fit=<deflated, base64url>

import { deflateSync, inflateSync } from "fflate";

export type HandoffMethod = "rampTest" | "twentyMinute" | "manual";

export interface Handoff {
  ftp: number;
  /** How the FTP was found: a test on the test drive, or typed in. */
  method: HandoffMethod;
  /** The test drive itself, unless it was simulated. */
  ride: { name: string; fit: Uint8Array } | null;
}

export const HANDOFF_PATH = "/test-drive";
const HOST = "lactic.fit";
const METHODS: HandoffMethod[] = ["rampTest", "twentyMinute", "manual"];
/** A long ride's FIT is a few hundred kB; anything far past that isn't one of ours. */
const MAX_FIT_BYTES = 8 * 1024 * 1024;
const MAX_NAME = 80;
/** The deflated FIT in the link; a three-hour ride is well under this. */
const MAX_FIT_TEXT = 1024 * 1024;

/** The app's link scheme: `lactic`, or `lactic-preview` for the Preview build (lactic.fit/ride?app=preview). */
export function handoffScheme(search: string): string {
  return new URLSearchParams(search).get("app") === "preview" ? "lactic-preview" : "lactic";
}

export function handoffUrl(h: Handoff, scheme = "lactic"): string {
  const q = new URLSearchParams({ ftp: String(Math.round(h.ftp)), method: h.method });
  if (h.ride) {
    q.set("name", h.ride.name.slice(0, MAX_NAME));
    q.set("fit", toBase64Url(deflateSync(h.ride.fit, { level: 9 })));
  }
  return `${scheme}://${HOST}${HANDOFF_PATH}?${q}`;
}

/** Reads a handoff link, or null when it isn't one (or doesn't hold up). */
export function readHandoff(link: string): Handoff | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!/^lactic(-[a-z]+)?:$/.test(url.protocol) || url.hostname !== HOST || url.pathname !== HANDOFF_PATH) return null;
  const q = url.searchParams;
  const ftp = Number(q.get("ftp"));
  if (!Number.isInteger(ftp) || ftp <= 50 || ftp >= 700) return null;
  const method = METHODS.find((m) => m === q.get("method")) ?? "manual";
  let ride: Handoff["ride"] = null;
  const fit = q.get("fit");
  if (fit && fit.length <= MAX_FIT_TEXT) {
    try {
      const bytes = inflateSync(fromBase64Url(fit));
      if (bytes.length > 0 && bytes.length <= MAX_FIT_BYTES) ride = { name: (q.get("name") ?? "").trim().slice(0, MAX_NAME) || "Test drive", fit: bytes };
    } catch {
      ride = null;
    }
  }
  return { ftp, method, ride };
}

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("Not base64url");
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
