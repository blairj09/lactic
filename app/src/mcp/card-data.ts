// What Lactic's cards in an AI app draw (an MCP App: src/mcp/view). A tool's result carries one of
// these as structuredContent, which the AI app hands to the card and keeps out of the model's
// context. Every number is the engine's; the card only draws them.

import type { ChartDay, ChartMarker } from "@/components/fitness-chart";
import type { Proposal } from "@/lib/coach/changes";
import type { ChartStream } from "@/lib/engine/ride-detail";

/** The one page all cards share; it draws whichever card a result carries. */
export const CARD_URI = "ui://lactic/card";
export const CARD_MIME = "text/html;profile=mcp-app";
/** The tool a card's buttons call. Only cards see it: the AI app hides it from the model. */
export const CARD_ACTION_TOOL = "lactic_card_action";

export interface ProposalCard {
  view: "proposal";
  id: string;
  proposal: Proposal;
  status: Proposal["status"];
}

export interface RideCardBlock {
  role: string;
  check: string;
  ok: boolean;
  target: number | null;
  power: number | null;
  heartRate: number | null;
}

export interface RideCard {
  view: "ride";
  id: string;
  title: string;
  line: string;
  stats: { label: string; value: string }[];
  stream: ChartStream | null;
  targetLabel: string;
  /** Effort blocks of a structured workout ridden in Lactic, and how each went. */
  blocks: RideCardBlock[];
}

export interface FitnessCard {
  view: "fitness";
  label: string;
  days: ChartDay[];
  forecastFrom: string | null;
  markers: ChartMarker[];
}

export type Card = ProposalCard | RideCard | FitnessCard;

/** What a card's button asks for. */
export type CardAction = { action: "status" | "apply" | "dismiss"; proposal_id: string } | { action: "open"; path: string };

/** At most `max` points per channel, by averaging neighbours, so a long ride stays small to send. */
export function thinStream(stream: ChartStream, max = 400): ChartStream {
  const length = Math.max(stream.watts?.length ?? 0, stream.heartRate?.length ?? 0, stream.cadence?.length ?? 0, stream.target?.length ?? 0);
  const factor = Math.ceil(length / max);
  if (factor <= 1) return { ...stream, route: null };
  const thin = <T extends number | null>(values: T[] | null) => {
    if (!values) return null;
    const out: (number | null)[] = [];
    for (let i = 0; i < values.length; i += factor) {
      const chunk = values.slice(i, i + factor).filter((v): v is NonNullable<T> => v !== null);
      out.push(chunk.length ? Math.round(chunk.reduce((a, b) => a + b, 0) / chunk.length) : null);
    }
    return out;
  };
  return {
    step: stream.step * factor,
    watts: thin(stream.watts) as number[] | null,
    heartRate: thin(stream.heartRate) as number[] | null,
    cadence: thin(stream.cadence) as number[] | null,
    target: thin(stream.target),
    route: null,
  };
}

/** Only paths inside Lactic's own pages, for "Open in Lactic". */
export function safePath(path: unknown): string | null {
  return typeof path === "string" && /^\/[A-Za-z0-9/_\-?=&.]*$/.test(path) && !path.startsWith("//") && path.length < 200 ? path : null;
}
