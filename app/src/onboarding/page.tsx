// First run: a few short steps, each one skippable but the first, and every one of them also in
// Settings later. The aim is riding a planned workout within five minutes of opening the app.

import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { button, Result } from "@/components/ui";
import { MarkTile, Wordmark } from "~/app/brand";
import { setSetting } from "~/settings/store";
import { ProfileForm, saveProfile, useProfile } from "~/setup/profile";
import { defaultWeek, saveWeek, WeekForm } from "~/setup/week";
import { GearSetup } from "~/setup/gear";
import { RidesSetup } from "~/setup/rides";
import { CoachSetupPanel } from "~/setup/coach";
import { revalidatePath } from "~/shims/next-cache";
import { startTour } from "~/tour/store";

const STEPS = [
  { id: "you", title: "About you", line: "So zones, stress and the plan fit you." },
  { id: "week", title: "Your week and goal", line: "Lactic builds a plan around the time you have." },
  { id: "gear", title: "Your gear", line: "Wake up your trainer and sensors. Lactic finds them." },
  { id: "rides", title: "Your rides and health", line: "Bring in your history so Lactic knows your fitness from day one, and your sleep for a daily recovery score." },
  { id: "coach", title: "Your coach", line: "Choose how you'd like coaching, if at all." },
] as const;
type StepId = (typeof STEPS)[number]["id"];

function Frame({ step, children, footer }: { step: number; children: React.ReactNode; footer: React.ReactNode }) {
  const s = STEPS[step];
  return (
    <div className="min-h-screen bg-ground">
      <div className="lactic-drag lactic-titlebar flex h-12 items-center px-5">
        <Wordmark />
      </div>
      <div className="mx-auto max-w-2xl px-5 pt-6 pb-28">
        <ol className="mb-8 grid grid-cols-5 gap-1.5" aria-label="Setup progress">
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

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="lactic-drag grid min-h-screen place-items-center bg-ground px-6">
      <div className="max-w-md space-y-8 text-center">
        <div className="flex justify-center">
          <MarkTile size={84} />
        </div>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome to Lactic</h1>
          <p className="text-muted">Structured training that fits your week: a plan that adapts as you ride, ERG workouts on your smart trainer, and your recovery in one place. Free, and everything stays on this computer.</p>
        </div>
        <div className="space-y-3">
          <button type="button" className={`${button.primary} h-11 w-full text-base`} onClick={onStart}>
            Get started
          </button>
          <p className="text-sm text-faint">About five minutes. You can change everything later.</p>
        </div>
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
          <p className="text-muted">Your plan is ready. Take a quick look around each screen and the Ride screen, or go straight to Today.</p>
        </div>
        <div className="space-y-3">
          <button type="button" className={`${button.primary} h-11 w-full text-base`} onClick={() => onFinish(true)}>
            Show me around
          </button>
          <button type="button" className={`${button.ghost} mx-auto`} onClick={() => onFinish(false)}>
            Skip the tour
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
        <Frame step={index} footer={footer(continueButton(() => void save(() => saveProfile(profile.values))), false)}>
          {profile.loaded && <ProfileForm values={profile.values} onChange={profile.setValues} error={error} />}
        </Frame>
      );
    case "week":
      return (
        <Frame step={index} footer={footer(continueButton(() => void save(() => saveWeek(week)), "Build my plan"))}>
          <WeekForm values={week} onChange={setWeek} error={error} />
        </Frame>
      );
    case "gear":
      return (
        <Frame step={index} footer={footer(continueButton(next))}>
          <GearSetup />
        </Frame>
      );
    case "rides":
      return (
        <Frame step={index} footer={footer(continueButton(next))}>
          <RidesSetup />
        </Frame>
      );
    case "coach":
      return (
        <Frame step={index} footer={footer(continueButton(next, "Finish"), false)}>
          <CoachSetupPanel />
          {error && <Result ok={false}>{error}</Result>}
        </Frame>
      );
  }
}
