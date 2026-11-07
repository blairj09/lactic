"use client";

import { useState, useTransition } from "react";
import type { FtpEstimate } from "@/lib/engine/ftp";
import { button } from "@/components/ui";
import { setFtp } from "./actions";

export default function UseEstimateButton({ estimate }: { estimate: FtpEstimate }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className={button.small}
        disabled={pending}
        onClick={() => start(async () => setMessage((await setFtp(estimate.watts, estimate.method, estimate.wPrime)).message))}
      >
        {pending ? "Saving..." : `Use ${Math.round(estimate.watts)} W`}
      </button>
      {message && <span role="status">{message}</span>}
    </span>
  );
}
