// "Post to Strava" on a ride page: sends an earlier ride recorded here (or one that didn't go), and
// shows where it is once sent. Only with the Strava experiment on and Strava connected.

import { useEffect, useState } from "react";
import { button } from "@/components/ui";
import { useExperiments } from "@/lib/use-experiments";
import { openExternal } from "~/platform/native";
import { loadStrava, postRideToStrava, stravaActivityUrl, stravaUploadFor, type StravaUpload } from "~/integrations/strava";

export function PostToStravaButton({ rideId }: { rideId: string }) {
  const { strava_upload } = useExperiments();
  const [connected, setConnected] = useState(false);
  const [upload, setUpload] = useState<StravaUpload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!strava_upload) return;
    let live = true;
    const read = async () => {
      const [c, u] = await Promise.all([loadStrava(), stravaUploadFor(rideId)]);
      if (!live) return;
      setConnected(!!c && !c.needsReconnect);
      setUpload(u);
    };
    void read();
    // Follow it while it's on its way.
    const timer = setInterval(() => void read(), 15_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [strava_upload, rideId]);

  if (!strava_upload || !connected) return null;

  if (upload?.status === "sent" && upload.stravaId)
    return (
      <button type="button" className={button.secondary} onClick={() => void openExternal(stravaActivityUrl(upload.stravaId!))}>
        View on Strava
      </button>
    );
  const going = upload && ["pending", "sending", "processing"].includes(upload.status);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={button.secondary}
        disabled={busy || !!going}
        title={error ?? (upload?.status === "failed" ? upload.error ?? undefined : undefined)}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await postRideToStrava(rideId);
            setUpload(await stravaUploadFor(rideId));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {going ? "Posting to Strava…" : upload?.status === "failed" ? "Try Strava again" : upload?.status === "skipped" ? "Post to Strava again" : "Post to Strava"}
      </button>
      {error && <span className="text-sm text-negative">{error}</span>}
    </span>
  );
}
