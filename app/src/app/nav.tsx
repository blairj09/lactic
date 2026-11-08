// Lactic's top bar, in place of the web app's (src/components/nav.tsx): the same four screens,
// Coach and Ride, plus the window's drag area and room for the macOS traffic lights.

import Link from "next/link";
import CoachButton from "@/app/coach/coach-button";
import { Wordmark } from "./brand";
import { useCoachMode } from "./coach-mode";
import { FeedbackButton } from "~/feedback/dialog";
import { isDemo } from "~/demo/flag";
import { hasHealth } from "@/lib/features";
import { useFeatures } from "@/lib/use-features";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/plan", label: "Plan" },
  { href: "/progress", label: "Progress" },
  { href: "/health", label: "Health" },
];

export default function Nav({ current }: { current: string }) {
  const mode = useCoachMode();
  const tracking = useFeatures();
  // Health has nothing to show when the rider tracks neither recovery nor weight.
  const links = LINKS.filter((l) => l.href !== "/health" || hasHealth(tracking));
  return (
    <header className="lactic-drag lactic-titlebar sticky top-0 z-30 border-b border-line bg-ground">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="shrink-0">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              data-tour={label.toLowerCase()}
              aria-current={current === href ? "page" : undefined}
              className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink aria-[current=page]:bg-active aria-[current=page]:text-ink"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {mode === "builtin" && (
            <span data-tour="coach" className="contents">
              <CoachButton />
            </span>
          )}
          {mode === "external" && (
            <Link href="/settings?section=coach" data-tour="coach" className="inline-flex h-8 items-center gap-2 rounded-md border border-control px-3 text-sm text-muted hover:text-ink" title="Your AI app is the coach, through Lactic's MCP server">
              <span className="size-1.5 rounded-full bg-positive" aria-hidden />
              External coach
            </Link>
          )}
          <Link
            href="/ride"
            data-tour="ride"
            aria-current={current === "/ride" ? "page" : undefined}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-on-primary transition-opacity hover:opacity-85 aria-[current=page]:hidden"
          >
            Ride
          </Link>
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
          {/* The website demo has no feedback to send. */}
          {!isDemo && <FeedbackButton />}
          <Link
            href="/settings"
            aria-label="Settings"
            data-tour="settings"
            title="Settings"
            aria-current={current === "/settings" ? "page" : undefined}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:text-ink aria-[current=page]:bg-active aria-[current=page]:text-ink"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Mark({ size = 18 }: { size?: number }) {
  return <Wordmark size={size} />;
}
