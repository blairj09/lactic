import Link from "next/link";
import PowerRadar from "@/components/power-radar";
import { Dash } from "@/components/ui";
import type { PowerCurve } from "@/lib/engine/power";
import { powerProfile, PROFILE_CATEGORIES, type RiderType } from "@/lib/engine/profile";
import { formatDuration } from "@/lib/format";

const TYPE_MEANING: Record<RiderType, string> = {
  sprinter: "Your short efforts rate highest: a sprinter.",
  pursuiter: "Your 1 to 5 minute efforts rate highest: a pursuiter, strong on short climbs and attacks.",
  "time trialist": "Your long efforts rate highest: a time trialist, strong at steady, sustained power.",
  "all-rounder": "Every duration rates about the same: an all-rounder.",
};

/**
 * Best W/kg from sprint to endurance on a radar, rated against the Coggan table, with a table under
 * it. The first series is the range; a second (the compare period) is drawn as a dashed outline.
 */
export default function PowerProfile({
  series,
  weightKg,
  sex,
}: {
  series: { label: string; curve: PowerCurve }[];
  weightKg: number | null;
  sex: "male" | "female" | null;
}) {
  if (!weightKg) {
    return (
      <p className="text-sm text-muted">
        The profile is in watts per kilo, so it needs your weight.{" "}
        <Link href="/health" className="underline underline-offset-4">
          Weigh in
        </Link>{" "}
        or add it in{" "}
        <Link href="/settings" className="underline underline-offset-4">
          Settings
        </Link>
        .
      </p>
    );
  }
  const [main, other] = series;
  if (!main || Object.keys(main.curve).length === 0) return <p className="text-sm text-muted">No rides with power in this range.</p>;
  const profile = powerProfile(main.curve, weightKg, sex);
  const compare = other && Object.keys(other.curve).length ? powerProfile(other.curve, weightKg, sex) : null;

  return (
    <div className="space-y-4">
      {profile.type && <p className="text-[15px]">{TYPE_MEANING[profile.type]}</p>}
      <PowerRadar points={profile.points} compare={compare?.points} />
      {compare && (
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--series-1)]" /> {main.label}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-[var(--series-2)]" /> {other.label}
          </span>
        </div>
      )}
      <table className="num w-full text-right text-sm">
        <thead className="text-muted">
          <tr>
            <th className="text-left font-normal">Profile</th>
            <th className="font-normal">Best</th>
            <th className="font-normal">W/kg</th>
            <th className="font-normal">Rating</th>
            {compare && <th className="font-normal">{other.label}</th>}
          </tr>
        </thead>
        <tbody>
          {profile.points.map((p, i) => {
            const then = compare?.points[i];
            return (
              <tr key={p.axis} className="border-t border-rule">
                <td className="py-1.5 text-left">
                  {p.label} <span className="text-muted">{p.duration < 60 ? `${p.duration} s` : formatDuration(p.duration)}</span>
                </td>
                <td>{p.watts === null ? <Dash /> : `${Math.round(p.watts)} W`}</td>
                <td>{p.wattsPerKg === null ? <Dash /> : p.wattsPerKg.toFixed(2)}</td>
                <td>{p.category ?? <Dash />}</td>
                {compare && <td className="text-muted">{then?.wattsPerKg == null ? <Dash /> : `${then.wattsPerKg.toFixed(2)} · ${then.category}`}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-sm text-muted">
        Rated on Allen and Coggan&apos;s power profile table ({sex === "female" ? "women's" : "men's"}), from {PROFILE_CATEGORIES[0].toLowerCase()} at
        the center to {PROFILE_CATEGORIES.at(-1)!.toLowerCase()} at the edge. Threshold is 95% of your best 20 minutes and endurance your best hour,
        both on the FTP column. W/kg uses your current weight, {weightKg.toFixed(1)} kg.
      </p>
    </div>
  );
}
