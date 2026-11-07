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
          <Section id="appearance" title="Appearance" description="Light, dark, or match the system. Applies everywhere, the ride overlay included.">
            <ThemeSetting />
          </Section>
          <Section id="tour" title="Getting started" description="A two-minute look at each screen, with a demo ride on a simulated trainer.">
            <TakeTour />
          </Section>
        </div>
        <div id="coach-settings" className="scroll-mt-16 space-y-4 border-t border-line pt-8">
          <Section title="Coach" description="No coach, the built-in coach on an AI model you choose, or an AI app you already use. Keys stay in your keychain.">
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
              <Section title="What the coach remembers" description="Facts it reads before every answer, built-in or external. Saved from your chats; edit or add your own.">
                <CoachMemory memory={memory} />
              </Section>
            </>
          )}
        </div>
        <div id="connections" className="scroll-mt-16 space-y-4 border-t border-line pt-8">
          <Section title="intervals.icu" description="Brings in rides from Zwift, Garmin, Wahoo and others, sends rides recorded here, and puts planned workouts on its calendar for your bike computer.">
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
                <IntervalsConnect />
              )}
            </div>
          </Section>
          <Section id="health" title="Health and recovery" description="Sleep, HRV and resting heart rate from your watch or ring, through intervals.icu or your iPhone.">
            <div className="sm:col-span-2">
              <HealthSetup />
            </div>
          </Section>
          <Section title="Import FIT files" description=".fit or .fit.gz files, from Documents/Zwift/Activities, Garmin Connect or your bike computer. Duplicates are skipped.">
            <div className="sm:col-span-2">
              <FitImport />
            </div>
          </Section>
        </div>
        <div id="gear" className="scroll-mt-16 space-y-4 border-t border-line pt-8">
          <Section title="Bluetooth" description="Devices Lactic remembers. Pair once and they reconnect on their own.">
            <BluetoothDevices />
          </Section>
          {import.meta.env.DEV && (
            <Section title="Simulated gear" description="Development builds only: a virtual trainer, heart rate strap, power meter and scale for testing without a bike.">
              <SimulatorSwitch />
            </Section>
          )}
        </div>
        <div id="data" className="scroll-mt-16 space-y-4 border-t border-line pt-8">
          <Section title="Your data" description="Everything Lactic knows is in one file on this computer. Back it up, or take it anywhere.">
            <AboutPanel />
          </Section>
        </div>
      </Page>
    </>
  );
}
