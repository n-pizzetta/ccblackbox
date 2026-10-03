const btn = (p, re) => p.locator("button, [role=tab]").filter({ hasText: re }).first();
const sess = (p, t) => p.getByText(t, { exact: false }).first();
export default {
  async replay({ p, wait, click, moveTo }) {
    await wait(700);
    await click(sess(p, "Fix layout shift on the settings page"), 1600);
    await moveTo(p.getByText("User prompts").first(), 200, 120); await wait(1200);
    await click(btn(p, /^Tools$/), 1300);
    await p.mouse.wheel(0, 380); await wait(1200);
    await p.mouse.wheel(0, -380); await wait(300);
    await click(btn(p, /^Tokens$/), 2200);
  },
  async timeline({ p, wait, click, glide }) {
    // A demo session long enough to compact once.
    const id = await p.evaluate(async () => (await (await fetch("/api/sessions")).json()).sessions.find((s) => JSON.stringify(s).includes("Fix the flaky integration test in orders/checkout")).id);
    await p.evaluate((id) => { location.hash = `#session/${id}`; }, id); await wait(1400);
    await click(btn(p, /^Timeline$/), 1400);
    for (let x = 140; x <= 1320; x += 90) { await glide(x, 560); await wait(140); }
    await wait(800);
  },
  async live({ p, wait, click, moveTo }) {
    await moveTo(sess(p, "Build a dark-mode toggle"), -150, 0); await wait(2500);
    await click(sess(p, "Build a dark-mode toggle"), 1000);
    await moveTo(p.getByText(/Keep going|Compact|Clear/).first()); await wait(2500);
    await moveTo(p.getByText(/^Running/).first(), 120, 0); await wait(4500);
  },
  async fleet({ p, wait, click }) {
    await wait(600);
    await click(btn(p, /^Heaviest$/), 1400);
    await click(btn(p, /^Longest$/), 1400);
    await click(btn(p, /^Health$/), 1900);
    await click(btn(p, /^Analysis$/), 1900);
    await p.mouse.wheel(0, 500); await wait(1700);
    await p.mouse.wheel(0, -500); await wait(300);
    await click(btn(p, /^30d$/), 1500);
  },
  async compare({ p, wait, click, moveTo }) {
    await click(p.getByText("Filters").first(), 900);
    await click(p.locator("button,[role=option],[role=menuitemradio],[role=menuitem],label,li").filter({ hasText: /^Friction\s*\d*$/ }).first(), 1100);
    await p.keyboard.press("Escape"); await wait(500);
    await click(btn(p, /^select/), 700);
    const rows = p.locator(".session-row");
    for (const i of [0, 1, 3]) await click(rows.nth(i), 800);
    await moveTo(p.getByText("Compare").first(), 300, 200); await wait(3000);
  },
  async ghost({ p, wait, click, moveTo }) {
    await click(p.getByText("Filters").first(), 900);
    await click(p.locator("button,[role=option],[role=menuitemradio],[role=menuitem],label,li").filter({ hasText: /^Ghosts\s*\d*$/ }).first(), 1000);
    await p.keyboard.press("Escape"); await wait(500);
    await click(sess(p, "Bump the React Native version"), 1500);
    await click(p.locator(".ghost-chip").first(), 1200);
    const del = p.locator(".ghost-banner button").filter({ hasText: /delete/i }).first();
    if (await del.count()) { await moveTo(del); await wait(2000); }
    await wait(600);
  },
};
