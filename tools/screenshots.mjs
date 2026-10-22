#!/usr/bin/env node
/**
 * Regenerate the README screenshots from the shipped build.
 *
 * Everything is captured from `dist/yurewatch.html` — the same bytes the APK
 * embeds — so a screenshot can never show a UI that the release does not have.
 * Demo scenarios are used for the alert states; every one of those shots carries
 * the SIMULATION banner, by design.
 *
 * Usage:  npm run build && node tools/screenshots.mjs
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(new URL('..', import.meta.url).pathname);
const dist = join(root, 'dist');
const outDir = join(root, 'docs', 'screenshots');
const file = join(dist, 'yurewatch.html');

if (!existsSync(file)) {
  console.error('dist/yurewatch.html missing — run `npm run build` first.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

/**
 * `action` runs after the app has settled, so panels that only exist behind a
 * tap are captured in their real, interactive state rather than being faked.
 */
const shots = [
  { name: 'desktop-live', lang: 'ja', viewport: [1440, 900], query: '' },
  { name: 'desktop-eew-warning', lang: 'ja', viewport: [1440, 900], query: '?demo=warning' },
  { name: 'desktop-eew-cancelled', lang: 'ja', viewport: [1440, 900], query: '?demo=cancelled' },
  { name: 'desktop-detail', lang: 'ja', viewport: [1440, 900], query: '', action: 'detail' },
  { name: 'desktop-info', lang: 'ja', viewport: [1440, 900], query: '', action: 'info' },
  { name: 'desktop-legend', lang: 'ja', viewport: [1440, 900], query: '', action: 'legend' },
  { name: 'tablet-live', lang: 'ja', viewport: [768, 1024], query: '' },
  { name: 'mobile-live', lang: 'ja', viewport: [390, 844], query: '' },
  { name: 'mobile-eew-warning', lang: 'ja', viewport: [390, 844], query: '?demo=warning' },
  { name: 'mobile-list', lang: 'ja', viewport: [390, 844], query: '', action: 'expand' },
  { name: 'en-desktop-live', lang: 'en', viewport: [1440, 900], query: '' },
  { name: 'en-desktop-eew-warning', lang: 'en', viewport: [1440, 900], query: '?demo=warning' },
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });

for (const shot of shots) {
  const [width, height] = shot.viewport;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    locale: shot.lang === 'ja' ? 'ja-JP' : 'en-US',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  const sep = shot.query ? '&' : '?';
  // `lang` forces the language; the app persists it per origin, so a fresh
  // context is used for every shot.
  await page.goto(`${base}${shot.query}${sep}lang=${shot.lang}`, { waitUntil: 'load' });
  await page.waitForSelector('.app', { timeout: 15_000 });
  // Let the feed settle and the map draw its first frames.
  await page.waitForTimeout(shot.query ? 4_500 : 5_500);

  // The phone layout opens as a peek; only the shots that need the panel expand it.
  const peek = await page.$('.sheet__handle');
  if (shot.action && (await peek?.isVisible())) {
    await peek.click();
    await page.waitForTimeout(450);
  }
  if (shot.action === 'detail' || shot.action === 'info') {
    await page.click(`.sideTab[data-view="${shot.action}"]`);
  }
  if (shot.action === 'legend') {
    await page.click('.mapBtn--legend');
  }
  if (shot.action) await page.waitForTimeout(700);
  await page.screenshot({ path: join(outDir, `${shot.name}.png`) });
  console.log(`  ${shot.name}.png  ${width}×${height}  ${shot.lang}`);
  await context.close();
}

await browser.close();
server.close();
console.log(`\nWrote ${shots.length} screenshots to docs/screenshots/`);
