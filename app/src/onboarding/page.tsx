// First run: a few short steps, each one skippable but the first, and every one of them also in
// Settings later. The aim is riding a planned workout within five minutes of opening the app.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { button, Result } from "@/components/ui";
import { MarkTile, Wordmark } from "~/app/brand";
import { getSetting, setSetting } from "~/settings/store";
import { ProfileForm, saveProfile, useProfile } from "~/setup/profile";
import { defaultWeek, saveWeek, WeekForm } from "~/setup/week";
import { GearSetup } from "~/setup/gear";
import { RidesSetup } from "~/setup/rides";
import { CoachSetupPanel } from "~/setup/coach";
import { revalidatePath } from "~/shims/next-cache";
import { startTour } from "~/tour/store";
import { FeatureChoice } from "~/setup/features";
import { saveFeatures } from "~/settings/features";
import { FEATURES_SETTING, parseFeatures, type Features } from "@/lib/features";
import { RestoreButton } from "~/data/restore-panel";
import { isDesktop, isPhone } from "~/platform/native";
import { PairPhone } from "~/phone/settings";

const STEPS = [
  { id: "you", title: "About you", line: "So your zones and plan fit you." },
  { id: "week", title: "Your week and goal", line: "Lactic plans around the time you have." },
  { id: "track", title: "What to track", line: "Rides and your plan are always on. Add these if you want them." },
  { id: "gear", title: "Your gear", line: "Wake your trainer and sensors and Lactic finds them." },
  { id: "rides", title: "Your rides and sleep", line: "Your history sets your fitness from day one. Sleep gives you a daily recovery score." },
  { id: "coach", title: "Your coach", line: "Pick a coach, or go without." },
] as const;
type StepId = (typeof STEPS)[number]["id"];

/** A step's title and line for what the rider chose to track. */
function stepText(step: number, tracking: Features) {
  const s = STEPS[step];
  if (s.id === "rides" && !tracking.recovery) return { title: "Your rides", line: "Your history sets your fitness from day one." };
  return s;
}

function Frame({ step, tracking, children, footer }: { step: number; tracking: Features; children: React.ReactNode; footer: React.ReactNode }) {
  const s = stepText(step, tracking);
  return (
    <div className="min-h-screen bg-ground">
      <div className="lactic-drag lactic-titlebar flex h-12 items-center px-5">
        <Wordmark />
      </div>
      <div className="mx-auto max-w-2xl px-5 pt-6 pb-28">
        <ol className="mb-8 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }} aria-label="Setup progress">
          {STEPS.map((x, i) => (
            <li key={x.id} className={`h-1 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} aria-current={i === step ? "step" : undefined} />
          ))}
        </ol>
        <p className="num mb-1 text-sm text-muted">
          Step {step + 1} of {STEPS.length}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{s.title}</h1>
        <p className="mt-1 mb-8 text-muted">{s.line}</p>
        {children}
      </div>
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-ground/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-4">{footer}</div>
      </div>
    </div>
  );
}

/** Pairs the rider's iPhone, which sends its data here; the app then starts over on it. */
function FromPhoneButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="font-medium text-ink underline underline-offset-2" onClick={() => setOpen(true)}>
        Bring it from your iPhone
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-2 py-4 sm:px-6 sm:py-16" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="from-phone-title" className="relative w-full max-w-lg space-y-4 rounded-xl border border-line bg-ground p-5 text-left text-sm text-ink shadow-2xl sm:p-6">
            <h2 id="from-phone-title" className="text-lg font-semibold">
              Bring your data from your iPhone
            </h2>
            <p className="text-muted">On your iPhone, open Lactic → Settings → Your computer and scan this code. Your plan, rides and settings come across, and this computer keeps the main copy from then on.</p>
            <PairPhone />
            <button type="button" className={button.ghost} onClick={() => setOpen(false)}>
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
          <h1 className="text-3xl font-semibold tracking-tight">Welcome to Lactic</h1>
          <p className="text-muted">A training plan that fits your week, workouts on your smart trainer, and your recovery in one place. Free, and your data stays on this computer.</p>
        </div>
        <div className="space-y-3">
          <button type="button" className={`${button.primary} h-11 w-full text-base`} onClick={onStart}>
            Get started
          </button>
          <p className="text-sm text-faint">5 minutes and you'll be riding intervals.</p>
        </div>
        {isDesktop && (
          <div className="space-y-1.5 text-sm text-muted">
            <p>
              Used Lactic on another computer? <RestoreButton fresh className="font-medium text-ink underline underline-offset-2" label="Bring your data across" />
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

function Done({ onFinish }: { onFinish: (tour: boolean) => void }) {
  return (
    <div className="lactic-drag grid min-h-screen place-items-center bg-ground px-6">
      <div className="max-w-md space-y-8 text-center">
        <div className="flex justify-center">
          <MarkTile size={72} />
        </div>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">You&apos;re set</h1>
          <p className="text-muted">Your plan is ready. Take a quick tour, or go straight to Today.</p>
        </div>
        <div className="space-y-3">
          <button type="button" className={`${button.primary} h-11 w-full text-base`} onClick={() => onFinish(true)}>
            Show me around
          </button>
          <button type="button" className={`${button.ghost} mx-auto`} onClick={() => onFinish(false)}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const params = useParams();
  const navigate = useNavigate();
  const at = (params["*"] ?? "") as StepId | "" | "done";
  const index = STEPS.findIndex((s) => s.id === at);
  const go = (to: string) => navigate(`/welcome/${to}`);
  const next = () => go(index + 1 < STEPS.length ? STEPS[index + 1].id : "done");
  const back = () => go(index > 0 ? STEPS[index - 1].id : "");

  const profile = useProfile();
  const [week, setWeek] = useState(defaultWeek);
  // New riders opt in to each; coming back to setup shows what they picked.
  const [tracking, setTracking] = useState<Features>({ recovery: false, weight: false });
  useEffect(() => {
    void getSetting<unknown>(FEATURES_SETTING, null).then((saved) => {
      if (saved !== null) setTracking(parseFeatures(saved));
    });
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(work: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    setError(null);
    const r = await work().catch((e) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    setBusy(false);
    if (r.ok) next();
    else setError(r.message);
  }

  async function finish(tour: boolean) {
    await setSetting("onboarding.done", true);
    if (!tour) await setSetting("tour.done", true);
    revalidatePath("/");
    navigate("/", { replace: true });
    if (tour) startTour();
  }

  if (at === "done") return <Done onFinish={(tour) => void finish(tour)} />;
  if (index < 0) return <Welcome onStart={() => go("you")} />;

  const footer = (primary: React.ReactNode, skip = true) => (
    <>
      <button type="button" className={button.ghost} onClick={back}>
        Back
      </button>
      <div className="flex items-center gap-4">
        {skip && (
          <button type="button" className={button.ghost} onClick={next}>
            Skip
          </button>
        )}
        {primary}
      </div>
    </>
  );
  const continueButton = (onClick: () => void, label = "Continue") => (
    <button type="button" className={button.primary} disabled={busy} onClick={onClick}>
      {busy ? "Saving…" : label}
    </button>
  );

  switch (STEPS[index].id) {
    case "you":
      return (
        <Frame step={index} tracking={tracking} footer={footer(continueButton(() => void save(() => saveProfile(profile.values))), false)}>
          {profile.loaded && <ProfileForm values={profile.values} onChange={profile.setValues} error={error} />}
        </Frame>
      );
    case "week":
      return (
        <Frame step={index} tracking={tracking} footer={footer(continueButton(() => void save(() => saveWeek(week)), "Build my plan"))}>
          <WeekForm values={week} onChange={setWeek} error={error} />
        </Frame>
      );
    case "track":
      return (
        <Frame step={index} tracking={tracking} footer={footer(continueButton(() => void save(async () => (await saveFeatures(tracking), { ok: true, message: "" }))), false)}>
          <FeatureChoice values={tracking} onChange={setTracking} />
          <p className="mt-4 text-sm text-muted">Not ready? Leave them off and turn them on any time in Settings → What you track.</p>
        </Frame>
      );
    case "gear":
      return (
        <Frame step={index} tracking={tracking} footer={footer(continueButton(next))}>
          <GearSetup scale={tracking.weight} />
        </Frame>
      );
    case "rides":
      return (
        <Frame step={index} tracking={tracking} footer={footer(continueButton(next))}>
          <RidesSetup sleep={tracking.recovery} />
        </Frame>
      );
    case "coach":
      return (
        <Frame step={index} tracking={tracking} footer={footer(continueButton(next, "Finish"), false)}>
          <CoachSetupPanel />
          {error && <Result ok={false}>{error}</Result>}
        </Frame>
      );
  }
}
