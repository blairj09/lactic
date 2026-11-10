// Lactic's top bar, in place of the web app's (src/components/nav.tsx): the same four screens,
// Coach and Ride, plus the window's drag area and room for the macOS traffic lights. On a phone
// the screens and Ride move to a tab bar along the bottom, within reach of a thumb.

import Link from "next/link";
import CoachButton from "@/app/coach/coach-button";
import { Wordmark } from "./brand";
import { useCoachMode, useMcpOn } from "./coach-mode";
import { ExternalCoachButton } from "~/mcp/external-coach";
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
  const mcp = useMcpOn();
  const tracking = useFeatures();
  // Health has nothing to show when the rider tracks neither recovery nor weight.
  const links = LINKS.filter((l) => l.href !== "/health" || hasHealth(tracking));
  return (
    <>
    <header className="lactic-drag lactic-titlebar sticky top-0 z-30 border-b border-line bg-ground pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="shrink-0">
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
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
          {mode === "builtin" && mcp && <ExternalCoachButton alongside />}
          {mode === "external" && <ExternalCoachButton />}
          <Link
            href="/ride"
            data-tour="ride"
            aria-current={current === "/ride" ? "page" : undefined}
            className="hidden h-8 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-on-primary transition-opacity hover:opacity-85 aria-[current=page]:hidden md:inline-flex"
          >
            Ride
          </Link>
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-line md:block" />
          {/* The website demo has no feedback to send. */}
          {!isDemo && (
            <span className="hidden md:contents">
              <FeedbackButton />
            </span>
          )}
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
    <nav aria-label="Main" className="lactic-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ground pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="mx-auto flex h-14 max-w-md items-stretch justify-around px-2">
        {[...links.slice(0, 2), { href: "/ride", label: "Ride" }, ...links.slice(2)].map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            data-tour={label.toLowerCase()}
            aria-current={current === href ? "page" : undefined}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted aria-[current=page]:text-accent"
          >
            <TabIcon href={href} />
            {label}
          </Link>
        ))}
      </div>
    </nav>
    </>
  );
}

/** Simple line icons for the phone's tab bar. */
function TabIcon({ href }: { href: string }) {
  const paths: Record<string, React.ReactNode> = {
    "/": <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z" />,
    "/plan": (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M4 10h16M9 3v4M15 3v4" />
      </>
    ),
    "/ride": <path d="M3 20V15h3v-4h3V7h3v13ZM12 15h9v5h-9" />,
    "/progress": <path d="M4 19h16M6 16l4-5 3 3 5-7" />,
    "/health": <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
  };
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[href]}
    </svg>
  );
}

export function Mark({ size = 18 }: { size?: number }) {
  return <Wordmark size={size} />;
}
