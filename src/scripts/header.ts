import { getLenis } from './lenis';

/**
 * Header behaviour (vanilla): desktop megamenus, mobile panel with accordion,
 * scroll lock and hide-on-scroll. State mirrors the prototype:
 * `open` (megamenu index), `menuOpen`, `accOpen` (mobile accordion), `hidden`.
 */
type Cleanup = () => void;
let teardown: Cleanup | null = null;

export function initHeader(): void {
  teardown?.();
  teardown = null;

  const header = document.querySelector<HTMLElement>('header[data-topbar]');
  if (!header) return;

  const nav = header.querySelector<HTMLElement>('[data-nav]');
  const trigger: 'hover' | 'click' = nav?.dataset.menuTrigger === 'click' ? 'click' : 'hover';
  const items = nav ? Array.from(nav.querySelectorAll<HTMLElement>('[data-nav-item]')) : [];

  const burger = header.querySelector<HTMLButtonElement>('[data-burger]');
  const iconOpen = header.querySelector<Element>('[data-icon-open]');
  const iconClose = header.querySelector<Element>('[data-icon-close]');
  const mobile = document.querySelector<HTMLElement>('[data-mobile-menu]');
  const accs = mobile ? Array.from(mobile.querySelectorAll<HTMLElement>('[data-acc]')) : [];

  const cleanups: Cleanup[] = [];
  const on = (
    target: EventTarget,
    type: string,
    fn: EventListenerOrEventListenerObject,
    opts?: AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };
  const setHidden = (el: Element | null, value: boolean): void => {
    if (!el) return;
    if (value) el.setAttribute('hidden', '');
    else el.removeAttribute('hidden');
  };

  let open: number | null = null;
  let menuOpen = false;
  let accOpen: number | null = null;
  let hidden = false;

  /* ---------- Desktop megamenu ---------- */
  const setOpen = (index: number | null): void => {
    open = index;
    items.forEach((item, k) => {
      const panel = item.querySelector<HTMLElement>('[data-megamenu]');
      if (!panel) return;
      const active = k === index;
      panel.hidden = !active;
      item.querySelector('button[data-navlink]')?.setAttribute('aria-expanded', String(active));
    });
  };

  items.forEach((item, i) => {
    const button = item.querySelector<HTMLButtonElement>('button[data-navlink]');
    if (!button || !item.querySelector('[data-megamenu]')) return;
    on(item, 'mouseenter', () => { if (trigger === 'hover') setOpen(i); });
    on(item, 'mouseleave', () => { if (trigger === 'hover') setOpen(null); });
    on(button, 'click', () => setOpen(open === i ? null : i));
    on(item, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape' && open === i) {
        setOpen(null);
        button.focus();
      }
    });
  });

  on(document, 'mousedown', (e) => {
    const target = e.target as Element | null;
    if (open !== null && !target?.closest('[data-nav]')) setOpen(null);
  });

  /* ---------- Hide on scroll ---------- */
  const onScroll = (): void => {
    const hide = window.scrollY > 24 && !menuOpen;
    if (hide === hidden) return;
    hidden = hide;
    document.documentElement.dataset.scrolled = hide ? 'true' : 'false';
    if (hide && open !== null) setOpen(null);
  };
  on(window, 'scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile panel + accordion ---------- */
  const setAcc = (index: number | null): void => {
    accOpen = index;
    accs.forEach((acc, k) => {
      const panel = acc.querySelector<HTMLElement>('[data-acc-panel]');
      if (!panel) return;
      const active = k === index;
      panel.hidden = !active;
      acc.querySelector('[data-acc-btn]')?.setAttribute('aria-expanded', String(active));
    });
  };

  const setMenu = (value: boolean): void => {
    menuOpen = value;
    if (mobile) mobile.hidden = !value;
    burger?.setAttribute('aria-expanded', String(value));
    setHidden(iconOpen, value);
    setHidden(iconClose, !value);
    document.documentElement.style.overflow = value ? 'hidden' : '';
    const lenis = getLenis();
    if (value) lenis?.stop();
    else lenis?.start();
    setOpen(null);
    setAcc(null);
    onScroll();
  };

  if (burger) on(burger, 'click', () => setMenu(!menuOpen));
  accs.forEach((acc, i) => {
    const button = acc.querySelector<HTMLElement>('[data-acc-btn]');
    if (button) on(button, 'click', () => setAcc(accOpen === i ? null : i));
  });
  mobile?.querySelectorAll<HTMLElement>('[data-mobile-leaf]').forEach((leaf) => {
    on(leaf, 'click', () => setMenu(false));
  });
  on(document, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && menuOpen) {
      setMenu(false);
      burger?.focus();
    }
  });
  const desktop = window.matchMedia('(min-width: 1025px)');
  on(desktop, 'change', () => { if (desktop.matches && menuOpen) setMenu(false); });

  teardown = () => {
    cleanups.forEach((fn) => fn());
    document.documentElement.style.overflow = '';
    delete document.documentElement.dataset.scrolled;
  };
}
