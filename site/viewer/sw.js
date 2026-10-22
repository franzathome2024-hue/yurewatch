/**
 * YureWatch viewer service worker.
 *
 * Safety policy — the whole reason this file is small:
 *
 *  1. ONLY the application shell is cached: the viewer's single-file HTML,
 *     its manifest and its icons. Nothing else.
 *  2. Cross-origin requests are NEVER intercepted. The earthquake/EEW feed
 *     always goes straight to the network, so this worker
 *     cannot delay, replace, cache or resurrect feed data — a cancelled
 *     warning can never come back from a cache, and stale records can never
 *     be presented as current information by the caching layer.
 *  3. Navigations are network-first: a new deployment is picked up on the
 *     next load, and the cached shell is only a fallback for "offline or
 *     the deployment is briefly broken" — in which case the app itself
 *     shows its explicit offline / no-data state, because it cannot fetch.
 *
 * Paths are relative to this worker's scope (/yurewatch/viewer/ on GitHub
 * Pages), so the same file works at any subpath.
 */

const VERSION = 'v1';
const CACHE = `yurewatch-viewer-${VERSION}`;

/** The complete offline shell. Deliberately no data URLs, no API paths. */
const SHELL = [
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      // Activate promptly: an old shell must never linger after a deploy.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Feed data and every other cross-origin request: not intercepted at all.
  // The browser makes a plain network request; nothing is read from or
  // written to any cache, and nothing waits on this worker.
  if (url.origin !== self.location.origin) return;

  // Page loads: fresh deployment first, cached shell only as a fallback.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Same-origin static assets (icons, manifest): cache-first.
  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // Keep the offline shell identical to what was just served.
      await cache.put('./index.html', response.clone());
      return response;
    }
    // A broken deployment (404/500) must not evict a working shell.
    throw new Error(`navigation fetch failed: ${response && response.status}`);
  } catch (error) {
    const cached = await cache.match('./index.html', { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) await cache.put(request, response.clone());
  return response;
}
