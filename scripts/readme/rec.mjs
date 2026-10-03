// node scripts/readme/rec.mjs <scenario>  → .readme-rec/frames/<scenario>/*.jpg + ffmpeg concat list (scenarios in scn.mjs)
import { chromium } from "playwright-core";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const URL0 = "http://127.0.0.1:3344/";
const name = process.argv[2];
const out = fileURLToPath(new URL(`../../.readme-rec/frames/${name}`, import.meta.url)); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-200px,-200px)", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.5))" });
    document.body.appendChild(c);
    addEventListener("mousemove", e => { c.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`; }, true);
    addEventListener("mousedown", e => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: e.clientX - 16 + "px", top: e.clientY - 16 + "px", width: "32px", height: "32px", borderRadius: "50%", border: "2px solid #4cc2ff", zIndex: 2147483646, pointerEvents: "none", transition: "transform .45s ease-out, opacity .45s ease-out" });
      document.body.appendChild(r); requestAnimationFrame(() => { r.style.transform = "scale(1.8)"; r.style.opacity = "0"; }); setTimeout(() => r.remove(), 500);
    }, true);
  });
});
const p = await ctx.newPage();
let mx = 720, my = 450;
const wait = (ms) => p.waitForTimeout(ms);
async function moveTo(loc, dx = 0, dy = 0) {
  const bb = await loc.boundingBox(); const x = bb.x + bb.width / 2 + dx, y = bb.y + bb.height / 2 + dy;
  const steps = 22; for (let i = 1; i <= steps; i++) { const t = i / steps, e = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; await p.mouse.move(mx + (x - mx) * e, my + (y - my) * e); await wait(12); }
  mx = x; my = y;
}
async function click(loc, pause = 900) { await moveTo(loc); await wait(180); await p.mouse.down(); await p.mouse.up(); await wait(pause); }
async function glide(x, y) { await moveTo({ boundingBox: async () => ({ x, y, width: 0, height: 0 }) }); }
await p.goto(URL0); await wait(2200);
await p.mouse.move(mx, my);
// --- screencast
const cdp = await ctx.newCDPSession(p);
const frames = [];
cdp.on("Page.screencastFrame", async (f) => { frames.push({ data: f.data, ts: f.metadata.timestamp }); try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {} });
const scenarios = (await import("./scn.mjs")).default;
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
await wait(400);
await scenarios[name]({ p, wait, moveTo, click, glide });
await wait(300);
await cdp.send("Page.stopScreencast");
let list = "";
frames.forEach((f, i) => {
  const fn = `${String(i).padStart(5, "0")}.jpg`; writeFileSync(`${out}/${fn}`, Buffer.from(f.data, "base64"));
  const d = i + 1 < frames.length ? frames[i + 1].ts - f.ts : 0.5;
  list += `file '${fn}'\nduration ${Math.max(0.02, d).toFixed(3)}\n`;
});
list += `file '${String(frames.length - 1).padStart(5, "0")}.jpg'\n`;
writeFileSync(`${out}/list.txt`, list);
console.log(name, frames.length, "frames", (frames.at(-1).ts - frames[0].ts).toFixed(1), "s");
await b.close();
