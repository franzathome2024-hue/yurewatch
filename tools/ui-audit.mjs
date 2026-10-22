#!/usr/bin/env node
/**
 * Interface audit harness (Milestone 1).
 *
 * Measures the shipped single-file build in headless Chromium: does the map keep
 * its controls inside its own pane, does anything hang below the fold, does the
 * sheet stay reachable, does a legend overlap the controls — across six viewport
 * classes and every demo state. It also captures the before/after screenshots
 * used in `docs/qa/ui-comparison.png`.
 *
 * Usage
 *   node tools/ui-audit.mjs matrix [htmlPath]
 *   node tools/ui-audit.mjs shots <htmlPath> <outDir>
 *   node tools/ui-audit.mjs compare <gitRef>      # before/after sheets + matrix
 *
 * `compare` builds the given ref in a temporary git worktree, so the "before"
 * column is produced from the same harness as the "after" column.
 *
 * Requires Playwright (devDependency) and, for `compare`, python3 + Pillow for
 * the contact sheet — the same pair the map QA comparison already uses.
 *
 * Nothing here validates a physical device: results are Chromium at the given
 * CSS pixel sizes, with deviceScaleFactor 2 for screenshots only.
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_HTML = join(ROOT, 'dist/yurewatch.html');

const VIEWPORTS = [
  [1920, 1080, 'desktop 1920x1080'],
  [1366, 768, 'laptop 1366x768'],
  [820, 1180, 'tablet portrait 820x1180'],
  [390, 844, 'phone portrait 390x844'],
  [740, 360, 'phone landscape 740x360'],
  [360, 800, 'phone portrait 360x800'],
];

const DEMOS = [
  'normal',
  'forecast',
  'warning',
  'updated',
  'cancelled',
  'historical',
  'disconnect',
  'stale',
  'unavailable',
  'tsunami',
];

/** Demo states that raise an EEW banner shortly after start-up. */
const ALERT_DEMOS = new Set(['forecast', 'warning', 'updated', 'cancelled']);

const SHOTS = [
  ['desktop-1366-normal', 1366, 768, 'normal'],
  ['laptop-1440-warning', 1440, 900, 'warning'],
  ['tablet-820-normal', 820, 1180, 'normal'],
  ['phone-390-normal', 390, 844, 'normal'],
  ['landscape-740-warning', 740, 360, 'warning'],
  ['phone-360-tsunami', 360, 800, 'tsunami'],
];

function serve(htmlPath) {
  const html = readFileSync(htmlPath);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

async function settle(page, demo) {
  await page.waitForSelector('.app');
  await page.waitForTimeout(400);
  if (ALERT_DEMOS.has(demo)) {
    await page
      .waitForFunction(() => document.querySelector('.app')?.classList.contains('app--alert'), null, {
        timeout: 6_000,
      })
      .catch(() => {});
  }
  await page.waitForTimeout(600);
}

async function matrix(htmlPath) {
  const server = await serve(htmlPath);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const rows = [];
  for (const [w, h, label] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    for (const demo of DEMOS) {
      await page.goto(`${origin}/?demo=${demo}&lang=ja`, { waitUntil: 'load' });
      await settle(page, demo);
      rows.push({
        vp: `${w}x${h}`,
        label,
        demo,
        ...(await page.evaluate(() => {
          const box = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
          const overlaps = (a, b) =>
            !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
          const pane = box('.mapPane');
          const controls = box('.mapControls');
          const legend = box('.mapBtn--legend');
          const banner = document.querySelector('.simBanner');
          const bannerBox = banner && !banner.hidden ? banner.getBoundingClientRect() : null;
          const inside =
            pane &&
            controls &&
            controls.top >= pane.top - 0.5 &&
            controls.bottom <= pane.bottom + 0.5 &&
            controls.left >= pane.left - 0.5 &&
            controls.right <= pane.right + 0.5;
          const clipped = ['.mapPane', '.side', '.sheet__handle', '.mapControls', '.statusStrip'].filter(
            (sel) => {
              const el = document.querySelector(sel);
              if (!el || !el.getClientRects().length) return false;
              const r = el.getBoundingClientRect();
              return (
                r.bottom > window.innerHeight + 0.5 ||
                r.right > window.innerWidth + 0.5 ||
                r.top < -0.5
              );
            },
          );
          return {
            overflowX: document.documentElement.scrollWidth - window.innerWidth,
            overflowY: document.documentElement.scrollHeight - window.innerHeight,
            controlsInsidePane: Boolean(inside),
            legendOverlapsControls: Boolean(controls && legend && overlaps(controls, legend)),
            clipped,
            mapPaneHeight: pane ? Math.round(pane.height) : 0,
            alertHeight: Math.round(box('.alert')?.height ?? 0),
            bannerMapShare:
              bannerBox && pane
                ? Math.round(((bannerBox.width * bannerBox.height) / (pane.width * pane.height)) * 100)
                : 0,
          };
        })),
      });
    }
    await page.close();
  }
  await browser.close();
  server.close();

  const bad = rows.filter(
    (r) => r.overflowX > 0 || r.overflowY > 0 || !r.controlsInsidePane || r.legendOverlapsControls || r.clipped.length,
  );
  for (const r of bad) {
    const reasons = [];
    if (r.overflowX > 0) reasons.push(`h-overflow ${r.overflowX}px`);
    if (r.overflowY > 0) reasons.push(`v-overflow ${r.overflowY}px`);
    if (!r.controlsInsidePane) reasons.push('controls outside pane');
    if (r.legendOverlapsControls) reasons.push('legend/controls overlap');
    if (r.clipped.length) reasons.push(`clipped: ${r.clipped.join(',')}`);
    console.log(`FAIL ${r.vp} ${r.demo.padEnd(11)} ${reasons.join('; ')}`);
  }
  console.log(`\n${rows.length - bad.length}/${rows.length} layout states clean across ${VIEWPORTS.length} viewports`);
  return bad.length === 0;
}

async function shots(htmlPath, outDir) {
  const server = await serve(htmlPath);
  const origin = `http://127.0.0.1:${server.address().port}`;
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const [name, w, h, demo] of SHOTS) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await page.goto(`${origin}/?demo=${demo}&lang=ja`, { waitUntil: 'load' });
    await settle(page, demo);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    await page.close();
  }
  await browser.close();
  server.close();
  console.log(`screenshots -> ${outDir}`);
}

/** Contact sheet: before (left) / after (right) for three representative states. */
function contactSheet(beforeDir, afterDir, outFile) {
  const py = `
import sys
from PIL import Image, ImageDraw, ImageFont
before_dir, after_dir, out = sys.argv[1:4]
pairs = [
    ('landscape-740-warning', 'landscape phone 740x360 \u2014 EEW warning'),
    ('desktop-1366-normal', 'desktop 1366x768 \u2014 demo idle'),
    ('phone-390-normal', 'phone 390x844 \u2014 demo idle'),
]
pad, label_h, gap, target_w = 24, 34, 28, 760
rows = []
for name, cap in pairs:
    b = Image.open(f'{before_dir}/{name}.png')
    a = Image.open(f'{after_dir}/{name}.png')
    def fit(im):
        r = target_w / im.width
        return im.resize((target_w, max(1, round(im.height * r))), Image.LANCZOS)
    b, a = fit(b), fit(a)
    rows.append((cap, b, a, max(b.height, a.height)))
W = pad * 2 + target_w * 2 + gap
H = pad + sum(label_h + h + gap for _, _, _, h in rows)
canvas = Image.new('RGB', (W, H), (14, 17, 20))
d = ImageDraw.Draw(canvas)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except Exception:
    font = ImageFont.load_default()
y = pad
for cap, b, a, h in rows:
    d.text((pad, y), f'{cap}   |   before  \u2192  after', fill=(220, 226, 232), font=font)
    y += label_h
    canvas.paste(b, (pad, y))
    canvas.paste(a, (pad + target_w + gap, y))
    y += h + gap
canvas.save(out, optimize=True)
print(out, canvas.size)
`;
  execFileSync('python3', ['-c', py, beforeDir, afterDir, outFile], { stdio: 'inherit' });
}

async function compare(ref) {
  const worktree = mkdtempSync(join(tmpdir(), 'yurewatch-ui-'));
  const beforeDir = join(ROOT, 'docs/qa/ui-before');
  const afterDir = join(ROOT, 'docs/qa/ui-after');
  console.log(`building ${ref} in ${worktree}`);
  execFileSync('git', ['worktree', 'add', '--detach', worktree, ref], { cwd: ROOT, stdio: 'inherit' });
  try {
    const modules = join(ROOT, 'node_modules');
    if (existsSync(modules)) execFileSync('ln', ['-sfn', modules, join(worktree, 'node_modules')]);
    execFileSync('npm', ['run', 'build'], { cwd: worktree, stdio: 'inherit' });
    const beforeHtml = join(worktree, 'dist/yurewatch.html');
    await shots(beforeHtml, beforeDir);
    await shots(DEFAULT_HTML, afterDir);
    contactSheet(beforeDir, afterDir, join(ROOT, 'docs/qa/ui-comparison.png'));
    console.log('\n--- matrix, before ---');
    const beforeClean = await matrix(beforeHtml);
    console.log('\n--- matrix, after ---');
    const afterClean = await matrix(DEFAULT_HTML);
    console.log(`\nbefore clean: ${beforeClean} | after clean: ${afterClean}`);
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, stdio: 'inherit' });
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'matrix') {
  const ok = await matrix(rest[0] ? resolve(rest[0]) : DEFAULT_HTML);
  process.exitCode = ok ? 0 : 1;
} else if (command === 'shots') {
  if (!rest[0] || !rest[1]) {
    console.error('usage: node tools/ui-audit.mjs shots <htmlPath> <outDir>');
    process.exit(2);
  }
  await shots(resolve(rest[0]), resolve(rest[1]));
} else if (command === 'compare') {
  await compare(rest[0] ?? 'v0.3.0');
} else {
  console.error('usage: node tools/ui-audit.mjs matrix [html] | shots <html> <dir> | compare <ref>');
  process.exit(2);
}
