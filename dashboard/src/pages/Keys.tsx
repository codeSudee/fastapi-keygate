import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Sparkline, RateMeter } from "@/components/charts";
import { useKeyManager } from "@/components/KeyManager";
import { Badge, Button, Card, EASE, EmptyState, ErrorState, Icon, Reveal, Segmented, Skeleton, StateBadge } from "@/components/ui";
import { fmtAgo, fmtCompact, fmtUntil, keyLabel, limitText } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import type { KeyRow, KeysResponse, Range } from "@/lib/types";
import { useUrlParam } from "@/lib/useUrlParam";
import { RANGES } from "./Overview";

const RANGE_VALUES = RANGES.map((r) => r.value);
const FILTER_VALUES = ["active", "all"] as const;

export function RowMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean; hidden?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button aria-label="Key actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg">{Icon.more}</button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu" initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }} transition={{ duration: 0.16, ease: EASE }}
            className="absolute right-0 top-full z-20 mt-1 min-w-40 origin-top-right rounded-xl border border-line-strong bg-raised p-1 shadow-pop"
          >
            {items.filter((i) => !i.hidden).map((i) => (
              <button key={i.label} role="menuitem" onClick={() => { setOpen(false); i.onClick(); }} className={`flex h-8 w-full items-center rounded-lg px-2.5 text-left text-[13px] transition-colors hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] ${i.danger ? "text-bad" : ""}`}>{i.label}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const COLS = "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_2rem]";

function Row({ k, range, onOpen, mgr }: { k: KeyRow; range: Range; onOpen: () => void; mgr: ReturnType<typeof useKeyManager> }) {
  const live = k.state === "active";
  return (
    <motion.li layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
      <div
        onClick={onOpen}
        className={`grid cursor-pointer items-center gap-x-6 gap-y-3 px-5 py-4 transition-colors hover:bg-raised/50 sm:px-6 ${COLS} ${live ? "" : "opacity-60"}`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Link to={`/keys/${k.id}`} onClick={(e) => e.stopPropagation()} className="truncate text-sm font-medium hover:underline">{keyLabel(k)}</Link>
            <StateBadge state={k.state} />
          </div>
          <p className="mt-1 truncate font-mono text-xs text-faint">kg_{k.prefix}…  <span className="font-sans">· {k.owner_id}</span></p>
          {k.scopes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">{k.scopes.slice(0, 3).map((s) => <Badge key={s}>{s}</Badge>)}{k.scopes.length > 3 && <Badge>+{k.scopes.length - 3}</Badge>}</div>
          )}
        </div>

        <div className="min-w-0">
          <p className="tabular text-sm"><span className="font-medium">{fmtCompact(k.usage.total)}</span> <span className="text-muted">calls</span></p>
          <div className="mt-1 w-full max-w-36"><Sparkline values={k.spark} /></div>
        </div>

        <div className="min-w-0">
          {live ? <RateMeter rate={k.rate} compact /> : <p className="text-sm text-faint">{limitText(k.per_minute, "min")}</p>}
          {!live && <p className="mt-0.5 text-xs text-faint">{k.state === "revoked" ? "Revoked" : "Expired"}</p>}
        </div>

        <div className="hidden text-sm lg:block">
          <p className="text-muted">{fmtAgo(k.last_used)}</p>
          {live && k.expires_at && <p className="mt-0.5 text-xs text-warn">{fmtUntil(k.expires_at)}</p>}
        </div>

        <div className="justify-self-end">
          <RowMenu items={[
            { label: "View usage", onClick: onOpen },
            { label: "Edit", onClick: () => mgr.edit(k), hidden: !live },
            { label: "Rotate", onClick: () => mgr.rotate(k), hidden: !live },
            { label: "Revoke", onClick: () => mgr.revoke(k), danger: true, hidden: k.state === "revoked" },
          ]} />
        </div>
      </div>
      <span className="sr-only">{range}</span>
    </motion.li>
  );
}

export default function Keys() {
  const nav = useNavigate();
  const [range, setRange] = useUrlParam<Range>("range", "7d", RANGE_VALUES);
  const [filter, setFilter] = useUrlParam<"active" | "all">("filter", "active", FILTER_VALUES);
  const { data, error, loading, reload } = useApi<KeysResponse>(`/keys?range=${range}`, { refreshMs: 30_000 });
  const mgr = useKeyManager({ onChange: reload, defaults: data?.defaults });

  const keys = data?.keys.filter((k) => filter === "all" || k.state !== "revoked") ?? [];

  return (
    <>
      <PageHeader
        title="API keys"
        subtitle="Create, monitor and revoke the keys your customers use."
        actions={<Button variant="primary" onClick={mgr.create}>{Icon.plus} Generate key</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Key filter" value={filter} onChange={setFilter} options={[{ value: "active", label: "Active" }, { value: "all", label: "All keys" }]} />
        <div className="flex items-center gap-2.5 text-[13px] text-muted">
          Usage
          <Segmented label="Usage period" value={range} onChange={setRange} options={RANGES} />
        </div>
      </div>

      <Reveal>
        <Card className="overflow-hidden">
          <div className={`hidden gap-x-6 border-b border-line px-6 py-3 text-xs font-medium text-faint md:grid ${COLS}`}>
            <span>Key</span><span>Requests</span><span>Rate limit</span><span className="hidden lg:block">Last used</span><span />
          </div>

          {error && !data ? <ErrorState message={error.message} onRetry={reload} /> : !data ? (
            <div className="divide-y divide-line">{[0, 1, 2, 3].map((i) => <div key={i} className="flex items-center gap-6 px-6 py-5"><div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-28" /></div><Skeleton className="hidden h-8 w-32 md:block" /><Skeleton className="hidden h-8 w-32 md:block" /></div>)}</div>
          ) : keys.length === 0 ? (
            <EmptyState icon={Icon.key} title={filter === "active" ? "No active keys" : "No keys yet"} body="Generate a key to start authenticating requests to your API." action={<Button variant="primary" onClick={mgr.create}>{Icon.plus} Generate key</Button>} />
          ) : (
            <motion.ul animate={{ opacity: loading ? 0.6 : 1 }} className="divide-y divide-line">
              <AnimatePresence initial={false}>
                {keys.map((k) => <Row key={k.id} k={k} range={range} mgr={mgr} onOpen={() => nav(`/keys/${k.id}`)} />)}
              </AnimatePresence>
            </motion.ul>
          )}
        </Card>
      </Reveal>
      {mgr.dialogs}
    </>
  );
}
