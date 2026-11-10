// Lactic's window: the web app's screens, routed in the window, with the coach drawer beside them.

import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useNavigate } from "react-router";
import CoachDrawer from "@/app/coach/coach-drawer";
import DrawerBoundary from "@/app/coach/drawer-boundary";
import NewDayRefresh from "@/components/new-day-refresh";
import { ServerPage } from "./server-page";
import { setNavigator } from "~/shims/next-navigation";
import { refreshCoachMode, useCoachMode, useMcpOn } from "./coach-mode";
import { getSetting } from "~/settings/store";
import { loadFeatures } from "~/settings/features";
import { loadExperiments } from "~/settings/experiments";
import { startBackground } from "~/integrations/background";
import "~/integrations/apple-health";
import "~/integrations/strava";
import { BluetoothPicker } from "~/bluetooth/picker";
import { startMcpBridge } from "~/mcp/bridge";
import { ExternalSuggestions } from "~/mcp/suggestions";
import { Tour } from "~/tour/tour";
import { installSupportTools } from "~/support/tools";
import { UpdatePrompt } from "~/updates/prompt";

// The coach's tools for checking and fixing the app itself (gear, intervals.icu, its own setup).
installSupportTools();

const today = () => import("@/app/(today)/page");
const plan = () => import("@/app/plan/page");
const progress = () => import("@/app/progress/page");
const vo2max = () => import("@/app/progress/vo2max/page");
const health = () => import("@/app/health/page");
const metric = () => import("@/app/health/[metric]/page");
const ride = () => import("@/app/ride/page");
const rideDetail = () => import("@/app/rides/[id]/page");
const raceReport = () => import("@/app/rides/[id]/race/page");
const settings = () => import("~/settings/page");
const onboarding = () => import("~/onboarding/page");
const overlay = () => import("~/ride/overlay-window");

function NavigatorBridge() {
  const navigate = useNavigate();
  useEffect(() => setNavigator((to, opts) => navigate(to, opts)), [navigate]);
  return null;
}

function Lazy({ load }: { load: () => Promise<{ default: React.ComponentType }> }) {
  const [C, setC] = useState<React.ComponentType | null>(null);
  useEffect(() => {
    void load().then((m) => setC(() => m.default));
  }, [load]);
  return C ? <C /> : null;
}

function Shell() {
  const mode = useCoachMode();
  const mcp = useMcpOn();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  useEffect(() => {
    void refreshCoachMode();
    // What the rider tracks is read before the first screen, so nothing they turned off flashes up.
    void Promise.all([loadFeatures(), loadExperiments()])
      .catch(() => {})
      .then(() => getSetting("onboarding.done", false))
      .then(setOnboarded);
    const onSettings = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (key === "onboarding.done") void getSetting("onboarding.done", false).then(setOnboarded);
      if (key === "coach.setup") void refreshCoachMode();
    };
    window.addEventListener("lactic:settings", onSettings);
    return () => window.removeEventListener("lactic:settings", onSettings);
  }, []);
  useEffect(() => {
    if (onboarded) return startBackground();
  }, [onboarded]);
  // The overlay window runs this app too; only the main window answers the MCP server.
  useEffect(() => (location.hash.startsWith("#/overlay") ? undefined : startMcpBridge()), []);
  if (onboarded === null) return null;
  return (
    <>
      <NavigatorBridge />
      <Routes>
        <Route path="/overlay" element={<Lazy load={overlay} />} />
        <Route path="/welcome/*" element={<Lazy load={onboarding} />} />
        {!onboarded ? (
          <Route path="*" element={<Navigate to="/welcome" replace />} />
        ) : (
          <>
        <Route path="/" element={<ServerPage load={today} />} />
        <Route path="/plan" element={<ServerPage load={plan} />} />
        <Route path="/progress" element={<ServerPage load={progress} />} />
        <Route path="/progress/vo2max" element={<ServerPage load={vo2max} />} />
        <Route path="/health" element={<ServerPage load={health} />} />
        <Route path="/health/:metric" element={<ServerPage load={metric} />} />
        <Route path="/ride" element={<ServerPage load={ride} />} />
        <Route path="/rides/:id" element={<ServerPage load={rideDetail} />} />
        <Route path="/rides/:id/race" element={<ServerPage load={raceReport} />} />
        <Route path="/settings" element={<ServerPage load={settings} />} />
        <Route path="/analysis" element={<Navigate to="/progress" replace />} />
        <Route path="/rides" element={<Navigate to="/progress?tab=rides" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
      <NewDayRefresh />
      <BluetoothPicker />
      <UpdatePrompt />
      {onboarded && <Tour />}
      {onboarded && mcp && <ExternalSuggestions />}
      {mode === "builtin" && (
        <DrawerBoundary>
          <CoachDrawer />
        </DrawerBoundary>
      )}
    </>
  );
}

export default function App() {
  // The ride overlay window runs this app too, but shows only the overlay.
  if (location.hash.startsWith("#/overlay")) return <Lazy load={overlay} />;
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
