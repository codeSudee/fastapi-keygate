export type Range = "1h" | "24h" | "7d" | "30d";
export type KeyState = "active" | "expired" | "revoked";

export interface Point { t: string; ok: number; errors: number; limited: number }
export interface Totals { total: number; ok: number; errors: number; limited: number }
export interface RateWindow { window: "minute" | "hour"; limit: number; remaining: number; reset_time: number }

export interface ApiKey {
  id: number;
  prefix: string;
  owner_id: string;
  name: string | null;
  per_minute: number | null;
  per_hour: number | null;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
  scopes: string[];
  state: KeyState;
}
export interface KeyRow extends ApiKey {
  usage: Totals;
  spark: number[];
  last_used: string | null;
  rate: RateWindow[];
}
export interface CreatedKey extends ApiKey { key: string }

export interface Overview {
  range: Range;
  totals: Totals;
  previous_total: number;
  error_rate: number;
  active_keys: number;
  total_keys: number;
  keys_at_limit: number;
  series: Point[];
  top_keys: { id: number; name: string; prefix: string; calls: number }[];
  top_endpoints: { method: string; path: string; calls: number }[];
}
export interface KeysResponse {
  range: Range;
  keys: KeyRow[];
  defaults: Defaults;
}
export interface KeyUsage {
  key: ApiKey;
  range: Range;
  totals: Totals;
  series: Point[];
  by_status: Record<string, number>;
  by_endpoint: { endpoint: string; calls: number }[];
  first_request: string | null;
  last_request: string | null;
  rate: RateWindow[];
}
export interface Defaults { default_per_minute: number | null; default_per_hour: number | null }

export interface PlanInfo {
  id: string; name: string; price: string | null;
  max_keys: number | null; key_per_minute: number | null; key_per_hour: number | null;
  max_scopes: number | null; wildcard_scope: boolean;
}
export interface PlansResponse { enabled: boolean; plans: PlanInfo[]; default: string | null }
