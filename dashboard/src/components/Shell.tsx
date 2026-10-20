import { Suspense, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useApi } from "@/lib/useApi";
import { DEMO } from "@/lib/api";
import type { PlansResponse } from "@/lib/types";
import { cx, EASE, Icon, PageSkeleton } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: Icon.overview, end: true },
  { to: "/keys", label: "API keys", icon: Icon.key, end: false },
  { to: "/plans", label: "Plans", icon: Icon.plans, end: false, needsPlans: true },
  { to: "/settings", label: "Settings", icon: Icon.settings, end: false },
];

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M11 16a5 5 0 1 1 9.6 2H24v3h-3v2h-3v-2h-2.4A5 5 0 0 1 11 16Zm5-2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" fill="var(--accent-fg)" fillRule="evenodd" />
    </svg>
  );
}

function SideLink({ to, label, icon, end }: { to: string; label: string; icon: ReactNode; end: boolean }) {
  return (
    <NavLink to={to} end={end} title={label} className="group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-fg aria-[current=page]:text-fg md:justify-center lg:justify-start">
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border border-line bg-raised" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
          )}
          <span className="relative transition-transform duration-200 group-hover:scale-110 motion-reduce:transform-none">{icon}</span>
          <span className="relative"><span className="md:sr-only lg:not-sr-only">{label}</span></span>
        </>
      )}
    </NavLink>
  );
}

export function Shell() {
  const { logout } = useAuth();
  const { dark, toggle } = useTheme();
  const { pathname } = useLocation();
  const { data: plansData } = useApi<PlansResponse>("/plans");
  const nav = NAV.filter((n) => !("needsPlans" in n) || plansData?.enabled);

  return (
    <div className="ambient min-h-dvh">
      <a href="#main" className="sr-only z-[200] rounded-lg bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[72px] flex-col border-r border-line bg-bg/80 px-3 py-5 backdrop-blur-xl md:flex lg:w-60 lg:px-4">
        <div className="mb-7 flex items-center gap-2.5 px-1.5 md:justify-center lg:justify-start">
          <Logo className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight md:sr-only lg:not-sr-only">Keygate</span>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">{nav.map((n) => <SideLink key={n.to} to={n.to} label={n.label} icon={n.icon} end={n.end} />)}</nav>
        <div className="mt-auto flex flex-col gap-1">
          <button onClick={toggle} title={dark ? "Switch to light theme" : "Switch to dark theme"} className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg md:justify-center lg:justify-start">
            <motion.span key={String(dark)} initial={{ rotate: -90, scale: 0.6, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>{dark ? Icon.sun : Icon.moon}</motion.span><span className="md:sr-only lg:not-sr-only">{dark ? "Light theme" : "Dark theme"}</span>
          </button>
          <button onClick={logout} title="Sign out" className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg md:justify-center lg:justify-start">
            {Icon.out}<span className="md:sr-only lg:not-sr-only">Sign out</span>
          </button>
        </div>
      </aside>

      <main id="main" className="md:pl-[72px] lg:pl-60">
        {DEMO && (
          <p className="border-b border-line bg-raised/60 px-4 py-1.5 text-center text-xs text-muted">
            Live demo with sample data. Nothing is saved. <a href="/" className="font-medium text-fg underline underline-offset-2">Back to site</a>
          </p>
        )}
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-8 sm:px-6 md:pb-16 md:pt-10 lg:px-10">
          <motion.div key={pathname.startsWith("/keys") ? "/keys" : pathname} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
            <Suspense fallback={<PageSkeleton />}><Outlet /></Suspense>
          </motion.div>
        </div>
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx("relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors active:scale-95", isActive ? "text-fg" : "text-faint")}>
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="nav-active-m" className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                {n.icon}{n.label}
              </>
            )}
          </NavLink>
        ))}
        <button onClick={logout} className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-faint">{Icon.out}Sign out</button>
      </nav>
    </div>
  );
}

/** Page heading with the same entrance on every route. */
export function PageHeader({ title, subtitle, actions, back, titleLayoutId }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: React.ReactNode; titleLayoutId?: string }) {
  return (
    <header className="mb-8 space-y-3">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {titleLayoutId
            ? <motion.h1 layoutId={titleLayoutId} transition={{ type: "spring", stiffness: 380, damping: 36 }} className="text-balance text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</motion.h1>
            : <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>}
          {subtitle && <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE, delay: 0.08 }} className="mt-1.5 text-[15px] text-muted">{subtitle}</motion.p>}
        </div>
        {actions && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE, delay: 0.14 }} className="flex flex-wrap items-center gap-2">{actions}</motion.div>}
      </div>
    </header>
  );
}
