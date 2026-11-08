import { ftpSourceLine } from "@/lib/engine/provenance";
import { localDate } from "@/lib/engine/activity";
import Nav from "@/components/nav";
import { loadAthlete } from "@/lib/activities";
import { authEnabled, PASSKEY_RP_ID, passkeysWorkOn } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { loadIngestToken } from "@/lib/recovery-data";
import { loadConnection as loadIntervals } from "@/lib/intervals/client";
import BluetoothDevices from "./bluetooth-devices";
import FitImport from "./fit-import";
import HealthShortcut from "./health-shortcut";
import IntervalsPanel from "./intervals-panel";
import SignIn, { type PasskeyRow } from "./sign-in";
import SettingsForm, { Section } from "./settings-form";
import ThemeSetting from "./theme-setting";
import CoachMemory from "./coach-memory";
import CoachPersona from "./coach-persona";
import { coachModel } from "@/lib/coach/conversation";
import { listConversations, loadMemory, loadPersona } from "@/lib/coach/store";
import { Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Settings · My Coach" };
export const dynamic = "force-dynamic";
// intervals.icu history batches fetch a file per ride.
export const maxDuration = 60;

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "coach-settings", label: "Coach" },
  { id: "connections", label: "Connections" },
  { id: "sign-in", label: "Sign-in" },
];

export default async function SettingsPage() {
  const supabase = authEnabled ? await createClient() : null;
  const host = (await headers()).get("host") ?? PASSKEY_RP_ID;
  const passkeysHere = passkeysWorkOn(host);
  const model = coachModel()?.model ?? null;
  // Each is a round trip to the database; they go out together.
  const [athlete, token, icu, passkeys, coach] = await Promise.all([
    supabase ? loadAthlete(supabase) : null,
    supabase ? loadIngestToken(supabase) : null,
    supabase ? loadIntervals(supabase) : null,
    supabase && passkeysHere ? loadPasskeys(supabase) : null,
    supabase && model ? loadCoach(supabase) : null,
  ]);
  const endpoint = `${host.startsWith("localhost") ? "http" : "https"}://${host}/api/health`;
  return (
    <>
      <Nav current="/settings" />
      <Page width="medium">
        <PageHeader title="Settings" />
        {athlete ? (
          <>
            <nav aria-label="Settings sections" className="-mt-2 mb-8 flex flex-wrap gap-1">
              {SECTIONS.filter((s) => s.id !== "coach-settings" || coach).map((s) => (
                <a key={s.id} href={`#${s.id}`} className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink">
                  {s.label}
                </a>
              ))}
            </nav>
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
            <div className="space-y-4 border-t border-line pt-8">
              <Section id="appearance" title="Appearance" description="Light, dark, or match the system. Applies everywhere, the ride overlay included.">
                <ThemeSetting />
              </Section>
            </div>
            {coach && (
              <div id="coach-settings" className="space-y-4 border-t border-line pt-8">
                <Section
                  title="Coach"
                  description={
                    <>
                      How it talks in chat and the brief. Running {model}, {coach.conversations}{" "}
                      {coach.conversations === 1 ? "conversation" : "conversations"} so far.
                    </>
                  }
                >
                  <CoachPersona initial={coach.persona} />
                </Section>
                <Section title="What the coach remembers" description="Facts it reads before every answer. Saved from your chats; edit or add your own.">
                  <CoachMemory memory={coach.memory} />
                </Section>
              </div>
            )}
            <div id="connections" className="scroll-mt-16 space-y-4 border-t border-line pt-8">
              <Section
                title="intervals.icu"
                description="Brings in Karoo and Zwift rides, sends rides recorded here, and puts planned workouts on its calendar. Link Zwift and the Karoo to it directly, not through Strava."
              >
                <div className="sm:col-span-2">
                  <IntervalsPanel
                    status={{
                      connected: Boolean(icu),
                      lastSyncedAt: icu?.lastSyncedAt?.toISOString() ?? null,
                      historyDone: icu?.backfillDone ?? false,
                      historyReachedBack: icu?.backfillBeforeLocal ?? null,
                      uploadRides: icu?.uploadRides ?? true,
                    }}
                  />
                </div>
              </Section>
              <Section title="Bluetooth" description="Devices this Mac remembers. Pair once and they reconnect on their own.">
                <BluetoothDevices />
              </Section>
              <Section id="health" title="Apple Health" description="Recovery and sleep (HRV, resting HR, sleep stages), sent by an iPhone Shortcut when you wake.">
                <div className="sm:col-span-2">
                  <HealthShortcut
                    endpoint={endpoint}
                    tokenCreatedAt={token?.createdAt.toISOString() ?? null}
                    lastUsedAt={token?.lastUsedAt?.toISOString() ?? null}
                  />
                </div>
              </Section>
              <Section
                title="Import FIT files"
                description=".fit or .fit.gz files, from Documents/Zwift/Activities or the Karoo dashboard. Duplicates are skipped."
              >
                <div className="sm:col-span-2">
                  <FitImport />
                </div>
              </Section>
            </div>
            <div className="space-y-4 border-t border-line pt-8">
              <Section id="sign-in" title="Sign-in" description="Passkeys, one-time codes for previews and new devices, and sign out.">
                <SignIn passkeys={passkeys} passkeysHere={passkeysHere} rpId={PASSKEY_RP_ID} />
              </Section>
            </div>
          </>
        ) : (
          <p className="text-muted">Settings need Supabase.</p>
        )}
      </Page>
    </>
  );
}

async function loadCoach(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [persona, memory, conversations] = await Promise.all([loadPersona(supabase), loadMemory(supabase), listConversations(supabase, 1000)]);
  return { persona, memory, conversations: conversations.length };
}

async function loadPasskeys(supabase: Awaited<ReturnType<typeof createClient>>): Promise<PasskeyRow[] | null> {
  const { data, error } = await supabase.auth.passkey.list();
  if (error || !data) return null;
  return data.map((p) => ({
    id: p.id,
    name: p.friendly_name || "Passkey",
    createdAt: p.created_at,
    lastUsedAt: p.last_used_at ?? null,
  }));
}

