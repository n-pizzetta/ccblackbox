import { useEffect, useRef } from "react";

/**
 * Realistic fire behind the #1 card's text: a small particle system drawn with additive
 * blending (white-hot core → yellow → orange → red → dark embers), tapering as it rises.
 * Sprites are pre-rendered per color step; the loop pauses off-screen and in hidden tabs, and
 * with prefers-reduced-motion it draws a single still frame.
 */

const STEPS = 24;
const RATE = 80; // particles / second
const PEDESTAL = 44; // px from the bottom where the fire starts (hidden behind the pedestal)

const RAMP: Array<[number, [number, number, number]]> = [
  [0, [255, 236, 170]],
  [0.2, [255, 205, 80]],
  [0.45, [255, 125, 30]],
  [0.75, [215, 50, 18]],
  [1, [90, 20, 12]],
];

function colorAt(t: number): [number, number, number] {
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, c1] = RAMP[i];
    if (t <= t1) {
      const [t0, c0] = RAMP[i - 1];
      const k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

function makeSprites(): HTMLCanvasElement[] {
  return Array.from({ length: STEPS }, (_, i) => {
    const [r, g, b] = colorAt(i / (STEPS - 1));
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},1)`);
    grad.addColorStop(0.45, `rgba(${r | 0},${g | 0},${b | 0},0.45)`);
    grad.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return c;
  });
}

type Particle = {
  x0: number; // 0..1 across the width
  rise: number; // fraction of the height travelled over its life
  t: number; // 0..1 age
  life: number; // seconds
  r: number; // base radius, in units of (height / 260)
  phase: number;
  freq: number;
  amp: number; // px of lateral sway
  spark: boolean;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function spawn(): Particle {
  const spark = Math.random() < 0.05;
  // triangular distribution: denser in the middle, so the flame tapers
  const x0 = 0.5 + (Math.random() + Math.random() - 1) * 0.5 * 0.92;
  return spark
    ? { x0, rise: rand(0.7, 1.1), t: 0, life: rand(0.9, 1.6), r: rand(0.5, 1), phase: rand(0, 6.28), freq: rand(3, 6), amp: rand(8, 22), spark }
    : { x0, rise: rand(0.35, 0.78), t: 0, life: rand(0.8, 1.7), r: rand(0.7, 1.35), phase: rand(0, 6.28), freq: rand(2, 5), amp: rand(4, 12), spark };
}

export function FireCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;

    const sprites = makeSprites();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let particles: Particle[] = [];
    let acc = 0;
    let time = 0;
    let last = 0;
    let raf = 0;
    let onScreen = true;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = host.clientWidth;
      h = host.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    };

    const step = (dt: number) => {
      time += dt;
      acc += dt * RATE;
      while (acc >= 1) {
        particles.push(spawn());
        acc -= 1;
      }
      for (const p of particles) p.t += dt / p.life;
      particles = particles.filter((p) => p.t < 1);
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const scale = h / 260;
      const y0 = h - PEDESTAL;
      for (const p of particles) {
        const t = p.t;
        const x = w / 2 + (p.x0 - 0.5) * w * (1 - 0.65 * t) + Math.sin(time * p.freq + p.phase) * p.amp * t;
        const y = y0 - p.rise * h * Math.pow(t, 0.85);
        if (p.spark) {
          ctx.globalAlpha = Math.min(1, (1 - t) * 1.4);
          ctx.fillStyle = "#ffd27a";
          ctx.beginPath();
          ctx.arc(x, y, 1.3 * p.r, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        const r = 18 * p.r * scale * (1 - 0.55 * t);
        // quick fade-in, long fade-out; smoke-red tail stays dim
        ctx.globalAlpha = Math.min(1, t * 8) * Math.pow(1 - t, 1.3) * 0.4;
        ctx.drawImage(sprites[Math.min(STEPS - 1, Math.floor(t * STEPS))], x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt);
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (reduced || raf || !onScreen || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw();
    });
    ro.observe(host);

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    io.observe(host);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    if (reduced) {
      for (let i = 0; i < 90; i++) step(1 / 60);
      draw();
    } else {
      start();
    }

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="fire-canvas" aria-hidden="true" />;
}

/** Hidden SVG filter: slow heat-haze distortion applied to the #1 card's text. */
export function HeatFilter() {
  const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <svg className="heat-defs" width="0" height="0" aria-hidden="true">
      <filter id="podium-heat" x="-5%" y="-15%" width="110%" height="130%">
        <feTurbulence type="fractalNoise" baseFrequency="0.01 0.022" numOctaves="2" seed="3" result="noise">
          {animate && <animate attributeName="baseFrequency" dur="5s" values="0.01 0.022;0.014 0.03;0.01 0.022" repeatCount="indefinite" />}
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
