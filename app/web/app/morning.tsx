"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Panel, Result } from "@/components/ui";
import type { StoredMessage } from "@/lib/coach/store";
import type { CheckinResult, OptionId } from "@/lib/engine/checkin";
import { applyProposal, dismissProposal } from "./coach/actions";
import { streamCoach } from "./coach/events";
import { openCoach } from "./coach/open";
import { Prose } from "./coach/prose";
import { ProposalCard } from "./coach/proposal-card";
import { FeelStep, TodayOptions, type CheckinAnswers } from "./checkin";
import { useFeatures } from "@/lib/use-features";
import type { RecoverySourceInfo } from "@/lib/recovery-source";

export interface MorningProps {
  day: string;
  /** Whether today's recovery is in, and a short line about it. */
  recovery: { in: boolean; line: string | null; healthLinked?: boolean; source?: RecoverySourceInfo | null };
  /** Whether there's a weigh-in today, so the brief is rewritten when one lands (the weekly weigh-in is its own card on Today). */
  weighedToday?: boolean;
  /** Today's brief, and whether it needs writing (again). Null when the coach is off. */
  brief: { message: StoredMessage | null; stale: boolean } | null;
  /** How you feel today and the options it gives; a line about the day instead once it's settled. */
  today: TodayChoice | { settled: string };
  /** Last night in brief (RecoverySummary), shown as the first, done step once it's in. */
  lastNight?: React.ReactNode;
  /** One step under another, for a narrow column. */
  stacked?: boolean;
  title?: string;
  /** False when "How you feel" is asked elsewhere (Today asks it in the workout card, as "Ready for it?"). */
  askFeel?: boolean;
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

type Skips = { recovery?: boolean };

/**
 * The start of the day on Today: last night's recovery, weigh in on the scale (once one is paired), say how you feel, and the coach's brief on today with its pick among today's options and
 * any plan changes to accept. Recovery comes from Apple Health (the phone's shortcut posts it); the
 * scale starts on its own when Chrome can reconnect it without its picker. The brief waits until recovery and the weigh-in are in, or
 * skipped, so it's written once from the full picture; how you feel rewrites it when it lands.
 * Riding never waits on any of it.
 */
export default function Morning({ day, recovery, weighedToday = false, brief, today, lastNight, stacked = false, title = "Morning", askFeel = true }: MorningProps) {
  const router = useRouter();
  // Recovery is a step only for riders who track it.
  const tracking = useFeatures();
  // Skips live in the browser, so the brief waits for them to load.
  const [mounted, setMounted] = useState(false);
  const [skips, setSkips] = useState<Skips>({});

  useEffect(() => {
    setSkips(readSkips(day));
    setMounted(true);
  }, [day]);

  const skip = (...steps: (keyof Skips)[]) => {
    const next = { ...skips };
    for (const step of steps) next[step] = true;
    setSkips(next);
    writeSkips(day, next);
  };

  const recoveryDone = recovery.in;
  // A step is settled once it's done, skipped, or can't happen. Recovery waits for Apple Health once
  // the shortcut is set up; without it there's nothing to wait for.
  const fromHealth = Boolean(recovery.healthLinked);
  const recoveryReady = !tracking.recovery || recoveryDone || skips.recovery || !fromHealth;
  const waitingOn = [!recoveryReady && ("recovery" as const)].filter((s) => s !== false);
  const pending = waitingOn.join(" and ");

  // Waiting on the recovery source: look again each minute, since nights arrive in the background.
  useEffect(() => {
    if (!tracking.recovery || !fromHealth || recoveryDone || skips.recovery) return;
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [tracking.recovery, fromHealth, recoveryDone, skips.recovery, router]);

  // Once last night is in, the Recovery card shows it, so the step only waits for it.
  const recoveryStep = tracking.recovery && (!recoveryDone || Boolean(lastNight));
  const stepCount = Number(askFeel) + Number(recoveryStep);
  // Last night in brief is a summary, not a step to do, so it isn't numbered.
  const offset = Number(Boolean(lastNight && recoveryDone));
  const feelStep = stepCount - offset;

  return (
    <Panel
      title={title}
      meta={
        brief !== null && title ? (
          <button type="button" onClick={() => openCoach()} className="hover:text-ink">
            Ask the coach
          </button>
        ) : undefined
      }
    >
      {stepCount > 0 && (
      <ol className={`grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line ${stacked ? "" : lastNight && recoveryDone ? LAST_NIGHT_COLUMNS[stepCount] : STEP_COLUMNS[stepCount]}`}>
        {recoveryStep && (
        <Step n={1} title="Recovery" state={recoveryDone ? (lastNight ? "settled" : "done") : recoveryReady ? (skips.recovery ? "skipped" : "settled") : "active"} plain={Boolean(lastNight && recoveryDone)}>
          {recoveryDone ? (
            (lastNight ?? <p>{recovery.line ?? "Last night is in."}</p>)
          ) : skips.recovery ? (
            <p>Skipped for today.</p>
          ) : fromHealth ? (
            <p className="animate-pulse">
              {recovery.source?.iphone
                ? recovery.source.iphone.here
                  ? `Waiting for last night in Health. Lactic last read it at ${clock(recovery.source.iphone.readAt)}.`
                  : `Waiting for last night from your iPhone. It last read Health at ${clock(recovery.source.iphone.readAt)}.`
                : `Waiting for last night from ${recovery.source?.name ?? "Apple Health"}.`}
            </p>
          ) : (
            <p>
              <Link href="/settings#health" className="text-ink underline underline-offset-4">
                {recovery.source ? `Connect ${recovery.source.name}` : "Connect your sleep and recovery data"}
              </Link>{" "}
              to bring in last night, or skip.
            </p>
          )}
          {!recoveryReady && (
            <Actions>
              <SkipButton onClick={() => skip("recovery")} />
            </Actions>
          )}
        </Step>
        )}

        {askFeel && (
        <Step n={feelStep} title="How you feel" state={"settled" in today ? "settled" : today.answers ? "done" : "active"}>
          {"settled" in today ? (
            <p>{today.settled}</p>
          ) : (
            <FeelStep key={today.answers?.at ?? "new"} answers={today.answers} plannedMinutes={today.plannedMinutes} coachEnabled={today.coachEnabled} />
          )}
        </Step>
        )}
      </ol>
      )}

      {brief ? (
        <Brief
          initial={brief.message}
          stale={brief.stale}
          ready={mounted && waitingOn.length === 0}
          inputs={`${recovery.in}-${weighedToday}-${"settled" in today ? "" : (today.answers?.at ?? "")}`}
          pending={mounted ? pending : ""}
          onSkipPending={() => skip(...waitingOn)}
          today={"settled" in today ? null : today}
        />
      ) : (
        !("settled" in today) && <TodayOptionsFor today={today} pick={null} className="mt-5" />
      )}
    </Panel>
  );
}

function Step({ n, title, state, children, plain = false }: { n: number; title: string; state: "waiting" | "active" | "done" | "settled" | "skipped"; children?: React.ReactNode; plain?: boolean }) {
  const marker = plain ? null :
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

/** A time today, or a day and time before today. */
function clock(iso: string) {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return at.toLocaleString("en-US", sameDay ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" });
}

const STEP_COLUMNS: Record<number, string> = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" };
// With last night in brief as the first step, it gets the wider share.
const LAST_NIGHT_COLUMNS: Record<number, string> = { 1: "", 2: "lg:grid-cols-[3fr_2fr]", 3: "lg:grid-cols-[2fr_1fr_2fr]" };

const Actions = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap items-center gap-3 pt-1">{children}</div>;

const SkipButton = ({ onClick, label = "Skip today" }: { onClick: () => void; label?: string }) => (
  <button type="button" className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={onClick}>
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
      {error && (/AI budget/.test(error) ? <p className="text-sm text-muted">{error}</p> : <Result ok={false}>The coach couldn&apos;t write today&apos;s brief ({error}).</Result>)}
      {!status && today && <TodayOptionsFor today={today} pick={(message?.meta.today as OptionId | undefined) ?? null} />}
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
