"use client";

import { button as ui } from "@/components/ui";
import { useRouter } from "next/navigation";
import { startTransition } from "react";

/** Shown when a page fails to load, usually a slow or briefly unavailable database. */
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">This page didn&apos;t load</h1>
      <p className="text-sm text-muted">The database was slow to answer. Trying again usually works.</p>
      <button
        // The error came from the server, so fetch the page again rather than just re-rendering.
        onClick={() => startTransition(() => (router.refresh(), reset()))}
        className={ui.primary}
      >
        Try again
      </button>
    </main>
  );
}
