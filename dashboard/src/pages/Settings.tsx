import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/Shell";
import { AnimatePresence, motion } from "framer-motion";
import { Button, Card, CardHeader, ErrorState, Icon, Input, Reveal, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/lib/toast";
import { useApi } from "@/lib/useApi";
import type { Defaults } from "@/lib/types";

const parse = (s: string) => (s.trim() === "" ? null : Number(s));
const valid = (s: string) => s.trim() === "" || (Number.isInteger(Number(s)) && Number(s) >= 1);

export default function SettingsPage() {
  const { data, error, reload } = useApi<Defaults>("/settings");
  const toast = useToast();
  const { logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [pm, setPm] = useState("");
  const [ph, setPh] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) { setPm(String(data.default_per_minute ?? "")); setPh(String(data.default_per_hour ?? "")); }
  }, [data]);

  const dirty = !!data && (parse(pm) !== data.default_per_minute || parse(ph) !== data.default_per_hour);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const errs = { pm: valid(pm) ? "" : "Enter a whole number, or leave empty for unlimited.", ph: valid(ph) ? "" : "Enter a whole number, or leave empty for unlimited." };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (errs.pm || errs.ph || !dirty) return;
    setBusy(true);
    try {
      await api("/settings", { method: "PUT", json: { default_per_minute: parse(pm), default_per_hour: parse(ph) } });
      toast("success", "Default limits updated");
      setSaved(true); setTimeout(() => setSaved(false), 1800);
      reload();
    } catch (err) { toast("error", (err as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Defaults and preferences for your dashboard." />
      <div className="max-w-2xl space-y-4 sm:space-y-5">
        <Reveal>
          <Card>
            <CardHeader title="Default rate limits" hint="Applied to new keys that don't set their own limits." />
            {error && !data ? <ErrorState message={error.message} onRetry={reload} /> : !data ? (
              <div className="space-y-4 p-6"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
            ) : (
              <form onSubmit={save} noValidate>
                <div className="grid gap-4 px-5 pb-2 pt-5 sm:grid-cols-2 sm:px-6">
                  <Input label="Requests per minute" inputMode="numeric" placeholder="Unlimited" value={pm} onChange={(e) => setPm(e.target.value)} error={errs.pm} autoComplete="off" />
                  <Input label="Requests per hour" inputMode="numeric" placeholder="Unlimited" value={ph} onChange={(e) => setPh(e.target.value)} error={errs.ph} autoComplete="off" />
                </div>
                <p className="px-5 pb-5 pt-2 text-xs leading-relaxed text-faint sm:px-6">
                  Existing keys keep their current limits; edit a key to change it. These defaults live in the running server and reset on restart. To make them permanent, set <code className="font-mono">default_per_minute</code> in <code className="font-mono">KeyGate(…)</code>.
                </p>
                <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-4 sm:px-6">
                  <span role="status" className="mr-auto text-[13px] text-muted">
                    <AnimatePresence initial={false}>
                      {dirty && <motion.span key="d" className="inline-block" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>Unsaved changes</motion.span>}
                    </AnimatePresence>
                  </span>
                  <Button type="submit" variant="primary" loading={busy} disabled={!dirty && !saved}>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span key={saved ? "s" : "n"} className="inline-flex items-center gap-1.5" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
                        {saved ? <>{Icon.check} Saved</> : "Save changes"}
                      </motion.span>
                    </AnimatePresence>
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </Reveal>

        <Reveal delay={0.05}>
          <Card>
            <CardHeader title="Appearance" />
            <div className="flex items-center justify-between gap-4 px-5 pb-6 pt-4 sm:px-6">
              <div><p className="text-sm font-medium">Theme</p><p className="text-[13px] text-muted">Currently using {dark ? "dark" : "light"} mode.</p></div>
              <Button onClick={toggle}>Switch to {dark ? "light" : "dark"}</Button>
            </div>
          </Card>
        </Reveal>

        <Reveal delay={0.1}>
          <Card>
            <CardHeader title="Session" />
            <div className="flex items-center justify-between gap-4 px-5 pb-6 pt-4 sm:px-6">
              <p className="text-[13px] text-muted">Sessions end automatically after 12 hours.</p>
              <Button onClick={logout}>Sign out</Button>
            </div>
          </Card>
        </Reveal>
      </div>
    </>
  );
}
