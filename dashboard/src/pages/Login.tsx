import { useState, type FormEvent } from "react";
import { motion, type Variants } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Shell";
import { Badge, Button, EASE, Input } from "@/components/ui";

const FEATURES = [
  { title: "Generate and manage keys", body: "Each key is shown once, then stored hashed. Name it, scope it, set an expiry." },
  { title: "Usage per key", body: "Requests over time, split by status and endpoint, for every key." },
  { title: "Live rate-limit status", body: "See how much quota is left, and edit per-minute and per-hour limits." },
  { title: "Rotate or revoke", body: "Rotate with a 24-hour grace period, or revoke a key immediately." },
];

const list: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } } };
const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

/** Static illustration of a key row, built from the real UI's look. Values are made up. */
function ExampleKey() {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5 shadow-card" aria-hidden>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-faint">Example</span>
        <Badge dot tone="ok">Active</Badge>
      </div>
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium">Production</p>
          <p className="mt-1 font-mono text-xs text-faint">kg_8f45fd65…</p>
        </div>
        <svg viewBox="0 0 100 28" className="h-8 w-28 shrink-0 overflow-visible">
          <motion.path
            d="M0 22 L10 17 L20 20 L30 10 L40 14 L50 7 L60 13 L70 5 L80 10 L90 3 L100 8"
            fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: EASE, delay: 0.7 }}
          />
        </svg>
      </div>
      <div className="mt-5">
        <div className="mb-1.5 flex justify-between text-[13px]">
          <span className="text-muted">Per minute</span>
          <span className="tabular text-fg">388 <span className="text-faint">/ 600 left</span></span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-raised">
          <motion.div
            className="h-full w-full rounded-full bg-accent" style={{ originX: 0 }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 0.35 }} transition={{ duration: 1.1, ease: EASE, delay: 0.8 }}
          />
        </div>
      </div>
    </div>
  );
}

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
    <div className="ambient relative min-h-dvh overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" style={{ backgroundImage: "linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px)", backgroundSize: "44px 44px" }} />

      <div className="relative mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-12 px-4 py-10 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:px-10">
        {/* Sign-in: first on phones and tablets, right column on desktop */}
        <motion.main
          initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.8, ease: EASE }}
          className="order-1 mx-auto w-full max-w-[400px] lg:order-2 lg:max-w-[420px]"
        >
          <div className="mb-8 flex flex-col items-center text-center">
            <motion.div initial={{ scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.15 }}>
              <Logo className="size-12 drop-shadow-[0_8px_24px_color-mix(in_srgb,var(--accent)_45%,transparent)]" />
            </motion.div>
            <h1 className="mt-6 text-balance text-2xl font-semibold tracking-tight">Sign in to Keygate</h1>
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

        {/* What Keygate is */}
        <motion.section variants={list} initial="hidden" animate="show" aria-labelledby="about-title" className="order-2 mx-auto w-full max-w-[520px] pb-6 lg:order-1 lg:mx-0 lg:max-w-none lg:pb-0">
          <motion.div variants={item} className="mb-8 hidden items-center gap-2.5 lg:flex">
            <Logo className="size-7" />
            <span className="text-[15px] font-semibold tracking-tight">Keygate</span>
          </motion.div>

          <motion.h2 variants={item} id="about-title" className="text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl lg:text-[44px]">
            API keys, rate limits and usage for your FastAPI app.
          </motion.h2>
          <motion.p variants={item} className="mt-4 max-w-lg text-pretty text-base leading-relaxed text-muted">
            Keygate adds API-key authentication, per-key rate limiting and usage tracking to FastAPI. This dashboard is where you manage all of it.
          </motion.p>

          <ul className="mt-9 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <motion.li key={f.title} variants={item} className="flex gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent" aria-hidden>
                  <svg viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
                </span>
                <div>
                  <h3 className="text-sm font-medium">{f.title}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{f.body}</p>
                </div>
              </motion.li>
            ))}
          </ul>

          <motion.div variants={item} className="mt-10 hidden max-w-sm sm:block">
            <ExampleKey />
          </motion.div>
        </motion.section>
      </div>
    </div>
  );
}
