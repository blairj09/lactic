"use client";

// The web pages a search found for a coach reply, as small links under it.

import { siteOf, sourcesOf } from "@/lib/coach/sources";
import { openExternal } from "~/platform/native";

export function Sources({ meta }: { meta: Record<string, unknown> }) {
  const sources = sourcesOf(meta);
  if (!sources.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-faint">Sources</span>
      {sources.map((s) => (
        <a
          key={s.url}
          href={s.url}
          title={s.title}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => (e.preventDefault(), void openExternal(s.url))}
          className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted hover:bg-raised hover:text-ink"
        >
          {siteOf(s.url)}
        </a>
      ))}
    </div>
  );
}
