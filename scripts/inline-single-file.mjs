#!/usr/bin/env node
/**
 * Post-build step: fold the Vite output into ONE self-contained HTML file.
 *
 * Why: the Android shell ships `assets/index.html` and loads it from file://.
 * A single file with no external requests means there is no local server, no
 * localhost, no CORS surprises and nothing to start manually — the app opens
 * straight into the map. The same file is what `dist/` serves for the web build.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const dist = join(root, 'dist');
const htmlPath = join(dist, 'index.html');

if (!existsSync(htmlPath)) {
  console.error('inline-single-file: dist/index.html not found — run `vite build` first.');
  process.exit(1);
}

let html = readFileSync(htmlPath, 'utf8');
let inlinedScripts = 0;
let inlinedStyles = 0;

// 1. Inline stylesheets.
html = html.replace(
  /<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  (match, href) => {
    const file = join(dist, href.replace(/^\//, ''));
    if (!existsSync(file)) return match;
    const css = readFileSync(file, 'utf8');
    inlinedStyles += 1;
    return `<style>\n${css}\n</style>`;
  },
);

// 2. Collect module scripts (Vite emits one IIFE bundle in this config) and
//    move them to the end of <body>. Vite hoists `<script type="module">` into
//    <head>; once inlined it is a *classic* script there, which would run before
//    the document body exists. Re-inserting before </body> restores the deferred
//    semantics the module tag had.
const scripts = [];
html = html.replace(
  /<script[^>]*src="([^"]+)"[^>]*><\/script>/g,
  (match, src) => {
    const file = join(dist, src.replace(/^\//, ''));
    if (!existsSync(file)) return match;
    scripts.push(readFileSync(file, 'utf8'));
    inlinedScripts += 1;
    return '';
  },
);
if (!scripts.length) {
  console.error('inline-single-file: no script bundle found to inline.');
  process.exit(1);
}
const scriptBlock = scripts
  .map((js) => `<script>\n${js}\n</script>`)
  .join('\n');
// NOTE: a function replacer is required here. The minified bundle contains
// sequences such as `$'` and `$&`, which String.replace would otherwise expand
// as substitution patterns and splice document fragments into the code.
html = html.includes('</body>')
  ? html.replace('</body>', () => `${scriptBlock}\n  </body>`)
  : `${html}\n${scriptBlock}`;

// 3. Drop the modulepreload hints (nothing left to preload).
html = html.replace(/<link[^>]+rel="modulepreload"[^>]*>/g, '');

// 4. Remove the boot placeholder markup is done by the app itself on mount.
const banner = `<!-- YureWatch single-file build. Source: https://github.com/ (see README). Map data: Natural Earth (public domain). -->`;
if (!html.includes('YureWatch single-file build')) {
  html = html.replace('<!doctype html>', () => `<!doctype html>\n${banner}`);
}

const outPath = join(dist, 'yurewatch.html');
writeFileSync(outPath, html, 'utf8');
writeFileSync(htmlPath, html, 'utf8');

// 5. Copy into the Android asset directory if the shell exists. This is the
//    folder passed to `aapt2 link -A`, see tools/build-apk.sh.
const androidAssets = join(root, 'android', 'app', 'assets');
if (existsSync(join(root, 'android'))) {
  mkdirSync(androidAssets, { recursive: true });
  copyFileSync(outPath, join(androidAssets, 'index.html'));
}

const sizeKb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(
  `inline-single-file: wrote dist/yurewatch.html (${sizeKb} KiB) — ${inlinedScripts} script(s), ${inlinedStyles} stylesheet(s) inlined; external refs remaining: ${(html.match(/(src|href)="(https?:)?\/\//g) ?? []).length}`,
);

// 6. Verify no external network references slipped in (fonts, CDNs, images).
const external = [...html.matchAll(/(?:src|href)="((?:https?:)?\/\/[^"]+)"/g)].map((m) => m[1]);
if (external.length) {
  console.error('inline-single-file: external references found, the offline build would break:', external);
  process.exit(1);
}
