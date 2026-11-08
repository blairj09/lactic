import { Dash, SectionTitle, Stat, StatStrip } from "@/components/ui";
import { formatDay } from "@/lib/format";
import type { FitnessSummary } from "@/lib/health-summary";
import { metricHref } from "../health/metrics";
import ProvenanceTag from "@/components/provenance";
import { fromRides, type Provenance } from "@/lib/engine/provenance";

/** Rides behind the VO2 max estimate (best 5-minute power). */
export const FITNESS_DAYS = 90;

/** VO2 max and fitness age as they stand now. They come from your power, so they sit with the rest of your training on Progress. */
export default function FitnessPanel({ fitness, today }: { fitness: FitnessSummary; today: string }) {
  const href = metricHref("fitness");
  const vo2: Provenance | null =
    fitness.vo2max === null
      ? null
      : fitness.source === "apple" && fitness.appleVo2max
        ? { kind: "synced", date: fitness.appleVo2max.day, via: "Apple Health" }
        : fromRides(today, `from your best 5 minutes in the last ${FITNESS_DAYS} days`);
  const tag = (p: Provenance | null) => (p ? <ProvenanceTag source={p} today={today} /> : undefined);
  return (
    <section className="space-y-3">
      <SectionTitle
        meta={
          fitness.source === "power"
            ? `Now, from your best 5 minutes in the last ${FITNESS_DAYS} days`
            : fitness.source === "apple"
              ? "Now, from Apple Health"
              : undefined
        }
      >
        VO2 max
      </SectionTitle>
      <StatStrip cols={3} phone={2}>
        <Stat
          label="VO2 max"
          href={href}
          value={fitness.vo2max !== null ? fitness.vo2max.toFixed(1) : <Dash />}
          unit={fitness.vo2max !== null ? "ml/kg/min" : undefined}
          source={tag(vo2)}
          sub={
            fitness.rating ??
            (fitness.vo2max === null
              ? "Needs a ride with power and your weight"
              : undefined)
          }
        />
        <Stat
          label="Fitness age"
          href={href}
          value={fitness.fitnessAge !== null ? fitness.fitnessAge : <Dash />}
          unit={fitness.fitnessAge !== null ? "years" : undefined}
          source={tag(fitness.fitnessAge !== null ? fromRides(today, "from your VO2 max and age") : null)}
          sub={
            fitness.fitnessAge === null
              ? "Needs VO2 max, birth date and sex"
              : fitness.age !== null
                ? `You're ${fitness.age}; average VO2 max at your age is ${fitness.averageForAge}`
                : undefined
          }
        />
        <Stat
          label="Best 5 minutes"
          href={href}
          className="col-span-2 sm:col-span-1"
          value={
            fitness.fiveMinuteWatts !== null ? (
              Math.round(fitness.fiveMinuteWatts)
            ) : (
              <Dash />
            )
          }
          unit={fitness.fiveMinuteWatts !== null ? "W" : undefined}
          source={tag(fitness.fiveMinuteWatts !== null ? { kind: "measured", date: today, via: `your power meter, best in the last ${FITNESS_DAYS} days` } : null)}
          sub={
            fitness.appleVo2max
              ? `Apple Watch says ${fitness.appleVo2max.value.toFixed(1)} (${formatDay(new Date(`${fitness.appleVo2max.day}T12:00:00Z`), "UTC")})`
              : `Last ${FITNESS_DAYS} days`
          }
        />
      </StatStrip>
      <p className="text-sm text-muted">
        VO2 max comes from your best 5-minute W/kg (ACSM cycling equation). Fitness age is the age whose average VO2 max matches yours (HUNT study).
      </p>
    </section>
  );
}
