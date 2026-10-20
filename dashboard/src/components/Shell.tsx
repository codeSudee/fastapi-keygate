import { Suspense } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { cx, EASE, Icon, PageSkeleton } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: Icon.overview, end: true },
  { to: "/keys", label: "API keys", icon: Icon.key, end: false },
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

function SideLink({ to, label, icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink to={to} end={end} title={label} className="group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:text-fg aria-[current=page]:text-fg md:justify-center lg:justify-start">
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border border-line bg-raised" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
          )}
          <span className="relative">{icon}</span>
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

  return (
    <div className="ambient min-h-dvh">
      <a href="#main" className="sr-only z-[200] rounded-lg bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[72px] flex-col border-r border-line bg-bg/80 px-3 py-5 backdrop-blur-xl md:flex lg:w-60 lg:px-4">
        <div className="mb-7 flex items-center gap-2.5 px-1.5 md:justify-center lg:justify-start">
          <Logo className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight md:sr-only lg:not-sr-only">Keygate</span>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">{NAV.map((n) => <SideLink key={n.to} {...n} />)}</nav>
        <div className="mt-auto flex flex-col gap-1">
          <button onClick={toggle} title={dark ? "Switch to light theme" : "Switch to dark theme"} className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg md:justify-center lg:justify-start">
            {dark ? Icon.sun : Icon.moon}<span className="md:sr-only lg:not-sr-only">{dark ? "Light theme" : "Dark theme"}</span>
          </button>
          <button onClick={logout} title="Sign out" className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg md:justify-center lg:justify-start">
            {Icon.out}<span className="md:sr-only lg:not-sr-only">Sign out</span>
          </button>
        </div>
      </aside>

      <main id="main" className="md:pl-[72px] lg:pl-60">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-8 sm:px-6 md:pb-16 md:pt-10 lg:px-10">
          <motion.div key={pathname} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
            <Suspense fallback={<PageSkeleton />}><Outlet /></Suspense>
          </motion.div>
        </div>
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx("flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium", isActive ? "text-fg" : "text-faint")}>
            {n.icon}{n.label}
          </NavLink>
        ))}
        <button onClick={logout} className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-faint">{Icon.out}Sign out</button>
      </nav>
    </div>
  );
}

/** Page heading with the same entrance on every route. */
export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: React.ReactNode }) {
  return (
    <header className="mb-8 space-y-3">
      {back}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
