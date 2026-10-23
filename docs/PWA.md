# Progressive Web App evaluation

**Verdict: yes — the browser viewer can be safely installed as a PWA, with a
shell-only caching design.** The viewer at
https://franzathome2024-hue.github.io/yurewatch/viewer/ is installable
(Chrome reports zero installability errors), starts offline, and — by
construction — can never present cached earthquake data as live information.

This document records what was implemented, the safety reasoning, what was
tested, and where browser limits make the PWA weaker than the Android APK.

## What was added

| Piece | Where | Notes |
| --- | --- | --- |
| Web app manifest | `site/viewer/manifest.webmanifest` | `name`/`short_name`, `display: standalone`, `theme_color`/`background_color` matching the app, `start_url: "./"` and `scope: "./"` — relative, so they resolve to `/yurewatch/viewer/` under the GitHub Pages subpath |
| Icons | `site/viewer/icons/` | `icon-192.png`, `icon-512.png` (purpose `any`), `icon-maskable-512.png` (full-bleed, mark inside the safe zone), rendered from the app mark |
| Service worker | `site/viewer/sw.js` | Scope `/yurewatch/viewer/`; caches the shell only (see policy below) |
| Registration + links | injected by `tools/build-site.mjs` | Manifest link, `apple-touch-icon`, and a `load`-time `navigator.serviceWorker.register('./sw.js')` with failures swallowed. Injected only into the Pages copy — the Android asset build is untouched |

Install: Chrome/Edge show the install action for the viewer page; Android
Chrome offers "Install app / Add to Home screen"; iOS Safari uses
Share → Add to Home Screen (no prompt API exists there; the touch icon and
`apple-mobile-web-app-capable` metadata are provided).

## Caching policy (the safety core)

| Request class | Strategy | Why |
| --- | --- | --- |
| Cross-origin — including **all feed API traffic** | **Not intercepted at all** (the fetch handler returns immediately) | The worker cannot delay, replace, cache, or resurrect feed data. A cancelled EEW can never reappear from a cache, because no bulletin is ever written to one |
| Navigations (viewer page loads) | Network-first, cached shell as fallback | New deployments arrive on the next load; a broken deployment or a dead network falls back to the last working shell instead of an error page |
| Same-origin static assets (icons, manifest) | Cache-first | Immutable enough, and needed for offline startup |
| Everything non-GET | Ignored | No interference |

Versioning: the cache is named `yurewatch-viewer-v1`. On activation the worker
deletes every other cache and claims clients, and `skipWaiting` makes updates
prompt. Bumping the version (which any worker change naturally does to the
file bytes) is the complete cache-invalidation mechanism.

What the worker never does: cache API responses, serve data of any kind,
run background fetches (no Background Sync / Periodic Sync is registered),
show notifications (the Notifications API is never requested), or keep the
app "alive" in the background.

## Offline and stale behaviour

The PWA layer caches the *shell*; honesty about data remains the app's job,
and it was already built for this:

- With no network, the app boots from the cached shell and immediately shows
  オフライン / "Offline" plus データなし / "No data" — verified by test.
  It never displays "live" for data it does not have.
- Connection state is worded (Live / Unstable / Updates stopped / Offline),
  freshness degrades to "Stale data" whenever the transport stalls or the
  device is offline (`effectiveFreshness`), and the status strip always shows
  the time of the last successful update (最終更新 HH:MM) next to the
  freshness label.
- On reconnect, polling resumes automatically and the live state returns —
  no reload or reinstall needed (also verified).

## Notifications, background updates, speech

All three are treated as optional, user-controlled capabilities:

- **Notifications:** not implemented, and **not promised**. There is no push
  subscription, no permission request, and nothing in the UI or docs claims
  alerts can be delivered while the app is closed — because from a browser
  they cannot be guaranteed.
- **Background updates:** none. The viewer fetches only while open (and
  pauses when hidden, like the APK). No background EEW delivery is claimed.
- **Speech:** unchanged from the web build — an opt-in, in-app toggle using
  the platform's speech synthesis; availability depends on the OS/browser
  having a voice for the active language, and the app says so when it does
  not. Simulated alerts never speak (verified by test).

## PWA vs the Android APK

| Aspect | Installed PWA | Android APK |
| --- | --- | --- |
| Install | From the browser; no store, no signing prompts | Sideloaded APK from GitHub Releases; signed with the CI key (see README caveats) |
| Updates | Automatic on next load (network-first shell) | Manual APK replacement per release |
| Data & honesty rules | Identical build, identical state machine | Identical |
| Offline | Shell starts; explicit offline/no-data state | Same UI behaviour; shell is bundled locally |
| Background EEW | **Not possible to guarantee; not offered** | Also foreground-only (polling pauses when hidden) — neither build promises background delivery |
| Alert sound / vibration | Web Audio; `navigator.vibrate` where the browser exposes it (often absent, esp. iOS) | Web Audio + vibration via the same guarded calls, reliably present on Android |
| Speech | Browser/OS TTS; voice availability varies (notably limited on some iOS versions) | Android TTS via the WebView, generally available |
| Storage durability | Browser may evict caches under storage pressure; reinstall is one tap and lossless (no user data is stored) | App-private storage, durable until uninstall |
| Distribution reach | Any modern browser, incl. desktop | Android only |

Where the browser is weaker (background delivery, vibration, TTS voices,
storage eviction), the limitation is documented rather than simulated —
there are no fake "notification" toggles or background claims anywhere in
the UI.

## What was tested

`npm run verify:site` (66 checks, headless Chromium against the artifact
served at the production subpath) now includes a PWA section:

1. Manifest linked, served, valid; `start_url`/`scope` resolve inside
   `/yurewatch/viewer/`; declared icon sizes match the actual PNG pixels;
   maskable icon present.
2. Service worker registers with scope exactly `…/yurewatch/viewer/`, and
   the shell cache contains the HTML and icons.
3. With the worker controlling the page: the live feed still loads, and an
   audit of every cache entry proves **no API response is ever cached**
   (all entries are same-origin shell files).
4. Broken deployment: with the server made to 404 the shell, the cached
   shell still boots the app.
5. Offline startup from cache shows Offline + No data (never "live");
   reconnecting returns to the live state.
6. Update path: a byte-changed worker activates and deletes the previous
   cache (`v1` evicted by the test build, then restored).
7. Chrome DevTools Protocol `Page.getInstallabilityErrors` returns an
   empty list for the viewer.

The deployment workflow additionally curl-checks the published manifest,
worker and icons after every deploy.

## Known limitations

- **iOS Safari:** installation is manual (Share → Add to Home Screen);
  service-worker caches can be evicted after days of non-use; no vibration;
  TTS voices for Japanese may be absent. The app still runs fully in the
  browser tab.
- **Storage pressure:** Chromium may clear the shell cache on low-storage
  devices. Consequence is only "needs network for the next cold start" —
  no data or settings of value live in the cache (language preference is in
  `localStorage`, which the worker never touches).
- **No push, by design.** Anyone needing guaranteed, closed-app alerting
  should use official channels (JMA, municipal disaster apps, EEW receivers).
  YureWatch — APK or PWA — is an informational viewer, not a safety device.
