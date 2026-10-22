import { chromium } from 'playwright';
const [, , url, out, w, h, act, lon, lat, zoom] = process.argv;
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url, { waitUntil: 'load' });
await p.waitForSelector('.app');
await p.waitForTimeout(4000);
if (lon && lat) { await p.evaluate(([lo, la]) => window.__yurewatch.focus(lo, la), [+lon, +lat]); await p.waitForTimeout(400); }
if (zoom) { for (let i = 0; i < +zoom; i++) { await p.evaluate(() => window.__yurewatch.zoom(1.6)); await p.waitForTimeout(180); } }
await p.waitForTimeout(900);
await p.screenshot({ path: out });
if (errs.length) console.log('ERRORS', errs);
await b.close();
