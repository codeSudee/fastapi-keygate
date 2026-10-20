import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Point, RateWindow, Range } from "@/lib/types";
import { fmtCompact, fmtNum, fmtTick, fmtTooltipTime } from "@/lib/format";
import { cx, EASE } from "./ui";

const SERIES = [
  { key: "ok", label: "Successful", color: "var(--accent)" },
  { key: "errors", label: "Errors", color: "var(--bad)" },
  { key: "limited", label: "Rate limited", color: "var(--warn)" },
] as const;

function ChartTooltip({ active, payload, label, range }: { active?: boolean; payload?: readonly { payload?: unknown }[]; label?: string | number; range: Range }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Point;
  const total = row.ok + row.errors + row.limited;
  return (
    <div className="min-w-44 rounded-xl border border-line-strong bg-raised/95 px-3.5 py-3 text-[13px] shadow-pop backdrop-blur">
      <p className="mb-2 text-xs text-muted">{fmtTooltipTime(String(label), range)}</p>
      <p className="mb-2 text-base font-medium tabular">{fmtNum(total)} <span className="text-xs font-normal text-muted">requests</span></p>
      <ul className="space-y-1">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-2 text-muted"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
            <span className="tabular">{fmtNum(row[s.key])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UsageChart({ data, range, height = 280 }: { data: Point[]; range: Range; height?: number }) {
  const hasData = data.some((p) => p.ok + p.errors + p.limited > 0);
  // Recharts measures after mount; delay animation start until the card has revealed.
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 120); return () => clearTimeout(t); }, []);
  const tickEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className="relative px-2 pb-4 pt-6 sm:px-4" style={{ height }} role="img" aria-label="Requests over time, stacked by outcome">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={s.key === "ok" ? 0.4 : 0.55} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
          <XAxis
            dataKey="t" tickLine={false} axisLine={false} tickMargin={10} interval={tickEvery - 1}
            tick={{ fill: "var(--faint)", fontSize: 12 }} tickFormatter={(v: string) => fmtTick(v, range)} minTickGap={24}
          />
          <YAxis
            width={44} tickLine={false} axisLine={false} allowDecimals={false}
            tick={{ fill: "var(--faint)", fontSize: 12 }} tickFormatter={(v: number) => fmtCompact(v)}
          />
          <Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }} content={(p) => <ChartTooltip {...p} range={range} />} isAnimationActive={false} />
          {[...SERIES].reverse().map((s) => (
            <Area
              key={s.key} type="monotone" dataKey={s.key} stackId="1" stroke={s.color} strokeWidth={s.key === "ok" ? 1.75 : 1.25}
              fill={`url(#g-${s.key})`} isAnimationActive={ready} animationDuration={900} animationEasing="ease-out"
              activeDot={{ r: 3.5, strokeWidth: 0, fill: s.color }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      {!hasData && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted">No requests in this period</p>
      )}
    </div>
  );
}

export function ChartLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}</li>
      ))}
    </ul>
  );
}

/** Tiny inline-SVG trend line that draws itself in. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const { line, area } = useMemo(() => {
    const w = 120, h = 32, pad = 2;
    const max = Math.max(...values, 1);
    const pts = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * w, h - pad - (v / max) * (h - pad * 2)]);
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return { line: d, area: `${d} L${w},${h} L0,${h} Z` };
  }, [values]);
  const flat = values.every((v) => v === 0);
  return (
    <svg viewBox="0 0 120 32" preserveAspectRatio="none" className={cx("h-8 w-full overflow-visible", className)} aria-hidden>
      <path d={area} fill="var(--accent)" opacity={flat ? 0 : 0.12} />
      <motion.path
        d={line} fill="none" stroke={flat ? "var(--line-strong)" : "var(--accent)"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: EASE }}
      />
    </svg>
  );
}

function resetIn(t: number) {
  const s = Math.max(0, t - Date.now() / 1000);
  return s < 90 ? `${Math.ceil(s)}s` : `${Math.ceil(s / 60)}m`;
}

/** Remaining-quota bar per rate window. */
export function RateMeter({ rate, compact }: { rate: RateWindow[]; compact?: boolean }) {
  if (!rate.length) return <span className="text-sm text-faint">Unlimited</span>;
  return (
    <div className={cx("space-y-3", compact && "space-y-2")}>
      {rate.map((r) => {
        const used = r.limit - r.remaining;
        const pct = Math.min(1, used / r.limit);
        const tone = pct >= 1 ? "var(--bad)" : pct > 0.8 ? "var(--warn)" : "var(--accent)";
        return (
          <div key={r.window}>
            <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
              <span className="text-muted">Per {r.window}</span>
              <span className="tabular text-fg">
                {fmtNum(r.remaining)} <span className="text-faint">/ {fmtNum(r.limit)} left</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label={`Per ${r.window} quota used`} aria-valuenow={used} aria-valuemin={0} aria-valuemax={r.limit}>
              <motion.div
                className="h-full rounded-full" style={{ background: tone, originX: 0 }}
                initial={{ scaleX: 0 }} animate={{ scaleX: pct }} transition={{ duration: 0.9, ease: EASE }}
              />
            </div>
            {!compact && used > 0 && <p className="mt-1 text-xs text-faint">Window resets in {resetIn(r.reset_time)}</p>}
          </div>
        );
      })}
    </div>
  );
}
