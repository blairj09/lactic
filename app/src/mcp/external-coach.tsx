// The top bar's "External coach" pill and its popover. With an external coach the rider talks to
// their own AI app (Claude Desktop and others), which coaches through Lactic's MCP server; there's
// no chat inside Lactic. The popover says so, shows whether the app has connected, gives a few
// things to ask, and links to the coach settings. ⌘K opens it, in place of the built-in drawer.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { shortcutHeld } from "@/app/coach/open";
import { openFeedback } from "~/feedback/dialog";
import { isDemo } from "~/demo/flag";
import { modKey } from "~/platform/native";
import { ago, connection, pillLabel, useMcpStatus } from "./status";

const ASK = ["How's my training going?", "Should I ride hard today?", "Plan my week around a long Saturday ride."];

const DOT = { active: "bg-positive", added: "bg-warning", none: "bg-faint" } as const;

export function ExternalCoachButton({ alongside = false }: { alongside?: boolean }) {
  const [open, setOpen] = useState(false);
  const status = useMcpStatus();
  const box = useRef<HTMLDivElement>(null);
  const state = connection(status);

  useEffect(() => {
    // With the built-in coach on too, ⌘K belongs to its drawer.
    if (alongside) return;
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        if (!open && shortcutHeld()) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, alongside]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  // Alongside the built-in coach, the pill only appears once an AI app has connected.
  if (alongside && state === "none") return null;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        data-tour={alongside ? undefined : "coach"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-8 items-center gap-2 rounded-md border border-control px-3 text-sm text-muted hover:text-ink ${open ? "bg-active text-ink" : ""}`}
        title={alongside ? "AI apps connected to Lactic" : `Your AI coach (${modKey()}K)`}
      >
        <span className={`size-1.5 rounded-full ${DOT[state]}`} aria-hidden />
        {state === "active" ? pillLabel(status) : "External coach"}
      </button>
      {open && (
        <div role="dialog" aria-label="Your AI coach" className="absolute right-0 top-10 z-40 w-[min(22rem,calc(100vw-2rem))] space-y-4 rounded-lg border border-line bg-surface p-4 text-sm shadow-xl">
          <div className="space-y-1">
            <p className="font-semibold">{alongside ? "AI apps can coach you too" : "Your coach lives in your AI app"}</p>
            <p className="text-muted">
              {alongside ? "They read your training and suggest changes for you to apply or dismiss." : "Talk to it there. It reads your training and suggests changes for you to apply or dismiss here."}
            </p>
          </div>
          {state === "active" && status?.apps?.length ? (
            <div className="space-y-1.5">
              <p className="font-medium">Connected</p>
              <ul className="space-y-1">
                {status.apps.map((a) => (
                  <li key={a.name} className="flex items-center gap-2">
                    <span className={`size-1.5 flex-none rounded-full ${DOT.active}`} aria-hidden />
                    <span>
                      {a.name} <span className="text-muted">· {ago(a.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-start gap-2">
              <span className={`mt-1.5 size-1.5 flex-none rounded-full ${DOT[state]}`} aria-hidden />
              <span>{state === "added" ? "Added to Claude Desktop. Quit and reopen Claude, then ask it something." : "No AI app has connected yet."}</span>
            </p>
          )}
          {state !== "none" ? (
            <div className="space-y-1.5">
              <p className="font-medium">Try asking</p>
              <ul className="space-y-1 text-muted">
                {ASK.map((q) => (
                  <li key={q}>“{q}”</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
            <Link href="/settings?section=coach-settings" onClick={() => setOpen(false)} className="font-medium text-ink underline-offset-4 hover:underline">
              {state === "none" ? "Connect an AI app" : "Coach settings"}
            </Link>
            <Link href="/settings?section=coach-settings" onClick={() => setOpen(false)} className="text-muted underline-offset-4 hover:text-ink hover:underline">
              {alongside ? "Turn this off" : "Switch to the built-in coach"}
            </Link>
            {!isDemo && (
              <button
                type="button"
                className="text-muted underline-offset-4 hover:text-ink hover:underline"
                onClick={() => {
                  setOpen(false);
                  openFeedback();
                }}
              >
                Send feedback
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
