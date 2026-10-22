/**
 * Assemble and validate the GitHub Pages site.
 *
 * The site is a thin shell around the *existing* single-file web build: there is
 * one application and one build. `dist/yurewatch.html` is copied verbatim to
 * `viewer/index.html` and the landing page is hand-written static HTML with no
 * framework, no CDN and no third-party dependency.
 *
 * Everything is written into `_site/`, which is the artifact GitHub Pages
 * publishes. Nothing here touches the Android build or any release asset.
 *
 * The script fails loudly (non-zero exit) when:
 *  - a referenced local asset does not exist in the built tree,
 *  - any page contains a root-absolute path (which would break under /yurewatch/),
 *  - the shipped viewer is not self-contained,
 *  - a screenshot named in SCREENSHOTS is missing from docs/screenshots/.
 *
 *   node tools/build-site.mjs
 */

import {
  mkdirSync,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_SRC = join(ROOT, 'site');
const SHOTS_SRC = join(ROOT, 'docs', 'screenshots');
const OUT = join(ROOT, '_site');
const VIEWER_SRC = join(ROOT, 'dist', 'yurewatch.html');

const SITE_URL = 'https://franzathome2024-hue.github.io/yurewatch/';

/** Screenshots copied into the site. Every one is a real captured app state. */
const SCREENSHOTS = [
  'desktop-live.png',
  'desktop-eew-warning.png',
  'desktop-eew-cancelled.png',
  'desktop-tsunami.png',
  'desktop-detail.png',
  'desktop-info.png',
  'desktop-legend.png',
  'mobile-live.png',
  'mobile-eew-warning.png',
  'en-desktop-live.png',
];

const problems = [];
const fail = (msg) => problems.push(msg);

/* ------------------------------------------------------------------ reset -- */

if (existsSync(OUT)) rmrf(OUT);
mkdirSync(OUT, { recursive: true });

// GitHub Pages never runs Jekyll for Actions deployments, but the marker costs
// one byte and removes any chance of `_`-prefixed paths being skipped.
writeFileSync(join(OUT, '.nojekyll'), '');

function rmrf(p) {
  for (const entry of readdirSync(p)) {
    const full = join(p, entry);
    if (statSync(full).isDirectory()) rmrf(full);
    else unlinkSync(full);
  }
  rmdirSync(p);
}

/* --------------------------------------------------------------- assemble -- */

// 1. Static site shell (site/ -> _site/), preserving relative directory layout.
let copied = 0;
function copyDir(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(dst, { recursive: true });
      copyDir(src, dst);
    } else {
      copyFileSync(src, dst);
      copied++;
    }
  }
}

if (!existsSync(SITE_SRC)) fail(`site source directory missing: ${relative(ROOT, SITE_SRC)}`);
else {
  mkdirSync(OUT, { recursive: true });
  copyDir(SITE_SRC, OUT);
}

// 2. The real viewer, unmodified apart from the injected site back-link.
if (!existsSync(VIEWER_SRC)) {
  fail(`viewer build missing: ${relative(ROOT, VIEWER_SRC)} (run \`npm run build\` first)`);
} else {
  mkdirSync(join(OUT, 'viewer'), { recursive: true });
  copyFileSync(VIEWER_SRC, join(OUT, 'viewer', 'index.html'));
  injectBackLink(join(OUT, 'viewer', 'index.html'));
}

// 3. Screenshots, referenced from the landing page.
const shotDir = join(OUT, 'assets', 'screenshots');
mkdirSync(shotDir, { recursive: true });
for (const name of SCREENSHOTS) {
  const src = join(SHOTS_SRC, name);
  if (!existsSync(src)) fail(`screenshot listed in build-site.mjs is missing: docs/screenshots/${name}`);
  else copyFileSync(src, join(shotDir, name));
}

/* ------------------------------------------------------------ back-link --- */

/**
 * The viewer is the shipped single-file app; we do not fork it. A fixed-position
 * link is injected so it floats above the layout and cannot change the app's
 * measured viewport (framing, canvas size and the QA harness stay untouched).
 */
function injectBackLink(file) {
  const html = readFileSync(file, 'utf8');
  if (html.includes('data-yw-site-back')) return;
  const link =
    '<a data-yw-site-back class="yw-site-back" href="../" rel="noopener">' +
    '<span aria-hidden="true">&#8592;</span> YureWatch' +
    '</a>';
  const style =
    '<style data-yw-site-back-style>' +
    '.yw-site-back{position:fixed;left:12px;bottom:12px;z-index:2147483000;' +
    'display:inline-flex;align-items:center;gap:.4rem;padding:.45rem .8rem;' +
    'border-radius:999px;background:#0d141d;color:#e9eff7;border:1px solid #2b3a4d;' +
    'font:600 13px/1.2 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;' +
    'text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.45);' +
    'transition:background .15s ease}' +
    '.yw-site-back:hover,.yw-site-back:focus-visible{background:#16212e}' +
    '.yw-site-back:focus-visible{outline:2px solid #ffd23f;outline-offset:2px}' +
    '@media (max-width:480px){.yw-site-back{left:8px;bottom:8px;font-size:12px;padding:.4rem .7rem}}' +
    '</style>';
  const out = html
    .replace(/(<head\b[^>]*>)/i, `$1${style}`)
    .replace(/(<body\b[^>]*>)/i, `$1${link}`);
  if (out === html) fail('could not inject the site back-link into the viewer (<head>/<body> not found)');
  writeFileSync(file, out);
}

/* --------------------------------------------------------------- validate -- */

const htmlFiles = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) htmlFiles.push(full);
  }
}
if (existsSync(OUT)) walk(OUT);

const isExternal = (u) => /^(https?:)?\/\//i.test(u) || u.startsWith('mailto:') || u.startsWith('tel:') || u.startsWith('data:');

for (const file of htmlFiles) {
  const rel = relative(OUT, file).split(sep).join('/');
  const html = readFileSync(file, 'utf8');

  // (a) every local href/src must resolve inside the artifact
  for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (!url || url.startsWith('#') || isExternal(url)) continue;
    const clean = url.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = resolve(dirname(file), clean);
    if (!existsSync(target)) fail(`${rel}: broken asset reference "${url}"`);
  }

  // (b) no root-absolute paths: the site lives under /yurewatch/, not /
  for (const m of html.matchAll(/\b(?:href|src)="(\/[^"]*)"/g)) {
    fail(`${rel}: root-absolute path "${m[1]}" would resolve to the domain root, not /yurewatch/`);
  }

  // (c) no external stylesheets, scripts or fonts
  for (const m of html.matchAll(/<(?:link|script|img)[^>]*\b(?:href|src)="(https?:\/\/[^"]+)"/g)) {
    // the og:image / canonical metadata is fine; executable/visual assets are not
    if (/<link[^>]*rel="(stylesheet|preload|font)"/i.test(m[0])) {
      fail(`${rel}: external resource "${m[1]}" — the site must be self-contained`);
    }
  }
}

// (d) the viewer must remain a single self-contained file
const viewerPath = join(OUT, 'viewer', 'index.html');
if (existsSync(viewerPath)) {
  const viewer = readFileSync(viewerPath, 'utf8');
  if (/(?:src|href)="(?:https?:)?\/\//i.test(viewer)) {
    fail('viewer/index.html references an external resource — the single-file build regressed');
  }
  if (!viewer.includes('data-yw-site-back')) fail('viewer/index.html is missing the injected site back-link');
}

// (e) the landing page must exist and carry the required metadata
const landing = join(OUT, 'index.html');
if (!existsSync(landing)) fail('landing page missing: _site/index.html');
else {
  const html = readFileSync(landing, 'utf8');
  for (const need of [
    ['<title>', 'a <title>'],
    ['name="description"', 'a meta description'],
    ['rel="canonical"', 'a canonical URL'],
    ['property="og:title"', 'Open Graph metadata'],
    ['rel="icon"', 'a favicon'],
  ]) {
    if (!html.includes(need[0])) fail(`landing page is missing ${need[1]}`);
  }
  if (!html.includes(SITE_URL)) fail(`landing page canonical/OG metadata does not reference ${SITE_URL}`);
}

// (f) no unreferenced screenshots shipped (keeps the artifact small)
if (existsSync(shotDir)) {
  const landingHtml = existsSync(landing) ? readFileSync(landing, 'utf8') : '';
  for (const name of readdirSync(shotDir)) {
    if (!landingHtml.includes(name)) fail(`screenshot shipped but never referenced: assets/screenshots/${name}`);
  }
}

/* ---------------------------------------------------------------- report -- */

const totalBytes = existsSync(OUT)
  ? (function size(dir) {
      let n = 0;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const f = join(dir, e.name);
        n += e.isDirectory() ? size(f) : statSync(f).size;
      }
      return n;
    })(OUT)
  : 0;

console.log(`site: copied ${copied} static file(s), ${SCREENSHOTS.length} screenshot(s)`);
console.log(`site: viewer ${existsSync(viewerPath) ? (statSync(viewerPath).size / 1024).toFixed(1) + ' KiB' : 'MISSING'}`);
console.log(`site: artifact ${(totalBytes / 1024 / 1024).toFixed(2)} MiB at ${relative(ROOT, OUT)}/`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s) found:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('site: validation passed (no broken paths, no root-absolute refs, viewer self-contained)');
