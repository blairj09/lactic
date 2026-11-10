import Link from "next/link";
import CoachButton from "@/app/coach/coach-button";

/** The four screens. Ride is the one action in the bar; Settings sits behind a quiet gear at the far right. */
const LINKS = [
  { href: "/", label: "Today" },
  { href: "/plan", label: "Plan" },
  { href: "/history", label: "History" },
  { href: "/progress", label: "Progress" },
  { href: "/health", label: "Health" },
];
const RIDE = "/ride";
const SETTINGS = "/settings";

/**
 * The top bar: mark and name, the screens, the actions (Coach, Ride), then the settings gear at the
 * far right, set apart by a hairline. On a phone the links fold into a menu
 * sheet (a <details>, so it works without script and closes when the next page renders).
 */
export default function Nav({ current }: { current: string }) {
  const menu = [...LINKS, { href: SETTINGS, label: "Settings" }];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ground">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
          <Mark />
          My Coach
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={current === href ? "page" : undefined}
              className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink aria-[current=page]:bg-active aria-[current=page]:text-ink"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <CoachButton />
          <Link
            href={RIDE}
            aria-current={current === RIDE ? "page" : undefined}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-on-primary transition-opacity hover:opacity-85 aria-[current=page]:hidden"
          >
            Ride
          </Link>
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-line lg:block" />
          <Link
            href={SETTINGS}
            aria-label="Settings"
            title="Settings"
            aria-current={current === SETTINGS ? "page" : undefined}
            className="hidden size-8 items-center justify-center rounded-md text-muted transition-colors hover:text-ink aria-[current=page]:bg-active aria-[current=page]:text-ink lg:inline-flex"
          >
            <Gear />
          </Link>
          <details className="group lg:hidden">
            <summary className="flex h-8 cursor-pointer list-none items-center rounded-md px-2.5 text-sm text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <nav aria-label="Main" className="fixed inset-x-0 top-12 bottom-0 z-40 bg-ground px-4 pt-2">
              {menu.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={current === href ? "page" : undefined}
                  className="flex h-12 items-center border-b border-rule text-lg text-muted aria-[current=page]:font-medium aria-[current=page]:text-ink"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

function Gear() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** The mark: an interval workout drawn as an M (an effort, a stepped recovery, a bigger effort), in the data hue. */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="2 2 20 20" aria-hidden className="shrink-0">
      <path d="M2 21V7.5H7V11.5H10V15H14V9H17V3H22V21Z" fill="var(--accent)" />
    </svg>
  );
}
