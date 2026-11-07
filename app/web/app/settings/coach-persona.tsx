"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, Result, Segmented, button, input } from "@/components/ui";
import { DETAIL_LABELS, MAX_INSTRUCTIONS, MAX_NAME, TONE_LABELS, type Detail, type Persona, type Tone } from "@/lib/coach/persona";
import { savePersona } from "../coach/actions";
import { AutoTextarea } from "@/components/auto-textarea";

/** The coach's name, tone, how much it says, and your own instructions. Goes into the chat and the morning brief. */
export default function CoachPersona({ initial }: { initial: Persona }) {
  const router = useRouter();
  const [persona, setPersona] = useState(initial);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (change: Partial<Persona>) => {
    setPersona((p) => ({ ...p, ...change }));
    setResult(null);
  };
  const changed = JSON.stringify(persona) !== JSON.stringify(initial);

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const saved = await savePersona(persona);
          setResult(saved);
          if (saved.ok) router.refresh();
        });
      }}
    >
      <Field label="Name">
        <input value={persona.name} onChange={(e) => set({ name: e.target.value })} maxLength={MAX_NAME} className={`${input} w-full`} />
      </Field>
      <div className="hidden sm:block" />
      <div className="space-y-2 sm:col-span-2">
        <p className="text-sm font-medium">Tone</p>
        <Segmented label="Tone" options={(Object.keys(TONE_LABELS) as Tone[]).map((t) => ({ value: t, label: TONE_LABELS[t] }))} value={persona.tone} onChange={(tone) => set({ tone })} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <p className="text-sm font-medium">How much it says</p>
        <Segmented label="How much it says" options={(Object.keys(DETAIL_LABELS) as Detail[]).map((d) => ({ value: d, label: DETAIL_LABELS[d] }))} value={persona.detail} onChange={(detail) => set({ detail })} />
      </div>
      <Field label="Instructions" hint="Anything else, e.g. explain the why behind workouts, or use kilometres." className="sm:col-span-2">
        <AutoTextarea
          value={persona.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
          maxLength={MAX_INSTRUCTIONS}
          rows={4}
          className={`${input} h-auto w-full py-2`}
        />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className={button.primary} disabled={pending || !changed}>
          {pending ? "Saving..." : "Save persona"}
        </button>
        {result && <Result ok={result.ok}>{result.message}</Result>}
      </div>
    </form>
  );
}
