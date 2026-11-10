// The Strava link in a ride page's line under the title, beside "Open in intervals.icu": "Post to
// Strava" sends an earlier ride recorded here (or one that didn't go), "View on Strava" opens it
// once it's there. Only with the Strava experiment on and Strava connected.

import { useEffect, useState } from "react";
import { useExperiments } from "@/lib/use-experiments";
import { openExternal } from "~/platform/native";
import { loadStrava, postRideToStrava, stravaActivityUrl, stravaUploadFor, type StravaUpload } from "~/integrations/strava";

const LINK = "underline decoration-rule underline-offset-2 hover:text-ink disabled:no-underline disabled:hover:text-inherit";

export function StravaRideLink({ rideId }: { rideId: string }) {
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

  if (upload?.status === "sent" && upload.stravaId) {
    const url = stravaActivityUrl(upload.stravaId);
    return (
      <>
        {" · "}
        <a href={url} target="_blank" rel="noreferrer" className={LINK} onClick={(e) => (e.preventDefault(), void openExternal(url))}>
          View on Strava
        </a>
      </>
    );
  }
  const going = !!upload && ["pending", "sending", "processing"].includes(upload.status);
  const label = going ? "Posting to Strava…" : upload?.status === "failed" ? "Try Strava again" : "Post to Strava";

  return (
    <>
      {" · "}
      <button
        type="button"
        className={LINK}
        disabled={busy || going}
        title={upload?.status === "failed" ? (upload.error ?? undefined) : undefined}
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
        {label}
      </button>
      {error && <span className="text-negative"> ({error})</span>}
    </>
  );
}
