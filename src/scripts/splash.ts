/**
 * Landing splash: shown once per browser session, removed from the DOM at 4000ms
 * (700ms under prefers-reduced-motion, after its shorter exit). The CSS animates from
 * the first paint; this only handles the session flag and the unmount.
 */
const KEY = 'sc-splash-seen';

export function initSplash(): void {
  const el = document.querySelector<HTMLElement>('[data-splash]');
  if (!el) return;

  let seen = false;
  try {
    seen = sessionStorage.getItem(KEY) !== null;
    if (!seen) sessionStorage.setItem(KEY, '1');
  } catch {
    // Storage unavailable (private mode, blocked): show the splash anyway.
  }

  if (seen) {
    el.remove(); // already seen in this session → do not repeat
    return;
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => el.remove(), reduced ? 700 : 4000);
}

// With <ClientRouter /> the component only exists on index.astro; re-run on each load.
if (document.querySelector('meta[name="astro-view-transitions-enabled"]')) {
  document.addEventListener('astro:page-load', initSplash);
} else {
  initSplash();
}
