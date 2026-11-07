"use client";

import { useState } from "react";
import { button as ui } from "@/components/ui";
import { newHealthToken } from "../actions";

export default function HealthShortcut({ endpoint, tokenCreatedAt, lastUsedAt }: { endpoint: string; tokenCreatedAt: string | null; lastUsedAt: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {tokenCreatedAt ? `Token made ${when(tokenCreatedAt)}; ${lastUsedAt ? `last used ${when(lastUsedAt)}` : "not used yet"}.` : "No token yet."}
      </p>
      <button
        className={ui.secondary}
        disabled={busy}
        onClick={async () => {
          if (tokenCreatedAt && !confirm("Make a new token? The shortcut stops working until you paste the new one in.")) return;
          setBusy(true);
          const result = await newHealthToken();
          setMessage(result.message);
          setToken(result.token ?? null);
          setBusy(false);
        }}
      >
        {tokenCreatedAt ? "Make a new token" : "Make a token"}
      </button>
      {message && <p className="text-sm text-muted">{message}</p>}
      {token && <code className="block rounded-md bg-raised p-3 text-xs break-all select-all">{token}</code>}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted">How to build the shortcut</summary>
        <p className="mt-2 text-muted">
          It sends every sleep stage, HRV, resting HR, breathing rate, wrist temperature, heart rate, active energy, step and VO2 max sample from the last 3 days, as lists, and My Coach works out each night and each day&apos;s exertion. No loops, so even
          60 days takes seconds.
        </p>
        <ol className="mt-2 list-decimal space-y-2 pl-5">
          <li>
            Add <b>Find Health Samples</b>: <i>Type is Sleep</i> (not Sleep Changes), <i>Start Date is in the last 3 days</i>, sorted by Start Date,
            oldest first, no limit. Then <b>Set Variable</b> <code>Sleep</code>.
          </li>
          <li>
            Same for <i>Heart Rate Variability</i> into <code>HRV</code>, <i>Resting Heart Rate</i> into <code>RestingHR</code>,{" "}
            <i>Respiratory Rate</i> into <code>RespRate</code>, and <i>Wrist Temperature</i> (Sleeping Wrist Temperature on some iOS versions) into{" "}
            <code>WristTemp</code>.
          </li>
          <li>
            For the day&apos;s exertion and energy: <i>Heart Rate</i> into <code>HeartRate</code>, <i>Active Energy</i> into <code>ActiveEnergy</code> and{" "}
            <i>Steps</i> into <code>Steps</code> (Group By Day for these two, if offered), and <i>VO2 Max</i> (Cardio Fitness) into <code>VO2Max</code>.
          </li>
          <li>
            Add <b>Get Contents of URL</b>: <code className="break-all">{endpoint}</code>, method POST, header <code>Authorization</code> ={" "}
            <code>Bearer</code>, a space, then your token. Request body JSON, all fields Text. For each one insert the variable, tap it, pick the
            property, and for dates set <b>Date Format: ISO 8601</b> with <b>Include ISO 8601 Time</b>:
            <ul className="mt-1 list-disc pl-5">
              <li>
                <code>sleepStart</code> = Sleep → Start Date, <code>sleepEnd</code> = Sleep → End Date, <code>sleepValue</code> = Sleep → Value
              </li>
              <li>
                <code>hrvDate</code> = HRV → Start Date, <code>hrvValue</code> = HRV → Value
              </li>
              <li>
                <code>restingHrDate</code> = RestingHR → Start Date, <code>restingHrValue</code> = RestingHR → Value
              </li>
              <li>
                <code>respRateDate</code> = RespRate → Start Date, <code>respRateValue</code> = RespRate → Value
              </li>
              <li>
                <code>wristTempStart</code> = WristTemp → Start Date, <code>wristTempEnd</code> = WristTemp → End Date, <code>wristTempValue</code> =
                WristTemp → Value (°F or °C both work)
              </li>
              <li>
                <code>heartRateDate</code> / <code>heartRateValue</code>, <code>activeEnergyDate</code> / <code>activeEnergyValue</code>,{" "}
                <code>stepsDate</code> / <code>stepsValue</code> and <code>vo2maxDate</code> / <code>vo2maxValue</code>: each variable&apos;s Start Date and Value
              </li>
              <li>
                <code>hrvKind</code> = <code>sdnn</code> (Apple Watch)
              </li>
            </ul>
          </li>
          <li>
            Add <b>Show Result</b>, run it once. It should show <code>{`{"ok":true, ...}`}</code> with last night&apos;s sleep, HRV, resting HR, breathing and wrist temp.
          </li>
          <li>
            For a baseline right away, change the night ones and VO2 max to <i>in the last 60 days</i> and the other three to <i>14 days</i> (heart rate is
            a lot of samples), run it once, then set them all back to 3 days.
          </li>
          <li>
            In Automation, add <b>Sleep → Waking Up</b>, run immediately, with this shortcut, plus a second one at a fixed time (say 9:00).
          </li>
        </ol>
      </details>
    </div>
  );
}
