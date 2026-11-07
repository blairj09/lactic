"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Proposal } from "@/lib/coach/changes";
import type { StoredMessage } from "@/lib/coach/store";
import { applyProposal, dismissProposal } from "./actions";
import { ProposalCard } from "./proposal-card";
import { streamCoach } from "./events";
import { Prose } from "./prose";
import { AutoTextarea } from "@/components/auto-textarea";
import { ACCEPT } from "@/lib/coach/attachments";
import { MessageAttachments, PendingFiles, useAttachments, useDropFiles } from "./attachments";

const SUGGESTIONS = [
  "How's my fitness trending, and am I on track for my event?",
  "How did my last ride go?",
  "I can't ride Thursday this week. What should I do?",
  "Am I recovered enough for today's workout?",
];

/**
 * One conversation with the coach, including morning briefs and check-ins, in the drawer. Replies
 * stream in as they're written. Each message carries the page it was sent from.
 */
export default function CoachChat({
  conversationId,
  initial,
  prompt,
  header,
  onSent,
}: {
  conversationId: string;
  initial: StoredMessage[];
  /** Text to put in the message box; `at` changes each time it's asked for. */
  prompt?: { text: string; at: number } | null;
  /** The drawer's bar: history, title, new conversation, close. */
  header: React.ReactNode;
  /** After a reply is saved, so the drawer can refresh the conversation list. */
  onSent?: () => void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState(prompt?.text ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const attach = useAttachments();
  const drop = useDropFiles((files) => void attach.add(files));
  const busy = status !== null;
  const canSend = !busy && !attach.uploading && Boolean(draft.trim() || attach.ready.length);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, status, partial]);

  // A reload of the conversation, unless a reply is on its way (it would drop the pending message).
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!busyRef.current) setMessages(initial);
  }, [initial]);

  useEffect(() => {
    if (prompt) setDraft(prompt.text);
  }, [prompt]);

  async function send(text: string, withFiles = true) {
    const message = text.trim();
    const files = withFiles ? attach.ready : [];
    if ((!message && !files.length) || busy || (withFiles && attach.uploading)) return;
    setError(null);
    setDraft("");
    if (withFiles) attach.clear();
    attach.setProblem(null);
    const now = new Date().toISOString();
    setMessages((m) => [
      ...m,
      {
        id: `pending-${Date.now()}`,
        conversationId,
        role: "user",
        kind: "chat",
        day: null,
        content: message,
        proposals: [],
        meta: {},
        ...(files.length ? { attachments: files } : {}),
        createdAt: now,
      },
    ]);
    setStatus("Thinking");
    try {
      const reply = await streamCoach(
        "/api/coach",
        {
          message,
          conversation: conversationId,
          page: {
            path: window.location.pathname,
            search: window.location.search,
          },
          attachments: files.map(({ path, name, type, size }) => ({
            path,
            name,
            type,
            size,
          })),
        },
        {
          status: (text) => setStatus(text),
          reset: () => setPartial(""),
          text: (delta) => setPartial((p) => p + delta),
        },
      );
      setMessages((m) => [...m, reply]);
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
      setPartial("");
    }
  }

  const updateProposal = (id: string, index: number, change: Partial<Proposal>) =>
    setMessages((all) =>
      all.map((m) =>
        m.id === id
          ? {
              ...m,
              proposals: m.proposals.map((p, i) => (i === index ? { ...p, ...change } : p)),
            }
          : m,
      ),
    );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...drop.handlers}>
      {header}
      {drop.over && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center border-2 border-dashed border-primary bg-ground/85 text-sm font-medium">
          Drop files to attach them
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Ask about your rides, plan, fitness, recovery or events. The coach can propose plan changes for you to apply.{" "}
              <Link href="/settings#coach-settings" className="underline underline-offset-4 hover:text-ink">
                What it remembers
              </Link>
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="rounded-full border border-control bg-surface px-3 py-1.5 text-left text-sm transition-colors hover:bg-raised"
                  onClick={() => send(s, false)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-auto max-w-[85%] space-y-1">
              {m.kind === "checkin" && messages[i - 1]?.kind !== "checkin" && <Label message={m} />}
              {m.attachments?.length ? <MessageAttachments attachments={m.attachments} /> : null}
              {m.content && <div className="rounded-2xl bg-raised px-4 py-2.5 text-[15px] whitespace-pre-wrap">{m.content}</div>}
            </div>
          ) : (
            <div key={m.id} className="max-w-[95%] space-y-3">
              {m.kind !== "chat" && messages[i - 1]?.kind !== m.kind && <Label message={m} />}
              <Prose text={m.content} />
              {m.proposals.map((p, i) => (
                <ProposalCard
                  key={i}
                  proposal={p}
                  onApply={async () => {
                    const result = await applyProposal(m.id, i);
                    if (!result.ok) return setError(result.message);
                    updateProposal(m.id, i, { status: "applied" });
                    router.refresh();
                  }}
                  onDismiss={async () => {
                    const result = await dismissProposal(m.id, i);
                    if (!result.ok) return setError(result.message);
                    updateProposal(m.id, i, { status: "dismissed" });
                  }}
                />
              ))}
            </div>
          ),
        )}
        {partial ? (
          <div className="max-w-[95%]">
            <Prose text={partial} />
          </div>
        ) : (
          status && <p className="animate-pulse text-sm text-muted">{status}...</p>
        )}
        {error && <p className="text-sm text-negative">{error}</p>}
        <div ref={bottom} />
      </div>

      <form
        className="relative shrink-0 border-t border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <PendingFiles files={attach.files} onRemove={attach.remove} />
        {attach.problem && <p className="mb-2 text-sm text-negative">{attach.problem}</p>}
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void attach.add(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="relative">
          <AutoTextarea
            name="message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (!files.length) return;
              e.preventDefault();
              void attach.add(files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={2}
            maxRows={8}
            maxLength={4000}
            placeholder="Message your coach"
            className="block w-full resize-none rounded-md border border-control bg-surface py-2 pr-12 pl-11 text-[15px] placeholder:text-faint"
          />
          <button
            type="button"
            aria-label="Attach files or images"
            title="Attach files or images (or paste, or drop them here)"
            onClick={() => picker.current?.click()}
            className="absolute bottom-2 left-1.5 grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m21.4 11.1-8.9 8.9a5.5 5.5 0 0 1-7.8-7.8l8.9-8.9a3.7 3.7 0 0 1 5.2 5.2l-8.9 8.9a1.8 1.8 0 0 1-2.6-2.6l8.2-8.2" />
            </svg>
          </button>
          <button
            aria-label="Send (Enter)"
            title="Send (Enter)"
            className="absolute right-2 bottom-2 grid size-8 place-items-center rounded-full bg-primary text-on-primary transition-opacity hover:opacity-85 disabled:opacity-30"
            disabled={!canSend}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5" />
              <path d="m5 12 7-7 7 7" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

/** Marks where a morning brief or check-in starts in the conversation. */
function Label({ message }: { message: StoredMessage }) {
  const day = message.day
    ? new Date(`${message.day}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
  return (
    <p className="text-xs font-medium tracking-wide text-muted uppercase">
      {message.kind === "brief" ? "Morning brief" : "Check-in"} · {day}
    </p>
  );
}
