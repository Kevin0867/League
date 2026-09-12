import type { WeekPoint, DevRating, TrendStat } from "@/lib/domain/formsAnalytics";

// Lightweight, dependency-free SVG charts for the coaching-form analytics.
// Server components — no client JS. Every value also appears as text so the
// charts stay accessible and legible in a printed / screenshotted report.

export function Sparkline({ points, color = "#0e7490", max, unit = "" }: {
  points: WeekPoint[];
  color?: string;
  /** Fixed top of the scale (e.g. 100 for a percentage). Omit to auto-scale to
   *  the data — right for plain-number metrics with no fixed range. */
  max?: number;
  unit?: string;
}) {
  const w = 220, h = 56, pad = 6;
  const n = points.length;
  const recorded = points.map((p, i) => ({ i, v: p.value })).filter((p) => p.v !== null) as { i: number; v: number }[];
  // Scale to the fixed max when given, else to the data's own peak (with a
  // little headroom) so a plain-number series fills the chart nicely.
  const dataMax = recorded.length ? Math.max(...recorded.map((p) => p.v)) : 1;
  const scaleMax = max ?? Math.max(1, dataMax * 1.15);
  const x = (i: number) => pad + (n <= 1 ? 0 : (i * (w - pad * 2)) / (n - 1));
  const y = (v: number) => h - pad - (Math.max(0, Math.min(scaleMax, v)) / scaleMax) * (h - pad * 2);
  if (recorded.length === 0) {
    return <div className="flex h-14 items-center text-xs text-slate-400">No data yet</div>;
  }
  const line = recorded.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(recorded[recorded.length - 1].i).toFixed(1)},${h - pad} L${x(recorded[0].i).toFixed(1)},${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" role="img" aria-label={`Trend chart, latest ${recorded[recorded.length - 1].v}${unit}`}>
      <path d={area} fill={color} fillOpacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {recorded.map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={2.5} fill={color} />
      ))}
    </svg>
  );
}

const DEV_LABELS = ["", "Needs work", "Improving", "Strength"];
const DEV_COLORS = ["#e2e8f0", "#f43f5e", "#f59e0b", "#10b981"];

export function SkillBars({ ratings }: { ratings: DevRating[] }) {
  return (
    <div className="space-y-1.5">
      {ratings.map((r) => {
        const v = r.value ?? 0;
        return (
          <div key={r.key} className="flex items-center gap-2">
            <div className="w-28 shrink-0 text-xs text-slate-600">{r.label}</div>
            <div className="flex flex-1 gap-1" aria-label={`${r.label}: ${r.value ? DEV_LABELS[v] : "not rated"}`}>
              {[1, 2, 3].map((step) => (
                <div key={step} className="h-2.5 flex-1 rounded-full" style={{ backgroundColor: v >= step ? DEV_COLORS[v] : "#f1f5f9" }} />
              ))}
            </div>
            <div className="w-20 shrink-0 text-right text-xs font-medium" style={{ color: r.value ? DEV_COLORS[v] : "#94a3b8" }}>
              {r.value ? DEV_LABELS[v] : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StatTile({ label, value, unit, sub, tone = "brand" }: {
  label: string;
  value: string | number | null;
  unit?: string;
  sub?: string;
  tone?: "brand" | "emerald" | "amber" | "slate";
}) {
  const tones: Record<string, string> = {
    brand: "text-brand-700",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    slate: "text-slate-700",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-xl font-bold ${tones[tone]}`}>
        {value === null || value === undefined || value === "" ? "—" : value}{value !== null && value !== "" && unit ? <span className="text-sm font-semibold text-slate-400">{unit}</span> : null}
      </div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

/** A one-line growth summary: start → now, total gain, % gain, avg/week. */
export function GrowthSummary({ stat, unit = "" }: { stat: TrendStat; unit?: string }) {
  if (stat.count < 2 || stat.first === null || stat.latest === null) {
    return <div className="text-xs text-slate-400">Needs 2+ weeks to show growth.</div>;
  }
  const up = (stat.delta ?? 0) > 0;
  const down = (stat.delta ?? 0) < 0;
  const tone = up ? "text-emerald-600" : down ? "text-rose-500" : "text-slate-500";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-slate-500">Wk {stat.firstWeek}: <span className="font-semibold text-slate-700">{stat.first}{unit}</span></span>
      <span className="text-slate-300">→</span>
      <span className="text-slate-500">Wk {stat.latestWeek}: <span className="font-semibold text-slate-700">{stat.latest}{unit}</span></span>
      <span className={`font-semibold ${tone}`}>{up ? "▲" : down ? "▼" : "■"} {stat.delta! > 0 ? "+" : ""}{stat.delta}{unit}{stat.pctChange !== null ? ` (${stat.pctChange > 0 ? "+" : ""}${stat.pctChange}%)` : ""}</span>
      {stat.avgPerWeek !== null && <span className="text-slate-400">avg {stat.avgPerWeek > 0 ? "+" : ""}{stat.avgPerWeek}{unit}/wk</span>}
      <span className="text-slate-400">{stat.improvedWeeks}/{Math.max(0, stat.count - 1)} weeks up</span>
    </div>
  );
}

/** Week-over-week table: each recorded week with its change from the prior. */
export function WowTable({ stat, unit = "" }: { stat: TrendStat; unit?: string }) {
  if (stat.count === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <tbody>
          <tr className="text-slate-400">
            <td className="pr-2 font-medium">Week</td>
            {stat.wow.map((w) => <td key={w.week} className="px-2 text-center">{w.week}</td>)}
          </tr>
          <tr className="text-slate-700">
            <td className="pr-2 font-medium text-slate-500">Value</td>
            {stat.wow.map((w) => <td key={w.week} className="px-2 text-center font-semibold">{w.value}{unit}</td>)}
          </tr>
          <tr>
            <td className="pr-2 font-medium text-slate-500">Δ</td>
            {stat.wow.map((w) => (
              <td key={w.week} className="px-2 text-center">
                {w.deltaPrev === null ? <span className="text-slate-300">—</span> : (
                  <span className={w.deltaPrev > 0 ? "text-emerald-600" : w.deltaPrev < 0 ? "text-rose-500" : "text-slate-400"}>
                    {w.deltaPrev > 0 ? "+" : ""}{w.deltaPrev}
                  </span>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function DeltaBadge({ delta, unit = "%" }: { delta: number | null; unit?: string }) {
  if (delta === null) return null;
  if (delta === 0) return <span className="text-xs font-medium text-slate-400">no change</span>;
  const up = delta > 0;
  return (
    <span className={`text-xs font-semibold ${up ? "text-emerald-600" : "text-rose-500"}`}>
      {up ? "▲" : "▼"} {Math.abs(delta)}{unit}
    </span>
  );
}
