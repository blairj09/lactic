// Lactic's Settings: the web app's panels where they fit (profile, appearance, coach voice and
// memory, intervals.icu, Bluetooth, FIT import) and Lactic's own (coach setup, Apple Health,
// your data; simulated gear in development builds). Rendered like the other pages, as an async page.

import Nav from "@/components/nav";
import { Page, PageHeader } from "@/components/ui";
import { loadAthlete } from "@/lib/activities";
import { loadConnection as loadIntervals } from "@/lib/intervals/client";
import { loadMemory, loadPersona } from "@/lib/coach/store";
import BluetoothDevices from "@/app/settings/bluetooth-devices";
import CoachMemory from "@/app/settings/coach-memory";
import CoachPersona from "@/app/settings/coach-persona";
import FitImport from "@/app/settings/fit-import";
import IntervalsPanel from "@/app/settings/intervals-panel";
import SettingsForm, { Section } from "@/app/settings/settings-form";
import ThemeSetting from "@/app/settings/theme-setting";
import { coachSetup } from "~/ai/settings";
import { createClient } from "~/db/supabase-client";
import { CoachSetupPanel } from "~/setup/coach";
import { HealthSetup } from "~/setup/health";
import { IntervalsConnect } from "~/setup/rides";
import { AboutPanel, SimulatorSwitch } from "./panels";
import { TakeTour } from "~/tour/take-tour";
import { FeedbackSetting } from "~/feedback/dialog";

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "coach-settings", label: "Coach" },
  { id: "connections", label: "Connections" },
  { id: "gear", label: "Gear" },
  { id: "data", label: "Your data" },
];

export default async function SettingsPage() {
  const supabase = createClient();
  const [athlete, icu, setup, persona, memory] = await Promise.all([loadAthlete(supabase), loadIntervals(supabase), coachSetup(), loadPersona(supabase), loadMemory(supabase)]);
  return (
    <>
      <Nav current="/settings" />
      <Page width="medium">
        <PageHeader title="Settings" />
        <nav aria-label="Settings sections" className="-mt-2 mb-8 flex flex-wrap gap-1">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#/settings`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" });
              }}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
            >
              {s.label}
            </a>
          ))}
        </nav>
        <SettingsForm
          values={{
            ftp_watts: athlete.ftp,
            threshold_hr: athlete.thresholdHr,
            max_hr: athlete.maxHr,
            weight_kg: athlete.weightKg,
            height_cm: athlete.heightCm,
            birth_date: athlete.birthDate,
            sex: athlete.sex,
            sleep_need_hours: athlete.sleepNeedHours,
            timezone: athlete.timezone,
          }}
        />
        <div className="space-y-4 border-t border-line pt-8">
          <Section id="appearance" title="Appearance" description="Light, dark, or match your system.">
            <ThemeSetting />
          </Section>
          <Section id="tour" title="Getting started" description="A short walk through each screen.">
            <TakeTour />
          </Section>
          <Section id="feedback" title="Feedback" description="Found a problem or have an idea? No account needed.">
            <FeedbackSetting />
          </Section>
        </div>
        <div id="coach-settings" className="scroll-mt-16 space-y-4 border-t border-line pt-8">
          <Section title="Coach" description="Built-in, an AI app you already use, or none.">
            <div className="sm:col-span-2">
              <CoachSetupPanel />
            </div>
          </Section>
          {setup.mode !== "none" && (
            <>
              {setup.mode === "builtin" && (
                <Section title="How the coach talks" description="Its voice in chat and the morning brief.">
                  <CoachPersona initial={persona} />
                </Section>
              )}
              <Section title="What the coach remembers" description="Facts it reads before every answer. Edit them or add your own.">
                <CoachMemory memory={memory} />
              </Section>
            </>
          )}
        </div>
        <div id="connections" className="scroll-mt-16 space-y-4 border-t border-line pt-8">
          <Section title="intervals.icu" description="Brings in rides from Zwift, Garmin and Wahoo, and sends your rides and planned workouts back.">
            <div className="sm:col-span-2">
              {icu ? (
                <IntervalsPanel
                  status={{
                    connected: true,
                    lastSyncedAt: icu.lastSyncedAt?.toISOString() ?? null,
                    historyDone: icu.backfillDone,
                    historyReachedBack: icu.backfillBeforeLocal ?? null,
                    uploadRides: icu.uploadRides,
                  }}
                />
              ) : (
                <IntervalsConnect heading={false} />
              )}
            </div>
          </Section>
          <Section id="health" title="Sleep and recovery" description="Sleep, HRV and resting heart rate from your watch or ring.">
            <div className="sm:col-span-2">
              <HealthSetup heading={false} />
            </div>
          </Section>
          <Section title="Import FIT files" description="From Zwift (Documents/Zwift/Activities), Garmin Connect or your bike computer. Duplicates are skipped.">
            <div className="sm:col-span-2">
              <FitImport />
            </div>
          </Section>
        </div>
        <div id="gear" className="scroll-mt-16 space-y-4 border-t border-line pt-8">
          <Section title="Bluetooth" description="Pair once and your gear reconnects on its own.">
            <BluetoothDevices />
          </Section>
          {import.meta.env.DEV && (
            <Section title="Simulated gear" description="Development builds only: a virtual trainer, heart rate strap, power meter and scale for testing without a bike.">
              <SimulatorSwitch />
            </Section>
          )}
        </div>
        <div id="data" className="scroll-mt-16 space-y-4 border-t border-line pt-8">
          <Section title="Your data" description="Everything is in one file on this computer. Back it up or take it anywhere.">
            <AboutPanel />
          </Section>
        </div>
      </Page>
    </>
  );
}
