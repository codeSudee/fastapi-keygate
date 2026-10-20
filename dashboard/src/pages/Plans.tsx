import { Navigate } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { motion } from "framer-motion";
import { Badge, Card, EASE, ErrorState, Reveal, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import type { PlanInfo, PlansResponse } from "@/lib/types";

const n = (v: number | null, unit = "") => (v === null ? "Unlimited" : `${v.toLocaleString()}${unit}`);

const ROWS: { label: string; value: (p: PlanInfo) => string }[] = [
  { label: "Active keys", value: (p) => n(p.max_keys) },
  { label: "Per-key limit, per minute", value: (p) => n(p.key_per_minute) },
  { label: "Per-key limit, per hour", value: (p) => n(p.key_per_hour) },
  { label: "Scopes per key", value: (p) => n(p.max_scopes) },
  { label: "Wildcard (*) scope", value: (p) => (p.wildcard_scope ? "Included" : "Not included") },
];

export default function PlansPage() {
  const { data, error, reload } = useApi<PlansResponse>("/plans");

  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (data && !data.enabled) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <PageHeader title="Plans" subtitle="What each plan allows. Limits are applied to every key an owner has." />
      {!data ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <Reveal>
          <div className="grid gap-4 md:grid-cols-3">
            {data.plans.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE, delay: 0.08 + i * 0.07 }}>
              <Card lift className="flex h-full flex-col p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">{p.name}</h2>
                  {p.id === data.default && <Badge>Default</Badge>}
                </div>
                <p className="mt-3 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight tabular">{p.price ?? "—"}</span>
                  {p.price && p.price !== "$0" && <span className="text-sm text-muted">per month</span>}
                </p>
                <dl className="mt-5 space-y-3 border-t border-line pt-5 text-sm">
                  {ROWS.map((r) => (
                    <div key={r.label} className="flex justify-between gap-4">
                      <dt className="text-muted">{r.label}</dt>
                      <dd className="tabular text-right">{r.value(p)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
              </motion.div>
            ))}
          </div>
          <p className="mt-4 text-[13px] text-muted">
            Prices are shown for reference. Billing isn't connected yet, so plans are assigned by an admin rather than purchased here.
            Rotation, expiry and revoke are available on every plan.
          </p>
        </Reveal>
      )}
    </div>
  );
}
