import { useEffect, useRef } from 'preact/hooks';

interface DataNode { x: number; y: number; vx: number; vy: number; r: number }
interface Streak { x: number; y: number; len: number; v: number; pink: boolean; a: number }

/**
 * Hero backdrop: perspective floor grid (track), drifting data nodes and light
 * streaks in brand blue/pink at low alpha. Ported from the prototype's startHero().
 * dpr capped at 2; a single frame under prefers-reduced-motion.
 */
function startHero(c: HTMLCanvasElement): () => void {
  const ctx = c.getContext('2d');
  if (!ctx) return () => {};

  const reduced =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let w = 0;
  let h = 0;
  let raf = 0;

  const resize = (): void => {
    const r = c.getBoundingClientRect();
    w = Math.max(1, r.width);
    h = Math.max(1, r.height);
    c.width = w * dpr;
    c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
  const nodes: DataNode[] = Array.from({ length: 64 }, () => ({
    x: rnd(0, 1), y: rnd(0, 1), vx: rnd(-0.02, 0.02), vy: rnd(-0.012, 0.012), r: rnd(1, 2.2),
  }));
  const streaks: Streak[] = Array.from({ length: 7 }, (_, i) => ({
    x: rnd(-0.4, 1), y: rnd(0.2, 0.95), len: rnd(0.12, 0.3), v: rnd(0.08, 0.22), pink: i % 3 === 0, a: rnd(0.25, 0.6),
  }));
  const BLUE = (a: number): string => `rgba(61,154,254,${a})`;
  const PINK = (a: number): string => `rgba(231,57,125,${a})`;
  let last = performance.now();
  let t = 0;

  const draw = (now: number): void => {
    const dt = reduced ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    ctx.clearRect(0, 0, w, h);
    const compact = w < 700;

    // floor grid, vanishing point to the right
    const vx = w * (compact ? 0.5 : 0.7);
    const hz = h * 0.56;
    ctx.lineWidth = 1;
    const cols = compact ? 7 : 11;
    for (let i = -cols; i <= cols; i++) {
      const bx = vx + i * (w / (compact ? 5 : 7));
      const g = ctx.createLinearGradient(vx, hz, bx, h);
      g.addColorStop(0, BLUE(0));
      g.addColorStop(0.35, BLUE(0.14));
      g.addColorStop(1, BLUE(0.04));
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(vx, hz);
      ctx.lineTo(bx, h + 40);
      ctx.stroke();
    }
    const rows = 14;
    const phase = (t * 0.22) % 1;
    for (let k = 0; k < rows; k++) {
      const z = (k + phase) / rows; // 0 = horizon, 1 = viewer
      const y = hz + (h - hz) * z * z;
      const a = 0.02 + z * 0.16;
      ctx.strokeStyle = BLUE(a);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // horizon glow line
    const hg = ctx.createLinearGradient(0, 0, w, 0);
    hg.addColorStop(0, BLUE(0));
    hg.addColorStop(0.55, BLUE(0.35));
    hg.addColorStop(0.8, PINK(0.3));
    hg.addColorStop(1, PINK(0));
    ctx.strokeStyle = hg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, hz);
    ctx.lineTo(w, hz);
    ctx.stroke();

    // data network above the horizon
    const ny = hz;
    ctx.lineWidth = 1;
    for (const n of nodes) {
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (n.x < -0.02) n.x = 1.02;
      if (n.x > 1.02) n.x = -0.02;
      if (n.y < -0.02) n.y = 1.02;
      if (n.y > 1.02) n.y = -0.02;
    }
    const link = compact ? 110 : 150;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!;
      const ax = a.x * w;
      const ay = a.y * ny;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]!;
        const bx = b.x * w;
        const by = b.y * ny;
        const dx = ax - bx;
        const dy = ay - by;
        const d = Math.hypot(dx, dy);
        if (d < link) {
          ctx.strokeStyle = BLUE((1 - d / link) * 0.22);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
      ctx.fillStyle = BLUE(0.55);
      ctx.beginPath();
      ctx.arc(ax, ay, a.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // light streaks (speed)
    ctx.lineWidth = 1.5;
    for (const s of streaks) {
      s.x += s.v * dt;
      if (s.x > 1.2) {
        s.x = -s.len - rnd(0, 0.4);
        s.y = rnd(0.2, 0.95);
      }
      const x0 = s.x * w;
      const x1 = (s.x + s.len) * w;
      const y = hz + ((h - hz) * (s.y - 0.2)) / 0.75 * 0.9 + 4;
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      const C = s.pink ? PINK : BLUE;
      g.addColorStop(0, C(0));
      g.addColorStop(0.85, C(s.a));
      g.addColorStop(1, C(0));
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }

    if (!reduced) raf = requestAnimationFrame(draw);
  };

  const ro = new ResizeObserver(() => {
    resize();
    // Static frame under reduced motion: repaint after a resize.
    if (reduced) draw(performance.now());
  });
  ro.observe(c);

  raf = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
}

export default function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    return startHero(canvas);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}
    />
  );
}
