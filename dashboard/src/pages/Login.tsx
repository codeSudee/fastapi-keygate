import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useAnimationControls, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, type Variants } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Shell";
import { Badge, Button, EASE, Input, Magnetic } from "@/components/ui";

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

const check: Variants = {
  hidden: { pathLength: 0 },
  show: { pathLength: 1, transition: { duration: 0.55, ease: EASE, delay: 0.35 } },
};

/** Slow drifting glows behind the layout. Transform-only, gradient (no blur filter), off when reduced motion is on. */
function Orbs() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  const orb = "pointer-events-none absolute rounded-full will-change-transform";
  const bg = (pos: string) => `radial-gradient(circle at ${pos}, color-mix(in srgb, var(--accent) 10%, transparent), transparent 65%)`;
  return (
    <>
      <motion.div aria-hidden className={`${orb} -left-40 -top-40 size-[520px]`} style={{ background: bg("50% 50%") }}
        animate={{ x: [0, 90, 20, 0], y: [0, 50, 110, 0] }} transition={{ duration: 28, ease: "easeInOut", repeat: Infinity }} />
      <motion.div aria-hidden className={`${orb} -bottom-48 -right-32 size-[600px]`} style={{ background: bg("50% 50%") }}
        animate={{ x: [0, -80, -20, 0], y: [0, -70, -20, 0] }} transition={{ duration: 34, ease: "easeInOut", repeat: Infinity }} />
    </>
  );
}

const DEMO_LIMIT = 5;
type Hit = { id: number; ok: boolean };

/** Interactive illustration of a key hitting its rate limit. Nothing is sent anywhere. */
function ExampleKey() {
  const [hits, setHits] = useState<Hit[]>([]);
  const [n, setN] = useState(0);
  const [okCount, setOkCount] = useState(0);
  const press = () => {
    const ok = okCount < DEMO_LIMIT;
    setHits((h) => [...h, { id: n, ok }].slice(-12));
    setN((v) => v + 1);
    if (ok) setOkCount((c) => c + 1);
  };
  const reset = () => { setHits([]); setOkCount(0); };
  const full = okCount >= DEMO_LIMIT;
  const left = DEMO_LIMIT - okCount;
  const last = hits[hits.length - 1];
  const pct = okCount / DEMO_LIMIT;
  const blocked = last && !last.ok;
  const reduce = useReducedMotion();
  const rx = useSpring(0, { stiffness: 200, damping: 20 });
  const ry = useSpring(0, { stiffness: 200, damping: 20 });

  return (
    <motion.div
      className="rounded-2xl border border-line bg-panel p-5 shadow-card"
      style={reduce ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        ry.set(((e.clientX - r.left) / r.width - 0.5) * 6);
        rx.set(-((e.clientY - r.top) / r.height - 0.5) * 6);
      }}
      onPointerLeave={() => { rx.set(0); ry.set(0); }}
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-faint">Interactive example</span>
        <Badge dot tone={full ? "warn" : "ok"}>{full ? "At limit" : "Active"}</Badge>
      </div>

      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium">Production</p>
          <p className="mt-1 font-mono text-xs text-faint">kg_8f45fd65… · 5 per minute</p>
        </div>
        <div className="flex h-8 items-end gap-1" aria-hidden>
          {Array.from({ length: 12 }, (_, i) => {
            const h = hits[hits.length - 12 + i];
            return (
              <motion.span
                key={h ? h.id : `e${i}`}
                initial={h ? { scaleY: 0.2, opacity: 0 } : false}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                className="h-full w-1.5 origin-bottom rounded-sm"
                style={{ background: h ? (h.ok ? "var(--accent)" : "var(--warn)") : "var(--raised)" }}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-1.5 flex justify-between text-[13px]">
          <span className="text-muted">Per minute</span>
          <span className="tabular text-fg">{left} <span className="text-faint">/ {DEMO_LIMIT} left</span></span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-raised">
          <motion.div
            className="h-full w-full rounded-full" style={{ originX: 0, background: full ? "var(--bad)" : "var(--accent)" }}
            animate={{ scaleX: pct }} transition={{ type: "spring", stiffness: 220, damping: 26 }}
          />
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <p className="font-mono text-xs" role="status" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={last ? last.id : "idle"}
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
              className={`inline-block ${blocked ? "text-warn" : last ? "text-ok" : "text-faint"}`}
            >
              {!last ? "GET /hello" : blocked ? "GET /hello → 429 Too Many Requests" : "GET /hello → 200 OK"}
            </motion.span>
          </AnimatePresence>
        </p>
        <div className="flex justify-end gap-2">
          {hits.length > 0 && <Button size="sm" variant="ghost" onClick={reset}>Reset</Button>}
          <Button size="sm" variant="secondary" onClick={press}>Send request</Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-faint">A simulation: nothing is sent. Real keys return a 429 like this once the limit is used up.</p>
    </motion.div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [done, setDone] = useState(false);
  const reduce = useReducedMotion();
  const logoCtl = useAnimationControls();
  useEffect(() => {
    if (reduce || !secret) return;
    logoCtl.start({ scale: [1, 1.1, 1], rotate: [0, -6, 0], transition: { duration: 0.35, ease: EASE } });
  }, [secret.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const mx = useMotionValue(-400);
  const my = useMotionValue(-400);
  const glow = useMotionTemplate`radial-gradient(520px circle at ${mx}px ${my}px, color-mix(in srgb, var(--accent) 13%, transparent), transparent 70%)`;
  const gridMask = useMotionTemplate`radial-gradient(260px circle at ${mx}px ${my}px, black, transparent)`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!secret.trim()) { setError("Enter your admin secret to continue."); setShake((n) => n + 1); return; }
    setBusy(true); setError("");
    try {
      await login(secret, async () => {
        setDone(true);
        if (!reduce) await new Promise((res) => setTimeout(res, 320));
      });
    } catch (err) {
      setError((err as Error).message);
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="ambient relative min-h-dvh overflow-hidden"
      onPointerMove={(e) => { if (!reduce && e.pointerType === "mouse") { mx.set(e.clientX); my.set(e.clientY); } }}
    >
      {/* Cursor spotlight, plus a brighter copy of the grid revealed around the pointer */}
      <Orbs />
      <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: glow }} />
      <motion.div
        aria-hidden className="pointer-events-none absolute inset-0 opacity-90"
        style={{ backgroundImage: "linear-gradient(var(--line-strong) 1px,transparent 1px),linear-gradient(90deg,var(--line-strong) 1px,transparent 1px)", backgroundSize: "44px 44px", maskImage: gridMask, WebkitMaskImage: gridMask }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" style={{ backgroundImage: "linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px)", backgroundSize: "44px 44px" }} />

      <div className="relative mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-12 px-4 py-10 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:px-10">
        {/* Sign-in: first on phones and tablets, right column on desktop */}
        <motion.main
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={done ? { opacity: 0, y: -8, scale: 0.97 } : { opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: done ? 0.3 : 0.8, ease: EASE }}
          className="order-1 mx-auto w-full max-w-[400px] lg:order-2 lg:max-w-[420px]"
        >
          <div className="mb-8 flex flex-col items-center text-center">
            <motion.div initial={{ scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.15 }}>
              <motion.div animate={logoCtl}>
                <Logo className="size-12 drop-shadow-[0_8px_24px_color-mix(in_srgb,var(--accent)_45%,transparent)]" />
              </motion.div>
            </motion.div>
            <h1 className="mt-6 text-balance text-2xl font-semibold tracking-tight">Sign in to Keygate</h1>
            <p className="mt-2 text-[15px] text-muted">Enter your admin secret to open the dashboard.</p>
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
            <Magnetic strength={0.08}><Button variant="primary" type="submit" loading={busy} className="h-10 w-full">Sign in</Button></Magnetic>
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
              <motion.li key={f.title} variants={item} whileHover={{ x: 3 }} transition={{ type: "spring", stiffness: 400, damping: 28 }} className="flex gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent" aria-hidden>
                  <svg viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><motion.path d="M4.5 10.5l3.5 3.5 7.5-8" variants={reduce ? undefined : check} /></svg>
                </span>
                <div>
                  <h3 className="text-sm font-medium">{f.title}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{f.body}</p>
                </div>
              </motion.li>
            ))}
          </ul>

          <motion.div variants={item} className="mt-10 max-w-sm">
            <ExampleKey />
          </motion.div>
        </motion.section>
      </div>
    </div>
  );
}
