"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { button } from "@/components/ui";
import type { StoredMessage } from "@/lib/coach/store";
import { removeConversation, startConversation } from "./actions";
import CoachChat from "./coach-chat";
import { onOpenCoach, shortcutHeld } from "./open";

interface ConversationItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface DrawerData {
  conversation: ConversationItem;
  messages: StoredMessage[];
  conversations: ConversationItem[];
  /** The coach's name, from its persona in Settings. */
  name: string;
}

const STALE = "The app was updated since this page opened. Reload the page to use the coach.";

/** Pages without the coach: signing in. */
const WITHOUT = ["/login", "/auth"];

/**
 * The coach in a drawer on the right of every page: the top bar's Coach button or ⌘K (Ctrl+K)
 * opens it, Escape closes it. It stays mounted while closed, so a reply keeps streaming. On a wide
 * screen the page moves over to make room; on a phone it covers the page. New starts another
 * conversation, and History reopens or deletes past ones.
 */
export default function CoachDrawer() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [data, setData] = useState<DrawerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ text: string; at: number } | null>(null);
  const [pending, start] = useTransition();
  const panel = useRef<HTMLElement>(null);
  // The conversation on screen; null follows the current one (where briefs and check-ins go).
  const shown = useRef<string | null>(null);
  const hidden = WITHOUT.some((p) => pathname.startsWith(p));

  const load = useCallback(async (conversation: string | null = shown.current) => {
    try {
      const response = await fetch(`/api/coach${conversation ? `?conversation=${conversation}` : ""}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? `The coach is unavailable (${response.status})`);
      // A page opened before a deploy can get an answer in a newer shape than its code expects.
      if (!body?.conversation?.id || !Array.isArray(body.messages) || !Array.isArray(body.conversations)) throw new Error(STALE);
      shown.current = conversation;
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const show = useCallback((text?: string) => {
    setOpen(true);
    setView("chat");
    if (text) setPrompt({ text, at: Date.now() });
  }, []);

  useEffect(() => onOpenCoach(show), [show]);

  // /coach redirects to /#coach, which opens the drawer.
  useEffect(() => {
    if (window.location.hash !== "#coach") return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    show();
  }, [show]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        if (hidden || (!open && shortcutHeld())) return;
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, hidden]);

  // Fresh messages each time it opens (a brief or check-in may have been added since), and the cursor in the box.
  useEffect(() => {
    if (!open) return;
    void load();
    const focus = setTimeout(() => panel.current?.querySelector<HTMLTextAreaElement>("textarea[name=message]")?.focus(), 50);
    return () => clearTimeout(focus);
  }, [open, load]);

  // A link in the drawer (to Settings, say) goes to another page: on a narrow screen the drawer
  // would cover it, so it closes.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (!window.matchMedia("(min-width: 80rem)").matches) setOpen(false);
  }, [pathname]);

  // Wide screens make room for the drawer (see globals.css).
  useEffect(() => {
    document.documentElement.toggleAttribute("data-coach-open", open && !hidden);
    return () => document.documentElement.removeAttribute("data-coach-open");
  }, [open, hidden]);

  const openConversation = (id: string | null) => {
    setView("chat");
    void load(id);
  };

  const newConversation = () =>
    start(async () => {
      const result = await startConversation();
      if (!result.ok) return setError(result.message);
      openConversation(null);
    });

  const deleteConversation = (id: string) =>
    start(async () => {
      const result = await removeConversation(id);
      if (!result.ok) return setError(result.message);
      // Deleting the one on screen goes back to the current one.
      await load(data?.conversation.id === id ? null : shown.current);
    });

  const close = () => setOpen(false);
  const name = data?.name ?? "Coach";

  if (hidden) return null;
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40 xl:hidden" aria-hidden onClick={close} />}
      <aside
        ref={panel}
        aria-label={name}
        inert={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-ground transition-transform duration-200 ease-out sm:w-[28rem] ${open ? "translate-x-0 shadow-2xl xl:shadow-none" : "translate-x-full"}`}
      >
        {!data ? (
          <Bar>
            <p className={error ? "min-w-0 text-sm text-negative" : "animate-pulse text-sm text-muted"}>{error ?? "Loading the conversation..."}</p>
            <div className="-mr-2 flex shrink-0 items-center gap-3">
              {error === STALE && <BarButton onClick={() => window.location.reload()}>Reload</BarButton>}
              <CloseButton onClick={close} />
            </div>
          </Bar>
        ) : (
          <>
            <div className={view === "history" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
              <Bar>
                <div className="flex min-w-0 items-center gap-1">
                  <IconButton label="Back to chat" onClick={() => setView("chat")} tipAlign="left" className="-ml-2">
                    <path d="m15 18-6-6 6-6" />
                  </IconButton>
                  <h2 className="truncate text-base font-semibold tracking-tight">Conversations</h2>
                </div>
                <CloseButton onClick={close} className="-mr-2" />
              </Bar>
              <History
                conversations={data.conversations}
                shown={data.conversation.id}
                pending={pending}
                error={error}
                onOpen={(id) => openConversation(id === data.conversations[0]?.id ? null : id)}
                onDelete={deleteConversation}
              />
            </div>
            <div className={view === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
              <CoachChat
                key={data.conversation.id}
                conversationId={data.conversation.id}
                initial={data.messages}
                prompt={prompt}
                onSent={() => void load()}
                header={
                  <Bar>
                    <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{data.conversation.title || name}</h2>
                    <div className="-mr-2 flex shrink-0 items-center">
                      <IconButton label="Past conversations" onClick={() => setView("history")}>
                        <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3" />
                        <path d="M3 3v5.3h5.3" />
                        <path d="M12 7v5l3 2" />
                      </IconButton>
                      <IconButton label="New conversation" onClick={newConversation} disabled={pending || data.messages.length === 0}>
                        <path d="M12 20h9" />
                        <path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </IconButton>
                      <CloseButton onClick={close} />
                    </div>
                  </Bar>
                }
              />
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Bar({ children }: { children: React.ReactNode }) {
  return <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4">{children}</div>;
}

function BarButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="shrink-0 text-sm text-muted transition-colors hover:text-ink disabled:opacity-40" {...props}>
      {children}
    </button>
  );
}

/** A square icon button with a tooltip that shows on hover and keyboard focus; children are the SVG's paths. */
function IconButton({
  label,
  tipAlign = "right",
  className = "",
  children,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { label: string; tipAlign?: "left" | "right"; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`group relative grid size-9 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink disabled:pointer-events-none disabled:opacity-40 ${className}`}
      {...props}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-10 mt-1 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink opacity-0 shadow-lg transition-opacity delay-300 group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-visible:delay-0 ${tipAlign === "right" ? "right-0" : "left-0"}`}
      >
        {label}
      </span>
    </button>
  );
}

function CloseButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <IconButton label="Close (Esc)" onClick={onClick} className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </IconButton>
  );
}

/** Past conversations, latest activity first, each with a delete that asks first, in place rather than in a browser dialog. */
function History({
  conversations,
  shown,
  pending,
  error,
  onOpen,
  onDelete,
}: {
  conversations: ConversationItem[];
  shown: string;
  pending: boolean;
  error: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
      <ul className="divide-y divide-rule">
        {conversations.map((c) => (
          <li key={c.id} className="px-2 py-2.5">
            {confirming === c.id ? (
              <div className="space-y-3 rounded-md border border-line bg-surface p-3" role="alertdialog" aria-label="Delete conversation">
                <p className="truncate text-sm font-medium">{title(c)}</p>
                <p className="text-sm">Delete this conversation? What the coach remembers about you stays.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="inline-flex h-8 items-center rounded-md bg-negative px-3 text-sm font-medium text-on-primary transition-opacity hover:opacity-85 disabled:opacity-50"
                    disabled={pending}
                    onClick={() => {
                      onDelete(c.id);
                      setConfirming(null);
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" className={button.small} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(c.id)} aria-current={c.id === shown ? "true" : undefined}>
                  <span className={`block truncate text-[15px] text-ink ${c.id === shown ? "font-medium" : ""}`}>{title(c)}</span>
                  <span className="block text-xs text-muted">
                    {c.id === shown ? "Open now · " : ""}
                    {when(c.updatedAt)}
                  </span>
                </button>
                <button type="button" className="shrink-0 text-sm text-muted hover:text-negative" onClick={() => setConfirming(c.id)} aria-label={`Delete ${title(c)}`}>
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="px-2 py-2 text-sm text-negative">{error}</p>}
      <p className="px-2 py-4 text-sm text-muted">
        What the coach remembers is shared by every conversation.{" "}
        <Link href="/settings#coach-settings" className="underline underline-offset-4 hover:text-ink">
          See it in Settings
        </Link>
      </p>
    </div>
  );
}

const title = (c: ConversationItem) => c.title || `Conversation from ${when(c.createdAt)}`;

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
