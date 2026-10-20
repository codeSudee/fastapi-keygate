import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Button, Card, CardHeader, CountUp, EASE, ErrorState, Icon, Reveal, Segmented, Skeleton } from "@/components/ui";
import { ChartLegend, UsageChart } from "@/components/charts";
import { useApi } from "@/lib/useApi";
import { fmtDelta, fmtNum, fmtPct } from "@/lib/format";
import { useUrlParam } from "@/lib/useUrlParam";
import type { Overview as OverviewData, Range } from "@/lib/types";

export const RANGES: { value: Range; label: string }[] = [
  { value: "1h", label: "1h" }, { value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" },
];
const RANGE_VALUES = RANGES.map((r) => r.value);
const PERIOD: Record<Range, string> = { "1h": "last hour", "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days" };

function Stat({ label, children, foot, delay }: { label: string; children: React.ReactNode; foot: React.ReactNode; delay: number }) {
  return (
    <Reveal delay={delay}>
      <Card className="h-full p-5 sm:p-6">
        <p className="text-[13px] text-muted">{label}</p>
        <p className="mt-2 text-[32px] font-semibold leading-none tracking-tight">{children}</p>
        <div className="mt-3 text-[13px] text-muted">{foot}</div>
      </Card>
    </Reveal>
  );
}

function BarList({ rows }: { rows: { id: string; label: React.ReactNode; value: number; to?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-1 px-3 pb-3 pt-4 sm:px-4">
      {rows.map((r, i) => {
        const inner = (
          <>
            <motion.span
              aria-hidden className="absolute inset-y-0 left-0 rounded-lg bg-[color-mix(in_srgb,var(--accent)_13%,transparent)]" style={{ originX: 0 }}
              initial={{ scaleX: 0 }} whileInView={{ scaleX: r.value / max }} viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE, delay: 0.05 * i }}
            />
            <span className="relative min-w-0 truncate text-sm">{r.label}</span>
            <span className="tabular relative text-sm text-muted">{fmtNum(r.value)}</span>
          </>
        );
        const cls = "relative flex h-10 items-center justify-between gap-4 rounded-lg px-3";
        return (
          <li key={r.id}>
            {r.to ? <Link to={r.to} className={`${cls} transition-colors hover:bg-raised/60`}>{inner}</Link> : <div className={cls}>{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export default function Overview() {
  const [range, setRange] = useUrlParam<Range>("range", "24h", RANGE_VALUES);
  const { data, error, loading, reload } = useApi<OverviewData>(`/overview?range=${range}`, { refreshMs: 30_000 });
  const d = data; // stale data stays visible while the next range loads
  const delta = d ? fmtDelta(d.totals.total, d.previous_total) : null;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="How your API keys are being used."
        actions={
          <>
            <Segmented label="Time range" value={range} onChange={setRange} options={RANGES} />
            <Button variant="ghost" size="sm" onClick={reload} aria-label="Refresh" className="size-8 px-0">{Icon.refresh}</Button>
          </>
        }
      />

      {error && !d ? (
        <Card><ErrorState message={error.message} onRetry={reload} /></Card>
      ) : (
        <motion.div animate={{ opacity: loading && d ? 0.55 : 1 }} transition={{ duration: 0.2 }} className="space-y-4 sm:space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4">
            <Stat label="Total API calls" delay={0} foot={d && delta ? (
              <span className={delta.dir === "up" ? "text-ok" : delta.dir === "down" ? "text-bad" : ""}>{delta.dir === "up" ? "↑" : delta.dir === "down" ? "↓" : "–"} {delta.text}<span className="text-muted"> vs previous period</span></span>
            ) : <Skeleton className="h-4 w-36" />}>
              {d ? <CountUp value={d.totals.total} /> : <Skeleton className="h-8 w-24" />}
            </Stat>
            <Stat label="Active keys" delay={0.06} foot={d ? `${d.total_keys} total · ${d.keys_at_limit} at limit now` : <Skeleton className="h-4 w-32" />}>
              {d ? <CountUp value={d.active_keys} /> : <Skeleton className="h-8 w-16" />}
            </Stat>
            <Stat label="Error rate" delay={0.12} foot={d ? `${fmtNum(d.totals.errors)} errors · ${fmtNum(d.totals.limited)} limited` : <Skeleton className="h-4 w-32" />}>
              {d ? <span className="tabular">{fmtPct(d.error_rate)}</span> : <Skeleton className="h-8 w-20" />}
            </Stat>
            <Stat label="Successful" delay={0.18} foot={d ? `In the ${PERIOD[range]}` : <Skeleton className="h-4 w-28" />}>
              {d ? <CountUp value={d.totals.ok} /> : <Skeleton className="h-8 w-24" />}
            </Stat>
          </div>

          <Reveal>
            <Card>
              <CardHeader title="Requests over time" hint={`All keys · ${PERIOD[range]}`} action={<ChartLegend />} />
              {d ? <UsageChart data={d.series} range={range} /> : <div className="p-6"><Skeleton className="h-[260px] w-full" /></div>}
            </Card>
          </Reveal>

          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
            <Reveal>
              <Card className="h-full">
                <CardHeader title="Top keys" hint="By request volume" action={<Link to="/keys" className="inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-fg">All keys {Icon.arrow}</Link>} />
                {d ? (d.top_keys.length ? <BarList rows={d.top_keys.map((k) => ({ id: String(k.id), label: <>{k.name}</>, value: k.calls, to: `/keys/${k.id}` }))} /> : <p className="px-6 py-10 text-center text-sm text-muted">No traffic yet</p>) : <div className="space-y-2 p-5"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>}
              </Card>
            </Reveal>
            <Reveal delay={0.06}>
              <Card className="h-full">
                <CardHeader title="Top endpoints" hint="Routes your keys call most" />
                {d ? (d.top_endpoints.length ? <BarList rows={d.top_endpoints.map((e) => ({ id: e.method + e.path, label: <span className="font-mono text-[13px]"><span className="text-faint">{e.method}</span> {e.path}</span>, value: e.calls }))} /> : <p className="px-6 py-10 text-center text-sm text-muted">No traffic yet</p>) : <div className="space-y-2 p-5"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>}
              </Card>
            </Reveal>
          </div>
        </motion.div>
      )}
    </>
  );
}
