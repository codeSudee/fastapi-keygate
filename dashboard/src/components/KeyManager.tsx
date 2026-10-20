import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { keyLabel } from "@/lib/format";
import type { ApiKey, CreatedKey, Defaults } from "@/lib/types";
import { Badge, Button, ConfirmDialog, Drawer, Icon, Input, Modal } from "./ui";

const EXPIRY = [
  { v: "never", label: "Never expires", days: 0 },
  { v: "7", label: "In 7 days", days: 7 },
  { v: "30", label: "In 30 days", days: 30 },
  { v: "90", label: "In 90 days", days: 90 },
  { v: "365", label: "In 1 year", days: 365 },
];
const naiveUtc = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 19);
const parseLimit = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const parseScopes = (s: string) => [...new Set(s.split(/[\s,]+/).filter(Boolean))];

interface FormValues { owner_id: string; name: string; per_minute: number | null; per_hour: number | null; scopes: string[]; expiry: string }

function KeyForm({ initial, defaults, onSubmit, onCancel, busy, error }: {
  initial?: ApiKey; defaults?: Defaults; busy: boolean; error: string;
  onSubmit: (v: FormValues) => void; onCancel: () => void;
}) {
  const edit = !!initial;
  const [owner, setOwner] = useState(initial?.owner_id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [pm, setPm] = useState(String((initial ? initial.per_minute : defaults?.default_per_minute) ?? ""));
  const [ph, setPh] = useState(String((initial ? initial.per_hour : defaults?.default_per_hour) ?? ""));
  const [scopes, setScopes] = useState(initial?.scopes.join(" ") ?? "");
  const [expiry, setExpiry] = useState(edit ? "keep" : "never");
  const [errs, setErrs] = useState<Record<string, string>>({});

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const next: Record<string, string> = {};
    if (!edit && !owner.trim()) next.owner = "Who is this key for? Use a tenant or user ID.";
    for (const [k, v] of [["pm", pm], ["ph", ph]] as const) {
      if (v.trim() !== "" && (!Number.isInteger(Number(v)) || Number(v) < 1)) next[k] = "Enter a whole number, or leave empty for unlimited.";
    }
    setErrs(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => form.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    onSubmit({ owner_id: owner.trim(), name: name.trim(), per_minute: parseLimit(pm), per_hour: parseLimit(ph), scopes: parseScopes(scopes), expiry });
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col" noValidate>
      <div className="flex-1 space-y-5 px-5 py-5 sm:px-6">
        <Input label="Name" placeholder="Production" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} autoComplete="off" hint="A label so you can recognise this key later." data-autofocus />
        {edit ? (
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">Owner</p>
            <p className="font-mono text-sm text-muted">{initial.owner_id}</p>
          </div>
        ) : (
          <Input label="Owner ID" placeholder="acme-corp" value={owner} onChange={(e) => setOwner(e.target.value)} error={errs.owner} maxLength={255} autoComplete="off" spellCheck={false} hint="Your tenant or user this key belongs to." />
        )}
        <div className="grid grid-cols-2 gap-4">
          <Input label="Per minute" inputMode="numeric" placeholder="Unlimited" value={pm} onChange={(e) => setPm(e.target.value)} error={errs.pm} autoComplete="off" />
          <Input label="Per hour" inputMode="numeric" placeholder="Unlimited" value={ph} onChange={(e) => setPh(e.target.value)} error={errs.ph} autoComplete="off" />
        </div>
        <p className="-mt-3 text-xs text-faint">Requests allowed in a rolling window. Leave empty for unlimited.</p>
        <Input label="Scopes" placeholder="read write" value={scopes} onChange={(e) => setScopes(e.target.value)} autoComplete="off" spellCheck={false} hint="Space-separated. Use * to grant every scope." />
        <div className="space-y-1.5">
          <label htmlFor="expiry" className="block text-[13px] font-medium">Expiry</label>
          <select id="expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg transition-[border-color,box-shadow] hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)]">
            {edit && <option value="keep">{initial.expires_at ? `Keep current (${new Date(initial.expires_at).toLocaleDateString()})` : "Keep current (never)"}</option>}
            {EXPIRY.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-panel px-5 py-4 sm:px-6">
        <Button type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>{edit ? "Save changes" : "Generate key"}</Button>
      </div>
    </form>
  );
}

function SecretReveal({ created, onClose, title }: { created: CreatedKey | null; onClose: () => void; title: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.key); } catch {
      const t = document.createElement("textarea"); t.value = created.key; document.body.append(t); t.select(); document.execCommand("copy"); t.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Modal open={!!created} onClose={onClose} title={title} wide>
      {created && (
        <div className="space-y-5 px-5 py-5 sm:px-6">
          <div className="flex gap-3 rounded-xl border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] p-3.5 text-[13px] leading-relaxed">
            <span className="mt-0.5 text-warn">{Icon.alert}</span>
            <p>Copy this key now. For security it is stored hashed and <strong className="font-medium">can't be shown again</strong>.</p>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium">{keyLabel(created)}</p>
            <div className="flex items-stretch gap-2">
              <code data-autofocus tabIndex={0} className="min-w-0 flex-1 select-all break-all rounded-lg border border-line bg-bg px-3 py-2.5 font-mono text-[13px] leading-relaxed">{created.key}</code>
              <Button onClick={copy} className="h-auto min-w-24 shrink-0" aria-live="polite">
                <motion.span key={String(copied)} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="inline-flex items-center gap-1.5">
                  {copied ? <>{Icon.check} Copied</> : <>{Icon.copy} Copy</>}
                </motion.span>
              </Button>
            </div>
          </div>
          <div className="flex justify-end"><Button variant="primary" onClick={onClose}>I've saved it</Button></div>
        </div>
      )}
    </Modal>
  );
}

export function useKeyManager({ onChange, defaults }: { onChange: () => void; defaults?: Defaults }) {
  const toast = useToast();
  const [form, setForm] = useState<{ mode: "create" } | { mode: "edit"; key: ApiKey } | null>(null);
  const [rotating, setRotating] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [reveal, setReveal] = useState<{ key: CreatedKey; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const closeForm = useCallback(() => { setForm(null); setError(""); }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); toast("error", (e as Error).message); } finally { setBusy(false); }
  };

  const submit = (v: FormValues) => run(async () => {
    const exp = EXPIRY.find((o) => o.v === v.expiry);
    const expires_at = v.expiry === "keep" ? undefined : exp && exp.days ? naiveUtc(exp.days) : null;
    if (form?.mode === "edit") {
      await api(`/keys/${form.key.id}`, { method: "PATCH", json: { name: v.name || null, per_minute: v.per_minute, per_hour: v.per_hour, scopes: v.scopes, ...(expires_at !== undefined && { expires_at }) } });
      toast("success", "Changes saved");
      closeForm();
    } else {
      const created = await api<CreatedKey>("/keys", { method: "POST", json: { owner_id: v.owner_id, name: v.name || null, per_minute: v.per_minute, per_hour: v.per_hour, scopes: v.scopes, expires_at } });
      closeForm();
      setReveal({ key: created, title: "Your new API key" });
    }
    onChange();
  });

  const dialogs: ReactNode = (
    <>
      <Modal open={form?.mode === "create"} onClose={closeForm} title="Generate API key">
        {form?.mode === "create" && <KeyForm defaults={defaults} busy={busy} error={error} onSubmit={submit} onCancel={closeForm} />}
      </Modal>
      <Drawer open={form?.mode === "edit"} onClose={closeForm} title="Edit key">
        {form?.mode === "edit" && <KeyForm key={form.key.id} initial={form.key} busy={busy} error={error} onSubmit={submit} onCancel={closeForm} />}
      </Drawer>
      <ConfirmDialog
        open={!!rotating} onClose={() => setRotating(null)} loading={busy} confirm="Rotate key" title="Rotate this key?"
        body={<>A replacement for <strong className="font-medium text-fg">{rotating && keyLabel(rotating)}</strong> will be issued with the same limits and scopes. The current key keeps working for <Badge>24 hours</Badge> so you can switch over.</>}
        onConfirm={() => run(async () => {
          const created = await api<CreatedKey>(`/keys/${rotating!.id}/rotate`, { method: "POST" });
          setRotating(null); setReveal({ key: created, title: "Your replacement key" }); onChange();
        })}
      />
      <ConfirmDialog
        open={!!revoking} onClose={() => setRevoking(null)} loading={busy} confirm="Revoke key" title="Revoke this key?"
        body={<>Requests using <strong className="font-medium text-fg">{revoking && keyLabel(revoking)}</strong> will fail immediately with a 401. This can't be undone.</>}
        onConfirm={() => run(async () => {
          await api(`/keys/${revoking!.id}`, { method: "DELETE" });
          toast("success", `${keyLabel(revoking!)} revoked`); setRevoking(null); onChange();
        })}
      />
      <SecretReveal created={reveal?.key ?? null} title={reveal?.title ?? ""} onClose={() => setReveal(null)} />
    </>
  );

  return {
    dialogs,
    create: () => setForm({ mode: "create" }),
    edit: (key: ApiKey) => setForm({ mode: "edit", key }),
    rotate: setRotating,
    revoke: setRevoking,
  };
}
