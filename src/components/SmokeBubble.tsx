import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A round bubble that, on hover, goes up in smoke and then re-forms. The smoke is a small canvas
 * particle system (soft puffs that rise, drift, swell and fade); it is a stylised effect, not a
 * fluid simulation. Without hover support or with prefers-reduced-motion nothing happens.
 */

export type Accent = "cyan" | "violet" | "green" | "amber" | "pink" | "periwinkle" | "teal";
const RGB: Record<Accent, [number, number, number]> = {
  cyan: [76, 194, 255],
  violet: [176, 132, 255],
  green: [0, 217, 126],
  amber: [255, 176, 32],
  pink: [255, 126, 182],
  periwinkle: [139, 156, 255],
  teal: [94, 234, 212],
};

const REFORM_AT_MS = 1300;
const REFORM_MS = 800;
const SPAWN_MS = 500;
const RATE = 260; // puffs / second while spawning
const PAD_X = 50; // canvas margins around the bubble: smoke rises above it
const PAD_TOP = 90;
const PAD_BOTTOM = 20;

type Puff = { x: number; y: number; vx: number; vy: number; age: number; life: number; r0: number; r1: number; phase: number; freq: number; amp: number };

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function makeSprite(accent: Accent): HTMLCanvasElement {
  const [r, g, b] = RGB[accent];
  // gray smoke with a tint of the bubble's accent
  const mix = (c: number) => Math.round(c * 0.25 + 175 * 0.75);
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${mix(r)},${mix(g)},${mix(b)},0.6)`);
  grad.addColorStop(0.5, `rgba(${mix(r)},${mix(g)},${mix(b)},0.25)`);
  grad.addColorStop(1, `rgba(${mix(r)},${mix(g)},${mix(b)},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

export function SmokeBubble({ accent, size = 128, title, children }: { accent: Accent; size?: number; title?: string; children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<"idle" | "vanish" | "reform">("idle");
  const busy = useRef(false);
  const timers = useRef<number[]>([]);
  const raf = useRef(0);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    cancelAnimationFrame(raf.current);
  }, []);

  const burst = () => {
    if (busy.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    busy.current = true;

    const w = size + PAD_X * 2;
    const h = size + PAD_TOP + PAD_BOTTOM;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const sprite = makeSprite(accent);
    const cx = w / 2;
    const cy = PAD_TOP + size / 2;
    let puffs: Puff[] = [];
    let acc = 0;
    let t = 0;
    let last = performance.now();

    setPhase("vanish");
    timers.current.push(window.setTimeout(() => setPhase("reform"), REFORM_AT_MS));
    timers.current.push(window.setTimeout(() => setPhase("idle"), REFORM_AT_MS + REFORM_MS));

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      if (t * 1000 < SPAWN_MS) {
        acc += dt * RATE;
        while (acc >= 1) {
          acc -= 1;
          const a = rand(0, Math.PI * 2);
          const d = Math.sqrt(Math.random()) * (size / 2) * 0.85;
          puffs.push({
            x: cx + Math.cos(a) * d,
            y: cy + Math.sin(a) * d,
            vx: rand(-10, 10),
            vy: -rand(18, 52),
            age: 0,
            life: rand(0.8, 1.5),
            r0: rand(6, 12),
            r1: rand(20, 38),
            phase: rand(0, 6.28),
            freq: rand(1.2, 3),
            amp: rand(6, 16),
          });
        }
      }
      for (const p of puffs) {
        p.age += dt / p.life;
        // two layered sways give the plume some curl
        p.x += (p.vx + Math.cos(t * p.freq + p.phase) * p.amp + Math.sin(t * p.freq * 2.3 + p.phase * 1.7) * p.amp * 0.5) * dt;
        p.y += p.vy * dt;
        p.vy *= 1 - 0.25 * dt; // smoke slows as it spreads
      }
      puffs = puffs.filter((p) => p.age < 1);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const p of puffs) {
        const k = p.age;
        const r = p.r0 + (p.r1 - p.r0) * Math.pow(k, 0.6);
        ctx.globalAlpha = Math.pow(Math.sin(Math.PI * Math.min(1, k)), 1.3) * 0.24;
        ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;

      if (puffs.length > 0 || t * 1000 < SPAWN_MS) {
        raf.current = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, w, h);
        busy.current = false;
      }
    };
    raf.current = requestAnimationFrame(tick);
  };

  return (
    <div
      className="smoke-wrap"
      style={{ width: size, height: size, "--bs": `${size}px` } as React.CSSProperties}
      onMouseEnter={burst}
      title={title}
    >
      <div className={`smoke-bubble accent-${accent} ${phase}`}>{children}</div>
      <canvas
        ref={canvasRef}
        className="smoke-canvas"
        style={{ left: -PAD_X, top: -PAD_TOP, width: size + PAD_X * 2, height: size + PAD_TOP + PAD_BOTTOM }}
        aria-hidden="true"
      />
    </div>
  );
}
