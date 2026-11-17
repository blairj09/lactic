// Lactic's Settings: the web app's panels where they fit (profile, appearance, coach voice and
// memory, intervals.icu, Bluetooth, FIT import) and Lactic's own (coach setup, Apple Health,
// your data; simulated gear in development builds, the plugin sandbox check in development and Preview builds). Rendered like the other pages, as an async page.

import Nav from "@/components/nav";
import { Page } from "@/components/ui";
import { loadAthlete } from "@/lib/activities";
import { loadConnection as loadIntervals } from "@/lib/intervals/client";
import { loadMemory, loadPersona } from "@/lib/coach/store";
import BluetoothDevices from "@/app/settings/bluetooth-devices";
import CoachMemory from "@/app/settings/coach-memory";
import CoachPersona from "@/app/settings/coach-persona";
import FitImport from "@/app/settings/fit-import";
import IntervalsPanel from "@/app/settings/intervals-panel";
import SettingsForm, { Section } from "@/app/settings/settings-form";
import ThemeSetting, { ContrastSetting } from "@/app/settings/theme-setting";
import UnitsSetting from "@/app/settings/units-setting";
import { coachSetup } from "~/ai/settings";
import { createClient } from "~/db/supabase-client";
import { CoachSetupPanel } from "~/setup/coach";
import { HealthSetup } from "~/setup/health";
import { IntervalsConnect } from "~/setup/rides";
import { DataPanel, SimulatorSwitch } from "./panels";
import { SandboxCheck } from "./sandbox-check";
import { isPreview } from "~/app/beta";
import AppStartSwitch from "~/ride/app-start-switch";
import { canWatchApps } from "~/ride/app-start";
import { StravaSection } from "./strava-panel";
import { TakeTour } from "~/tour/take-tour";
import { FeedbackSetting } from "~/feedback/dialog";
import { AboutSetting } from "~/updates/check-button";
import { FeatureSetting } from "~/setup/features";
import { ExperimentsSetting } from "./experiments";
import { features } from "@/lib/features";
import { SettingsShell, type SettingBlock } from "./shell";
import { isDesktop, isPhone, phoneHealthName, phoneWord } from "~/platform/native";
import { ComputerLink, PairPhone, PhoneHealth } from "~/phone/settings";
import { phoneStatus } from "~/phone/plugin";
import { ftpSourceLine } from "@/lib/engine/provenance";
import { localDate } from "@/lib/engine/activity";
import { listSavedLayouts, loadLayout } from "@/lib/layout-data";
import { defaultLayout } from "@/lib/sdk/layout";
import { sameLayout } from "@/lib/sdk/layout-editor";
import { LayoutSetting } from "./layout-panel";
import { PluginsSettings } from "./plugins-settings";
import { pluginsAllowed } from "~/plugins/use-plugin-tab";

export default async function SettingsPage() {
  const supabase = createClient();
  const tracking = features();
  const [athlete, icu, setup, persona, memory, layout, copies] = await Promise.all([
    loadAthlete(supabase),
    loadIntervals(supabase),
    coachSetup(),
    loadPersona(supabase),
    loadMemory(supabase),
    loadLayout(supabase),
    listSavedLayouts(supabase).catch(() => []),
  ]);
  // A paired iPhone leaves intervals.icu to the computer; one used on its own connects it itself.
  const pairedPhone = isPhone() && Boolean((await phoneStatus().catch(() => null))?.paired);
  const pairedFor = (connected: boolean) =>
    connected ? "Connected on your computer. Rides it brings in come across when this iPhone syncs." : "Connect intervals.icu in Lactic on your computer.";
  const blocks: (SettingBlock | false)[] = [
    {
      key: "profile",
      section: "profile",
      text: "Training FTP threshold max heart rate zones power Body weight height birth date sex Sleep need time zone",
      node: (
        <SettingsForm
          ftpSource={ftpSourceLine(athlete.ftpHistory, localDate(new Date(), athlete.timezone))}
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
      ),
    },
    {
      key: "look",
      section: "appearance",
      text: "Look theme light dark contrast high contrast units metric imperial kg lb km miles",
      node: (
        <Section id="units" title="Look" description="Theme, contrast and units.">
          <ThemeSetting />
          <ContrastSetting />
          <UnitsSetting />
        </Section>
      ),
    },
    {
      key: "layout",
      section: "appearance",
      text: "Layout tabs order Today cards customize reset",
      node: (
        <Section id="layout" title="Layout" description="Your tabs and the cards on Today.">
          <LayoutSetting layout={layout} copies={copies} custom={!sameLayout(layout, defaultLayout())} />
        </Section>
      ),
    },
    {
      key: "bluetooth",
      section: "devices",
      text: "Bluetooth pair trainer smart trainer KICKR heart rate strap power meter cadence scale sensors",
      node: (
        <Section id="bluetooth" title="Bluetooth" description="Your trainer, sensors and scale.">
          <BluetoothDevices />
        </Section>
      ),
    },
    canWatchApps() && {
      key: "free-ride",
      section: "devices",
      text: "Free ride start with Zwift Rouvy MyWhoosh any app overlay fields trainer",
      node: (
        <Section id="free-ride" title="Free ride" description="Ride with Zwift, Rouvy or any app, your fields on top.">
          <div className="sm:col-span-2">
            <AppStartSwitch className="" />
          </div>
        </Section>
      ),
    },
    import.meta.env.DEV && {
      key: "simulated",
      section: "devices",
      text: "Simulated gear virtual trainer development testing",
      node: (
        <Section title="Simulated gear" description="Development builds only: virtual gear for testing without a bike.">
          <SimulatorSwitch />
        </Section>
      ),
    },
    {
      key: "coach",
      section: "coach",
      text: "Coach AI built-in external Claude ChatGPT OpenRouter API key model none MCP",
      node: (
        <Section id="coach-settings" title="Your coach" description="Who coaches, and on which model.">
          <div className="sm:col-span-2">
            <CoachSetupPanel />
          </div>
        </Section>
      ),
    },
    setup.mode === "builtin" && {
      key: "persona",
      section: "coach",
      text: "How the coach talks voice tone persona morning brief",
      node: (
        <Section title="How the coach talks" description="Its voice in chat and the morning brief.">
          <CoachPersona initial={persona} />
        </Section>
      ),
    },
    setup.mode !== "none" && {
      key: "memory",
      section: "coach",
      text: "What the coach remembers memory facts",
      node: (
        <Section title="What the coach remembers" description="Facts it reads before every answer.">
          <CoachMemory memory={memory} />
        </Section>
      ),
    },
    {
      key: "intervals",
      section: "connections",
      text: "intervals.icu sync rides Zwift Garmin Wahoo planned workouts upload",
      node: (
        <Section id="intervals" title="intervals.icu" description="Rides in from Zwift, Garmin and Wahoo. Your rides and planned workouts back out.">
          <div className="sm:col-span-2">
            {/* A paired iPhone leaves intervals.icu to the computer and gets its rides by syncing. */}
            {pairedPhone ? (
              <p className="text-sm text-muted">{pairedFor(Boolean(icu))}</p>
            ) : icu ? (
              <IntervalsPanel
                status={{
                  connected: true,
                  lastSyncedAt: icu.lastSyncedAt?.toISOString() ?? null,
                  historyDone: icu.backfillDone,
                  historyReachedBack: icu.backfillBeforeLocal ?? null,
                  uploadRides: icu.uploadRides,
                  stravaMissing: icu.stravaMissing,
                }}
              />
            ) : (
              <IntervalsConnect heading={false} />
            )}
          </div>
        </Section>
      ),
    },
    { key: "strava", section: "connections", text: "Strava post upload rides", node: <StravaSection /> },
    {
      key: "import",
      section: "connections",
      text: "Import ride files FIT GPX TCX zip Zwift Garmin Strava archive",
      node: (
        <Section id="import" title="Import ride files" description="FIT, GPX or TCX files, or a whole .zip such as Strava's or Garmin's archive. Duplicates are skipped.">
          <div className="sm:col-span-2">
            <FitImport />
          </div>
        </Section>
      ),
    },
    {
      key: "tracking",
      section: "health",
      text: "What you track sleep recovery weight turn off",
      node: (
        <Section id="tracking" title="What you track" description="Besides rides and your plan. Off hides it; saved data stays.">
          <FeatureSetting />
        </Section>
      ),
    },
    isPhone() && {
      key: "phone-health",
      section: "health",
      text: `${phoneHealthName()} Apple Health sleep HRV resting heart rate rides out`,
      node: (
        <Section id="health-source" title={phoneHealthName()} description="Sleep and recovery in, rides out.">
          <PhoneHealth />
        </Section>
      ),
    },
    !isPhone() && tracking.recovery && {
      key: "recovery",
      section: "health",
      text: "Sleep and recovery HRV resting heart rate Apple Health watch ring Oura WHOOP Garmin",
      node: (
        <Section id="health-source" title="Sleep and recovery" description="From Apple Health, or your watch or ring through intervals.icu.">
          <div className="sm:col-span-2">
            <HealthSetup heading={false} />
          </div>
        </Section>
      ),
    },
    isPhone() && {
      key: "computer",
      section: "phone",
      text: "Your computer sync pair Mac Wi-Fi",
      node: (
        <Section id="computer" title="Your computer" description={`It keeps the main copy of everything. This ${phoneWord()} syncs with it.`}>
          <ComputerLink />
        </Section>
      ),
    },
    !isPhone() && isDesktop && {
      key: "pair-phone",
      section: "phone",
      text: "Phone iPhone Android pair QR code sync Wi-Fi Apple Health",
      node: (
        <Section id="iphone" title="Phone" description="Reads Apple Health for you and runs rides. Syncs with this computer over Wi-Fi.">
          <PairPhone />
        </Section>
      ),
    },
    pluginsAllowed && {
      key: "plugins",
      section: "plugins",
      text: "Plugins add-ons install add GitHub catalog browse ride fields ride page sections update remove",
      node: (
        <Section id="plugins-list">
          <div className="sm:col-span-2">
            <PluginsSettings />
          </div>
        </Section>
      ),
    },
    pluginsAllowed &&
      (import.meta.env.DEV || isPreview) && {
        key: "sandbox-check",
        section: "plugins",
        text: "Plugin sandbox check escape tests development",
        node: (
          <Section title="Sandbox check" description="Development and Preview builds only: tests that plugins can't escape their sandbox.">
            <SandboxCheck />
          </Section>
        ),
      },
    {
      key: "data",
      section: "data",
      text: "Your data backup back up export restore delete everything file CSV",
      node: (
        <Section>
          <DataPanel />
        </Section>
      ),
    },
    {
      key: "experimental",
      section: "experimental",
      text: "Experimental features race report course prep adaptive workouts beta",
      node: (
        <Section>
          <ExperimentsSetting />
        </Section>
      ),
    },
    {
      key: "help",
      section: "help",
      text: "Getting started tour walk through Feedback problem bug idea report About Lactic version update",
      node: (
        <Section id="about">
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <TakeTour />
            <FeedbackSetting />
          </div>
          <AboutSetting />
        </Section>
      ),
    },
  ];
  return (
    <>
      <Nav current="/settings" />
      <Page>
        <SettingsShell blocks={blocks.filter((b): b is SettingBlock => Boolean(b))} />
      </Page>
    </>
  );
}
