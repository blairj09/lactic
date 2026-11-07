// The first-run tour: a card that walks the top bar screen by screen, a short list of what setup
// left undone, and a demo ride on the simulated trainer at the end.

import { useEffect, useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router";
import { button } from "@/components/ui";
import { remembered } from "@/lib/ble/devices";
import { useCoachMode } from "~/app/coach-mode";
import { createClient } from "~/db/supabase-client";
import { DemoRide } from "./demo-ride";
import { stepsFor } from "./steps";
import { getSetting } from "~/settings/store";
import { endTour, goToStep, startTour, TOUR_DONE, useTourStep } from "./store";

interface Gap {
  label: string;
  section: string;
}

/** What setup was skipped, so the Settings stop can point at it. */
function useSetupGaps(active: boolean, mode: string): Gap[] | null {
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  useEffect(() => {
    if (!active) return;
    const supabase = createClient();
    void Promise.all([
      supabase.from("athlete_settings").select("ftp_watts").maybeSingle(),
      supabase.from("intervals_connections").select("user_id").maybeSingle(),
    ]).then(([athlete, icu]) => {
      const out: Gap[] = [];
      if (!athlete.data?.ftp_watts) out.push({ label: "Your FTP, for training zones", section: "profile" });
      if (!remembered("trainer")) out.push({ label: "Pair your smart trainer", section: "gear" });
      if (!icu.data) out.push({ label: "Bring in your rides from intervals.icu", section: "connections" });
      if (mode === "none") out.push({ label: "Choose a coach, if you'd like one", section: "coach-settings" });
      setGaps(out);
    });
  }, [active, mode]);
  return gaps;
}

function useTarget(target: string | undefined, key: unknown) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    setRect(null);
    if (!target) return;
    let frame = 0;
    const measure = () => {
      const found = document.querySelector(`[data-tour="${target}"]`);
      const el = found && getComputedStyle(found).display === "contents" ? found.firstElementChild : found;
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 ? r : null);
    };
    // Screens load lazily, so keep looking for a moment.
    const poll = setInterval(measure, 200);
    const stop = setTimeout(() => clearInterval(poll), 3000);
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", onResize);
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [target, key]);
  return rect;
}

const CARD_WIDTH = 380;
const PAD = 6;

export function Tour() {
  const at = useTourStep();
  const mode = useCoachMode();
  const navigate = useNavigate();
  const steps = stepsFor(mode);
  const step = at === null ? null : steps[Math.min(at, steps.length - 1)];
  const [demo, setDemo] = useState(false);
  const rect = useTarget(step?.target, at);
  const gaps = useSetupGaps(step?.id === "settings", mode);

  // Until it's finished or skipped once, the tour picks up again when Lactic opens.
  useEffect(() => {
    void getSetting(TOUR_DONE, false).then((seen) => {
      if (!seen) startTour();
    });
  }, []);

  useEffect(() => {
    if (step?.route) navigate(step.route);
  }, [step?.route, navigate]);

  useEffect(() => {
    if (at === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (demo) return;
      if (e.key === "Escape") void endTour();
      if (e.key === "ArrowRight" && at < steps.length - 1) goToStep(at + 1);
      if (e.key === "ArrowLeft" && at > 0) goToStep(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, steps.length, demo]);

  if (at === null || !step) return null;
  if (demo)
    return (
      <DemoRide
        onClose={(finished) => {
          setDemo(false);
          if (finished) void endTour();
        }}
      />
    );

  const index = steps.indexOf(step);
  const last = index === steps.length - 1;
  const first = index === 0;
  const vw = window.innerWidth;
  const cardStyle: React.CSSProperties = rect
    ? { top: rect.bottom + PAD + 12, left: Math.max(16, Math.min(rect.left + rect.width / 2 - CARD_WIDTH / 2, vw - CARD_WIDTH - 16)), width: Math.min(CARD_WIDTH, vw - 32) }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: Math.min(CARD_WIDTH + 40, vw - 32) };

  const openSection = (section: string) => {
    void endTour();
    navigate(`/settings`);
    setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: "smooth" }), 400);
  };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-lg transition-all duration-300"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 2px var(--accent), 0 0 0 9999px rgb(0 0 0 / 0.55)" }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/55" />
      )}
      <div className="absolute space-y-4 rounded-xl border border-line bg-surface p-5 shadow-2xl transition-all duration-300" style={cardStyle}>
        <div className="space-y-1.5">
          {!first && (
            <p className="num text-xs text-faint">
              {index} of {steps.length - 1}
            </p>
          )}
          <h2 id="tour-title" className="text-lg font-semibold tracking-tight">
            {step.title}
          </h2>
          <p className="text-sm text-muted">{step.body}</p>
        </div>
        {step.id === "settings" && gaps && gaps.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Still to set up</p>
            <ul className="space-y-1">
              {gaps.map((g) => (
                <li key={g.label}>
                  <button type="button" className="text-left text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink" onClick={() => openSection(g.section)}>
                    {g.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 pt-1">
          <button type="button" className={button.ghost} onClick={() => void endTour()}>
            {last ? "Finish" : "Skip tour"}
          </button>
          <div className="flex items-center gap-2">
            {!first && (
              <button type="button" className={button.small} onClick={() => goToStep(index - 1)}>
                Back
              </button>
            )}
            {last ? (
              <button type="button" className={button.smallPrimary} onClick={() => setDemo(true)}>
                Try a demo ride
              </button>
            ) : (
              <button type="button" className={button.smallPrimary} onClick={() => goToStep(index + 1)} autoFocus>
                {first ? "Show me" : "Next"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
