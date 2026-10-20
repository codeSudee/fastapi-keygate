import {
  forwardRef, useEffect, useId, useRef,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
} from "react";
import { animate, AnimatePresence, motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { lenis } from "@/lib/scroll";
import { fmtCompact } from "@/lib/format";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export const EASE = [0.16, 1, 0.3, 1] as const;

/* ---- Scroll-triggered reveal ------------------------------------------ */
export function Reveal({ children, delay = 0, className, as = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "section" | "li" }) {
  const M = motion[as];
  return (
    <M
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </M>
  );
}

/* ---- Magnetic wrapper: nudges its child toward a fine pointer. Decorative only. ---- */
export function Magnetic({ children, strength = 0.25, className }: { children: ReactNode; strength?: number; className?: string }) {
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 300, damping: 22, mass: 0.4 });
  const y = useSpring(0, { stiffness: 300, damping: 22, mass: 0.4 });
  const ref = useRef<HTMLDivElement>(null);
  return (
    <motion.div
      ref={ref}
      className={className}
      style={reduce ? undefined : { x, y }}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== "mouse" || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => { x.set(0); y.set(0); }}
    >
      {children}
    </motion.div>
  );
}

/* ---- Card -------------------------------------------------------------- */
export function Card({ className, children, lift, ...rest }: { className?: string; children: ReactNode; lift?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("rounded-2xl border border-line bg-panel shadow-card", lift && "transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop motion-reduce:transform-none", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
      <div className="min-w-0">
        <h2 className="text-[15px] font-medium tracking-tight text-fg">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---- Button ------------------------------------------------------------ */
type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:-translate-y-px hover:brightness-110 motion-reduce:transform-none shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset]",
  secondary: "border border-line-strong bg-raised text-fg hover:bg-[color-mix(in_srgb,var(--fg)_8%,var(--raised))]",
  ghost: "text-muted hover:bg-raised hover:text-fg",
  danger: "bg-bad text-white hover:brightness-110",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: "sm" | "md" }>(
  function Button({ variant = "secondary", loading, size = "md", className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background,filter,transform,color] duration-150 active:translate-y-0 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
          size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-3.5 text-sm",
          variants[variant],
          className,
        )}
        {...rest}
      >
        {loading && <Spinner />}
        {children}
      </button>
    );
  },
);

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("size-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ---- Form field -------------------------------------------------------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; trailing?: ReactNode }>(
  function Input({ label, hint, error, trailing, className, id, ...rest }, ref) {
    const auto = useId();
    const fid = id ?? auto;
    return (
      <div className="group relative space-y-1.5">
        <label htmlFor={fid} className="block text-[13px] font-medium text-fg transition-colors group-focus-within:text-accent">{label}</label>
        <div className="relative">
        <input
          ref={ref}
          id={fid}
          aria-invalid={!!error}
          aria-describedby={hint || error ? `${fid}-d` : undefined}
          className={cx(
            "h-10 w-full rounded-lg border bg-bg px-3 text-sm text-fg placeholder:text-faint",
            "transition-[border-color,box-shadow] duration-150 hover:border-line-strong",
            "focus:border-accent focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)]",
            error ? "border-bad" : "border-line",
            trailing ? "pr-10" : "",
            className,
          )}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
        </div>
        <AnimatePresence initial={false} mode="popLayout">
          {(hint || error) && (
            <motion.p
              key={error ? "e" : "h"} id={`${fid}-d`}
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.18, ease: EASE }}
              className={cx("text-xs", error ? "text-bad" : "text-faint")}
            >{error ?? hint}</motion.p>
          )}
        </AnimatePresence>
      </div>
    );
  },
);

/* ---- Badges ------------------------------------------------------------ */
const tones = {
  ok: "text-ok bg-[color-mix(in_srgb,var(--ok)_12%,transparent)] ring-[color-mix(in_srgb,var(--ok)_28%,transparent)]",
  warn: "text-warn bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] ring-[color-mix(in_srgb,var(--warn)_28%,transparent)]",
  bad: "text-bad bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] ring-[color-mix(in_srgb,var(--bad)_28%,transparent)]",
  neutral: "text-muted bg-raised ring-line",
  accent: "text-accent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]",
};
export function Badge({ tone = "neutral", children, dot }: { tone?: keyof typeof tones; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone])}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export const StateBadge = ({ state }: { state: "active" | "expired" | "revoked" }) => (
  <Badge dot tone={state === "active" ? "ok" : state === "expired" ? "warn" : "neutral"}>
    {state[0].toUpperCase() + state.slice(1)}
  </Badge>
);

/* ---- Skeleton / states ------------------------------------------------- */
export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cx("skeleton", className)} />;

/* Generic page placeholder, used as the Suspense fallback while a page chunk loads. */
export const PageSkeleton = () => (
  <div role="status" aria-label="Loading" className="space-y-4 sm:space-y-5">
    <div className="space-y-2.5 pb-2"><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-72 max-w-full" /></div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl border border-line" />)}
    </div>
    <Skeleton className="h-72 rounded-xl border border-line" />
  </div>
);

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 20 }} className="mb-4 grid size-11 place-items-center rounded-xl border border-line bg-raised text-muted">{icon}</motion.div>
      <p className="text-[15px] font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-sm text-bad">{message}</p>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/* ---- Count-up number --------------------------------------------------- */
export function CountUp({ value, format = fmtCompact, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(Math.round(v)));
  const first = useRef(true);

  useEffect(() => {
    if (reduce) { mv.set(value); return; }
    if (!inView) return;
    const c = animate(mv, value, { duration: first.current ? 1.1 : 0.6, ease: EASE });
    first.current = false;
    return () => c.stop();
  }, [value, inView, reduce, mv]);

  return <motion.span ref={ref} className={cx("tabular", className)}>{reduce ? format(value) : text}</motion.span>;
}

/* ---- Segmented control ------------------------------------------------- */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-bg p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx("relative h-7 rounded-md px-3 text-[13px] font-medium transition-[color,transform] active:scale-95", on ? "text-fg" : "text-muted hover:text-fg")}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-md border border-line-strong bg-raised"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---- Overlays ---------------------------------------------------------- */
function useOverlay(open: boolean, onClose: () => void, panel: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    lenis?.stop();
    const first =
      panel.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel.current?.querySelector<HTMLElement>("input, select, textarea") ??
      panel.current?.querySelector<HTMLElement>("button:not([aria-label=Close])");
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key !== "Tab" || !panel.current) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); lenis?.start(); prev?.focus?.({ preventScroll: true }); };
  }, [open, onClose, panel]);
}

function Overlay({ open, onClose, side, title, children, wide }: { open: boolean; onClose: () => void; side?: boolean; title: string; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const tid = useId();
  useOverlay(open, onClose, panel);
  return (
    <AnimatePresence>
      {open && (
        <div className={cx("fixed inset-0 z-50 flex", side ? "justify-end" : "items-end justify-center p-0 sm:items-center sm:p-6")}>
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-[3px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={tid}
            data-lenis-prevent
            className={cx(
              "relative flex max-h-[100dvh] flex-col overflow-y-auto border border-line-strong bg-panel shadow-pop overscroll-contain",
              side ? "h-full w-full max-w-md rounded-l-2xl" : cx("w-full rounded-t-2xl sm:rounded-2xl", wide ? "max-w-xl" : "max-w-md"),
            )}
            initial={side ? { x: "100%" } : { opacity: 0, y: 24, scale: 0.97 }}
            animate={side ? { x: 0 } : { opacity: 1, y: 0, scale: 1 }}
            exit={side ? { x: "100%" } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={side ? { type: "spring", stiffness: 380, damping: 40 } : { type: "spring", stiffness: 420, damping: 32 }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4 sm:px-6">
              <h2 id={tid} className="text-base font-medium tracking-tight">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="-mr-1.5 grid size-8 place-items-center rounded-lg text-muted transition-[background,color,transform] hover:rotate-90 hover:bg-raised hover:text-fg motion-reduce:transform-none">
                <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
export const Modal = (p: Omit<Parameters<typeof Overlay>[0], "side">) => <Overlay {...p} />;
export const Drawer = (p: Omit<Parameters<typeof Overlay>[0], "side" | "wide">) => <Overlay {...p} side />;

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirm, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: ReactNode; confirm: string; loading?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-5 px-5 py-5 sm:px-6">
        <div className="text-sm leading-relaxed text-muted">{body}</div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} data-autofocus>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>{confirm}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ---- Icons ------------------------------------------------------------- */
const I = ({ d, className = "size-[18px]" }: { d: ReactNode; className?: string }) => (
  <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
export const Icon = {
  overview: <I d={<><rect x="3" y="3" width="6" height="7" rx="1.5" /><rect x="11" y="3" width="6" height="4" rx="1.5" /><rect x="3" y="12" width="6" height="5" rx="1.5" /><rect x="11" y="9" width="6" height="8" rx="1.5" /></>} />,
  key: <I d={<><circle cx="7" cy="12" r="3.5" /><path d="M9.5 9.5L16 3m-2.5 2.5l2 2M11.5 7.5l1.5 1.5" /></>} />,
  settings: <I d={<><path d="M4 6h7M15 6h1M4 14h1M9 14h7" /><circle cx="13" cy="6" r="2" /><circle cx="7" cy="14" r="2" /></>} />,
  plans: <I d={<><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M3 8h14M6.5 12h3" /></>} />,
  plus: <I d={<path d="M10 4v12M4 10h12" />} />,
  copy: <I d={<><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /></>} />,
  check: <I d={<path d="M4 10.5l4 4 8-9" />} />,
  eye: <I d={<><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" /><circle cx="10" cy="10" r="2.5" /></>} />,
  eyeOff: <I d={<><path d="M3 3l14 14M8.2 5.2A8 8 0 0 1 10 5c5 0 8 5 8 5a13 13 0 0 1-2.6 3M5.6 6.6C3.6 8 2 10 2 10s3 5 8 5c1.2 0 2.3-.3 3.3-.7M8.6 8.6a2.5 2.5 0 0 0 2.8 2.8" /></>} />,
  sun: <I d={<><circle cx="10" cy="10" r="3.5" /><path d="M10 2v2m0 12v2M2 10h2m12 0h2M4.3 4.3l1.4 1.4m8.6 8.6l1.4 1.4m0-11.4l-1.4 1.4M5.7 14.3l-1.4 1.4" /></>} />,
  moon: <I d={<path d="M16.5 11.5A6.5 6.5 0 0 1 8.5 3.5a6.5 6.5 0 1 0 8 8z" />} />,
  out: <I d={<><path d="M8 4H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3M13 7l3 3-3 3M16 10H8" /></>} />,
  more: <I d={<><circle cx="4.5" cy="10" r=".8" fill="currentColor" /><circle cx="10" cy="10" r=".8" fill="currentColor" /><circle cx="15.5" cy="10" r=".8" fill="currentColor" /></>} />,
  arrow: <I d={<path d="M4 10h11m-4-4l4 4-4 4" />} className="size-4" />,
  back: <I d={<path d="M16 10H5m4-4l-4 4 4 4" />} className="size-4" />,
  alert: <I d={<><path d="M10 3L2.5 16h15L10 3z" /><path d="M10 8.5v3.5M10 14.2v.1" /></>} />,
  refresh: <I d={<path d="M4 10a6 6 0 0 1 10.2-4.3L16 7.5M16 3.5v4h-4M16 10a6 6 0 0 1-10.2 4.3L4 12.5M4 16.5v-4h4" />} />,
};
