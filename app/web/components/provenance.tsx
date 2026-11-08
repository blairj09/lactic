import { describeProvenance, PROVENANCE_LABELS, type Provenance } from "@/lib/engine/provenance";

const DOT: Record<Provenance["kind"], string> = { measured: "bg-positive", estimated: "bg-warning", synced: "bg-accent" };

/** A quiet "Measured · today" under a number, with how it was got in the tooltip. */
export default function ProvenanceTag({ source, today }: { source: Provenance; today: string }) {
  const full = describeProvenance(source, today);
  const when = full.slice(PROVENANCE_LABELS[source.kind].length + 1).split(" · ")[0];
  return (
    <span title={full} aria-label={full} className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span aria-hidden className={`inline-block size-1.5 rounded-full ${DOT[source.kind]}`} />
      {PROVENANCE_LABELS[source.kind]} {when}
    </span>
  );
}
