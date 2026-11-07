import { CATEGORY_RINGS, type ProfilePoint } from "@/lib/engine/profile";

const SIZE = 420;
const CENTER = { x: SIZE / 2, y: 200 };
const RADIUS = 140;

/**
 * Spider chart of a power profile: one spoke per duration, sprint at the top, distance from the
 * center is the Coggan rating (center untrained, edge world class). Faint rings mark every other
 * category boundary; each spoke's own category is written under its label, not on the rings.
 * `compare` draws a second profile as a dashed outline (all-time bests behind the recent ones).
 */
export default function PowerRadar({ points, compare }: { points: ProfilePoint[]; compare?: ProfilePoint[] }) {
  const n = points.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const at = (i: number, score: number) => {
    const r = (score / 100) * RADIUS;
    return { x: CENTER.x + r * Math.cos(angle(i)), y: CENTER.y + r * Math.sin(angle(i)) };
  };
  const polygon = (scores: number[]) => scores.map((s, i) => at(i, s)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const ring = (score: number) => polygon(Array<number>(n).fill(score));
  const rings = CATEGORY_RINGS.filter((_, i) => i % 2 === 1);

  return (
    <svg viewBox={`-50 -16 ${SIZE + 100} ${SIZE + 6}`} className="viz mx-auto w-full max-w-lg select-none" role="img" aria-label="Power profile radar">
      <polygon points={ring(100)} className="fill-surface stroke-[var(--grid)]" />
      {rings.map((s) => (
        <polygon key={s} points={ring(s)} fill="none" className="stroke-[var(--grid)]" />
      ))}
      {points.map((_, i) => {
        const end = at(i, 100);
        return <line key={i} x1={CENTER.x} y1={CENTER.y} x2={end.x} y2={end.y} className="stroke-[var(--grid)]" />;
      })}
      {compare && (
        <polygon
          points={polygon(compare.map((p) => p.score ?? 0))}
          fill="none"
          stroke="var(--series-2)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          strokeLinejoin="round"
        />
      )}
      <polygon
        points={polygon(points.map((p) => p.score ?? 0))}
        fill="var(--series-1)"
        fillOpacity={0.15}
        stroke="var(--series-1)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {points.map((p, i) =>
        p.score === null ? null : (
          <circle key={p.axis} cx={at(i, p.score).x} cy={at(i, p.score).y} r={4} fill="var(--series-1)" className="stroke-surface" strokeWidth={2}>
            <title>{`${p.label}: ${p.wattsPerKg!.toFixed(1)} W/kg, ${p.category}`}</title>
          </circle>
        ),
      )}

      {points.map((p, i) => {
        const outside = at(i, 116);
        const cos = Math.cos(angle(i));
        const anchor = Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end";
        // Three lines: the top label sits above its spoke, the bottom two hang below theirs.
        const dy = Math.sin(angle(i)) < -0.9 ? -36 : Math.sin(angle(i)) > 0.5 ? 6 : -12;
        return (
          <text key={p.axis} x={outside.x} y={outside.y + dy} textAnchor={anchor} className="text-[12px]">
            <tspan x={outside.x} className="fill-ink font-medium">
              {p.label}
            </tspan>
            <tspan x={outside.x} dy={14} className="num fill-muted">
              {p.wattsPerKg === null ? "no effort yet" : `${p.wattsPerKg.toFixed(1)} W/kg`}
            </tspan>
            {p.category && (
              <tspan x={outside.x} dy={14} className="fill-faint">
                {p.category}
              </tspan>
            )}
          </text>
        );
      })}
    </svg>
  );
}
