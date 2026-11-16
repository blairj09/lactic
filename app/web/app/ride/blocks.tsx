// Draws the built-in blocks plugins can use (web/lib/sdk/blocks.ts): gauge, ring, zone bar, target,
// list, status, countdown and balance. Lactic picks every colour, size and motion here; the plugin
// only said what the numbers mean. Three sizes: "sm" for the overlay strip (and narrow phone
// columns), "md" for a ride field and a ride page section, "lg" for a big field.

import { useEffect, useState } from "react";
import { useUnits } from "@/lib/use-units";
import { balanceLeft, bandOf, clock, inUnits, rampZone, shownNumber, targetVerdict, zonebarPosition, formatNumber, type BlockNode, type StatusIcon, type Zone } from "@/lib/sdk/blocks";

export type BlockSize = "sm" | "md" | "lg";

/** A tone (the kit's or a ride field's) as a CSS colour. Unknown or default is Lactic blue. */
export function toneColor(t: string | undefined): string {
  switch (t) {
    case "good":
    case "positive":
      return "var(--positive)";
    case "warn":
    case "warning":
      return "var(--warning)";
    case "bad":
    case "negative":
      return "var(--negative)";
    case "muted":
      return "var(--faint)";
    default:
      return "var(--accent)";
  }
}

/** A zone's colour for fills (bars, arcs). */
export const zoneFill = (z: number) => `var(--zone-${Math.min(7, Math.max(1, z))})`;
/** A zone's colour for words and numbers: mixed toward the text colour so even zone 1 reads on the ground. */
export const zoneInk = (z: number) => `color-mix(in oklab, var(--zone-${Math.min(7, Math.max(1, z))}) 60%, var(--ink))`;

/** Now, in seconds since 1970, ticking once a second while shown. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function BlockView({ block, size = "md", valueSize }: { block: BlockNode; size?: BlockSize; valueSize?: string }) {
  const units = useUnits();
  const big = valueSize ?? (size === "lg" ? "text-7xl leading-[1.05]" : size === "sm" ? "text-2xl" : "text-4xl leading-[1.15]");
  switch (block.type) {
    case "gauge":
      return <Gauge b={block} size={size} valueSize={big} units={units} />;
    case "ring":
      return <Ring b={block} size={size} valueSize={big} />;
    case "zonebar":
      return <ZoneBar b={block} size={size} valueSize={big} />;
    case "target":
      return <Target b={block} size={size} valueSize={big} units={units} />;
    case "list":
      return <List b={block} size={size} />;
    case "status":
      return <Status b={block} size={size} />;
    case "countdown":
      return <Countdown b={block} valueSize={big} />;
    case "balance":
      return <Balance b={block} size={size} valueSize={big} />;
  }
}

// ---- Gauge ----

const rad = (a: number) => ((a - 90) * Math.PI) / 180;
const at = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))] as const;
function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const [x0, y0] = at(cx, cy, r, a0);
  const [x1, y1] = at(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

type Units = ReturnType<typeof useUnits>;

function Gauge({ b, size, valueSize, units }: { b: Extract<BlockNode, { type: "gauge" }>; size: BlockSize; valueSize: string; units: Units }) {
  const conv = (v: number) => (b.format ? v : inUnits(v, b.unit, units).value);
  const shown = shownNumber(b.value, b.unit, b, units);
  const min = conv(b.min);
  const max = conv(b.max);
  const value = conv(b.value);
  const half = size === "sm" || b.shape === "half";
  const sweep = half ? 180 : 240;
  const a0 = -sweep / 2;
  const frac = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min)));
  const A = (v: number) => a0 + sweep * frac(v);
  const W = 200;
  const sw = half && size === "sm" ? 22 : 14;
  // With tick labels the dial shrinks so they sit outside it, clear of the number.
  const labelled = size !== "sm" && b.ticks !== undefined;
  const r = half ? (labelled ? 78 : 100 - sw / 2 - 2) : labelled ? 68 : 80;
  const cx = 100;
  const cy = half ? 100 : 90;
  const H = half ? 102 : 140;

  // Bands, each from the last one's end; coloured by tone, zone or the zone ramp.
  const bands = (b.zones ?? []).map((z, i, all) => ({
    from: i ? conv(all[i - 1].to) : min,
    to: conv(z.to),
    color: z.tone ? toneColor(z.tone) : zoneFill(z.zone ?? rampZone(i, all.length)),
  }));
  const inBand = bands.find((x) => value >= x.from && value <= x.to) ?? (value > max ? bands[bands.length - 1] : undefined);
  const color = b.tone ? toneColor(b.tone) : b.zone ? zoneFill(b.zone) : (inBand?.color ?? "var(--accent)");
  const track = arc(cx, cy, r, a0, a0 + sweep);

  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`${shown.text}${shown.unit ? ` ${shown.unit}` : ""}`}>
      <path d={track} stroke="var(--raised)" strokeWidth={sw} fill="none" strokeLinecap="round" />
      {bands.map((x, i) => (
        <path key={i} d={arc(cx, cy, r, A(x.from) + 0.6, Math.max(A(x.from) + 0.6, A(x.to) - 0.6))} stroke={x.color} strokeOpacity={0.35} strokeWidth={sw} fill="none" />
      ))}
      <path d={track} pathLength={100} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" strokeDasharray={`${frac(value) * 100} 100`} style={{ transition: "stroke-dasharray 0.8s ease-out, stroke 0.4s" }} />
      {b.target !== undefined && (() => {
        const [x0, y0] = at(cx, cy, r - sw * 0.9, A(conv(b.target)));
        const [x1, y1] = at(cx, cy, r + sw * 0.9, A(conv(b.target)));
        return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--ink)" strokeWidth={3} />;
      })()}
      {size !== "sm" && b.ticks !== undefined && ticks(min, max, niceStep(conv(b.min + b.ticks) - conv(b.min))).map((t) => {
        const [x, y] = at(cx, cy, r + sw / 2 + 11, A(t));
        return (
          <text key={t} x={x} y={y + 4} fill="var(--muted)" fontSize={11} textAnchor="middle">
            {formatNumber(t, { decimals: Number.isInteger(t) ? 0 : 1 })}
          </text>
        );
      })}
      {size !== "sm" && b.needle && (
        <g style={{ transform: `rotate(${A(value)}deg)`, transformOrigin: `${cx}px ${cy}px`, transition: "transform 0.8s ease-out" }}>
          <line x1={cx} y1={cy - r + sw / 2 + 9} x2={cx} y2={cy - r - sw / 2 - 1} stroke="var(--ink)" strokeWidth={3} strokeLinecap="round" />
        </g>
      )}
      {size !== "sm" && (
        <>
          <text x={cx} y={cy + (half ? -8 : 14)} fill="var(--ink)" fontSize={half ? 42 : 44} fontWeight={500} textAnchor="middle" letterSpacing={-1} className="num">
            {shown.text}
          </text>
          {shown.unit && !b.label && (
            <text x={cx} y={cy + (half ? 10 : 34)} fill="var(--muted)" fontSize={13} textAnchor="middle">
              {shown.unit}
            </text>
          )}
        </>
      )}
    </svg>
  );
  if (size === "sm")
    return (
      <div className={`flex items-end gap-[0.15em] ${valueSize}`}>
        <span className="num font-medium tracking-tight">{shown.text}</span>
        <span className="mb-[0.12em] block w-[1.1em]">
          {svg}
        </span>
      </div>
    );
  return (
    <div className={size === "lg" ? "mx-auto w-full max-w-[26rem]" : "w-full max-w-[13rem]"}>
      {b.label && (
        <div className="text-sm text-muted">
          {b.label}
          {shown.unit ? ` · ${shown.unit}` : ""}
        </div>
      )}
      {svg}
    </div>
  );
}

/** Tick values every `step` from the first multiple of it at or above `min`, up to `max`. */
function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-6 && out.length < 14; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** A round step near `raw` (1, 2, 2.5 or 5 times a power of ten), so converted units still tick on round numbers. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * p;
}

// ---- Ring ----

function Ring({ b, size, valueSize }: { b: Extract<BlockNode, { type: "ring" }>; size: BlockSize; valueSize: string }) {
  const color = b.tone ? toneColor(b.tone) : b.zone ? zoneFill(b.zone) : "var(--accent)";
  const L = 2 * Math.PI * 40;
  const svg = (
    <svg viewBox="0 0 100 100" className="block size-full" role="img" aria-label={b.text ?? `${Math.round(b.value * 100)}%`}>
      <circle cx={50} cy={50} r={40} stroke="var(--raised)" strokeWidth={size === "sm" ? 18 : 11} fill="none" />
      <circle cx={50} cy={50} r={40} stroke={color} strokeWidth={size === "sm" ? 18 : 11} fill="none" strokeLinecap="round" strokeDasharray={`${b.value * L} ${L}`} transform="rotate(-90 50 50)" style={{ transition: "stroke-dasharray 0.8s ease-out" }} />
      {size !== "sm" && b.text && (
        <text x={50} y={58} fill="var(--ink)" fontSize={24} fontWeight={500} textAnchor="middle" className="num">
          {b.text}
        </text>
      )}
    </svg>
  );
  if (size === "sm")
    return (
      <div className={`flex items-center gap-[0.15em] ${valueSize}`}>
        <span className="block size-[0.6em]">{svg}</span>
        {b.text && <span className="num font-medium tracking-tight">{b.text}</span>}
      </div>
    );
  return (
    <div>
      {b.label && <div className="text-sm text-muted">{b.label}</div>}
      <div className={`mt-1 ${size === "lg" ? "size-48" : "size-24"}`}>{svg}</div>
    </div>
  );
}

// ---- Zone bar ----

function ZoneBar({ b, size, valueSize }: { b: Extract<BlockNode, { type: "zonebar" }>; size: BlockSize; valueSize: string }) {
  const n = b.bands.length - 1;
  const i = bandOf(b.value, b.bands);
  const pos = zonebarPosition(b.value, b.bands);
  const fill = (k: number) => (b.tones?.[k] && b.tones[k] !== "default" ? toneColor(b.tones[k]) : zoneFill(n === 7 ? k + 1 : rampZone(k, n)));
  const name = b.names?.[i];
  const label = name && name.length <= 3 ? name : `Z${i + 1}`;
  const bar = (
    <div className={`relative ${size === "sm" ? "w-[1.6em] pt-[0.08em]" : "w-full max-w-[16rem] pt-2"}`}>
      <div className={`flex gap-[2px] ${size === "sm" ? "h-[0.14em]" : size === "lg" ? "h-5" : "h-3"}`}>
        {Array.from({ length: n }, (_, k) => (
          <div key={k} className="flex-1 rounded-[3px]" style={{ background: fill(k), opacity: k === i ? 1 : 0.5 }} />
        ))}
      </div>
      <div className="absolute top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-full bg-ink" style={{ left: `${pos * 100}%`, transition: "left 0.6s ease-out" }} />
    </div>
  );
  if (size === "sm")
    return (
      <div className={`flex items-center gap-[0.15em] ${valueSize}`}>
        <span className="num font-medium tracking-tight">{label}</span>
        {bar}
      </div>
    );
  return (
    <div>
      {b.label && <div className="text-sm text-muted">{b.label}</div>}
      <div className={`num font-medium tracking-tight ${valueSize}`}>
        {label}
        {name && name !== label && <span className="ml-2 text-base font-normal tracking-normal text-muted">{name}</span>}
      </div>
      {bar}
    </div>
  );
}

// ---- Target vs actual ----

function Target({ b, size, valueSize, units }: { b: Extract<BlockNode, { type: "target" }>; size: BlockSize; valueSize: string; units: Units }) {
  const v = shownNumber(b.value, b.unit, b, units);
  const t = shownNumber(b.target, b.unit, b, units);
  const fmt = (n: number) => (b.format ? formatNumber(n, b) : shownNumber(n, b.unit, b, units).text);
  const verdict = targetVerdict(b.value, b.target, b.within, fmt);
  const color = verdict.good ? "var(--positive)" : "var(--warning)";
  const top = Math.max(b.target * 1.15, b.value, 1e-9);
  if (size === "sm")
    return (
      <div className={`num font-medium tracking-tight ${valueSize}`}>
        {v.text}
        <span className="ml-[0.2em] text-[0.45em] font-normal tracking-normal text-muted">/ {t.text}</span>
      </div>
    );
  return (
    <div>
      {b.label && <div className="text-sm text-muted">{b.label}</div>}
      <div className={`num font-medium tracking-tight ${valueSize}`}>
        {v.text}
        <span className="ml-1.5 text-base font-normal tracking-normal text-muted">
          / {t.text}
          {t.unit ? ` ${t.unit}` : ""}
        </span>
      </div>
      <div className="relative mt-1 h-4 w-full max-w-[16rem]">
        <div className="absolute inset-x-0 top-1.5 h-1.5 rounded-full bg-raised" />
        <div className="absolute left-0 top-1.5 h-1.5 rounded-full" style={{ width: `${Math.min(100, Math.max(0, (b.value / top) * 100))}%`, background: color, transition: "width 0.6s ease-out" }} />
        <div className="absolute top-0 h-4 w-[3px] -translate-x-1/2 rounded-full bg-ink" style={{ left: `${(b.target / top) * 100}%` }} />
      </div>
      <div className="h-5 text-sm" style={{ color }}>
        {verdict.words}
      </div>
    </div>
  );
}

// ---- List ----

function List({ b, size }: { b: Extract<BlockNode, { type: "list" }>; size: BlockSize }) {
  const ink = (tone?: string) => (tone && tone !== "default" ? { color: tone === "muted" ? "var(--muted)" : toneColor(tone) } : undefined);
  if (size === "sm")
    return (
      <div className="num whitespace-nowrap font-medium">
        {b.rows.slice(0, 3).map((r, i) => (
          <span key={i}>
            {i > 0 && <span className="text-faint"> · </span>}
            <span style={ink(r.tone)}>{r.value}</span>
          </span>
        ))}
      </div>
    );
  return (
    <div>
      {b.label && <div className="text-sm text-muted">{b.label}</div>}
      <dl className={`mt-1 space-y-0.5 ${size === "lg" ? "text-3xl" : "text-base"}`}>
        {b.rows.map((r, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 truncate text-muted">{r.label}</dt>
            <dd className="num font-medium" style={ink(r.tone)}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---- Status ----

const ICON: Record<StatusIcon, React.ReactNode> = {
  check: <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  alert: (
    <>
      <path d="M8 2 15 14H1Z" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
      <path d="M8 6.5v3.5M8 12v.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </>
  ),
  up: <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  down: <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />,
  pause: <path d="M5.5 3v10M10.5 3v10" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />,
  dot: <circle cx={8} cy={8} r={4} fill="currentColor" />,
  half: (
    <>
      <circle cx={8} cy={8} r={5.5} fill="none" stroke="currentColor" strokeWidth={1.8} />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" />
    </>
  ),
};

function Status({ b, size }: { b: Extract<BlockNode, { type: "status" }>; size: BlockSize }) {
  const color = b.tone && b.tone !== "default" ? (b.tone === "muted" ? "var(--muted)" : toneColor(b.tone)) : "var(--ink)";
  const pill = (
    <span
      className={`inline-flex max-w-full items-center gap-[0.35em] whitespace-nowrap rounded-full font-semibold ${size === "sm" ? "px-[0.5em] py-[0.1em]" : size === "lg" ? "px-5 py-2 text-4xl" : "px-3 py-1 text-xl"}`}
      style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}
    >
      {b.icon && (
        <svg viewBox="0 0 16 16" className="size-[0.85em] shrink-0" aria-hidden>
          {ICON[b.icon]}
        </svg>
      )}
      <span className="truncate">{b.text}</span>
    </span>
  );
  if (size === "sm") return pill;
  return (
    <div>
      {b.label && <div className="text-sm text-muted">{b.label}</div>}
      <div className="mt-2">{pill}</div>
      {b.sub && <div className="mt-1.5 text-sm text-muted">{b.sub}</div>}
    </div>
  );
}

// ---- Countdown ----

function Countdown({ b, valueSize }: { b: Extract<BlockNode, { type: "countdown" }>; valueSize: string }) {
  const now = useNow();
  const seconds = b.until !== undefined ? b.until - now : now - (b.since ?? now);
  const color = b.tone && b.tone !== "default" ? toneColor(b.tone) : undefined;
  return (
    <div>
      {b.label && <div className="text-sm text-muted">{b.label}</div>}
      <div className={`num font-medium tracking-tight ${valueSize}`} style={color ? { color } : undefined}>
        {clock(seconds)}
      </div>
      {b.sub && <div className="text-sm text-muted">{b.sub}</div>}
    </div>
  );
}

// ---- Balance ----

function Balance({ b, size, valueSize }: { b: Extract<BlockNode, { type: "balance" }>; size: BlockSize; valueSize: string }) {
  const l = balanceLeft(b.left, b.right);
  const words = (
    <div className={`num font-medium tracking-tight ${valueSize}`}>
      {l}
      <span className="text-faint">/</span>
      {100 - l}
    </div>
  );
  if (size === "sm") return words;
  const off = 50 - l; // positive: right is bigger
  return (
    <div>
      {b.label && <div className="text-sm text-muted">{b.label}</div>}
      {words}
      <div className="relative mt-2 h-4 w-full max-w-[16rem]">
        <div className="absolute inset-x-0 top-1 h-2 rounded-full bg-raised" />
        <div className="absolute top-1 h-2 bg-accent" style={{ left: `${off >= 0 ? 50 : 50 + off}%`, width: `${Math.abs(off)}%`, transition: "all 0.6s ease-out" }} />
        <div className="absolute left-1/2 top-0 h-4 w-[2px] -translate-x-1/2 bg-ink" />
      </div>
    </div>
  );
}

/** The zone colour for a number, or nothing. */
export const zoneStyle = (z: Zone | undefined) => (z ? { color: zoneInk(z) } : undefined);
