import { motion } from "framer-motion";
import { Link, useLocation, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { ChartLegend, RateMeter, UsageChart } from "@/components/charts";
import { useKeyManager } from "@/components/KeyManager";
import { Badge, Button, Card, CardHeader, CountUp, EASE, ErrorState, Icon, Reveal, Segmented, Skeleton, StateBadge } from "@/components/ui";
import { fmtAgo, fmtDate, fmtNum, fmtPct, fmtUntil, keyLabel, limitText } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { KeyUsage, Range } from "@/lib/types";
import { useUrlParam } from "@/lib/useUrlParam";
import { RANGES } from "./Overview";

const RANGE_VALUES = RANGES.map((r) => r.value);

const statusTone = (c: string) => (c.startsWith("2") ? "var(--ok)" : c === "429" ? "var(--warn)" : c.startsWith("4") || c.startsWith("5") ? "var(--bad)" : "var(--muted)");

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1 truncate text-sm">{children}</dd>
    </div>
  );
}

export default function KeyDetail() {
  const { id } = useParams();
  const fromList = (useLocation().state as { label?: string } | null)?.label;
  const [range, setRange] = useUrlParam<Range>("range", "24h", RANGE_VALUES);
  const { data: d, error, loading, reload } = useApi<KeyUsage>(`/keys/${id}/usage?range=${range}`, { refreshMs: 15_000 });
  const mgr = useKeyManager({ onChange: reload });
  const k = d?.key;
  const live = k?.state === "active";
  const statusTotal = d ? Object.values(d.by_status).reduce((a, b) => a + b, 0) : 0;
  const endpointMax = d ? Math.max(...d.by_endpoint.map((e) => e.calls), 1) : 1;

  return (
    <>
      <PageHeader
        back={<Link to="/keys" className="-ml-1 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-fg">{Icon.back} API keys</Link>}
        title={k ? keyLabel(k) : fromList ?? "Loading…"}
        titleLayoutId={`key-title-${id}`}
        subtitle={k && <span className="inline-flex flex-wrap items-center gap-2"><span className="font-mono text-sm">kg_{k.prefix}…</span><StateBadge state={k.state} /></span>}
        actions={k && (
          <>
            <Segmented label="Time range" value={range} onChange={setRange} options={RANGES} />
            {live && <Button onClick={() => mgr.edit(k)}>Edit</Button>}
            {live && <Button onClick={() => mgr.rotate(k)}>Rotate</Button>}
            {k.state !== "revoked" && <Button variant="danger" onClick={() => mgr.revoke(k)}>Revoke</Button>}
          </>
        )}
      />

      {error && !d ? (
        <Card><ErrorState message={error.status === 404 ? "This key doesn't exist." : error.message} onRetry={reload} /></Card>
      ) : (
        <motion.div animate={{ opacity: loading && d ? 0.55 : 1 }} className="space-y-4 sm:space-y-5">
          <div className="grid gap-4 sm:grid-cols-3 sm:gap-5">
            {[
              { label: "Requests", node: d && <CountUp value={d.totals.total} /> },
              { label: "Success rate", node: d && <span className="tabular">{d.totals.total ? fmtPct(d.totals.ok / d.totals.total) : "—"}</span> },
              { label: "Rate limited", node: d && <CountUp value={d.totals.limited} /> },
            ].map((s, i) => (
              <Reveal key={s.label} delay={i * 0.06}>
                <Card className="p-5 sm:p-6"><p className="text-[13px] text-muted">{s.label}</p><p className="mt-2 text-[32px] font-semibold leading-none tracking-tight">{s.node ?? <Skeleton className="h-8 w-24" />}</p></Card>
              </Reveal>
            ))}
          </div>

          <Reveal>
            <Card>
              <CardHeader title="Requests over time" action={<ChartLegend />} />
              {d ? <UsageChart data={d.series} range={range} height={260} /> : <div className="p-6"><Skeleton className="h-[240px]" /></div>}
            </Card>
          </Reveal>

          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
            <Reveal>
              <Card className="h-full">
                <CardHeader title="Rate limit status" hint="Live quota remaining for this key" />
                <div className="px-5 pb-6 pt-5 sm:px-6">
                  {!d ? <Skeleton className="h-16" /> : live ? <RateMeter rate={d.rate} /> : <p className="text-sm text-muted">Limits don't apply to a {k?.state} key.</p>}
                </div>
              </Card>
            </Reveal>
            <Reveal delay={0.06}>
              <Card className="h-full">
                <CardHeader title="Details" />
                <dl className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 pb-6 pt-5 sm:px-6">
                  {k ? (
                    <>
                      <Meta label="Owner"><span className="font-mono">{k.owner_id}</span></Meta>
                      <Meta label="Created">{fmtDate(k.created_at)}</Meta>
                      <Meta label="Limits">{limitText(k.per_minute, "min")}{k.per_hour ? ` · ${limitText(k.per_hour, "hr")}` : ""}</Meta>
                      <Meta label="Last request">{fmtAgo(d?.last_request ?? null)}</Meta>
                      <Meta label="Expiry">{k.revoked_at ? `Revoked ${fmtDate(k.revoked_at)}` : fmtUntil(k.expires_at)}</Meta>
                      <Meta label="Scopes">{k.scopes.length ? <span className="flex flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s}>{s}</Badge>)}</span> : <span className="text-faint">None</span>}</Meta>
                    </>
                  ) : <Skeleton className="col-span-2 h-24" />}
                </dl>
              </Card>
            </Reveal>
          </div>

          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
            <Reveal>
              <Card className="h-full">
                <CardHeader title="Response codes" hint="Selected period" />
                <ul className="space-y-3.5 px-5 pb-6 pt-5 sm:px-6">
                  {d && Object.entries(d.by_status).length === 0 && <li className="text-sm text-muted">No requests yet</li>}
                  {d && Object.entries(d.by_status).map(([code, n]) => (
                    <li key={code}>
                      <div className="mb-1.5 flex justify-between text-[13px]"><span className="font-mono">{code}</span><span className="tabular text-muted">{fmtNum(n)}</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                        <motion.div className="h-full rounded-full" style={{ background: statusTone(code), originX: 0 }} initial={{ scaleX: 0 }} whileInView={{ scaleX: n / statusTotal }} viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </Reveal>
            <Reveal delay={0.06}>
              <Card className="h-full">
                <CardHeader title="Endpoints" hint="Most requested routes" />
                <ul className="space-y-1 px-3 pb-4 pt-4 sm:px-4">
                  {d && d.by_endpoint.length === 0 && <li className="px-3 py-2 text-sm text-muted">No requests yet</li>}
                  {d?.by_endpoint.map((e, i) => (
                    <li key={e.endpoint} className="relative flex h-10 items-center justify-between gap-4 rounded-lg px-3">
                      <motion.span aria-hidden className="absolute inset-y-0 left-0 rounded-lg bg-[color-mix(in_srgb,var(--accent)_13%,transparent)]" style={{ originX: 0 }} initial={{ scaleX: 0 }} whileInView={{ scaleX: e.calls / endpointMax }} viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE, delay: i * 0.05 }} />
                      <span className="relative min-w-0 truncate font-mono text-[13px]">{e.endpoint}</span>
                      <span className="tabular relative text-sm text-muted">{fmtNum(e.calls)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </Reveal>
          </div>
        </motion.div>
      )}
      {mgr.dialogs}
    </>
  );
}
