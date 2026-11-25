import { Panel } from "@/components/ui";
import { recoveryAgainstUsual, type HrRecovery, type UsualHrRecovery } from "@/lib/engine/hr-recovery";

const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(Math.round(seconds % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

const AGAINST: Record<"faster" | "usual" | "slower", { label: string; tone: string }> = {
  faster: { label: "Faster than usual", tone: "text-positive" },
  usual: { label: "About usual", tone: "text-muted" },
  slower: { label: "Slower than usual", tone: "text-warning" },
};

/** How far heart rate fell in the minute after each hard effort, against your usual. */
export default function HrRecoveryPanel({ recovery, usual }: { recovery: HrRecovery; usual: UsualHrRecovery | null }) {
  const against = recoveryAgainstUsual(recovery.drop, usual);
  const most = Math.max(...recovery.efforts.map((e) => e.drop), usual?.drop ?? 0, 1);
  const count = recovery.efforts.length;
  return (
    <Panel title="Heart rate recovery" meta="Drop in the minute after each hard effort" pad={false}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 sm:px-5">
        <p className="num text-2xl font-semibold">
          {recovery.drop} <span className="text-base font-normal text-muted">bpm</span>
        </p>
        <p className="text-sm">
          {against && <span className={`font-medium ${AGAINST[against].tone}`}>{AGAINST[against].label}</span>}
          <span className="text-muted">
            {against ? " · " : ""}
            {count === 1 ? "1 effort" : `Average of ${count} efforts`}
            {usual ? `, your usual ${usual.drop} bpm` : ", your usual shows after 3 rides with hard efforts"}
          </span>
        </p>
      </div>
      <div className="overflow-x-auto px-4 pt-3 pb-4 sm:px-5">
        <table className="num w-full text-sm">
          <thead className="text-left whitespace-nowrap text-muted">
            <tr>
              <th className="pb-2 pr-3 font-normal">Effort</th>
              <th className="hidden pb-2 pr-3 text-right font-normal sm:table-cell">Power</th>
              <th className="pb-2 pr-3 text-right font-normal">Peak</th>
              <th className="pb-2 pr-3 text-right font-normal">1 min on</th>
              <th className="pb-2 font-normal">Drop</th>
            </tr>
          </thead>
          <tbody>
            {recovery.efforts.map((e, k) => (
              <tr key={e.from} className="border-t border-rule">
                <td className="py-2 pr-3 whitespace-nowrap">
                  {k + 1} <span className="text-muted">· {clock(e.to - e.from)}<span className="hidden sm:inline"> at {clock(e.from)}</span></span>
                </td>
                <td className="hidden py-2 pr-3 text-right whitespace-nowrap sm:table-cell">{e.watts} W</td>
                <td className="py-2 pr-3 text-right">{e.peak}</td>
                <td className="py-2 pr-3 text-right">{e.after}</td>
                <td className="w-1/3 min-w-28 py-2">
                  <div className="flex items-center gap-2">
                    <div className="relative h-2 flex-1 rounded-full bg-rule">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${(e.drop / most) * 100}%` }} />
                      {usual && <div className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: `${(usual.drop / most) * 100}%` }} title={`Your usual ${usual.drop} bpm`} />}
                    </div>
                    <span className="w-14 shrink-0 text-right font-medium">{e.drop} bpm</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {usual && <p className="mt-2 text-xs text-muted">The dark mark is your usual over the last 8 weeks ({usual.rides} rides).</p>}
      </div>
    </Panel>
  );
}
