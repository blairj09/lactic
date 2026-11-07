// The coach's persona, set in Settings: a name, a tone, how much detail, and anything else you want
// it to keep in mind. It shapes how the coach talks, never what the numbers are.

export type Tone = "direct" | "encouraging" | "analytical" | "calm";
export type Detail = "brief" | "balanced" | "thorough";

export interface Persona {
  name: string;
  tone: Tone;
  detail: Detail;
  instructions: string;
}

export const DEFAULT_PERSONA: Persona = { name: "Coach", tone: "direct", detail: "balanced", instructions: "" };

export const TONE_LABELS: Record<Tone, string> = { direct: "Direct", encouraging: "Encouraging", analytical: "Data-heavy", calm: "Calm" };
export const DETAIL_LABELS: Record<Detail, string> = { brief: "Brief", balanced: "Balanced", thorough: "Thorough" };

const TONES: Record<Tone, string> = {
  direct: "Be direct and plain-spoken: say what to do and why, without cushioning.",
  encouraging: "Be warm and encouraging: notice what's going well, and frame problems as the next thing to work on.",
  analytical: "Lead with the data: cite the specific numbers from the tools behind each point.",
  calm: "Be calm and steady: keep things in proportion and don't make a drama of one bad day.",
};

const DETAILS: Record<Detail, string> = {
  brief: "Keep replies short: two or three sentences unless they ask for more.",
  balanced: "Keep replies to a few short paragraphs at most.",
  thorough: "Explain your reasoning fully when it helps, still in plain prose.",
};

export const MAX_NAME = 40;
export const MAX_INSTRUCTIONS = 2000;

/** Reads a stored persona, falling back to the defaults for anything missing or unknown. */
export function toPersona(row: { name?: string | null; tone?: string | null; detail?: string | null; instructions?: string | null } | null): Persona {
  return {
    name: row?.name?.trim().slice(0, MAX_NAME) || DEFAULT_PERSONA.name,
    tone: row?.tone && row.tone in TONES ? (row.tone as Tone) : DEFAULT_PERSONA.tone,
    detail: row?.detail && row.detail in DETAILS ? (row.detail as Detail) : DEFAULT_PERSONA.detail,
    instructions: row?.instructions?.trim().slice(0, MAX_INSTRUCTIONS) ?? "",
  };
}

/** The persona's part of the system prompt. The athlete's own instructions can't override the rules about numbers. */
export function personaPrompt(persona: Persona) {
  const lines = [`Your name is ${persona.name}.`, TONES[persona.tone], DETAILS[persona.detail]];
  if (persona.instructions) {
    lines.push(`The athlete's instructions for you (follow them, except that every number still comes from the status and tools):\n${persona.instructions}`);
  }
  return `Persona:\n${lines.join(" ")}`;
}
