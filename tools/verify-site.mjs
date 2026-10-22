/**
 * Verify the built Pages artifact in a real browser, served from the same
 * subpath production uses.
 *
 *   npm run site:build
 *   npm run verify:site            # starts its own server on :4173
 *
 * Checks the landing page (assets, metadata, accessibility, responsive layout)
 * and the viewer (boot, canvas paint, live feed, offline state, simulation
 * labelling), and fails on any console error or failed network request.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4173);
const PREFIX = '/yurewatch';
const BASE = `http://127.0.0.1:${PORT}${PREFIX}`;

let passed = 0;
const failures = [];
const check = (ok, name, detail = '') => {
  if (ok) {
    passed++;
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failures.push(name);
    console.log(`**FAIL**  ${name}${detail ? `  (${detail})` : ''}`);
  }
};

/* --------------------------------------------------------------- server -- */

const server = spawn(process.execPath, ['tools/serve-site.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: 'ignore',
});

const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch();

/* --------------------------------------------------------- landing page -- */

{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('requestfailed', (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.url()} HTTP ${r.status()}`);
  });

  const resp = await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  check(resp?.status() === 200, 'landing page returns 200', `HTTP ${resp?.status()}`);
  check((await page.title()).includes('YureWatch'), 'landing page has a title', await page.title());

  // metadata
  const meta = await page.evaluate(() => {
    const get = (sel, attr = 'content') => document.querySelector(sel)?.getAttribute(attr) ?? null;
    return {
      description: get('meta[name="description"]'),
      canonical: get('link[rel="canonical"]', 'href'),
      ogTitle: get('meta[property="og:title"]'),
      ogImage: get('meta[property="og:image"]'),
      twitterCard: get('meta[name="twitter:card"]'),
      icon: get('link[rel="icon"]', 'href'),
      lang: document.documentElement.lang,
    };
  });
  check(!!meta.description, 'meta description present');
  check(meta.canonical === 'https://franzathome2024-hue.github.io/yurewatch/', 'canonical URL correct', meta.canonical);
  check(!!meta.ogTitle, 'Open Graph title present');
  check((meta.ogImage ?? '').startsWith('https://'), 'og:image is an absolute URL', meta.ogImage);
  check(meta.twitterCard === 'summary_large_image', 'Twitter card metadata present');
  check(!!meta.icon, 'favicon declared', meta.icon);
  check(meta.lang === 'en', 'html lang attribute set', meta.lang);

  // images actually decode
  await page.evaluate(async () => {
    for (const img of document.querySelectorAll('img')) {
      img.loading = 'eager';
      await img.decode().catch(() => {});
    }
  });
  const imgs = await page.evaluate(() =>
    [...document.querySelectorAll('img')].map((i) => ({
      src: i.currentSrc || i.src,
      w: i.naturalWidth,
      alt: i.getAttribute('alt'),
    })),
  );
  check(imgs.length >= 8, 'screenshots are rendered', `${imgs.length} images`);
  check(imgs.every((i) => i.w > 0), 'every screenshot decodes', `${imgs.filter((i) => i.w > 0).length}/${imgs.length}`);
  check(imgs.every((i) => i.alt && i.alt.length > 10), 'every screenshot has descriptive alt text');

  // primary call to action
  const cta = page.locator('a.btn--primary').first();
  check(await cta.isVisible(), 'Open Live Viewer button is visible');
  const href = await cta.getAttribute('href');
  check(href === 'viewer/', 'CTA uses a relative path that survives the subpath', href);
  const ctaResp = await page.request.get(`${BASE}/viewer/`);
  check(ctaResp.status() === 200, 'CTA target resolves', `HTTP ${ctaResp.status()}`);

  // accessibility basics
  const a11y = await page.evaluate(() => {
    const skip = document.querySelector('a.skip');
    return {
      skip: !!skip,
      h1: document.querySelectorAll('h1').length,
      main: !!document.getElementById('main'),
      landmarks: [...document.querySelectorAll('header,nav,main,footer')].length,
      labelledSections: [...document.querySelectorAll('section')].every(
        (s) => s.getAttribute('aria-labelledby') || s.getAttribute('aria-label'),
      ),
      tableHeaders: [...document.querySelectorAll('th')].every((th) => th.getAttribute('scope')),
    };
  });
  check(a11y.skip, 'skip link present');
  check(a11y.h1 === 1, 'exactly one h1', `${a11y.h1}`);
  check(a11y.main, 'main landmark present');
  check(a11y.labelledSections, 'every section is labelled');
  check(a11y.tableHeaders, 'table headers carry scope');

  // keyboard: tab from the top should reach the skip link, then nav / CTA
  await page.keyboard.press('Tab');
  const firstFocus = await page.evaluate(() => document.activeElement?.className ?? '');
  check(firstFocus.includes('skip'), 'first Tab reaches the skip link', firstFocus);
  const reachable = await page.evaluate(async () => {
    const cta = document.querySelector('a.btn--primary');
    cta.focus();
    return document.activeElement === cta;
  });
  check(reachable, 'primary CTA is keyboard focusable');

  // responsive: no horizontal overflow at phone width
  await page.setViewportSize({ width: 360, height: 740 });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, 'no horizontal overflow at 360px', `${overflow}px`);

  check(consoleErrors.length === 0, 'landing page has no console errors', consoleErrors.join(' | ').slice(0, 200));
  check(failedRequests.length === 0, 'landing page has no failed requests', failedRequests.join(' | ').slice(0, 200));

  await context.close();
}

/* --------------------------------------------------------------- viewer -- */

{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(`${BASE}/viewer/`, { waitUntil: 'domcontentloaded' });

  // boots and paints
  await page.waitForSelector('#app', { timeout: 20_000 });
  check(true, 'viewer boots and mounts #app');
  const bootGone = await page.evaluate(() => !document.getElementById('boot'));
  check(bootGone, 'boot placeholder removed after mount');

  const painted = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return { ok: false, reason: 'no canvas' };
    const ctx = c.getContext('2d');
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
    }
    return { ok: lit > 50, lit, w: c.width, h: c.height };
  });
  check(painted.ok, 'map canvas is actually painted', `${painted.lit} lit samples, ${painted.w}x${painted.h}`);

  // site back-link
  const back = page.locator("a[data-yw-site-back]").first();
  check(await back.isVisible(), 'site back-link is visible on the viewer');
  const backHref = await back.getAttribute('href');
  check(backHref === '../', 'back-link points at the site root under the subpath', backHref);

  // live feed connects over the network (real API, so allow for failure)
  let live = false;
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes('ライブ') || document.body.innerText.includes('LIVE'),
      { timeout: 30_000 },
    );
    live = true;
  } catch {
    /* network or provider unavailable */
  }
  check(live, 'viewer reaches the live connection state', live ? 'ライブ/LIVE shown' : 'TIMED OUT — provider may be down');

  // navigation back to the landing page
  await back.click();
  await page.waitForLoadState('domcontentloaded');
  check(page.url().endsWith(`${PREFIX}/`), 'back-link returns to the landing page', page.url());

  await context.close();
}

/* ---------------------------------------------------------- offline state */

{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/viewer/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app', { timeout: 20_000 });
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  await page.waitForTimeout(6000);
  const offlineText = await page.evaluate(() => document.body.innerText);
  const showsOffline = offlineText.includes('オフライン') || offlineText.includes('Offline');
  check(showsOffline, 'offline is stated in words, not only a dot', showsOffline ? 'オフライン shown' : 'not shown');
  const showsUnknown = offlineText.includes('状態不明') || offlineText.includes('Status unknown');
  check(showsUnknown, 'offline also marks the alert state as unconfirmed', showsUnknown ? '状態不明 shown' : 'not shown');
  await context.setOffline(false);
  await context.close();
}

/* ------------------------------------------------------ simulation state */

{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/viewer/?demo=warning`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app', { timeout: 20_000 });
  await page.waitForTimeout(3500);
  const text = await page.evaluate(() => document.body.innerText);
  check(/SIMULATION|シミュレーション/i.test(text), 'simulated data is labelled as simulation');
  const bannerSim = await page.evaluate(() => !!document.querySelector('.alert--sim, [class*="sim"]'));
  check(bannerSim, 'simulated alert carries the simulation marker in the DOM');

  // simulated alerts must not reach the speech engine by default
  const spoke = await page.evaluate(
    () => typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.speaking,
  );
  check(!spoke, 'simulated alert does not trigger real alert speech by default');
  await context.close();
}

/* ---------------------------------------------------------------- report -- */

await browser.close();
stop();

console.log('');
if (failures.length) {
  console.log(`${passed} passed, ${failures.length} FAILED`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passed}/${passed} checks passed`);
