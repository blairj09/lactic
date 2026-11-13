// A saved ride's plugin analyses, each in its plugin frame under Lactic's own sections. Analyses that
// haven't run on this ride with the current plugin version run when the page opens, never mid-ride.
import { useCallback, useEffect, useState } from "react";
import { button } from "@/components/ui";
import { analyzeRide, rideAnalyses, type AnalysisResult } from "./analyze";
import { createPluginWorker } from "./spawn";
import { KitView, PluginFrame } from "./kit-view";

export function RidePlugins({ rideId }: { rideId: string }) {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(
    async (force = false) => {
      setResults(await rideAnalyses(rideId));
      setRunning(true);
      try {
        if (await analyzeRide(rideId, createPluginWorker, { force })) setResults(await rideAnalyses(rideId));
      } finally {
        setRunning(false);
      }
    },
    [rideId],
  );

  useEffect(() => {
    void run().catch(() => setRunning(false));
    const refresh = () => void rideAnalyses(rideId).then(setResults);
    window.addEventListener("lactic:plugins", refresh);
    return () => window.removeEventListener("lactic:plugins", refresh);
  }, [run, rideId]);

  if (!results.length) return null;
  return (
    <div className="space-y-4">
      {results.map((r) => (
        <PluginFrame key={`${r.pluginId}:${r.analysis}`} name={r.pluginName} label={r.title}>
          {r.tree ? (
            <KitView node={r.tree} />
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
              <span>
                {r.pluginName} {r.failed}.
              </span>
              <button type="button" className={button.small} disabled={running} onClick={() => void run(true)}>
                Try again
              </button>
            </div>
          )}
        </PluginFrame>
      ))}
    </div>
  );
}
