/**
 * Canvas renderer benchmark.
 *
 * Question it answers: is the current main-thread Canvas2D renderer
 * (buildScene + draw, rAF-throttled, render-on-dirty) fast enough at
 * realistic loads that a Web Worker / OffscreenCanvas / WebGL rewrite is
 * unnecessary? It measures end-to-end frame intervals in real Chromium
 * while the map is being panned continuously (the worst case: every frame
 * is dirty), plus the EEW pulse-animation loop.
 *
 *   npm run build && node tools/bench-render.mjs
 *
 * This is a diagnostic, not a pass/fail gate: it prints distributions so a
 * future regression (or an architecture proposal) has numbers to argue
 * with. Methodology: rAF timestamp deltas over ~6 s windows; headless
 * Chromium on the CI/dev machine — treat values as comparative, not as
 * physical-device timings.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'dist', 'yurewatch.html');
if (!existsSync(FILE)) {
  console.error('dist/yurewatch.html missing — run `npm run build` first.');
  process.exit(1);
}
const HTML = readFileSync(FILE, 'utf8');

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(HTML);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];

async function measure(page, label, action) {
  await page.evaluate(() => {
    window.__intervals = [];
    let last = performance.now();
    const loop = (t) => {
      window.__intervals.push(t - last);
      last = t;
      if (window.__intervals.length < 400) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await action();
  await page.waitForTimeout(6_500);
  const intervals = await page.evaluate(() => window.__intervals.slice(5));
  const sorted = [...intervals].sort((a, b) => a - b);
  const over33 = intervals.filter((i) => i > 33).length;
  const over50 = intervals.filter((i) => i > 50).length;
  console.log(
    `${label.padEnd(38)} frames=${String(intervals.length).padStart(4)} ` +
      `median=${pct(sorted, 50).toFixed(1)}ms p95=${pct(sorted, 95).toFixed(1)}ms ` +
      `p99=${pct(sorted, 99).toFixed(1)}ms max=${sorted[sorted.length - 1].toFixed(1)}ms ` +
      `>33ms=${over33} >50ms=${over50}`,
  );
  return { median: pct(sorted, 50), p95: pct(sorted, 95) };
}

const browser = await chromium.launch();
const results = {};

for (const [vpName, width, height] of [
  ['desktop 1440x900', 1440, 900],
  ['phone 390x844', 390, 844],
]) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();

  // Continuous pan over the full geometry (17,960 vertices, labels, shading).
  await page.goto(`${base}?demo=normal&lang=ja`, { waitUntil: 'load' });
  await page.waitForSelector('.app', { timeout: 20_000 });
  await page.waitForTimeout(3_000);
  results[`${vpName} pan`] = await measure(page, `${vpName} · continuous pan (demo)`, async () => {
    const box = await page.locator('canvas').first().boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // Drag in a slow circle for the whole measurement window.
    const started = Date.now();
    let i = 0;
    while (Date.now() - started < 6_000) {
      const a = (i / 40) * Math.PI * 2;
      await page.mouse.move(cx + Math.cos(a) * 120, cy + Math.sin(a) * 80, { steps: 2 });
      i++;
    }
    await page.mouse.up();
  });

  // EEW pulse animation: the only perpetual animation loop in the app.
  await page.goto(`${base}?demo=warning&lang=ja`, { waitUntil: 'load' });
  await page.waitForSelector('.app', { timeout: 20_000 });
  await page.waitForTimeout(3_500);
  results[`${vpName} EEW pulse`] = await measure(page, `${vpName} · EEW pulse animation`, async () => {});

  await ctx.close();
}

await browser.close();
server.close();

console.log('');
const worstP95 = Math.max(...Object.values(results).map((r) => r.p95));
console.log(
  worstP95 <= 20
    ? `Verdict input: worst p95 frame interval ${worstP95.toFixed(1)}ms — main-thread Canvas2D is comfortably inside a 60 fps budget; a Worker/WebGL rewrite is not justified by these numbers.`
    : `Verdict input: worst p95 frame interval ${worstP95.toFixed(1)}ms — investigate before dismissing a renderer change.`,
);
