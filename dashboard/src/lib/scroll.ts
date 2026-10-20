import Lenis from "lenis";

/** Shared Lenis instance so overlays can pause page scrolling. */
export let lenis: Lenis | null = null;

export function startSmoothScroll(): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const instance = new Lenis({ autoRaf: true, lerp: 0.1, smoothWheel: true, anchors: true });
  lenis = instance;
  return () => { instance.destroy(); lenis = null; };
}
