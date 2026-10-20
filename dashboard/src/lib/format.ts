const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en");

export const fmtCompact = (n: number) => (n < 10_000 ? full.format(n) : compact.format(n));
export const fmtNum = (n: number) => full.format(n);
export const fmtPct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.01 ? 2 : 1)}%`;

export function fmtDelta(cur: number, prev: number): { text: string; dir: "up" | "down" | "flat" } {
  if (!prev) return cur ? { text: "New", dir: "up" } : { text: "No change", dir: "flat" };
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.005) return { text: "No change", dir: "flat" };
  return { text: `${d > 0 ? "+" : ""}${(d * 100).toFixed(Math.abs(d) < 0.1 ? 1 : 0)}%`, dir: d > 0 ? "up" : "down" };
}

export function fmtAgo(iso: string | null): string {
  if (!iso) return "Never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "Just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return fmtDate(iso);
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });

export function fmtUntil(iso: string | null): string {
  if (!iso) return "Never expires";
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s <= 0) return "Expired";
  if (s < 3600) return `Expires in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `Expires in ${Math.round(s / 3600)}h`;
  return `Expires in ${Math.round(s / 86400)}d`;
}

export function fmtTick(iso: string, range: string): string {
  const d = new Date(iso);
  if (range === "1h" || range === "24h") return d.toLocaleTimeString("en", { hour: "numeric", minute: range === "1h" ? "2-digit" : undefined });
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function fmtTooltipTime(iso: string, range: string): string {
  const d = new Date(iso);
  return range === "30d"
    ? d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })
    : d.toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: range === "1h" ? "2-digit" : undefined });
}

export const keyLabel = (k: { name: string | null; prefix: string }) => k.name || `kg_${k.prefix}`;
export const limitText = (v: number | null, unit: string) => (v ? `${fmtNum(v)}/${unit}` : "Unlimited");
