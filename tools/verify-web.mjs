#!/usr/bin/env node
/**
 * Integration checks that need a real browser engine (Chromium), covering the
 * paths unit tests cannot reach:
 *
 *   1. the shipped single-file build boots and paints the map,
 *   2. live mode fetches through the *Android bridge contract* (a stand-in for
 *      `YureWatchNative` that calls window.__yurewatchNativeResolve, exactly as
 *      NativeNet.java does),
 *   3. demo mode is visibly labelled SIMULATION,
 *   4. the lifecycle hooks the Android shell calls exist and behave,
 *   5. the back-gesture hook consumes the gesture when a panel is open.
 *
 * Usage:
 *   npm run build
 *   node tools/verify-web.mjs [--url http://127.0.0.1:8099/yurewatch.html]
 *
 * Requires: npm i -D playwright && npx playwright install chromium
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(new URL('..', import.meta.url).pathname);
const dist = join(root, 'dist');

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function main() {
  if (!existsSync(join(dist, 'yurewatch.html'))) {
    console.error('dist/yurewatch.html missing — run `npm run build` first.');
    process.exit(1);
  }

  // Serve dist/ ourselves unless a URL was supplied.
  let server = null;
  let base = argValue('--url', null);
  if (!base) {
    server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      const file = join(dist, path === '/' ? 'yurewatch.html' : path);
      if (!file.startsWith(dist) || !existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      const type = extname(file) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type }).end(readFileSync(file));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}/yurewatch.html`;
  }

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ja-JP' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // --- 1. boot + map paint -------------------------------------------------
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForSelector('.app', { timeout: 10_000 });
  await page.waitForTimeout(2_500);
  check('app shell mounts', await page.locator('.app').count() === 1);
  check('map canvas present', await page.locator('.map__canvas').count() === 1);
  const canvasPainted = await page.evaluate(() => {
    const c = document.querySelector('.map__canvas');
    if (!c) return false;
    return c.width > 100 && c.height > 100;
  });
  check('map canvas has real dimensions', canvasPainted);
  check('event feed renders rows or an empty state', (await page.locator('.feed__item, .feed__empty').count()) > 0);
  check('no page errors during boot', errors.length === 0, errors.join(' | ').slice(0, 160));

  // --- 2. Android bridge contract -----------------------------------------
  // Replaces the native transport with a pure-JS stand-in that keeps the same
  // request(id, url, timeoutMs) -> __yurewatchNativeResolve(id, payload) flow.
  const bridgePage = await context.newPage();
  const bridgeErrors = [];
  bridgePage.on('pageerror', (e) => bridgeErrors.push(e.message));
  await bridgePage.addInitScript(() => {
    window.__bridgeCalls = [];
    window.YureWatchNative = {
      request: function (id, url, timeoutMs) {
        window.__bridgeCalls.push(url);
        fetch(url)
          .then(async (res) => {
            const body = await res.text();
            window.__yurewatchNativeResolve(id, JSON.stringify({ status: res.status, body: body }));
          })
          .catch((err) => {
            window.__yurewatchNativeResolve(id, JSON.stringify({ error: String(err) }));
          });
      },
    };
  });
  await bridgePage.goto(base, { waitUntil: 'load' });
  await bridgePage.waitForTimeout(6_000);
  const bridgeState = await bridgePage.evaluate(() => ({
    calls: window.__bridgeCalls ?? [],
    info: window.YureWatchInfo ? JSON.parse(window.YureWatchInfo()) : null,
    rows: document.querySelectorAll('.feed__item').length,
    conn: document.querySelector('.chip--conn')?.textContent ?? '',
  }));
  check(
    'loads data through the Android bridge contract',
    bridgeState.calls.some((u) => u.includes('api.p2pquake.net')),
    `${bridgeState.calls.length} bridged request(s)`,
  );
  check(
    'bridge responses reach application state',
    bridgeState.info?.health === 'live',
    `health=${bridgeState.info?.health ?? 'n/a'}, events=${bridgeState.info?.events ?? 0}`,
  );
  check('bridged live data renders in the feed', bridgeState.rows > 0, `${bridgeState.rows} rows`);
  check('live mode shows no SIMULATION banner', (await bridgePage.locator('.simBanner').isVisible()) === false);
  check('no page errors in bridge mode', bridgeErrors.length === 0, bridgeErrors.join(' | ').slice(0, 160));

  // --- 3. demo mode labelling ---------------------------------------------
  const demoPage = await context.newPage();
  await demoPage.goto(`${base}?demo=warning`, { waitUntil: 'load' });
  await demoPage.waitForTimeout(3_500);
  check('demo mode shows the SIMULATION banner', await demoPage.locator('.simBanner').isVisible());
  check('demo alert panel is marked SIMULATION', (await demoPage.locator('.alert').textContent()).includes('SIMULATION'));
  check('demo mode header says DEMO', (await demoPage.locator('.chip--mode').textContent()).includes('DEMO'));

  // --- 4. lifecycle hooks the APK calls -----------------------------------
  const hooks = await demoPage.evaluate(() => ({
    pause: typeof window.YureWatchOnPause,
    resume: typeof window.YureWatchOnResume,
    back: typeof window.YureWatchBack,
    info: typeof window.YureWatchInfo,
  }));
  check(
    'Android lifecycle hooks are exposed',
    hooks.pause === 'function' && hooks.resume === 'function' && hooks.back === 'function',
    JSON.stringify(hooks),
  );

  // --- 5. back gesture ----------------------------------------------------
  // Uses the historical scenario because it always populates the feed, so there
  // is a selection to clear before leaving demo mode.
  const backPage = await context.newPage();
  await backPage.goto(`${base}?demo=historical`, { waitUntil: 'load' });
  await backPage.waitForSelector('.feed__button', { timeout: 15_000 });
  await backPage.locator('.feed__button').first().click();
  await backPage.waitForTimeout(400);
  const selected = await backPage.evaluate(() => Boolean(document.querySelector('.feed__item.is-selected')));
  const backWithSelection = await backPage.evaluate(() => window.YureWatchBack());
  await backPage.waitForTimeout(200);
  const selectionCleared = await backPage.evaluate(() => !document.querySelector('.feed__item.is-selected'));
  const backAfterSelection = await backPage.evaluate(() => window.YureWatchBack());
  await backPage.waitForTimeout(300);
  check('tapping a feed row selects the event', selected);
  check('back clears the selection first', backWithSelection === true && selectionCleared);
  check('back leaves demo mode next', backAfterSelection === true);

  // Returning to live mode starts a fresh feed, whose first batch auto-selects
  // the newest event; the gesture must still terminate rather than loop.
  await backPage.waitForTimeout(2_500);
  const backSequence = [];
  for (let i = 0; i < 4; i++) {
    backSequence.push(await backPage.evaluate(() => window.YureWatchBack()));
    await backPage.waitForTimeout(120);
  }
  check(
    'repeated back eventually lets the activity finish',
    backSequence[backSequence.length - 1] === false,
    backSequence.map(String).join(' → '),
  );

  await browser.close();
  server?.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
