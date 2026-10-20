import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Shell";
import { Button, EASE, Input } from "@/components/ui";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!secret.trim()) { setError("Enter your admin secret to continue."); setShake((n) => n + 1); return; }
    setBusy(true); setError("");
    try {
      await login(secret);
      nav("/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ambient relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" style={{ backgroundImage: "linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px)", backgroundSize: "44px 44px" }} />
      <motion.main
        initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.8, ease: EASE }}
        className="relative w-full max-w-[400px]"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <motion.div initial={{ scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.15 }}>
            <Logo className="size-12 drop-shadow-[0_8px_24px_color-mix(in_srgb,var(--accent)_45%,transparent)]" />
          </motion.div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Sign in to Keygate</h1>
          <p className="mt-2 text-[15px] text-muted">Manage API keys, usage and rate limits.</p>
        </div>

        <motion.form
          key={shake}
          onSubmit={submit}
          animate={shake ? { x: [0, -8, 8, -5, 5, 0] } : undefined}
          transition={{ duration: 0.4 }}
          className="space-y-5 rounded-2xl border border-line bg-panel/90 p-6 shadow-card backdrop-blur"
        >
          <Input
            label="Admin secret" name="secret" type="password" autoComplete="current-password" spellCheck={false}
            placeholder="The admin_secret from KeyGate(…)" value={secret} onChange={(e) => setSecret(e.target.value)}
            error={error} autoFocus
          />
          <Button variant="primary" type="submit" loading={busy} className="h-10 w-full">Sign in</Button>
        </motion.form>
        <p className="mt-6 text-center text-xs text-faint">Your secret is exchanged for a short-lived session token and never stored in the browser.</p>
      </motion.main>
    </div>
  );
}
