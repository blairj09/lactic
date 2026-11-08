"use client";

import { useCallback, useEffect, useState } from "react";
import { DEVICE_KINDS, type DeviceKind } from "@/lib/ble/catalog";
import {
  DEVICES_CHANGED,
  canReconnectSilently,
  connectGatt,
  findRemembered,
  forgetDevice,
  isPickerCancel,
  rememberDevice,
  remembered,
  renameDevice,
  type DeviceKey,
  type RememberedDevice,
} from "@/lib/ble/devices";
import { AskCoach } from "@/app/coach/ask-coach";
import { POWER_SOURCE_PREF, isWebBluetoothAvailable, type PowerSource } from "@/lib/ble/sensor-hub";
import PairSheet from "@/components/pair-sheet";
import { Notice, Pill, Segmented, button, input } from "@/components/ui";
import { useFeatures } from "@/lib/use-features";

type Row = { saved?: RememberedDevice; silent: boolean };
type Check = { state: "checking" } | { state: "ok" } | { state: "failed"; message: string };

const when = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
};

/** Remembered Bluetooth devices: pair, check, rename and forget each, and the default power source. */
export default function BluetoothDevices() {
  const [supported, setSupported] = useState(true);
  const [silent, setSilent] = useState(true);
  const [rows, setRows] = useState<Partial<Record<DeviceKey, Row>>>({});
  const [checks, setChecks] = useState<Partial<Record<DeviceKey, Check>>>({});
  const [pairing, setPairing] = useState<DeviceKind | null>(null);
  // The scale row is for riders who track weight (or still have one paired, so they can forget it).
  const tracking = useFeatures();
  const [renaming, setRenaming] = useState<{ key: DeviceKey; value: string } | null>(null);
  const [forgetting, setForgetting] = useState<DeviceKey | null>(null);
  const [powerSource, setPowerSource] = useState<PowerSource>("trainer");

  const load = useCallback(async () => {
    const next: Partial<Record<DeviceKey, Row>> = {};
    for (const { key } of DEVICE_KINDS) {
      const saved = remembered(key);
      next[key] = { saved, silent: saved ? Boolean(await findRemembered(key)) : false };
    }
    setRows(next);
  }, []);

  useEffect(() => {
    setSupported(isWebBluetoothAvailable());
    setSilent(canReconnectSilently());
    try {
      setPowerSource(localStorage.getItem(POWER_SOURCE_PREF) === "powerMeter" ? "powerMeter" : "trainer");
    } catch {}
    load();
    const refresh = () => void load();
    window.addEventListener(DEVICES_CHANGED, refresh);
    return () => window.removeEventListener(DEVICES_CHANGED, refresh);
  }, [load]);

  const setCheck = (key: DeviceKey, check: Check | undefined) => setChecks((c) => ({ ...c, [key]: check }));

  /** Connects once to show the device answers, then lets go; the Ride page and syncs hold their own link. */
  const check = async (kind: DeviceKind, device?: BluetoothDevice) => {
    setCheck(kind.key, { state: "checking" });
    try {
      let target = device ?? (await findRemembered(kind.key));
      if (!target) {
        // Without Chrome's flags the app can't reach it silently, so Chrome's list confirms it.
        target = await navigator.bluetooth.requestDevice(kind.request);
        rememberDevice(kind.key, target);
      }
      await connectGatt(target, { attempts: 2 });
      target.gatt?.disconnect();
      setCheck(kind.key, { state: "ok" });
    } catch (e) {
      setCheck(kind.key, isPickerCancel(e) ? undefined : { state: "failed", message: `It didn't answer. ${kind.wake}` });
    }
  };

  const pair = async (kind: DeviceKind) => {
    try {
      const device = await navigator.bluetooth.requestDevice(kind.request);
      rememberDevice(kind.key, device);
      await check(kind, device);
    } catch (e) {
      if (!isPickerCancel(e)) setCheck(kind.key, { state: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const forget = async (key: DeviceKey) => {
    setForgetting(null);
    setCheck(key, undefined);
    await forgetDevice(key);
  };

  const pickPowerSource = (source: PowerSource) => {
    setPowerSource(source);
    try {
      localStorage.setItem(POWER_SOURCE_PREF, source);
    } catch {}
  };

  if (!supported) {
    return (
      <div className="sm:col-span-2">
        <Notice>This browser has no Web Bluetooth. Open Settings in the Lactic app to manage devices.</Notice>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:col-span-2">
      {!silent && (
        <Notice>
          Chrome asks for each device once per visit. To have them connect on their own whenever they wake up, turn on &quot;Use the new permissions backend for Web
          Bluetooth&quot; and &quot;Experimental Web Platform features&quot; in chrome://flags, then relaunch.
        </Notice>
      )}

      <ul className="divide-y divide-line">
        {DEVICE_KINDS.filter((kind) => kind.key !== "scale" || tracking.weight || rows.scale?.saved).map((kind) => {
          const row = rows[kind.key];
          const saved = row?.saved;
          const status = checks[kind.key];
          const editing = renaming?.key === kind.key;
          return (
            <li key={kind.key} className="space-y-3 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm text-muted">{kind.label}</div>
                  {editing ? (
                    <form
                      className="flex flex-wrap items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        renameDevice(kind.key, renaming.value);
                        setRenaming(null);
                      }}
                    >
                      <input
                        autoFocus
                        aria-label={`Name for the ${kind.label.toLowerCase()}`}
                        value={renaming.value}
                        placeholder={saved?.deviceName}
                        onChange={(e) => setRenaming({ key: kind.key, value: e.target.value })}
                        className={`${input} w-56`}
                      />
                      <button className={button.smallPrimary}>Save</button>
                      <button type="button" className={button.small} onClick={() => setRenaming(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="truncate font-medium">{saved ? saved.name : <span className="text-faint">Not paired</span>}</div>
                  )}
                  {saved && !editing && (
                    <div className="text-sm text-muted">
                      {saved.nickname && `${saved.deviceName} · `}
                      {saved.lastSeen ? `Last connected ${when(saved.lastSeen)}` : "Not connected yet"}
                    </div>
                  )}
                </div>
                <div className="flex flex-none flex-wrap items-center gap-2">
                  {status?.state === "checking" ? (
                    <Pill>Connecting...</Pill>
                  ) : status?.state === "ok" ? (
                    <Pill tone="positive">Answered just now</Pill>
                  ) : saved ? (
                    <Pill tone={row?.silent ? "positive" : "neutral"}>{row?.silent ? "Reconnects on its own" : "Picked once per visit"}</Pill>
                  ) : null}
                </div>
              </div>

              {status?.state === "failed" && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-warning">{status.message}</p>
                  <AskCoach prompt={`My ${kind.label.toLowerCase()}${saved ? ` (${saved.name})` : ""} won't connect. Lactic said: "${status.message}" Can you check what's going on?`} />
                </div>
              )}

              {!editing && (
                <div className="flex flex-wrap items-center gap-2">
                  {saved ? (
                    <>
                      <button className={button.small} disabled={status?.state === "checking"} onClick={() => check(kind)}>
                        Reconnect
                      </button>
                      <button className={button.small} onClick={() => setRenaming({ key: kind.key, value: saved.nickname ?? "" })}>
                        Rename
                      </button>
                      <button className={button.small} onClick={() => setPairing(kind)}>
                        Pair a different one
                      </button>
                      {forgetting === kind.key ? (
                        <>
                          <button className={`${button.small} text-negative`} onClick={() => forget(kind.key)}>
                            Forget {saved.name}
                          </button>
                          <button className={button.ghost} onClick={() => setForgetting(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <button className={button.ghost} onClick={() => setForgetting(kind.key)}>
                          Forget
                        </button>
                      )}
                    </>
                  ) : (
                    <button className={button.smallPrimary} onClick={() => setPairing(kind)}>
                      Pair
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-line pt-5">
        <div className="text-sm font-medium">Power source</div>
        <Segmented
          label="Power source"
          options={[
            { value: "trainer" as const, label: "Trainer" },
            { value: "powerMeter" as const, label: "Power meter" },
          ]}
          value={powerSource}
          onChange={pickPowerSource}
        />
        <p className="text-sm text-muted">
          {powerSource === "trainer"
            ? "Rides use the trainer's power and cadence."
            : "Rides use the power meter when it's connected, with ERG matched to it. Until then, the trainer's power counts."}{" "}
          You can switch it mid-ride.
        </p>
      </div>

      <PairSheet kind={pairing} onFind={pair} onClose={() => setPairing(null)} />
    </div>
  );
}
