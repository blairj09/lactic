// Settings for a paired iPhone, on both ends. On the computer: pair an iPhone (a QR code) and see
// or forget paired ones. On the iPhone: the computer it syncs with, and Apple Health.

import { useEffect, useState } from "react";
import { renderSVG } from "uqr";
import { button, Pill, Result } from "@/components/ui";
import { invoke, listen } from "~/platform/native";
import { getSetting, setSetting } from "~/settings/store";
import { connectHealth, syncPhoneHealth, WRITE_RIDES } from "./health";
import { onLinkState, resetLink, syncWithComputer, type LinkState } from "./link";
import { pair, phoneStatus, readable, send, unpair, type PhoneStatus } from "./plugin";

interface Device {
  id: string;
  name: string;
  pairedAt: number;
  lastSeen: number | null;
}

interface ComputerStatus {
  devices: Device[];
  listening: boolean;
  port: number | null;
  computer: string;
}

interface Offer {
  url: string;
  expiresAt: number;
  hosts: string[];
  port: number;
}

export function ago(ms: number | null | undefined): string {
  if (!ms) return "never";
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// --- on the computer -------------------------------------------------------------------------------

export function PairPhone() {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<string | null>(null);
  const [, tick] = useState(0);

  const refresh = () => void invoke<ComputerStatus>("phone_status").then(setStatus).catch(() => {});
  useEffect(() => {
    refresh();
    const stop = listen<{ name: string }>("phone:paired", (p) => {
      setOffer(null);
      setPaired(p.name);
      refresh();
    });
    const timer = setInterval(() => tick((n) => n + 1), 15_000);
    return () => {
      void stop.then((s) => s());
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!offer) return;
    const left = offer.expiresAt - Date.now();
    const t = setTimeout(() => setOffer(null), Math.max(0, left));
    return () => clearTimeout(t);
  }, [offer]);

  async function start() {
    setError(null);
    setPaired(null);
    try {
      setOffer(await invoke<Offer>("phone_pair_start"));
    } catch (e) {
      setError(readable(e).message);
    }
  }

  async function cancel() {
    setOffer(null);
    await invoke("phone_pair_cancel").catch(() => {});
  }

  async function forget(d: Device) {
    if (!window.confirm(`Unpair ${d.name}? It stops syncing with this computer. What's already on it stays there.`)) return;
    await invoke("phone_forget", { id: d.id }).catch((e) => setError(String(e)));
    refresh();
  }

  return (
    <div className="space-y-4 sm:col-span-2">
      {status?.devices.length ? (
        <ul className="divide-y divide-line rounded-md border border-line">
          {status.devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{d.name}</p>
                <p className="text-sm text-muted">Last synced {ago(d.lastSeen)}</p>
              </div>
              <button type="button" className={button.small} onClick={() => void forget(d)}>
                Unpair
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {paired && <Result ok>{paired} is paired. It's bringing your data across now.</Result>}
      {offer ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* A QR code needs dark on light, in either theme. */}
          <div className="w-48 flex-none rounded-lg bg-white p-3" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: renderSVG(offer.url, { border: 1 }) }} />
          <div className="space-y-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Open Lactic on your iPhone.</li>
              <li>Tap <span className="font-medium">Pair with your computer</span> (or Settings → Your computer).</li>
              <li>Scan this code. Your iPhone needs to be on the same Wi-Fi as this computer.</li>
            </ol>
            <p className="text-muted">The code works for 10 minutes and only once. Everything between the two stays on your network, encrypted.</p>
            <button type="button" className={button.secondary} onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={button.secondary} onClick={() => void start()}>
          {status?.devices.length ? "Pair another iPhone" : "Pair an iPhone"}
        </button>
      )}
      {error && <Result ok={false}>{error}</Result>}
    </div>
  );
}

// --- on the iPhone -----------------------------------------------------------------------------------

/** Opens the camera for the computer's QR code; resolves with the link it holds (null if cancelled). */
export async function scanPairingCode(): Promise<string | null> {
  const scanner = await import("@tauri-apps/plugin-barcode-scanner");
  let permission = await scanner.checkPermissions();
  if (permission !== "granted") permission = await scanner.requestPermissions();
  if (permission !== "granted") throw new Error("Lactic needs the camera to scan the code. Allow it in the iPhone's Settings → Lactic, or paste the link instead.");
  const result = await scanner.scan({ windowed: false, formats: [scanner.Format.QRCode] });
  return result?.content ?? null;
}

/** Pieces of the database, in base64 characters (a multiple of 4), small enough for one request. */
const PIECE = 1 << 20;

/** What a phone used on its own brings to a computer that has its own plan: what it rode and measured. */
const KEEP_TABLES = ["activities", "activity_streams", "ride_feedback", "intervals_uploads", "strava_uploads", "ftp_history", "body_measurements", "health_days", "recovery_days", "custom_workouts", "workout_favorites"];

/**
 * A phone set up on its own, pairing with a computer: a computer new to Lactic starts from this
 * phone's data, sent whole ("sent"). One that has its own takes the rides and measurements from the
 * phone in the sync that follows, and stays the plan and settings ("keep"). A phone that's new
 * itself just takes the computer's copy ("none").
 */
async function bringDataToComputer(onProgress: (fraction: number) => void): Promise<"sent" | "keep" | "none"> {
  if (!(await getSetting("onboarding.done", false))) return "none";
  const { fresh } = await send<{ fresh: boolean }>("status", {}, 15);
  if (!fresh) return "keep";
  const live = await invoke<string>("db_path");
  const copy = live.replace(/[^/\\]+$/, "lactic-to-computer.db");
  await invoke("db_backup", { to: copy });
  try {
    const data = await invoke<string>("file_read_base64", { path: copy });
    const n = Math.max(1, Math.ceil(data.length / PIECE));
    for (let i = 0; i < n; i++) {
      onProgress(i / n);
      await send("adopt", { i, n, data: data.slice(i * PIECE, (i + 1) * PIECE) }, 120);
    }
    onProgress(1);
    return "sent";
  } finally {
    await invoke("file_write_base64", { path: copy, data: "" }).catch(() => {});
  }
}

/** Scan (or paste) the computer's code and pair. */
export function PairWithComputer({ onPaired }: { onPaired?: (computer: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [link, setLink] = useState("");

  async function finish(url: string | null) {
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      // The first request on the network makes iOS ask to allow local network access, and fails
      // while it asks: try once more after a moment.
      const { computer } = await pair(url.trim()).catch(async () => {
        await new Promise((r) => setTimeout(r, 2500));
        return pair(url.trim());
      });
      const brought = await bringDataToComputer(setSending);
      await resetLink();
      if (brought === "keep") await invoke("sync_keep", { tables: KEEP_TABLES });
      onPaired?.(computer);
      void syncWithComputer();
    } catch (e) {
      setError(readable(e).message);
    } finally {
      setBusy(false);
      setSending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button.primary} disabled={busy} onClick={() => void scanPairingCode().then(finish, (e) => setError(readable(e).message))}>
          {sending !== null ? `Sending your data… ${Math.round(sending * 100)}%` : busy ? "Pairing…" : "Scan the code"}
        </button>
        <button type="button" className={button.secondary} disabled={busy} onClick={() => setPasting((p) => !p)}>
          Paste the link
        </button>
      </div>
      {pasting && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void finish(link);
          }}
        >
          <input className="h-9 min-w-0 flex-1 rounded-md border border-control bg-surface px-3 text-sm" placeholder="https://lactic.fit/pair#…" value={link} onChange={(e) => setLink(e.target.value)} autoCapitalize="off" autoCorrect="off" />
          <button type="submit" className={button.secondary} disabled={busy || !link.trim()}>
            Pair
          </button>
        </form>
      )}
      {error && <Result ok={false}>{error}</Result>}
    </div>
  );
}

export function useLinkState(): LinkState | null {
  const [s, setS] = useState<LinkState | null>(null);
  useEffect(() => onLinkState(setS), []);
  return s;
}

export function ComputerLink() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const link = useLinkState();
  const refresh = () => void phoneStatus().then(setStatus).catch(() => {});
  useEffect(refresh, [link?.at]);

  if (!status) return null;
  if (!status.paired)
    return (
      <div className="space-y-3 sm:col-span-2">
        <p className="text-sm text-muted">On your computer, open Lactic → Settings → iPhone and click Pair an iPhone. Then scan the code it shows.</p>
        <PairWithComputer onPaired={refresh} />
      </div>
    );

  async function forget() {
    if (!window.confirm(`Stop syncing with ${status!.paired!.computer}? Everything already on this iPhone stays.`)) return;
    await unpair();
    await resetLink();
    refresh();
  }

  return (
    <div className="space-y-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{status.paired.computer}</p>
        {link?.running ? <Pill>Syncing…</Pill> : link?.error ? <Pill tone="warning">Not reachable</Pill> : <Pill tone="positive">Paired</Pill>}
      </div>
      <p className="text-sm text-muted">
        {link?.error ?? `Last synced ${ago(link?.at ?? status.paired.lastSentAt)}. Your computer keeps the main copy; this iPhone syncs with it over Wi-Fi whenever Lactic is open on both.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button.secondary} disabled={link?.running} onClick={() => void syncWithComputer()}>
          Sync now
        </button>
        <button type="button" className={button.ghost} onClick={() => void forget()}>
          Unpair
        </button>
      </div>
    </div>
  );
}

export function PhoneHealth() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [writeRides, setWriteRides] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const refresh = () => void phoneStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    refresh();
    void getSetting<boolean>(WRITE_RIDES, true).then(setWriteRides);
  }, []);

  if (!status) return null;
  if (!status.healthAvailable) return <p className="text-sm text-muted sm:col-span-2">Apple Health isn't available on this device.</p>;

  async function connect() {
    setBusy(true);
    setResult(null);
    try {
      await connectHealth();
      const latest = await syncPhoneHealth();
      setResult({ ok: true, message: latest ? `Connected. Latest ${latest}.` : "Connected. Nothing from last night yet." });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function readNow() {
    setBusy(true);
    const latest = await syncPhoneHealth();
    setResult({ ok: true, message: latest ? `Latest ${latest}.` : "Nothing new from Health." });
    setBusy(false);
  }

  return (
    <div className="space-y-3 sm:col-span-2">
      <p className="text-sm text-muted">
        Lactic reads sleep, HRV, resting heart rate, breathing, wrist temperature, heart rate, steps and VO2 max straight from Health, and picks up new nights on its own. No Shortcut needed.
      </p>
      {status.healthAsked ? (
        <button type="button" className={button.secondary} disabled={busy} onClick={() => void readNow()}>
          {busy ? "Reading…" : "Read Health now"}
        </button>
      ) : (
        <button type="button" className={button.primary} disabled={busy} onClick={() => void connect()}>
          {busy ? "Connecting…" : "Connect Apple Health"}
        </button>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={writeRides}
          onChange={(e) => {
            setWriteRides(e.target.checked);
            void setSetting(WRITE_RIDES, e.target.checked);
          }}
        />
        <span>
          Save rides to Health as cycling workouts
          <span className="block text-muted">With heart rate, power, cadence, distance and energy. Rides Zwift or your bike computer already put there are skipped.</span>
        </span>
      </label>
      {status.healthAsked && <p className="text-sm text-muted">To change what Lactic can read or write, open the Health app → your picture → Apps → Lactic.</p>}
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </div>
  );
}
