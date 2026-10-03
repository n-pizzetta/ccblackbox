// node scripts/readme/hero.mjs  → docs/readme/hero.png: the dashboard in a window on a gradient, a Claude Code terminal over it (hero.html).
// The terminal's status line takes the context fill and 5h reset shown on the dashboard, so both agree.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = join(ROOT, ".readme-rec");
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ channel: "chrome" });
const d = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await d.goto("http://127.0.0.1:3344/"); await d.waitForTimeout(3500);
await d.screenshot({ path: join(OUT, "dash.png") });
const txt = await d.evaluate(() => document.body.innerText);
const pct = Number(/ctx (\d+)%/.exec(txt)[1]);
const reset = /58%\s+(\S+)/.exec(txt)[1];
const filled = Math.round(pct / 100 * 8);
const font = pathToFileURL(join(ROOT, "node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2")).href;
const html = readFileSync(new URL("./hero.html", import.meta.url), "utf8")
  .replace("__FONT__", font).replace("__RESET__", reset).replace("__PCT__", pct)
  .replace("__FILL__", "━".repeat(filled)).replace("__EMPTY__", "─".repeat(8 - filled));
writeFileSync(join(OUT, "hero.gen.html"), html);
console.log({ pct, reset });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await p.goto(pathToFileURL(join(OUT, "hero.gen.html")).href); await p.waitForTimeout(800);
await (await p.$(".stage")).screenshot({ path: join(ROOT, "docs/readme/hero.png"), omitBackground: true });
await b.close();
