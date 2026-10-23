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
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

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

  // structured data + a real contact route (added after an external
  // site-quality scan flagged both as missing; keep them from regressing)
  const structured = await page.evaluate(() => {
    const out = { jsonLd: false, contact: false };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const d = JSON.parse(s.textContent ?? '');
        if (d && (d['@type'] || d['@graph'])) out.jsonLd = true;
      } catch { /* unparseable JSON-LD does not count */ }
    }
    out.contact = !!document.querySelector('a[href*="github.com/franzathome2024-hue/yurewatch/issues"]');
    return out;
  });
  check(structured.jsonLd, 'landing carries parseable JSON-LD structured data');
  check(structured.contact, 'landing links to the issue tracker as its contact route');

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

/* ------------------------------------------------------------ PWA layer -- */

{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/viewer/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app', { timeout: 20_000 });

  // manifest: linked, valid, subpath-relative, installable shape
  const manifestHref = await page.evaluate(
    () => document.querySelector('link[rel="manifest"]')?.href ?? null,
  );
  check(!!manifestHref, 'viewer links a web app manifest', manifestHref ?? 'none');
  let manifest = null;
  try {
    const res = await fetch(manifestHref);
    check(res.status === 200, 'manifest is served', `HTTP ${res.status}`);
    manifest = await res.json();
  } catch (e) {
    check(false, 'manifest is valid JSON', String(e));
  }
  if (manifest) {
    check(!!manifest.name && !!manifest.short_name, 'manifest has name and short_name');
    check(manifest.display === 'standalone', 'manifest display is standalone');
    const start = new URL(manifest.start_url, manifestHref);
    const scope = new URL(manifest.scope, manifestHref);
    check(
      start.pathname === `${PREFIX}/viewer/` && scope.pathname === `${PREFIX}/viewer/`,
      'manifest start_url and scope resolve inside the Pages subpath',
      `${start.pathname} / ${scope.pathname}`,
    );
    // icons: declared sizes must match the actual PNG pixels
    const pngSize = async (u) => {
      const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
      const ok = buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      return ok ? `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` : 'not-png';
    };
    let iconsOk = true;
    let detail = [];
    for (const icon of manifest.icons ?? []) {
      const actual = await pngSize(new URL(icon.src, manifestHref).href);
      detail.push(`${icon.sizes}=${actual}`);
      if (actual !== icon.sizes) iconsOk = false;
    }
    check(iconsOk, 'manifest icon sizes match the real PNG pixels', detail.join(', '));
    check(
      (manifest.icons ?? []).some((i) => String(i.purpose).includes('maskable')),
      'manifest declares a maskable icon',
    );
  }

  // service worker: registered, correctly scoped, shell cached, feed untouched
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.ready;
    return {
      supported: true,
      scope: reg.scope,
      script: reg.active?.scriptURL ?? null,
    };
  });
  check(swState.supported, 'service worker API available');
  check(
    (swState.scope ?? '').endsWith(`${PREFIX}/viewer/`),
    'service worker scope is the viewer directory under the subpath',
    swState.scope,
  );
  check((swState.script ?? '').endsWith(`${PREFIX}/viewer/sw.js`), 'active worker is viewer/sw.js', swState.script);

  const cacheState = await page.evaluate(async () => {
    const keys = await caches.keys();
    const entries = [];
    for (const key of keys) {
      const cache = await caches.open(key);
      for (const req of await cache.keys()) entries.push(req.url);
    }
    return { keys, entries };
  });
  check(
    cacheState.keys.some((k) => k.startsWith('yurewatch-viewer-')),
    'app shell cache exists',
    cacheState.keys.join(', '),
  );
  check(
    cacheState.entries.some((u) => u.endsWith('/viewer/index.html')) &&
      cacheState.entries.some((u) => u.endsWith('/viewer/icons/icon-512.png')),
    'cache holds the shell and icons (offline startup assets)',
    `${cacheState.entries.length} entries`,
  );

  // live data must flow with the worker active, and must never enter a cache
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app', { timeout: 20_000 });
  let liveOk = false;
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes('ライブ') || document.body.innerText.includes('LIVE'),
      { timeout: 30_000 },
    );
    liveOk = true;
  } catch { /* provider unreachable */ }
  check(liveOk, 'live feed still loads with the service worker controlling the page');
  const cachesAfterLive = await page.evaluate(async () => {
    const out = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const req of await cache.keys()) out.push(req.url);
    }
    return out;
  });
  check(
    cachesAfterLive.every((u) => !u.includes('p2pquake') && new URL(u).origin === new URL(BASE).origin),
    'no feed/API response is ever written to a cache',
    `${cachesAfterLive.length} cached URLs, all same-origin shell`,
  );

  // failed deployment: server 404s the shell, the cached one must still boot
  const indexFile = join(ROOT, '_site', 'viewer', 'index.html');
  const backup = `${indexFile}.pwa-test-bak`;
  renameSync(indexFile, backup);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#app', { timeout: 20_000 });
    const bootGone = await page.evaluate(() => !document.getElementById('boot'));
    check(bootGone, 'broken deployment (shell 404) falls back to the cached shell');
  } catch (e) {
    check(false, 'broken deployment (shell 404) falls back to the cached shell', String(e).slice(0, 120));
  } finally {
    renameSync(backup, indexFile);
  }

  // offline startup from cache: boots, and says so instead of faking "live"
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app', { timeout: 20_000 });
  check(true, 'viewer starts offline from the cached shell');
  await page.waitForTimeout(4000);
  const offlineText = await page.evaluate(() => document.body.innerText);
  check(
    offlineText.includes('オフライン') || offlineText.includes('Offline'),
    'offline startup shows the explicit offline state',
  );
  check(
    (offlineText.includes('データなし') || offlineText.includes('No data')) &&
      !offlineText.includes('ライブ'),
    'offline startup claims no live data (no-data, never "live")',
  );
  // reconnect: the live state must come back without reinstalling anything
  await context.setOffline(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app', { timeout: 20_000 });
  let backLive = false;
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes('ライブ') || document.body.innerText.includes('LIVE'),
      { timeout: 30_000 },
    );
    backLive = true;
  } catch { /* provider unreachable */ }
  check(backLive, 'viewer recovers to live after reconnect');

  // update path: a changed worker must activate and evict the old cache
  const swFile = join(ROOT, '_site', 'viewer', 'sw.js');
  const swOriginal = readFileSync(swFile, 'utf8');
  const marker = "const VERSION = 'v1'";
  check(swOriginal.includes(marker), 'service worker carries a cache version marker');
  if (swOriginal.includes(marker)) {
    try {
      writeFileSync(swFile, swOriginal.replace(marker, "const VERSION = 'v2-pwatest'"));
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg.update();
      });
      await page.waitForFunction(
        async () => {
          const keys = await caches.keys();
          return keys.some((k) => k.includes('v2-pwatest')) && !keys.includes('yurewatch-viewer-v1');
        },
        null,
        { timeout: 30_000 },
      );
      check(true, 'updated worker activates and deletes the previous cache');
    } catch (e) {
      check(false, 'updated worker activates and deletes the previous cache', String(e).slice(0, 120));
    } finally {
      writeFileSync(swFile, swOriginal);
      try {
        await page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          await reg.update();
        });
        await page.waitForFunction(
          async () => (await caches.keys()).includes('yurewatch-viewer-v1'),
          null,
          { timeout: 30_000 },
        );
      } catch { /* the next natural page load restores it */ }
    }
  }

  await context.close();
}

/* ------------------------------------------------- history persistence -- */

{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/viewer/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app', { timeout: 20_000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  // a successful live session persists a bounded event history
  let stored = false;
  try {
    await page.waitForFunction(
      () =>
        (window.__yurewatch?.store().events.length ?? 0) > 0 &&
        !!localStorage.getItem('yurewatch.history.v1'),
      { timeout: 30_000 },
    );
    stored = true;
  } catch { /* provider unreachable */ }
  check(stored, 'live session persists recent-event history to storage');

  if (stored) {
    const payload = await page.evaluate(() => JSON.parse(localStorage.getItem('yurewatch.history.v1')));
    check(
      !('alert' in payload) && !('tsunami' in payload) && Array.isArray(payload.events),
      'history snapshot contains events only (no EEW/tsunami state to resurrect)',
      Object.keys(payload).join(', '),
    );

    // cold start with no network: history shows, labelled, no alert revived
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#app', { timeout: 20_000 });
    await page.waitForTimeout(1500);
    const restored = await page.evaluate(() => {
      const s = window.__yurewatch.store();
      return {
        events: s.events.length,
        alert: s.alert,
        snapshotAt: s.historySnapshotAt,
        lastSuccessAt: s.health.lastSuccessAt,
      };
    });
    check(restored.events > 0, 'offline cold start restores saved events', `${restored.events} events`);
    check(restored.alert === null, 'offline cold start revives no EEW alert');
    check(
      restored.snapshotAt !== null && restored.lastSuccessAt === null,
      'restored history is marked as a snapshot, freshness stays unclaimed',
    );
    const text = await page.evaluate(() => document.body.innerText);
    check(
      text.includes('保存済みの履歴') || text.includes('Saved history'),
      'status strip labels the data as saved history',
    );
    await context.setOffline(false);
  }
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
  // The state flips via the window 'offline' event or the next failing poll
  // (idle cadence is 20 s), so wait for the wording instead of sleeping a
  // fixed interval that races the poll schedule.
  try {
    await page.waitForFunction(
      () => document.body.innerText.includes('オフライン') || document.body.innerText.includes('Offline'),
      { timeout: 30_000 },
    );
  } catch { /* fall through to the checks below, which will report it */ }
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
