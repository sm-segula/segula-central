import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';

interface Props {
  /** Number of slides rendered in `children`. */
  count: number;
  /** Accessible name of the carousel region. */
  label: string;
  /** Slides (static Astro markup, one `flex: 0 0 100%` element per slide). */
  children?: ComponentChildren;
}

/**
 * 16:9 slide carousel ported from the "Política de horas" prototype script:
 * state `slide`, wrap-around go(i), track translateX(-n*100%), ←/→ on the focused
 * region, swipe threshold 40px, dots 12→32px (role=tablist), counter "n / N".
 * Styles live in the hosting page (`.horas :global(...)`); only dynamic values inline.
 */
export default function Slider({ count, label, children }: Props) {
  const [slide, setSlide] = useState(0);
  const tx = useRef<number | null>(null);
  const N = count;
  const cur = slide;
  const go = (i: number): void => setSlide(((i % N) + N) % N);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(cur - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(cur + 1);
    }
  };
  const onTouchStart = (e: TouchEvent): void => {
    tx.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: TouchEvent): void => {
    const x = e.changedTouches[0]?.clientX;
    if (x === undefined) return;
    const dx = x - (tx.current ?? 0);
    if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1));
  };

  return (
    <>
      <div
        class="slider-viewport"
        tabIndex={0}
        role="region"
        aria-roledescription="carrusel"
        aria-label={label}
        onKeyDown={onKey}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div class="slider-track" style={{ transform: `translateX(-${cur * 100}%)` }}>
          {children}
        </div>
      </div>
      <div class="slider-bar">
        <span class="sc-tag slider-counter" aria-live="polite">
          {cur + 1} / {N}
        </span>
        <div class="slider-dots" role="tablist" aria-label="Ir a lámina">
          {Array.from({ length: N }, (_, i) => {
            const active = i === cur;
            return (
              <button
                type="button"
                role="tab"
                class="slider-dot"
                aria-selected={active}
                aria-label={`Lámina ${i + 1}`}
                onClick={() => go(i)}
              >
                <span
                  style={{
                    width: active ? '32px' : '12px',
                    background: active ? 'var(--brand-lightblue)' : 'var(--border-strong)',
                  }}
                />
              </button>
            );
          })}
        </div>
        <div class="slider-arrows">
          <button type="button" class="slider-arrow" onClick={() => go(cur - 1)} aria-label="Lámina anterior">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6"></path>
            </svg>
          </button>
          <button type="button" class="slider-arrow" onClick={() => go(cur + 1)} aria-label="Lámina siguiente">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6"></path>
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
