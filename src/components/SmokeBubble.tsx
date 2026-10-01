import { useEffect, useRef, type ReactNode } from "react";

/**
 * A round bubble the pointer burns a path through: wherever the cursor passes, the bubble dissolves
 * (a soft mask hole) and leaves a wisp of smoke; the holes then heal, oldest first, so the bubble
 * re-forms behind the cursor. The smoke is a small canvas particle system, a stylised effect rather
 * than a fluid simulation. With prefers-reduced-motion nothing happens.
 */

const HOLE_R = 20; // px, fully erased radius
const HOLE_SOFT = 14; // px, soft edge
const HOLD_MS = 550; // a hole stays open this long...
const HEAL_MS = 1200; // ...then closes over this long
const STEP = 6; // px between holes along the path
const PAD = 50; // canvas margin around the bubble, so smoke can drift out of it

type Hole = { x: number; y: number; t: number };
type Puff = { x: number; y: number; vx: number; vy: number; age: number; life: number; r0: number; r1: number; phase: number; freq: number; amp: number };

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function makeSprite(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(176,184,196,0.6)");
  grad.addColorStop(0.5, "rgba(176,184,196,0.25)");
  grad.addColorStop(1, "rgba(176,184,196,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

/** 0 right after the hole opens, 1 once it has healed. */
function heal(age: number): number {
  if (age <= HOLD_MS) return 0;
  const k = Math.min(1, (age - HOLD_MS) / HEAL_MS);
  return k * k * (3 - 2 * k);
}

export function SmokeBubble({ size = 128, title, children }: { size?: number; title?: string; children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holes = useRef<Hole[]>([]);
  const puffs = useRef<Puff[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);
  const running = useRef(false);
  const sprite = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const w = size + PAD * 2;
  const h = size + PAD * 2;

  const frame = (now: number, prev: number) => {
    const bubble = bubbleRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!bubble || !canvas || !ctx) return;
    const dt = Math.min(0.05, (now - prev) / 1000);

    holes.current = holes.current.filter((o) => now - o.t < HOLD_MS + HEAL_MS);
    for (const p of puffs.current) {
      p.age += dt / p.life;
      p.x += (p.vx + Math.cos(now / 1000 * p.freq + p.phase) * p.amp) * dt;
      p.y += p.vy * dt;
      p.vy *= 1 - 0.2 * dt;
    }
    puffs.current = puffs.current.filter((p) => p.age < 1);

    // mask: every hole is a radial gradient (transparent in the middle), intersected together
    if (holes.current.length > 0) {
      const layers = holes.current.map((o) => {
        const a = heal(now - o.t).toFixed(3);
        return `radial-gradient(circle at ${o.x.toFixed(1)}px ${o.y.toFixed(1)}px, rgba(0,0,0,${a}) 0, rgba(0,0,0,${a}) ${HOLE_R}px, #000 ${HOLE_R + HOLE_SOFT}px)`;
      }).join(",");
      bubble.style.maskImage = layers;
      bubble.style.setProperty("-webkit-mask-image", layers);
      bubble.style.maskComposite = "intersect";
      bubble.style.setProperty("-webkit-mask-composite", "source-in");
    } else {
      bubble.style.maskImage = "";
      bubble.style.setProperty("-webkit-mask-image", "");
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== w * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const p of puffs.current) {
      const r = p.r0 + (p.r1 - p.r0) * Math.pow(p.age, 0.6);
      ctx.globalAlpha = Math.pow(Math.sin(Math.PI * Math.min(1, p.age)), 1.3) * 0.26;
      ctx.drawImage(sprite.current!, p.x + PAD - r, p.y + PAD - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;

    if (holes.current.length > 0 || puffs.current.length > 0) {
      raf.current = requestAnimationFrame((t) => frame(t, now));
    } else {
      running.current = false;
      ctx.clearRect(0, 0, w, h);
    }
  };

  const ensureRunning = () => {
    if (running.current) return;
    running.current = true;
    const start = performance.now();
    raf.current = requestAnimationFrame((t) => frame(t, start));
  };

  const onMove = (e: React.MouseEvent) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    sprite.current ??= makeSprite();
    const r = wrap.getBoundingClientRect();
    const to = { x: e.clientX - r.left, y: e.clientY - r.top };
    const from = last.current ?? to;
    last.current = to;
    const now = performance.now();
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const n = Math.max(1, Math.round(dist / STEP));
    for (let i = 1; i <= n; i++) {
      const x = from.x + ((to.x - from.x) * i) / n;
      const y = from.y + ((to.y - from.y) * i) / n;
      holes.current.push({ x, y, t: now });
      // a wisp of smoke at the cursor, stronger while moving fast
      const wisps = dist > 14 ? 2 : 1;
      for (let k = 0; k < wisps; k++) {
        puffs.current.push({
          x: x + rand(-6, 6),
          y: y + rand(-6, 6),
          vx: rand(-8, 8),
          vy: -rand(10, 34),
          age: 0,
          life: rand(0.9, 1.6),
          r0: rand(6, 10),
          r1: rand(18, 32),
          phase: rand(0, 6.28),
          freq: rand(1.2, 3),
          amp: rand(5, 14),
        });
      }
    }
    if (holes.current.length > 400) holes.current.splice(0, holes.current.length - 400);
    ensureRunning();
  };

  return (
    <div
      ref={wrapRef}
      className="smoke-wrap"
      style={{ width: size, height: size }}
      onMouseMove={onMove}
      onMouseLeave={() => { last.current = null; }}
      title={title}
    >
      <div ref={bubbleRef} className="smoke-bubble">{children}</div>
      <canvas
        ref={canvasRef}
        className="smoke-canvas"
        style={{ left: -PAD, top: -PAD, width: w, height: h }}
        aria-hidden="true"
      />
    </div>
  );
}
