// Settings' frame: a menu of sections beside the open one, and a search over every block.
// Wide windows show the menu as a sidebar; narrow ones (the iPhone) show it as a list you tap into.
// The open section lives in the URL's anchor (/settings#coach) so it doesn't reload the page's data.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { modKey } from "~/platform/native";
import { SECTIONS, matches, sectionFor, type SectionId } from "./sections";

export interface SettingBlock {
  key: string;
  section: SectionId;
  /** Words search looks through: the block's title and description, plus any others a rider might type. */
  text: string;
  node: ReactNode;
}

export function SettingsShell({ blocks }: { blocks: SettingBlock[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const anchor = location.hash.replace(/^#/, "");
  const active = sectionFor(anchor);
  const shown = active ?? "profile";
  const sections = useMemo(() => SECTIONS.filter((s) => blocks.some((b) => b.section === s.id)), [blocks]);
  const searching = query.trim() !== "";
  const results = useMemo(() => (searching ? blocks.filter((b) => matches(b, query)) : []), [blocks, query, searching]);

  const open = (id: SectionId) => {
    setQuery("");
    navigate(`/settings#${id}`);
  };

  // Older links (/settings?section=coach-settings) open the same way as anchors.
  useEffect(() => {
    const section = params.get("section");
    if (section) navigate(`/settings#${section}`, { replace: true });
  }, [params, navigate]);

  // Opening a section starts at its top, or at the block an anchor named (#head-unit).
  useEffect(() => {
    if (!anchor || anchor === active) {
      window.scrollTo({ top: 0 });
      return;
    }
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(anchor);
      if (el || ++tries > 20) clearInterval(timer);
      if (!el) return;
      // The section's first block is already in view under its title.
      if (el.closest("[data-block]") === document.querySelector("[data-block]")) window.scrollTo({ top: 0 });
      else el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => clearInterval(timer);
  }, [anchor, active]);

  // ⌘F (Ctrl+F) searches settings while they're open.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const count = (id: SectionId) => results.filter((b) => b.section === id).length;
  const info = SECTIONS.find((s) => s.id === shown)!;

  return (
    <div className="md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
      {/* On a narrow screen the menu is the first page; a section replaces it. */}
      <aside className={`${active && !searching ? "hidden md:block" : ""} md:sticky md:top-20 md:self-start`}>
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Settings</h1>
        <label className="relative mb-4 block">
          <span className="sr-only">Search settings</span>
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search settings"
            className="h-9 w-full rounded-md border border-line bg-surface pr-12 pl-3 text-sm outline-none placeholder:text-faint focus:border-control"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line px-1.5 font-sans text-[11px] text-faint md:block">
            {searching ? "esc" : `${modKey()}F`}
          </kbd>
        </label>
        <nav aria-label="Settings sections" className={searching ? "hidden md:block" : ""}>
          <Menu sections={sections.filter((s) => !s.more)} active={searching ? null : shown} count={searching ? count : null} onOpen={open} />
          <p className="mt-5 mb-1 px-3 text-xs font-medium tracking-wide text-faint uppercase max-md:mt-6 max-md:px-1">More</p>
          <Menu sections={sections.filter((s) => s.more)} active={searching ? null : shown} count={searching ? count : null} onOpen={open} />
        </nav>
      </aside>

      <div className={`${active || searching ? "" : "hidden md:block"} min-w-0 space-y-4`}>
        {searching ? (
          <>
            <h2 className="text-xl font-semibold tracking-tight max-md:mt-2">{results.length === 0 ? `Nothing matches “${query.trim()}”` : results.length === 1 ? "1 result" : `${results.length} results`}</h2>
            {sections
              .filter((s) => count(s.id) > 0)
              .map((s) => (
                <div key={s.id} className="space-y-4 pt-2">
                  <button type="button" onClick={() => open(s.id)} className="text-xs font-medium tracking-wide text-faint uppercase hover:text-ink">
                    {s.label} ›
                  </button>
                  {results.filter((b) => b.section === s.id).map((b) => (
                    <div key={b.key}>{b.node}</div>
                  ))}
                </div>
              ))}
          </>
        ) : (
          <>
            <button type="button" onClick={() => navigate("/settings")} className="text-sm text-accent md:hidden">
              ‹ Settings
            </button>
            <div className="space-y-1 pb-2">
              <h2 className="text-2xl font-semibold tracking-tight">{info.label}</h2>
              <p className="text-[15px] text-muted">{info.line}</p>
            </div>
            {blocks
              .filter((b) => b.section === shown)
              .map((b) => (
                <div key={b.key} data-block>
                  {b.node}
                </div>
              ))}
          </>
        )}
      </div>
    </div>
  );
}

function Menu({
  sections,
  active,
  count,
  onOpen,
}: {
  sections: typeof SECTIONS;
  active: SectionId | null;
  count: ((id: SectionId) => number) | null;
  onOpen: (id: SectionId) => void;
}) {
  return (
    <ul className="max-md:divide-y max-md:divide-rule max-md:overflow-hidden max-md:rounded-lg max-md:border max-md:border-line max-md:bg-surface">
      {sections.map((s) => {
        const n = count?.(s.id) ?? null;
        const on = s.id === active;
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onOpen(s.id)}
              aria-current={on ? "page" : undefined}
              className={`flex w-full items-center gap-2 text-left transition-colors max-md:px-4 max-md:py-3 max-md:text-[15px] md:rounded-md md:px-3 md:py-1.5 md:text-sm ${
                on ? "md:bg-accent-soft md:font-medium md:text-accent" : "text-ink md:text-muted md:hover:text-ink"
              } ${n === 0 ? "opacity-40" : ""}`}
            >
              <span className="flex-1">{s.label}</span>
              {n !== null && n > 0 && <span className="num text-xs text-faint">{n}</span>}
              <span aria-hidden className="text-faint md:hidden">
                ›
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** ⌘, (Ctrl+,) opens Settings from anywhere, as in other Mac apps. */
export function SettingsShortcut() {
  const navigate = useNavigate();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === ",") {
        e.preventDefault();
        navigate("/settings");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [navigate]);
  return null;
}
