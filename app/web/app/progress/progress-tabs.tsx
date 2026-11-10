import Link from "next/link";

const TABS = [
  { id: "trends", label: "Trends", href: "/progress" },
  { id: "rides", label: "Rides", href: "/progress?tab=rides" },
] as const;

/** Progress's two views, styled like Plan's Calendar / Setup: the range charts, and every ride. */
export default function ProgressTabs({ tab }: { tab: "trends" | "rides" }) {
  return (
    <nav aria-label="Progress sections" className="-mt-2 flex gap-1">
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={tab === t.id ? "page" : undefined}
          className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink aria-[current=page]:bg-active aria-[current=page]:text-ink"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
