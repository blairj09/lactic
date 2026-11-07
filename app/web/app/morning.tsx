"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, Result, button } from "@/components/ui";
import { canReconnectSilently, isPickerCancel, remembered } from "@/lib/ble/devices";
import { isWebBluetoothAvailable } from "@/lib/ble/sensor-hub";
import type { StoredMessage } from "@/lib/coach/store";
import type { CheckinResult, OptionId } from "@/lib/engine/checkin";
import type { ScaleProfile } from "@/lib/scale/bodypod";
import { weighIn, type WeighInUpdate } from "@/lib/scale/scale";
import { saveWeighIn } from "./actions";
import { applyProposal, dismissProposal } from "./coach/actions";
import { streamCoach } from "./coach/events";
import { openCoach } from "./coach/open";
import { Prose } from "./coach/prose";
import { ProposalCard } from "./coach/proposal-card";
import { STAGE_TEXT } from "./health/weigh-in";
import { FeelStep, TodayOptions, type CheckinAnswers } from "./checkin";

export interface MorningProps {
  day: string;
  /** Whether today's recovery is in, and a short line about it. */
  recovery: { in: boolean; line: string | null; healthLinked?: boolean };
  /** Today's latest weigh-in. */
  weighIn: { weightKg: number; bodyFatPercent: number | null } | null;
  /** For the scale's body composition; null until height, sex and birth date are in Settings. */
  profile: ScaleProfile | null;
  /** Today's brief, and whether it needs writing (again). Null when the coach is off. */
  brief: { message: StoredMessage | null; stale: boolean } | null;
  /** How you feel today and the options it gives; a line about the day instead once it's settled. */
  today: TodayChoice | { settled: string };
}

export interface TodayChoice {
  options: CheckinResult;
  /** Today's check-in, once given. */
  answers: (CheckinAnswers & { at: string }) | null;
  /** What today is without any change: as planned, or rest. */
  plain: OptionId;
  plannedMinutes: number | null;
  coachEnabled: boolean;
}

type Weigh = { phase: "idle" } | { phase: "running"; update: WeighInUpdate | null } | { phase: "saved"; kg: number } | { phase: "failed"; message: string };

type Skips = { recovery?: boolean; weigh?: boolean };

/**
 * The start of the day on Today: last night's recovery, weigh in on the scale, say how you feel, and the coach's brief on today with its pick among today's options and
 * any plan changes to accept. Recovery comes from Apple Health (the phone's shortcut posts it); the
 * scale starts on its own when Chrome can reconnect it without its picker. The brief waits until recovery and the weigh-in are in, or
 * skipped, so it's written once from the full picture; how you feel rewrites it when it lands.
 * Riding never waits on any of it.
 */
export default function Morning({ day, recovery, weighIn: weighed, profile, brief, today }: MorningProps) {
  const router = useRouter();
  // Bluetooth and remembered devices are only known in the browser.
  const [device, setDevice] = useState<{ bluetooth: boolean; scale: boolean; silent: boolean } | null>(null);
  const [skips, setSkips] = useState<Skips>({});
  const [weigh, setWeigh] = useState<Weigh>({ phase: "idle" });
  const autoStarted = useRef({ weigh: false });

  useEffect(() => {
    setDevice({ bluetooth: isWebBluetoothAvailable(), scale: Boolean(remembered("scale")), silent: canReconnectSilently() });
    setSkips(readSkips(day));
  }, [day]);

  const skip = (...steps: (keyof Skips)[]) => {
    const next = { ...skips };
    for (const step of steps) next[step] = true;
    setSkips(next);
    writeSkips(day, next);
  };

  const recoveryDone = recovery.in;
  // A step is settled once it's done, skipped, or can't happen. Recovery waits for Apple Health once
  // the shortcut is set up; without it there's nothing to wait for. Without Bluetooth (the phone) the
  // weigh-in can still arrive from the Mac, so it waits for that or a skip.
  const fromHealth = Boolean(recovery.healthLinked);
  const recoveryReady = recoveryDone || skips.recovery || !fromHealth;
  const weighDone = Boolean(weighed) || weigh.phase === "saved";
  const weighReady = weighDone || skips.weigh || (device !== null && device.bluetooth && !profile);
  const waitingOn = [!recoveryReady && ("recovery" as const), !weighReady && ("weigh" as const)].filter((s) => s !== false);
  const pending = waitingOn.map((s) => (s === "weigh" ? "weigh-in" : s)).join(" and ");

  const startWeigh = useCallback(
    async (choose = false) => {
      if (!profile) return;
      setWeigh({ phase: "running", update: null });
      try {
        const reading = await weighIn(profile, (update) => setWeigh({ phase: "running", update }), { choose });
        setDevice((d) => d && { ...d, scale: true });
        setWeigh({ phase: "running", update: { stage: "done", liveKg: reading.weightKg } });
        const saved = await saveWeighIn(reading);
        if (!saved.ok) setWeigh({ phase: "failed", message: saved.message });
        else {
          setWeigh({ phase: "saved", kg: reading.weightKg });
          router.refresh();
        }
      } catch (e) {
        setWeigh(isPickerCancel(e) ? { phase: "idle" } : { phase: "failed", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [profile, router],
  );

  // Waiting on Apple Health: look again each minute, since the shortcut posts from the phone.
  useEffect(() => {
    if (!fromHealth || recoveryDone || skips.recovery) return;
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [fromHealth, recoveryDone, skips.recovery, router]);

  // The scale starts listening on its own, if it reconnects without a click.
  useEffect(() => {
    if (!device || autoStarted.current.weigh || weighDone || skips.weigh || !profile) return;
    if (!device.bluetooth || !device.scale || !device.silent || weigh.phase !== "idle") return;
    autoStarted.current.weigh = true;
    void startWeigh();
  }, [device, weighDone, skips.weigh, profile, weigh.phase, startWeigh]);


  const weighedKg = weighed?.weightKg ?? (weigh.phase === "saved" ? weigh.kg : null);

  return (
    <Panel
      title="Morning"
      meta={
        brief !== null ? (
          <button type="button" onClick={() => openCoach()} className="hover:text-ink">
            Ask the coach
          </button>
        ) : undefined
      }
    >
      <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
        <Step n={1} title="Recovery" state={recoveryDone ? "done" : recoveryReady ? (skips.recovery ? "skipped" : "settled") : "active"}>
          {recoveryDone ? (
            <p>{recovery.line ?? "Last night is in."}</p>
          ) : skips.recovery ? (
            <p>Skipped for today.</p>
          ) : fromHealth ? (
            <p className="animate-pulse">Waiting for last night from Apple Health.</p>
          ) : (
            <p>
              <Link href="/settings#health" className="text-ink underline underline-offset-4">
                Connect Apple Health
              </Link>{" "}
              to bring last night in, or skip it.
            </p>
          )}
          {!recoveryReady && (
            <Actions>
              <SkipButton onClick={() => skip("recovery")} />
            </Actions>
          )}
        </Step>

        <Step n={2} title="Weigh in" state={weighDone ? "done" : weighReady ? (skips.weigh ? "skipped" : "settled") : "active"}>
          {weighDone ? (
            <p>
              <span className="num text-ink">{weighedKg!.toFixed(1)} kg</span>
              {weighed?.bodyFatPercent != null && <span className="num"> · {weighed.bodyFatPercent.toFixed(1)}% fat</span>}
            </p>
          ) : device === null ? null : skips.weigh ? (
            <p>Skipped for today.</p>
          ) : !device.bluetooth ? (
            <p>Weigh in from Chrome on the Mac.</p>
          ) : !profile ? (
            <p>
              Add height, birth date and sex in{" "}
              <Link href="/settings" className="text-ink underline underline-offset-4">
                Settings
              </Link>{" "}
              to weigh in.
            </p>
          ) : weigh.phase === "running" ? (
            <div aria-live="polite">
              {weigh.update?.liveKg != null && <p className="num text-2xl font-medium tracking-tight text-ink">{weigh.update.liveKg.toFixed(1)} kg</p>}
              <p>{STAGE_TEXT[weigh.update?.stage ?? "waking"]}</p>
            </div>
          ) : weigh.phase === "failed" ? (
            <Result ok={false}>{weigh.message}</Result>
          ) : (
            <p>Tap the Body Pod with your foot, then step on.</p>
          )}
          {!weighDone && device?.bluetooth && profile && !skips.weigh && weigh.phase !== "running" && (
            <Actions>
              <button className={button.smallPrimary} onClick={() => startWeigh()}>
                {device.scale ? "Weigh in" : "Pair scale"}
              </button>
              <SkipButton onClick={() => skip("weigh")} />
            </Actions>
          )}
          {!weighReady && (weigh.phase === "running" || (device && !device.bluetooth)) && (
            <Actions>
              <SkipButton onClick={() => skip("weigh")} />
            </Actions>
          )}
        </Step>

        <Step n={3} title="How you feel" state={"settled" in today ? "settled" : today.answers ? "done" : "active"}>
          {"settled" in today ? (
            <p>{today.settled}</p>
          ) : (
            <FeelStep key={today.answers?.at ?? "new"} answers={today.answers} plannedMinutes={today.plannedMinutes} coachEnabled={today.coachEnabled} />
          )}
        </Step>
      </ol>

      {brief ? (
        <Brief
          initial={brief.message}
          stale={brief.stale}
          ready={device !== null && waitingOn.length === 0}
          inputs={`${recovery.in}-${Boolean(weighed)}-${"settled" in today ? "" : (today.answers?.at ?? "")}`}
          pending={device === null ? "" : pending}
          onSkipPending={() => skip(...waitingOn)}
          today={"settled" in today ? null : today}
        />
      ) : (
        !("settled" in today) && <TodayOptionsFor today={today} pick={null} className="mt-5" />
      )}
    </Panel>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: "waiting" | "active" | "done" | "settled" | "skipped"; children?: React.ReactNode }) {
  const marker =
    state === "done" ? (
      <span className="flex size-5 items-center justify-center rounded-full bg-ink text-[11px] text-surface" aria-label="Done">
        ✓
      </span>
    ) : (
      <span
        className={`num flex size-5 items-center justify-center rounded-full border text-[11px] ${state === "active" ? "border-ink text-ink" : "border-line text-faint"}`}
      >
        {n}
      </span>
    );
  return (
    <li
      className={`bg-surface p-4 text-sm ${state === "done" ? "flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:block sm:space-y-1.5" : "space-y-1.5"} ${state === "waiting" ? "text-faint" : "text-muted"}`}
    >
      <div className="flex items-center gap-2">
        {marker}
        <span className={`font-medium ${state === "waiting" ? "text-muted" : "text-ink"}`}>{title}</span>
      </div>
      {children}
    </li>
  );
}

const Actions = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap items-center gap-3 pt-1">{children}</div>;

const SkipButton = ({ onClick, label = "Skip today" }: { onClick: () => void; label?: string }) => (
  <button className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={onClick}>
    {label}
  </button>
);

/**
 * The coach's brief, written once recovery and the weigh-in are in or skipped (or shown, if today's
 * is already written), and again when any of them or how you feel arrives after it. Today's options sit under it with the
 * coach's pick first, then plan changes it proposes with Apply buttons; nothing changes until you
 * press one.
 */
function Brief({
  initial,
  stale,
  ready,
  inputs,
  pending,
  onSkipPending,
  today,
}: {
  initial: StoredMessage | null;
  stale: boolean;
  ready: boolean;
  inputs: string;
  /** Morning steps not in yet; the brief waits for them. */
  pending: string;
  /** Skip the steps still pending, so the brief is written now. */
  onSkipPending: () => void;
  today: TodayChoice | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState(initial);
  const [text, setText] = useState(initial?.content ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef<string | null>(null);
  const streaming = status !== null;

  // A refreshed page brings a newer brief.
  const seen = useRef(initial?.id);
  useEffect(() => {
    if (!initial || initial.id === seen.current || status) return;
    seen.current = initial.id;
    setMessage(initial);
    setText(initial.content);
  }, [initial, status]);

  useEffect(() => {
    // One write at a time; newer data that arrives meanwhile is picked up after.
    if (!stale || !ready || streaming || requested.current === inputs) return;
    setStatus(requested.current === null && !initial ? "Writing your brief" : "Updating your brief");
    requested.current = inputs;
    setError(null);
    let streamed = "";
    streamCoach("/api/coach/brief", {}, {
      status: (s) => setStatus(s),
      reset: () => (streamed = ""),
      text: (delta) => {
        streamed += delta;
        setText(streamed);
      },
    })
      .then((m) => {
        setMessage(m);
        setText(m.content);
        router.refresh();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setStatus(null));
  }, [stale, ready, streaming, inputs, initial, router]);

  const update = (index: number, status: "applied" | "dismissed") =>
    setMessage((m) => m && { ...m, proposals: m.proposals.map((p, i) => (i === index ? { ...p, status } : p)) });

  if (!text && !status && !error) {
    if (!pending) return null;
    return (
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <p>Your brief is written once your {pending} {pending.includes(" and ") ? "are" : "is"} in.</p>
        <button className="text-ink underline-offset-4 hover:underline" onClick={onSkipPending}>
          Skip and write it now
        </button>
      </div>
    );
  }
  return (
    <div className="mt-5 space-y-3">
      {text ? (
        <Prose text={text} />
      ) : error ? null : (
        <p className="animate-pulse text-sm text-muted">{status}...</p>
      )}
      {text && status && <p className="animate-pulse text-xs text-muted">{status}...</p>}
      {text && !status && pending && (
        <p className="text-xs text-muted">
          It updates once your {pending} {pending.includes(" and ") ? "are" : "is"} in.{" "}
          <button className="underline-offset-4 hover:text-ink hover:underline" onClick={onSkipPending}>
            Skip
          </button>
        </p>
      )}
      {error && <Result ok={false}>The coach couldn&apos;t write today&apos;s brief ({error}).</Result>}
      {!status && today && <TodayOptionsFor today={today} pick={stale ? null : (message?.meta.today as OptionId | undefined) ?? null} />}
      {!status && message && message.proposals.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {message.proposals.map((p, i) => (
            <ProposalCard
              key={i}
              proposal={p}
              onApply={async () => {
                const result = await applyProposal(message.id, i);
                if (!result.ok) return setError(result.message);
                update(i, "applied");
                router.refresh();
              }}
              onDismiss={async () => {
                const result = await dismissProposal(message.id, i);
                if (!result.ok) return setError(result.message);
                update(i, "dismissed");
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Today's options once there's something to choose: after you've said how you feel, or when the
 * pick (the coach's, else the engine's) changes today. A plain day needs no list.
 */
function TodayOptionsFor({ today, pick, className }: { today: TodayChoice; pick: OptionId | null; className?: string }) {
  const { options } = today;
  const chosen = pick && options.options.some((o) => o.id === pick) ? pick : options.recommended;
  if (!today.answers && chosen === today.plain) return null;
  return (
    <div className={className}>
      <TodayOptions result={options} pick={chosen} reasons={!today.coachEnabled} />
    </div>
  );
}

// Skipped steps are remembered in this browser for the day.
const SKIPS = "morning.skips";

function readSkips(day: string): Skips {
  try {
    const saved = JSON.parse(localStorage.getItem(SKIPS) ?? "{}");
    return saved.day === day ? saved.skips : {};
  } catch {
    return {};
  }
}

function writeSkips(day: string, skips: Skips) {
  try {
    localStorage.setItem(SKIPS, JSON.stringify({ day, skips }));
  } catch {}
}

