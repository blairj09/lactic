// Draws a checked kit tree (web/lib/sdk/kit.ts) with Lactic's own styles, and the frame every piece
// of plugin content sits in: a purple band naming the plugin that the plugin can't draw over (S8).
// Text is rendered as text only; nothing from a plugin becomes HTML, a link or a style.
import type { KitNode, Tone } from "@shared/sdk";

const TONE: Record<Tone, string> = { default: "text-ink", good: "text-positive", warn: "text-warning", bad: "text-negative", muted: "text-muted" };
const STROKE: Record<Tone, string> = { default: "var(--plugin)", good: "var(--positive)", warn: "var(--warning)", bad: "var(--negative)", muted: "var(--faint)" };
const tone = (t?: Tone) => TONE[t ?? "default"];

export function PluginFrame({ name, label, dashed, children }: { name: string; label?: string; dashed?: boolean; children: React.ReactNode }) {
  return (
    <section className={`overflow-hidden rounded-lg border bg-surface ${dashed ? "border-dashed border-plugin-line bg-transparent" : "border-plugin-line"}`}>
      <div className="flex items-center gap-2 bg-plugin-soft px-3 py-1 text-xs font-semibold text-plugin">
        <span aria-hidden>⧉</span>
        <span className="truncate">{name}</span>
        <span className="ml-auto truncate font-normal">{label ? `plugin · ${label}` : "plugin"}</span>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Line({ values, color, height = 32 }: { values: (number | null)[]; color: string; height?: number }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const span = Math.max(...nums) - min || 1;
  let d = "";
  values.forEach((v, i) => {
    if (v === null) return;
    const x = (i / (values.length - 1)) * 100;
    const y = height - ((v - min) / span) * height;
    d += `${d && values[i - 1] !== null ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:00` : `${m}:00`;
};

function Profile({ node }: { node: Extract<KitNode, { type: "profile" }> }) {
  const H = 120;
  const nums = node.y.filter((v): v is number => v !== null);
  if (node.x.length < 2 || nums.length < 2) return null;
  const x0 = node.x[0];
  const xs = node.x[node.x.length - 1] - x0 || 1;
  const max = Math.max(...nums);
  const min = Math.min(0, ...nums);
  const sx = (x: number) => ((x - x0) / xs) * 100;
  const sy = (y: number) => H - ((y - min) / (max - min || 1)) * H;
  let d = "";
  node.y.forEach((v, i) => {
    if (v === null) return;
    d += `${d && node.y[i - 1] !== null ? "L" : "M"}${sx(node.x[i]).toFixed(2)},${sy(v).toFixed(2)}`;
  });
  const fmt = (x: number) => (node.xUnit === "km" ? `${x.toFixed(1)} km` : clock(x));
  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }} role="img" aria-label={node.yUnit ? `Line in ${node.yUnit}` : "Line"}>
        {(node.marks ?? []).map((m, i) => (
          <rect key={i} x={sx(m.from)} y={0} width={Math.max(0, sx(m.to) - sx(m.from))} height={H} fill={STROKE[m.tone ?? "good"]} opacity={0.12}>
            {m.label ? <title>{m.label}</title> : null}
          </rect>
        ))}
        <path d={d} fill="none" stroke={STROKE[node.tone ?? "default"]} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-xs text-faint">
        <span>{fmt(x0)}</span>
        {node.yUnit ? <span>{node.yUnit}</span> : null}
        <span>{fmt(node.x[node.x.length - 1])}</span>
      </div>
    </div>
  );
}

export function KitView({ node, onOpenDetail }: { node: KitNode; onOpenDetail?: () => void }): React.ReactElement | null {
  switch (node.type) {
    case "field":
      return (
        <div>
          <div className="text-xs text-muted">{node.label}</div>
          <div className={`${node.lead ? "text-4xl" : "text-3xl"} font-semibold tabular-nums ${tone(node.tone)}`}>
            {node.value}
            {node.unit ? <span className="ml-1 text-base font-normal text-muted">{node.unit}</span> : null}
          </div>
          {node.sub ? <div className="text-xs text-muted">{node.sub}</div> : null}
        </div>
      );
    case "stat":
      return (
        <div>
          <div className="text-xs text-muted">{node.label}</div>
          <div className={`text-2xl font-semibold tabular-nums ${tone(node.tone)}`}>{node.value}</div>
          {node.sub ? <div className="text-xs text-muted">{node.sub}</div> : null}
        </div>
      );
    case "text":
      return <p className={`${node.size === "lg" ? "text-base" : node.size === "sm" ? "text-xs" : "text-sm"} ${node.weight === "semibold" ? "font-semibold" : node.weight === "medium" ? "font-medium" : ""} ${tone(node.tone)}`}>{node.text}</p>;
    case "sparkline":
      return <Line values={node.values} color={STROKE[node.tone ?? "default"]} />;
    case "bars": {
      const max = Math.max(1, ...node.values.map((v) => v ?? 0));
      return (
        <div className="flex h-12 items-end gap-0.5">
          {node.values.map((v, i) => (
            <div key={i} className="flex-1 rounded-sm" style={{ height: `${((v ?? 0) / max) * 100}%`, background: node.palette === "zones" ? `var(--zone-${Math.min(7, i + 1)})` : STROKE[node.tone ?? "default"], opacity: v === null ? 0.2 : node.palette === "zones" ? 1 : 0.8 }} title={node.labels?.[i]} />
          ))}
        </div>
      );
    }
    case "meter":
      return (
        <div className="space-y-1">
          {node.label ? <div className="text-xs text-muted">{node.label}</div> : null}
          <div className="h-2 overflow-hidden rounded bg-raised">
            <div className="h-full" style={{ width: `${node.value * 100}%`, background: STROKE[node.tone ?? "default"] }} />
          </div>
        </div>
      );
    case "stack":
      return (
        <div className={`flex ${node.direction === "row" ? "flex-row flex-wrap items-end" : "flex-col"} ${node.gap === "sm" ? "gap-2" : "gap-4"}`}>
          {node.children.map((c, i) => (
            <KitView key={i} node={c} onOpenDetail={onOpenDetail} />
          ))}
        </div>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-faint">
                {node.columns.map((c, i) => (
                  <th key={i} className={`py-1.5 font-medium ${node.align?.[i] === "right" ? "text-right" : ""} ${i ? "pl-4" : ""}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((c, j) => (
                    <td key={j} className={`py-1.5 ${node.align?.[j] === "right" ? "text-right" : ""} ${j ? "pl-4" : ""}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "profile":
      return <Profile node={node} />;
    case "button":
      return (
        <button type="button" className="inline-flex h-8 items-center rounded-md border border-control px-3 text-sm hover:bg-raised" onClick={onOpenDetail} disabled={!onOpenDetail}>
          {node.label}
        </button>
      );
  }
}
