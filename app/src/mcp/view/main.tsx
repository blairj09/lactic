// Lactic's card in an AI app's chat (an MCP App). One page draws every card: a suggestion with
// Apply and Dismiss, a ride, or fitness and form, from the tool result the AI app hands it
// (card-data.ts). Built into one HTML file by vite.config.ts (mcpView) and served by bridge.ts.

import "./view.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProposalFields, ProposalPlan, ProposalWorkout } from "@/app/coach/proposal-card";
import RideChart, { type Span } from "@/app/rides/[id]/ride-chart";
import FitnessChart from "@/components/fitness-chart";
import { button } from "@/components/ui";
import { CARD_ACTION_TOOL, type Card, type FitnessCard, type ProposalCard, type RideCard } from "../card-data";
import { connect, type Host, type HostContext, type ToolResult } from "./host";

function applyContext(c: HostContext) {
  const root = document.documentElement;
  if (c.theme) root.dataset.theme = c.theme;
  // The AI app's own typeface, so the card reads as part of the chat; Lactic's colours stay.
  const font = c.styles?.variables?.["--font-sans"];
  if (font) root.style.setProperty("--font-archivo", font);
}

const textOf = (r: ToolResult) => r.content?.find((c) => c.type === "text")?.text ?? "";

function Shell({ children, open, host }: { children: React.ReactNode; open?: string; host: Host }) {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4 text-sm text-ink">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="grid size-[18px] place-items-center rounded-[5px] bg-accent text-[11px] font-bold text-white">L</span>
        <span>Lactic</span>
        {open && (
          <button type="button" className="ml-auto text-muted hover:text-ink" onClick={() => void host.callTool(CARD_ACTION_TOOL, { action: "open", path: open }).catch(() => {})}>
            Open in Lactic
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Proposal({ card, host }: { card: ProposalCard; host: Host }) {
  const [status, setStatus] = useState(card.status);
  const [busy, setBusy] = useState<"apply" | "dismiss" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // A card shown again later (the chat reopened) asks whether it was decided since.
  useEffect(() => {
    host
      .callTool(CARD_ACTION_TOOL, { action: "status", proposal_id: card.id })
      .then((r) => {
        const s = r.structuredContent?.status;
        if (s === "pending" || s === "applied" || s === "dismissed") setStatus(s);
      })
      .catch(() => {});
  }, [card.id, host]);

  async function decide(action: "apply" | "dismiss") {
    setBusy(action);
    setMessage(null);
    try {
      const r = await host.callTool(CARD_ACTION_TOOL, { action, proposal_id: card.id });
      const s = r.structuredContent?.status;
      if (s === "applied" || s === "dismissed" || s === "pending") setStatus(s);
      setMessage({ ok: !r.isError, text: textOf(r) || (r.isError ? "Lactic couldn't do that." : "Done.") });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const p = card.proposal;
  return (
    <Shell host={host} open="/plan">
      <p className="text-base font-semibold">{p.summary}</p>
      <ProposalWorkout proposal={p} />
      <ProposalFields proposal={p} />
      {p.reason && <p className="text-muted">{p.reason}</p>}
      <ProposalPlan proposal={p} />
      {status === "pending" ? (
        <div className="flex gap-2">
          <button type="button" className={button.smallPrimary} disabled={busy !== null} onClick={() => void decide("apply")}>
            {busy === "apply" ? "Applying…" : "Apply"}
          </button>
          <button type="button" className={button.small} disabled={busy !== null} onClick={() => void decide("dismiss")}>
            Dismiss
          </button>
        </div>
      ) : (
        <p className="text-muted">{status === "applied" ? "Applied in Lactic." : "Dismissed."}</p>
      )}
      {message && !message.ok && <p className="text-negative">{message.text}</p>}
    </Shell>
  );
}

function Stats({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {stats.map((s) => (
        <div key={s.label}>
          <div className="num text-lg font-semibold">{s.value}</div>
          <div className="text-xs text-muted">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function Ride({ card, host }: { card: RideCard; host: Host }) {
  const [zoom, setZoom] = useState<Span | null>(null);
  return (
    <Shell host={host} open={`/rides/${card.id}`}>
      <div>
        <p className="text-base font-semibold">{card.title}</p>
        <p className="text-muted">{card.line}</p>
      </div>
      {card.stream ? <RideChart stream={card.stream} targetLabel={card.targetLabel} zoom={zoom} onZoom={setZoom} highlight={null} /> : <p className="text-muted">This ride has no stored readings to chart.</p>}
      <Stats stats={card.stats} />
      {card.blocks.length > 0 && (
        <table className="num w-full text-left">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-normal">Effort</th>
              <th className="py-1 font-normal">Target</th>
              <th className="py-1 font-normal">Average</th>
              <th className="py-1 font-normal">HR</th>
              <th className="py-1 font-normal" />
            </tr>
          </thead>
          <tbody>
            {card.blocks.map((b, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1.5">{b.role}</td>
                <td>{b.target === null ? "–" : `${b.target} W`}</td>
                <td>{b.power === null ? "–" : `${b.power} W`}</td>
                <td>{b.heartRate ?? "–"}</td>
                <td className={b.ok ? "text-positive" : "text-warning"}>{b.check}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

function Fitness({ card, host }: { card: FitnessCard; host: Host }) {
  return (
    <Shell host={host} open="/progress">
      <p className="text-base font-semibold">Fitness, fatigue and form</p>
      {card.days.length > 1 ? <FitnessChart days={card.days} label={card.label} forecastFrom={card.forecastFrom ?? undefined} markers={card.markers} /> : <p className="text-muted">No days to chart yet.</p>}
    </Shell>
  );
}

function App() {
  const [host, setHost] = useState<Host | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    connect(
      (r) => {
        const c = r.structuredContent as Card | undefined;
        if (c && (c.view === "proposal" || c.view === "ride" || c.view === "fitness")) setCard(c);
        else if (r.isError) setError(textOf(r));
      },
      applyContext,
    )
      .then(setHost)
      .catch(() => setError("Couldn't reach Lactic."));
  }, []);

  if (error) return <p className="p-3 text-sm text-muted">{error}</p>;
  if (!host || !card) return <p className="p-3 text-sm text-muted">Loading from Lactic…</p>;
  if (card.view === "proposal") return <Proposal card={card} host={host} />;
  if (card.view === "ride") return <Ride card={card} host={host} />;
  return <Fitness card={card} host={host} />;
}

createRoot(document.getElementById("root")!).render(<App />);
