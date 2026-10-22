#!/usr/bin/env node
/**
 * Map framing / clipping QA harness.
 *
 * Loads the *built* single-file app in a real Chromium, then for every viewport
 * class measures what the camera actually did and whether the geography the app
 * claims to show is still on the canvas.
 *
 * The check is deliberately not a unit test: it reads the live camera from the
 * running app, re-projects the shipped geometry with the same maths, and then
 * compares that prediction against the pixels the renderer produced. A framing
 * bug that only appears at one viewport shape shows up here and nowhere else.
 *
 * Usage:
 *   npm run build
 *   node tools/map-qa.mjs [--label before|after] [--out docs/qa] [--headed]
 *
 * Exit code is non-zero if any viewport fails a check, so CI can gate on it.
 */
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BUILD = join(ROOT, 'dist', 'yurewatch.html');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const LABEL = arg('label', 'run');
const OUT = resolve(ROOT, arg('out', 'docs/qa'));
const SHOTS = join(OUT, LABEL);
mkdirSync(SHOTS, { recursive: true });

/* ---------------------------------------------------------------- geometry -- */

const MAP = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'japan-map.json'), 'utf8'));

const lonX = (lon) => (lon + 180) / 360;
const latY = (lat) => {
  const r = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / (2 * Math.PI);
};

/**
 * Ring area in world units, matching mapData.buildShape(): rings are sorted by
 * descending area there, so the app's ring indices are area-rank order, not the
 * order the JSON happens to store. The harness has to sort the same way or it
 * checks the wrong rings.
 */
function ringArea(ring) {
  let sum = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = lonX(ring[i][0]);
    const yi = latY(ring[i][1]);
    const xj = lonX(ring[j][0]);
    const yj = latY(ring[j][1]);
    sum += xj * yi - xi * yj;
  }
  return Math.abs(sum / 2);
}

/** Every shipped ring, in lon/lat, with the prefecture (or country) it belongs to. */
const FEATURES = [
  ...MAP.prefectures.flatMap((p) =>
    [...p.rings]
      .map((ring, original) => ({ ring, original, area: ringArea(ring) }))
      .sort((a, b) => b.area - a.area)
      .map(({ ring }, i) => ({ kind: 'pref', code: p.code, name: p.name, index: i, ring })),
  ),
  ...MAP.land.flatMap((l) =>
    l.rings.map((ring, i) => ({ kind: 'context', code: l.name, name: l.name, index: i, ring })),
  ),
];

function ringBox(ring) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return { w, s, e, n };
}

function centroid(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cross = xj * yi - xi * yj;
    a += cross;
    cx += (xj + xi) * cross;
    cy += (yj + yi) * cross;
  }
  if (Math.abs(a) < 1e-12) return null;
  return [cx / (3 * a), cy / (3 * a)];
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const toScreen = (cam, p) => ({
  x: (lonX(p.lon) - cam.cx) * cam.scale + cam.w / 2,
  y: (latY(p.lat) - cam.cy) * cam.scale + cam.h / 2,
});

/** Screen-space AABB of a ring. */
function screenBox(cam, box) {
  const a = toScreen(cam, { lon: box.w, lat: box.n });
  const b = toScreen(cam, { lon: box.e, lat: box.s });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/* ------------------------------------------------------------------- cases -- */

const CASES = [
  { id: 'desktop-landscape', label: 'Desktop landscape', w: 1920, h: 1080, query: 'demo=normal' },
  { id: 'laptop-landscape', label: 'Laptop landscape', w: 1366, h: 768, query: 'demo=normal' },
  { id: 'tablet-landscape', label: 'Tablet landscape', w: 1024, h: 768, query: 'demo=normal' },
  { id: 'tablet-portrait', label: 'Tablet portrait', w: 820, h: 1180, query: 'demo=normal' },
  { id: 'android-portrait', label: 'Narrow Android portrait', w: 360, h: 740, query: 'demo=normal', dpr: 2 },
  { id: 'android-landscape', label: 'Android landscape', w: 740, h: 360, query: 'demo=normal', dpr: 2 },
];

/** Runs after load: exercise the dynamic layouts the audit calls out. */
const DYNAMIC = [
  {
    id: 'resize-after-launch',
    label: 'Resize after launch (1440x900 -> 900x1200)',
    w: 1440,
    h: 900,
    query: 'demo=normal',
    resizeTo: { w: 900, h: 1200 },
  },
  {
    id: 'sakishima-rendering',
    label: 'Southern Ryūkyū rendering (Sakishima group, zoomed past the country frame)',
    w: 1024,
    h: 768,
    query: 'demo=normal',
    probeOnly: true,
    // Focused one at a time, because at a zoom where an individual island is
    // more than a few pixels across the group does not fit on one screen.
    probeIslands: [
      ['Miyakojima', 125.30, 24.79],
      ['Ishigakijima', 124.16, 24.34],
      ['Iriomote', 123.80, 24.34],
      ['Yonaguni', 123.00, 24.46],
      ['Hateruma', 123.78, 24.06],
    ],
  },
  {
    id: 'alert-strip-open',
    label: 'Alert strip changes height (EEW warning)',
    w: 1366,
    h: 768,
    query: 'demo=warning',
    baseline: { query: 'demo=normal' },
  },
];

/* ----------------------------------------------------------------- helpers -- */

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtRect(r) {
  return `x${Math.round(r.x)} y${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`;
}

/** Land-ish pixels: brighter than the ocean gradient, ignoring the graticule. */
async function pixelStats(page, samples) {
  return page.evaluate((pts) => {
    const c = document.querySelector('.map__canvas');
    if (!c || !c.width) return null;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const { width, height } = c;
    const data = ctx.getImageData(0, 0, width, height).data;
    let count = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let lumaSum = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        lumaSum += luma;
        // Ocean is ~#121619 (luma ~22). Land fill is ~#23272b (luma ~39) and
        // anything brighter is a coastline stroke, label or overlay.
        if (luma > 35) {
          count++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    const sampled = Math.ceil(width / 2) * Math.ceil(height / 2);

    // Point probe: CSS px -> device px. Uses a small neighbourhood mean so a
    // single antialiased coastline pixel cannot flip the result.
    const ratio = width / (c.getBoundingClientRect().width || width);
    const lumaAt = (px, py) => {
      const cx = Math.round(px * ratio);
      const cy = Math.round(py * ratio);
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = Math.min(width - 1, Math.max(0, cx + dx));
          const y = Math.min(height - 1, Math.max(0, cy + dy));
          const i = (y * width + x) * 4;
          sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          n++;
        }
      }
      return sum / n;
    };
    const land = pts?.land ?? [];
    const ocean = pts?.ocean ?? [];
    // Ocean reference for this frame. A fixed "land is luma > 35" rule broke as
    // soon as the renderer dimmed the prefectures an event does not touch: a
    // dimmed prefecture reads ~21, i.e. below a threshold tuned on undimmed
    // land (~40), and three correctly drawn prefectures were reported as ocean.
    const oceanRef = ocean.length
      ? ocean
          .map((p) => lumaAt(p.x, p.y))
          .sort((a, b) => a - b)[Math.floor(ocean.length / 2)]
      : 22;
    let landHit = 0;
    const misses = [];
    const landSamples = [];
    for (const p of land) {
      const v = lumaAt(p.x, p.y);
      landSamples.push({ x: p.x, y: p.y, luma: v, name: p.name });
      if (v >= oceanRef + 6) landHit++;
      else if (misses.length < 5) misses.push(`${p.name}@${v.toFixed(0)}`);
    }
    let oceanHit = 0;
    let landSum = 0;
    let oceanSum = 0;
    for (const p of land) landSum += lumaAt(p.x, p.y);
    const oceanSamples = [];
    for (const p of ocean) {
      const v = lumaAt(p.x, p.y);
      oceanSamples.push({ x: p.x, y: p.y, luma: v });
      oceanSum += v;
      if (v >= oceanRef + 12) oceanHit++;
    }

    return {
      width,
      height,
      landRatio: count / sampled,
      landBox: count ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null,
      meanLuma: lumaSum / sampled,
      probe: {
        landTotal: land.length,
        landHit,
        landMisses: misses,
        oceanTotal: ocean.length,
        oceanHit,
        // Mean luminance of land vs open ocean. The basemap's whole job is
        // telling the two apart, so this is measured rather than eyeballed.
        oceanRef,
        landMean: land.length ? landSum / land.length : null,
        oceanMean: ocean.length ? oceanSum / ocean.length : null,
        landSamples,
        oceanSamples,
      },
    };
  }, samples);
}

async function measure(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.mapPane');
    const canvas = document.querySelector('.map__canvas');
    const controls = document.querySelector('.mapControls');
    const overlays = [...document.querySelectorAll('[data-map-anchor]')]
      .filter((n) => !n.hidden && n.offsetParent)
      .map((n) => {
        const r = n.getBoundingClientRect();
        return { anchor: n.dataset.mapAnchor ?? '', x: r.x, y: r.y, w: r.width, h: r.height };
      });
    const h = host?.getBoundingClientRect();
    const c = canvas?.getBoundingClientRect();
    const k = controls?.getBoundingClientRect();
    const toRect = (r) =>
      r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    return {
      host: toRect(h),
      canvasCss: toRect(c),
      controls: toRect(k),
      overlays,
      backing: canvas ? { width: canvas.width, height: canvas.height } : null,
      dpr: window.devicePixelRatio,
      debug: window.__yurewatch?.map?.() ?? null,
    };
  });
}

async function openCase(browser, c) {
  const page = await browser.newPage({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: c.dpr ?? 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${URL}?${c.query}&lang=ja`, { waitUntil: 'load' });
  await page.waitForSelector('.app', { timeout: 20000 });
  await page.waitForFunction(() => window.__yurewatch?.map?.()?.scale > 0, { timeout: 20000 });
  await page.waitForTimeout(1200);
  return { page, errors };
}

/**
 * Judge one measurement.
 *
 * `declared` is the set of features the app says it is showing (from the
 * profile in debugState). Before the framing fix there is no declared profile,
 * so the conservative default is "every shipped feature", which is exactly the
 * coverage the old comments promised.
 */
function judge(m, pixels, declared) {
  const cam = { cx: m.debug.cx, cy: m.debug.cy, scale: m.debug.scale, w: m.debug.viewport.width, h: m.debug.viewport.height };
  const canvas = { w: m.debug.viewport.width, h: m.debug.viewport.height };
  // Only Japanese geometry counts as *intended coverage*: the neighbouring
  // countries are a backdrop and are expected to run off the edges.
  const prefFeatures = FEATURES.filter((f) => f.kind === 'pref');
  const rings = m.debug?.coverage?.rings ?? null;
  const members = rings
    ? prefFeatures.filter((f) => rings.includes(`pref:${f.code}:${f.index}`))
    : prefFeatures;

  const boxes = members.map((f) => ({ f, box: ringBox(f.ring) }));
  const offCanvas = boxes.filter(({ box }) => {
    const r = screenBox(cam, box);
    return r.x + r.w < 0 || r.x > canvas.w || r.y + r.h < 0 || r.y > canvas.h;
  });
  const partially = boxes.filter(({ box }) => {
    const r = screenBox(cam, box);
    const inside = r.x >= 0 && r.y >= 0 && r.x + r.w <= canvas.w && r.y + r.h <= canvas.h;
    const outside = r.x + r.w < 0 || r.x > canvas.w || r.y + r.h < 0 || r.y > canvas.h;
    return !inside && !outside;
  });

  // Geographic coverage of the *intended* set, in screen space.
  const all = boxes.flatMap(({ box }) => [
    screenBox(cam, box),
  ]);
  const cover = {
    x: Math.min(...all.map((r) => r.x)),
    y: Math.min(...all.map((r) => r.y)),
    w: 0,
    h: 0,
  };
  cover.w = Math.max(...all.map((r) => r.x + r.w)) - cover.x;
  cover.h = Math.max(...all.map((r) => r.y + r.h)) - cover.y;

  const ins = m.debug?.framing?.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const availW = Math.max(1, canvas.w - ins.left - ins.right);
  const availH = Math.max(1, canvas.h - ins.top - ins.bottom);
  const fillX = cover.w / canvas.w;
  const fillY = cover.h / canvas.h;
  // Compare against the space the map chrome leaves free: fitting into the full
  // canvas would put geography underneath the zoom controls.
  const fillAvailX = cover.w / availW;
  const fillAvailY = cover.h / availH;
  const fill = Math.max(fillAvailX, fillAvailY);

  // "Centred" means centred in the space the chrome leaves, because the insets
  // are deliberately asymmetric (controls bottom-right, scale bar bottom-left).
  const boxCx = ins.left + availW / 2;
  const boxCy = ins.top + availH / 2;
  const centreOffset = {
    x: cover.x + cover.w / 2 - boxCx,
    y: cover.y + cover.h / 2 - boxCy,
  };

  const margins = {
    left: cover.x,
    top: cover.y,
    right: canvas.w - (cover.x + cover.w),
    bottom: canvas.h - (cover.y + cover.h),
  };

  // Stretch: the backing store must keep the CSS aspect ratio.
  const cssAspect = m.canvasCss.w / m.canvasCss.h;
  const backingAspect = m.backing.width / m.backing.height;
  const stretch = Math.abs(backingAspect - cssAspect) / cssAspect;

  // Sample points we can check against the rendered pixels: ring centroids of
  // land that must be painted, and offshore points that must stay ocean.
  // A bbox centre is not good enough: a C-shaped coastal ring has its bbox
  // centre out at sea. Use the area centroid, and only keep it when it falls
  // inside the ring, so every sample is genuinely a land pixel.
  // A ring narrower than a few pixels is an islet, not renderable geometry at
  // this zoom; 1:10m carries dozens of 4-8 point specks. Sampling them proves
  // nothing, so they are counted and reported instead of being asserted on.
  let subPixelRings = 0;
  const landSamples = boxes
    .map(({ f, box }) => {
      const ring = f.ring;
      const screenW = Math.abs(screenBox(cam, box).w);
      if (screenW < 6) {
        subPixelRings++;
        return null;
      }
      const c = centroid(ring);
      if (!c || !pointInRing(c[0], c[1], ring)) return null;
      const p = toScreen(cam, { lon: c[0], lat: c[1] });
      return { x: p.x, y: p.y, name: f.name };
    })
    .filter(Boolean)
    .filter((p) => p.x > 4 && p.y > 4 && p.x < canvas.w - 4 && p.y < canvas.h - 4)
    // A label is printed at the ring's own centroid, so the darkest, busiest
    // pixel of a prefecture is exactly the sample point. 北海道's sample was
    // landing on the 北海道 glyphs and reading as "land not painted".
    .filter(
      (p) =>
        !(m.debug?.labels ?? []).some(
          (l) => p.x >= l.x - 6 && p.x <= l.x + l.w + 6 && p.y >= l.y - 6 && p.y <= l.y + l.h + 6,
        ),
    );
  // Open-water reference points (Pacific, Sea of Japan, East China Sea).
  // Corners of the canvas are useless here: with neighbouring countries now
  // drawn as context they frequently land on land.
  const oceanSamples = [
    [146.5, 33.5],
    [149.0, 39.0],
    [141.0, 21.0],
    [127.0, 21.5],
    [134.5, 38.5],
    [146.0, 43.5],
    [139.5, 34.2],
    [132.0, 36.5],
    [143.0, 30.5],
    [152.0, 33.0],
    [129.0, 25.0],
    [145.5, 41.0],
  ]
    // Keep only candidates that are genuinely open water *in this dataset*:
    // outside every ring and at least 0.25 deg from the nearest one. Hard-coding
    // "ocean" coordinates stopped being safe once the southern Ryukyus and the
    // Kurils arrived — 129 E 25 N is now a few kilometres from Yonaguni.
    .filter(([lon, lat]) =>
      FEATURES.every((f) => {
        const b = ringBox(f.ring);
        const near =
          lon > b.w - 0.25 && lon < b.e + 0.25 && lat > b.s - 0.25 && lat < b.n + 0.25;
        return !near;
      }),
    )
    .map(([lon, lat]) => toScreen(cam, { lon, lat }))
    .filter((p) => p.x > 10 && p.y > 10 && p.x < canvas.w - 10 && p.y < canvas.h - 10)
    // Drop points that a drawn label overlaps: bright text there is correct.
    .filter(
      (p) =>
        !(m.debug?.labels ?? []).some(
          (l) => p.x >= l.x - 4 && p.x <= l.x + l.w + 4 && p.y >= l.y - 4 && p.y <= l.y + l.h + 4,
        ),
    )
    .map((p) => ({ x: p.x, y: p.y }));

  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add(
    'intended coverage fully on canvas',
    offCanvas.length === 0,
    offCanvas.length
      ? `${offCanvas.length} feature(s) entirely off-canvas: ${offCanvas
          .slice(0, 4)
          .map(({ f, box }) => `${f.name}@${box.s.toFixed(1)}N`)
          .join(', ')}`
      : 'none',
  );
  add('no feature half-cut at an edge', partially.length === 0, `${partially.length} partially cut`);
  add(
    'map fills the space left for it (dominant axis >=97%)',
    fill >= 0.97,
    `${pct(fill)} of the inset box (x ${pct(fillAvailX)}, y ${pct(fillAvailY)}; raw canvas x ${pct(fillX)}, y ${pct(fillY)})`,
  );
  add(
    'map is centred in its inset box',
    Math.abs(centreOffset.x) <= Math.max(3, canvas.w * 0.02) && Math.abs(centreOffset.y) <= Math.max(3, canvas.h * 0.02),
    `offset ${Math.round(centreOffset.x)}px, ${Math.round(centreOffset.y)}px`,
  );
  // ---- Milestone 3: overlays and legibility -------------------------------
  // Overlays are positioned over the map. The framing reserves their space, so
  // with correct insets the declared coverage rectangle cannot intersect them.
  const overlayBoxes = (m.overlays ?? []).map((o) => ({
    anchor: o.anchor,
    x: o.x - m.canvasCss.x,
    y: o.y - m.canvasCss.y,
    w: o.w,
    h: o.h,
  }));
  const covers = (o, pt) => pt.x >= o.x && pt.x <= o.x + o.w && pt.y >= o.y && pt.y <= o.y + o.h;
  // The honest test is not "overlay vs the coverage *rectangle*" — a corner
  // control column beside open ocean costs nothing. It is "overlay vs a sampled
  // point that should be land". Those points come from the ring centroids the
  // renderer was asked to draw, so a hit means real geography is hidden.
  const hiddenLand = (pixels?.probe?.landSamples ?? []).filter((pt) =>
    overlayBoxes.some((o) => covers(o, pt)),
  );
  add(
    'on-map overlays do not hide sampled land',
    hiddenLand.length === 0,
    hiddenLand.length
      ? `${hiddenLand.length} land sample(s) under ${[...new Set(overlayBoxes.filter((o) => hiddenLand.some((pt) => covers(o, pt))).map((o) => o.anchor))].join(', ')}`
      : `${overlayBoxes.length} overlay(s) clear of ${pixels?.probe?.landSamples?.length ?? 0} land samples`,
  );

  const landMean = pixels?.probe?.landMean ?? null;
  const oceanMean = pixels?.probe?.oceanMean ?? null;
  const delta = landMean !== null && oceanMean !== null ? landMean - oceanMean : null;
  add(
    'land and ocean are measurably distinct (delta luma >= 10)',
    delta !== null && delta >= 10,
    delta === null ? 'no samples' : `land ${landMean.toFixed(1)} vs ocean ${oceanMean.toFixed(1)} (delta ${delta.toFixed(1)})`,
  );

  add('canvas is not stretched (aspect within 0.5%)', stretch <= 0.005, `${pct(stretch)} aspect drift`);
  add('canvas backing store matches CSS box', Math.abs(m.backing.width - m.canvasCss.w * m.dpr) <= 2 && Math.abs(m.backing.height - m.canvasCss.h * m.dpr) <= 2,
    `${m.backing.width}x${m.backing.height} vs ${Math.round(m.canvasCss.w * m.dpr)}x${Math.round(m.canvasCss.h * m.dpr)}`);
  add('renderer painted land', Boolean(pixels?.landBox) && pixels.landRatio > 0.01, `${pct(pixels?.landRatio ?? 0)} of pixels`);
  // Japan covers a minority of its own bounding box; if the ratio is wildly off,
  // either nothing was drawn or the camera and the renderer disagree.
  add(
    'land covers a plausible share of the frame (3-60%)',
    Boolean(pixels) && pixels.landRatio > 0.03 && pixels.landRatio < 0.6,
    `${pct(pixels?.landRatio ?? 0)}`,
  );
  const probe = pixels?.probe ?? null;
  add(
    'predicted land is actually painted (>=95% of visible samples)',
    Boolean(probe) && probe.landHit / Math.max(1, probe.landTotal) >= 0.95,
    probe
      ? `${probe.landHit}/${probe.landTotal} visible land samples lit (${subPixelRings} sub-pixel islets skipped${
          probe.landMisses?.length ? `; missed: ${probe.landMisses.join(', ')}` : ''
        })`
      : 'no probe',
  );
  // Sampled as a rate rather than "none at all": on a 154 px-tall pane a
  // prefecture label or a marker can legitimately sit over one sample point.
  // At most one sample may be covered by something drawn on top (a marker, the
  // EEW callout, a clipped label). A genuine failure — ocean rendered as land —
  // lights most of the samples, not one.
  // Ocean samples that sit under an overlay are excluded: the simulation banner
  // covers the Sea of Japan on short panes, and counting that as "ocean drawn as
  // land" would have hidden a real regression behind a chrome artefact.
  const insets = m.debug?.framing?.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const inChrome = (pt) =>
    pt.x < insets.left ||
    pt.y < insets.top ||
    pt.x > canvas.w - insets.right ||
    pt.y > canvas.h - insets.bottom;
  const oceanVisible = (probe?.oceanSamples ?? []).filter(
    (pt) => !overlayBoxes.some((o) => covers(o, pt)) && !inChrome(pt),
  );
  const oceanLit = oceanVisible.filter((pt) => pt.luma >= (probe?.oceanRef ?? 22) + 12).length;
  add(
    'open ocean stays water (at most 1 overlay-covered sample)',
    oceanVisible.length > 0 && oceanLit <= 1,
    `${oceanLit}/${oceanVisible.length} visible ocean samples lit`,
  );
  add(
    'no overlay covers the map centre',
    !m.controls || !(m.controls.x < canvas.w / 2 && m.controls.x + m.controls.w > canvas.w / 2 && m.controls.y < canvas.h / 2),
    m.controls ? `controls at ${fmtRect(m.controls)}` : 'no controls',
  );

  return {
    samples: { land: landSamples, ocean: oceanSamples },
    camera: cam,
    canvas,
    cover,
    fill,
    fillX,
    fillY,
    centreOffset,
    margins,
    stretch,
    subPixelRings,
    offCanvas: offCanvas.map(({ f, box }) => `${f.name}@${box.s.toFixed(1)}N`),
    partially: partially.map(({ f }) => f.name),
    pixels,
    checks,
  };
}

/* -------------------------------------------------------------------- main -- */

if (!BUILD) throw new Error('build missing');
const html = readFileSync(BUILD);
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const results = [];

for (const c of [...CASES, ...DYNAMIC]) {
  let baselineHeight = null;
  if (c.baseline) {
    const { page } = await openCase(browser, { ...c, query: c.baseline.query });
    baselineHeight = (await measure(page)).host?.h ?? null;
    await page.close();
  }

  const { page, errors } = await openCase(browser, c);

  if (c.resizeTo) {
    await page.setViewportSize({ width: c.resizeTo.w, height: c.resizeTo.h });
    await page.waitForTimeout(900);
  }

  const m = await measure(page);
  if (c.probeOnly) {
    // Island-by-island rendering probe: focus each island, then sample the
    // centre of its largest shipped ring. This is the check that fails if the
    // geometry is present in the JSON but never reaches the canvas.
    const islandChecks = [];
    for (const [name, lon, lat] of c.probeIslands) {
      // Recentre first so the zoom factor is a fixed multiple of the profile
      // fit; then focus last, because focusing only raises the zoom and never
      // moves the camera, and zooming after it would drift the centre.
      await page.evaluate(() => window.__yurewatch.recenter());
      await page.evaluate(() => window.__yurewatch.zoom(8));
      await page.evaluate(([lo, la]) => window.__yurewatch.focus(lo, la), [lon, lat]);
      await page.waitForTimeout(700);
      const mm = await measure(page);
      const camI = {
        cx: mm.debug.cx, cy: mm.debug.cy, scale: mm.debug.scale,
        w: mm.debug.viewport.width, h: mm.debug.viewport.height,
      };
      const probe = { x: lonX(lon) && toScreen(camI, { lon, lat }).x, y: toScreen(camI, { lon, lat }).y };
      const stats = await pixelStats(page, { land: [{ ...probe, name }], ocean: [] });
      const lit = stats?.probe?.landHit === 1;
      const inside = probe.x > 6 && probe.y > 6 && probe.x < camI.w - 6 && probe.y < camI.h - 6;
      islandChecks.push({
        name: `renders ${name} when focused on it`,
        ok: lit && inside,
        detail: `probe ${Math.round(probe.x)},${Math.round(probe.y)} ${inside ? 'on canvas' : 'off canvas'} · luma ${lit ? '>35 (land)' : '<=35 (not painted)'}`,
      });
      await page.screenshot({ path: join(SHOTS, `${c.id}-${name.toLowerCase()}.png`) });
    }
    results.push({
      id: c.id,
      label: c.label,
      viewport: { w: c.w, h: c.h, dpr: c.dpr ?? 1, resizedTo: null },
      host: m.host,
      camera: { cx: m.debug.cx, cy: m.debug.cy, scale: m.debug.scale, w: m.debug.viewport.width, h: m.debug.viewport.height },
      cover: null,
      fillX: 0, fillY: 0, margins: { left: 0, right: 0, top: 0, bottom: 0 },
      declaredProfile: 'island focus',
      alertStrip: null,
      errors,
      checks: islandChecks,
    });
    await page.close();
    continue;
  }
  const declared = m.debug?.coverage?.features ?? null;
  const geom = judge(m, null, declared);
  const pixels = await pixelStats(page, geom.samples);
  const verdict = judge(m, pixels, declared);
  verdict.errors = errors;
  verdict.id = c.id;
  verdict.label = c.label;
  verdict.viewport = { w: c.w, h: c.h, dpr: c.dpr ?? 1, resizedTo: c.resizeTo ?? null };
  verdict.host = m.host;
  verdict.declaredProfile = m.debug?.framing?.profile ?? null;
  verdict.insets = m.debug?.framing?.insets ?? null;
  verdict.memberCount = verdict.memberCount ?? null;
  verdict.alertStrip = c.baseline ? { baselineHostHeight: baselineHeight, hostHeight: m.host?.h ?? null } : null;

  await page.screenshot({ path: join(SHOTS, `${c.id}.png`) });
  results.push(verdict);
  await page.close();
}

await browser.close();
server.close();

/* ------------------------------------------------------------------ report -- */

const lines = [];
lines.push(`# Map QA — ${LABEL}`);
lines.push('');
lines.push(`Build: \`dist/yurewatch.html\` · ${CASES.length + DYNAMIC.length} viewport cases`);
lines.push('');

let failures = 0;
for (const r of results) {
  const failed = r.checks.filter((k) => !k.ok);
  failures += failed.length;
  const cam = r.camera;
  lines.push(`## ${r.label}`);
  lines.push('');
  lines.push(`- viewport \`${r.viewport.w}x${r.viewport.h}\` @${r.viewport.dpr}x${r.viewport.resizedTo ? ` → resized to \`${r.viewport.resizedTo.w}x${r.viewport.resizedTo.h}\`` : ''}`);
  lines.push(`- map host ${fmtRect(r.host)} · canvas ${Math.round(cam.w)}x${Math.round(cam.h)}`);
  lines.push(`- camera centre (${cam.cx.toFixed(5)}, ${cam.cy.toFixed(5)}) scale ${cam.scale.toFixed(1)}`);
  if (r.cover) lines.push(`- projected coverage ${fmtRect(r.cover)} → fill x ${pct(r.fillX)} / y ${pct(r.fillY)}; margins L${Math.round(r.margins.left)} R${Math.round(r.margins.right)} T${Math.round(r.margins.top)} B${Math.round(r.margins.bottom)}`);
  lines.push(`- profile: ${r.declaredProfile ?? '**not declared**'}`);
  if (r.alertStrip) lines.push(`- alert strip: map host ${Math.round(r.alertStrip.baselineHostHeight)}px → ${Math.round(r.alertStrip.hostHeight)}px`);
  lines.push('');
  for (const k of r.checks) lines.push(`- ${k.ok ? 'PASS' : '**FAIL**'} ${k.name} — ${k.detail}`);
  if (r.errors.length) lines.push(`- page errors: ${r.errors.join(' | ')}`);
  lines.push('');
}

const total = results.reduce((n, r) => n + r.checks.length, 0);
lines.push(`**${total - failures}/${total} checks passed** across ${results.length} viewports.`);
lines.push('');
lines.push(`Screenshots: \`docs/qa/${LABEL}/\``);

const report = lines.join('\n');
const { writeFileSync } = await import('node:fs');
writeFileSync(join(OUT, `${LABEL}.md`), report + '\n');
console.log(report);
process.exit(failures ? 1 : 0);
