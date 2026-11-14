// First run: two short steps, FTP and weight then the trainer, and the rider is riding. The rest of
// setup (week and goal, rides, what to track, the coach) waits on Today's "Finish setting up" list,
// which opens each of those steps here on its own (web/app/finish-setup.tsx).

import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { button, Result } from "@/components/ui";
import { MarkTile, Wordmark } from "~/app/brand";
import { getSetting, setSetting } from "~/settings/store";
import { ProfileForm, saveProfile, useProfile } from "~/setup/profile";
import { defaultWeek, saveWeek, WeekForm } from "~/setup/week";
import { GearSetup } from "~/setup/gear";
import { RidesSetup } from "~/setup/rides";
import { CoachSetupPanel } from "~/setup/coach";
import { keepCoachChoice } from "~/ai/settings";
import { revalidatePath } from "~/shims/next-cache";
import { TOUR_DONE } from "~/tour/store";
import { FeatureChoice } from "~/setup/features";
import { saveFeatures } from "~/settings/features";
import { FEATURES_SETTING, parseFeatures, type Features } from "@/lib/features";
import { RestoreButton } from "~/data/restore-panel";
import { isDesktop, isPhone, thisDevice } from "~/platform/native";
import { PairPhone } from "~/phone/settings";
import { PhoneSleepSetup } from "~/phone/setup-health";
import { SOLO } from "~/phone/welcome";
import { createClient } from "~/db/supabase-client";
import {
  FINISH_SETUP,
  markSetupDone,
  type LaterStep,
} from "@/lib/finish-setup";

const STEPS = [
  { id: "you", title: "About you", line: "So your workouts fit you." },
  { id: "gear", title: "Your trainer", line: "Spin the pedals to wake it." },
  // Later, one at a time from Today's "Finish setting up".
  {
    id: "week",
    title: "Your week and goal",
    line: "Lactic plans around the time you have.",
  },
  {
    id: "track",
    title: "Sleep and weight",
    line: "Rides and your plan are always on. Add these if you want them.",
  },
  {
    id: "sleep",
    title: "Sleep and recovery",
    line: "Last night's sleep gives you a recovery score each morning.",
  },
  {
    id: "rides",
    title: "Your rides and sleep",
    line: "Your history sets your fitness from day one. Sleep gives you a daily recovery score.",
  },
  { id: "coach", title: "Your coach", line: "Pick a coach, or go without." },
] as const;
type StepId = (typeof STEPS)[number]["id"];
type Step = (typeof STEPS)[number];

/** The first run: just what a ride needs. */
const FIRST: StepId[] = ["you", "gear"];

/** A step's title and line for what the rider chose to track. */
function stepText(s: Step, tracking: Features) {
  if (s.id === "rides" && (!tracking.recovery || isPhone()))
    return {
      title: "Your rides",
      line: "Your history sets your fitness from day one.",
    };
  return s;
}

/** `steps` and `step` draw the progress bar on the first run; a later step on its own has none. */
function Frame({
  step,
  steps,
  tracking,
  children,
  footer,
}: {
  step: Step;
  steps: Step[] | null;
  tracking: Features;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const s = stepText(step, tracking);
  const at = steps ? steps.indexOf(step) : -1;
  return (
    <div className="min-h-screen bg-ground">
      <div className="lactic-drag lactic-titlebar flex h-12 items-center px-5">
        <Wordmark />
      </div>
      <div className="mx-auto max-w-2xl px-5 pt-6 pb-28">
        {steps && (
          <>
            <ol
              className="mb-8 grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
              }}
              aria-label="Setup progress"
            >
              {steps.map((x, i) => (
                <li
                  key={x.id}
                  className={`h-1 rounded-full ${i <= at ? "bg-accent" : "bg-line"}`}
                  aria-current={i === at ? "step" : undefined}
                />
              ))}
            </ol>
            <p className="num mb-1 text-sm text-muted">
              Step {at + 1} of {steps.length}
            </p>
          </>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{s.title}</h1>
        <p className="mt-1 mb-8 text-muted">{s.line}</p>
        {children}
      </div>
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-ground/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-4">
          {footer}
        </div>
      </div>
    </div>
  );
}

/** Pairs the rider's iPhone, which sends its data here; the app then starts over on it. */
function FromPhoneButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="font-medium text-ink underline underline-offset-2"
        onClick={() => setOpen(true)}
      >
        Bring it from your iPhone
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-2 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-16 sm:pb-16"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="from-phone-title"
            className="relative w-full max-w-lg space-y-4 rounded-xl border border-line bg-ground p-5 text-left text-sm text-ink shadow-2xl sm:p-6"
          >
            <h2 id="from-phone-title" className="text-lg font-semibold">
              Bring your data from your iPhone
            </h2>
            <p className="text-muted">
              On your iPhone, open Lactic → Settings → Your computer and scan
              this code. Your plan, rides and settings come across, and this
              computer keeps the main copy from then on.
            </p>
            <PairPhone />
            <button
              type="button"
              className={button.ghost}
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="lactic-drag grid min-h-screen place-items-center bg-ground px-6">
      <div className="max-w-md space-y-8 text-center">
        <div className="flex justify-center">
          <MarkTile size={84} />
        </div>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome to Lactic
          </h1>
          <p className="text-muted">
            A training plan that fits your week and workouts on your smart
            trainer. Free, and your data stays on {thisDevice()}.
          </p>
        </div>
        <div className="space-y-3">
          <button
            type="button"
            className={`${button.primary} h-11 w-full text-base`}
            onClick={onStart}
          >
            Get started
          </button>
          <p className="text-sm text-faint">
            Two quick steps and you&apos;re riding.
          </p>
        </div>
        {isDesktop && (
          <div className="space-y-1.5 text-sm text-muted">
            <p>
              Used Lactic on another computer?{" "}
              <RestoreButton
                fresh
                className="font-medium text-ink underline underline-offset-2"
                label="Bring your data across"
              />
            </p>
            {!isPhone() && (
              <p>
                Already riding with Lactic on your iPhone? <FromPhoneButton />
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A plan to ride from day one, until the rider sets their week and goal (left alone if one exists). */
async function starterPlan() {
  const { data } = await createClient()
    .from("training_plans")
    .select("id")
    .limit(1)
    .maybeSingle();
  return data ? { ok: true, message: "" } : saveWeek(defaultWeek());
}

export default function Onboarding() {
  const params = useParams();
  const navigate = useNavigate();
  const at = (params["*"] ?? "") as StepId | "";
  // New riders opt in to each; coming back to setup shows what they picked.
  const [tracking, setTracking] = useState<Features>({
    recovery: false,
    weight: false,
  });
  const step = STEPS.find((s) => s.id === at);
  const first = step && FIRST.includes(step.id);
  const steps = STEPS.filter((s) => FIRST.includes(s.id));
  const index = first ? steps.indexOf(step) : -1;
  const go = (to: string) => navigate(`/welcome/${to}`);
  // A later step goes back to Today when it's done (sleep follows "track" on an iPhone that tracks recovery).
  const home = () => {
    revalidatePath("/");
    navigate("/", { replace: true });
  };
  // On the iPhone the first screen is the phone's own welcome (pair, or use it on its own).
  const back = () =>
    !first
      ? home()
      : index <= 0 && isPhone()
        ? void setSetting(SOLO, false)
        : go(index > 0 ? steps[index - 1].id : "");

  const profile = useProfile();
  const [week, setWeek] = useState(defaultWeek);
  useEffect(() => {
    void getSetting<unknown>(FEATURES_SETTING, null).then((saved) => {
      if (saved !== null) setTracking(parseFeatures(saved));
    });
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(
    work: () => Promise<{ ok: boolean; message: string }>,
    then: () => void | Promise<void>,
  ) {
    setBusy(true);
    setError(null);
    const r = await work().catch((e) => ({
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    }));
    if (r.ok) await then();
    else setError(r.message);
    setBusy(false);
  }

  /** The end of the first run: a starter plan, the rest of setup on Today, and straight to riding. */
  async function startRiding() {
    // Sleep and weight start off (a choice on the list); a rider back in setup keeps what they picked.
    if ((await getSetting<unknown>(FEATURES_SETTING, null)) === null) await saveFeatures({ recovery: false, weight: false });
    await setSetting(FINISH_SETUP, true);
    // The tour stays in Settings → Getting started and on the "Finish setting up" list.
    await setSetting(TOUR_DONE, true);
    await setSetting("onboarding.done", true);
    home();
  }

  /** A later step saved: tick it off Today's list. */
  async function later(id: LaterStep) {
    await markSetupDone(id, getSetting, setSetting);
    if (id === "track" && isPhone() && tracking.recovery) go("sleep");
    else home();
  }

  if (!step)
    return isPhone() ? (
      <Navigate to="/welcome/you" replace />
    ) : (
      <Welcome onStart={() => go("you")} />
    );

  const footer = (primary: React.ReactNode) => (
    <>
      <button type="button" className={button.ghost} onClick={back}>
        {first ? "Back" : "Cancel"}
      </button>
      {primary}
    </>
  );
  const continueButton = (
    onClick: () => void,
    label = first ? "Continue" : "Save",
  ) => (
    <button
      type="button"
      className={button.primary}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? "Saving…" : label}
    </button>
  );
  const frame = (footerButton: React.ReactNode, children: React.ReactNode) => (
    <Frame
      step={step}
      steps={first ? steps : null}
      tracking={tracking}
      footer={footer(footerButton)}
    >
      {children}
    </Frame>
  );

  switch (step.id) {
    case "you":
      return frame(
        continueButton(
          () =>
            void save(
              () => saveProfile(profile.values),
              () => go("gear"),
            ),
        ),
        profile.loaded && (
          <ProfileForm
            values={profile.values}
            onChange={profile.setValues}
            error={error}
            short
          />
        ),
      );
    case "gear":
      return frame(
        continueButton(
          () => void save(starterPlan, startRiding),
          "Start riding",
        ),
        <>
          <GearSetup scale={false} power={false} />
          {error && <Result ok={false}>{error}</Result>}
        </>,
      );
    case "week":
      return frame(
        continueButton(
          () =>
            void save(
              () => saveWeek(week),
              () => later("week"),
            ),
          "Build my plan",
        ),
        <WeekForm values={week} onChange={setWeek} error={error} />,
      );
    case "track":
      return frame(
        continueButton(
          () =>
            void save(
              async () => (
                await saveFeatures(tracking),
                { ok: true, message: "" }
              ),
              () => later("track"),
            ),
        ),
        <>
          <FeatureChoice values={tracking} onChange={setTracking} />
          <p className="mt-4 text-sm text-muted">
            Change these any time in Settings → What you track.
          </p>
        </>,
      );
    case "sleep":
      return frame(continueButton(home, "Done"), <PhoneSleepSetup />);
    case "rides":
      return frame(
        continueButton(() => void later("rides"), "Done"),
        <RidesSetup sleep={tracking.recovery && !isPhone()} />,
      );
    case "coach":
      return frame(
        continueButton(
          () =>
            void save(
              () => keepCoachChoice().then(() => ({ ok: true, message: "" })),
              () => later("coach"),
            ),
        ),
        <>
          <CoachSetupPanel />
          {error && <Result ok={false}>{error}</Result>}
        </>,
      );
  }
}
