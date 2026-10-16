import Lenis from 'lenis';

/**
 * Smooth scroll. Replaces the manual wheel lerp of the prototypes with Lenis
 * (same lerp 0.11). Not created under prefers-reduced-motion. Destroyed and
 * recreated on every navigation.
 */
let lenis: Lenis | null = null;
let rafId = 0;

const prefersReduced = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initLenis(): Lenis | null {
  destroyLenis();
  if (prefersReduced()) return null;

  lenis = new Lenis({ lerp: 0.11, smoothWheel: true, wheelMultiplier: 1 });
  const loop = (time: number): void => {
    lenis?.raf(time);
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
  return lenis;
}

export function destroyLenis(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  lenis?.destroy();
  lenis = null;
}

export const getLenis = (): Lenis | null => lenis;
