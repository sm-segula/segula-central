/**
 * Scroll reveals for every `[data-reveal]` element.
 * Initial state (opacity 0, translateY 20px) and the 600ms ease-out-expo transition
 * live in global.css; this module only flips `.is-visible` once per element and
 * applies `data-reveal-delay` as `transition-delay`.
 */
const seen = new WeakSet<Element>();
let io: IntersectionObserver | null = null;
let mo: MutationObserver | null = null;

const prefersReduced = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function show(el: HTMLElement): void {
  const delay = Number(el.dataset.revealDelay ?? 0);
  el.style.transitionDelay = `${delay}ms`;
  el.classList.add('is-visible');
  // Drop the delay once the entrance finished so hover transitions on the same
  // element (cards) are not delayed afterwards.
  const clear = (e: TransitionEvent): void => {
    if (e.target !== el || e.propertyName !== 'opacity') return;
    el.style.transitionDelay = '';
    el.removeEventListener('transitionend', clear);
  };
  el.addEventListener('transitionend', clear);
}

function track(el: Element): void {
  if (seen.has(el)) return;
  seen.add(el);
  if (io) io.observe(el);
  else show(el as HTMLElement);
}

function trackAll(): void {
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach(track);
}

export function initReveals(): void {
  io?.disconnect();
  mo?.disconnect();
  io = null;
  mo = null;

  if (!prefersReduced() && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target as HTMLElement);
          io?.unobserve(entry.target);
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -6% 0px' },
    );
  }

  trackAll();
  // Elements rendered later (islands, injected content) are picked up as they appear.
  mo = new MutationObserver(trackAll);
  mo.observe(document.body, { childList: true, subtree: true });
}
