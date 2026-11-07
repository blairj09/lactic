"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { pushIntervalsPlan, syncIntervals } from "@/app/actions";

const SYNC = { intervals: syncIntervals };

/** Pulls new rides in the background when the page opens, then refreshes if any arrived. intervals.icu then gets the plan. */
export default function AutoSync({ services }: { services: (keyof typeof SYNC)[] }) {
  const router = useRouter();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    Promise.all(services.map((s) => SYNC[s]("new"))).then((results) => {
      if (results.some((r) => r.ok && (r.imported || r.linked || r.sent))) router.refresh();
      // After the pull, so the plan sent reflects any rides that just arrived.
      if (services.includes("intervals")) pushIntervalsPlan();
    });
  }, [router, services]);
  return null;
}
