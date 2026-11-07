import Nav from "@/components/nav";
import { Page } from "@/components/ui";

/**
 * What a page shows the moment its link is clicked, while the server loads its data (every page reads the database,
 * so none can be served ready-made): the bar with the new tab marked, the title, and grey blocks in the page's shape.
 * Each page's loading.tsx renders it; Next prefetches those for every link on screen, so it appears without waiting on
 * the network. (They sit in each page's folder, not at the root, where the popup slot would show one too.)
 */
export default function PageSkeleton({ current, title, width = "wide" }: { current: string; title: string; width?: "medium" | "wide" }) {
  return (
    <>
      <Nav current={current} />
      <Page width={width}>
        <div aria-busy="true" aria-live="polite" className="space-y-6 sm:space-y-8">
          <span className="sr-only">Loading {title}</span>
          <div className="space-y-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <Bar className="h-4 w-72 max-w-full" />
          </div>
          {width === "medium" ? (
            <div className="space-y-6">
              <Block className="h-56" />
              <Block className="h-40" />
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="space-y-6">
                <Block className="h-64" />
                <Block className="h-44" />
              </div>
              <div className="space-y-6">
                <Block className="h-36" />
                <Block className="h-48" />
              </div>
            </div>
          )}
        </div>
      </Page>
    </>
  );
}

function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg border border-line bg-surface ${className}`} />;
}

function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-rule ${className}`} />;
}
