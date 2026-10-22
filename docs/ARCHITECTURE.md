# Architecture & technical decisions

## Data flow

```
                ┌──────────────┐        ┌────────────────────────────┐
 HTTPS  ───────►│ LiveFeed     │        │ DemoFeed                    │
 (bridge on     │ poll 3 URLs  │        │ scripted timeline           │
  Android)      │ backoff      │        │ (same wire payloads)        │
                │ stale watchdog│       └────────────────────────────┘
                └──────┬───────┘                     │
                       │  FeedEvent {connection|batch}│
                       └──────────────┬───────────────┘
                                      ▼
                          ┌───────────────────────┐
                          │ parseBatch (pure)     │  wire → model, honest about
                          │ 551/556/552           │  sentinels, malformed data
                          └───────────┬───────────┘
                                      ▼
                          ┌───────────────────────┐
                          │ reduce(state, action) │  immutable app state
                          │  ingestEew (state m.) │  prefecture shading,
                          │  ingestEvents (merge) │  selection, diagnostics
                          └───────────┬───────────┘
                     subscribe()      ▼
        ┌────────────────────────────────────────────────┐
        │ App.update(state) → panels re-render           │
        │                 → MapView.update(input)        │
        │                       → buildScene (pure)      │
        │                       → MapRenderer.draw        │
        └────────────────────────────────────────────────┘
```

One direction only: sources never touch the DOM, components never mutate state.

## Module responsibilities

| Module | Responsibility | Deliberately does **not** |
| --- | --- | --- |
| `core/*` | Types, JMA vocabulary, formatting, intensity ramp | Know about HTTP, DOM or sources |
| `sources/p2pquake/*` | Wire types + pure parsers for one provider's JSON | Decide what to show |
| `state/*` | Reducer, EEW state machine, event merging, freshness | Do I/O |
| `net/*` | Transport (fetch/native), polling, backoff, recency gating | Interpret seismology |
| `demo/*` | Scenarios + deterministic player | Bypass the parsers |
| `map/geo` | Web-Mercator projection, camera maths, clamping | Touch canvas |
| `map/scene` | State → screen-space draw instructions, culling, label collision | Call canvas APIs |
| `map/renderer` | Canvas painting only | Know what a "warning" is |
| `map/view` | Gestures, sizing, rAF loop | Own application state |
| `i18n/*` | Message catalogs, `t()`, locale persistence | Contain layout or seismology |
| `ui/*` | Small `{el, update(state)}` components | Fetch or parse |

The split between `scene` (pure) and `renderer` (canvas) is what makes map
behaviour testable: marker positions, colours, culling, selection order and label
collisions are asserted in `tests/scene.test.ts` without a browser.

## Localisation

`src/i18n/` owns every user-visible string. Components call `t(key, params)` and
never branch on a locale, so the two languages cannot diverge functionally; a
switch increments a version counter that each memoising panel folds into its
cache key, which makes the switch a single ordinary re-render of the whole app.
Catalogs are typed against each other (`Record<MessageKey, string>`), so a
missing translation is a compile error rather than a fallback at runtime.

The locale code is persisted through `SharedPreferences` on Android
(`NativePrefs.java`, exposed as `YureWatchPrefs`), because WebView `localStorage`
is not dependable for the `file:///android_asset/` origin. `localStorage` is used
on the web, and memory when neither exists.

Full rationale, terminology table and extension guide: [`I18N.md`](I18N.md).

## Startup and failure states

The HTML shell paints a small progress line before the bundle executes (no white
flash) and a watchdog replaces it after six seconds with an explanation and a
reload button if the app never mounted. That state is what a reader sees when the
*source* `index.html` is opened without the bundler — the failure is reported
honestly instead of leaving a logo on screen forever.

`MainActivity` has its own fallback view for a WebView load error, and the map
draws a labelled fallback (`map.error` + "the list views remain usable") if the
canvas cannot initialise. No failure path silently shows invented data.

## Decisions and their reasons

### D1 — No UI framework

Target: an installable APK plus a web build from the same source. A framework
would add 40–140 KiB and a build-time runtime whose failure modes (hydration,
effect ordering) offer nothing here: the UI is a handful of panels that replace
their own contents. Plain DOM + `{el, update}` components keep the single-file
asset near 200 KiB and make `tests/ui.test.ts` straightforward.

### D2 — A single self-contained HTML file for Android

`scripts/inline-single-file.mjs` inlines the JS, the CSS and every asset, and
**fails the build** if any `http(s)://` reference remains. Consequences:
no local HTTP server, no localhost, no CORS for assets, no port conflicts, and an
instant cold start. The only network traffic is the data feed, which goes through
the native bridge.

### D3 — Native HTTPS bridge instead of a WebView fetch

A WebView loading `file:///android_asset/index.html` has an opaque origin, so
`fetch('https://api.p2pquake.net/…')` is rejected by CORS. Options considered:

| Option | Verdict |
| --- | --- |
| `WebViewAssetLoader` on `https://appassets.androidplatform.net` | Works, but needs androidx and a real origin for what is effectively a static file |
| `file://` + `allowUniversalAccessFromFileURLs` | Rejected: disables the SOP for *every* request the page makes |
| **`addJavascriptInterface` bridge** (chosen) | No androidx dependency, honest `User-Agent`, request logs stay in Java, HTTPS enforced by `network_security_config.xml`, allowlist of schemes in `NativeNet.request` |

Contract (mirrored in `tests` via `tools/verify-web.mjs`):

```
JS  → native : YureWatchNative.request(id, url, timeoutMs)
native → JS  : window.__yurewatchNativeResolve(id, '{"status":200,"body":"…"}')
```

The JS side (`NativeTransport`) has its own timeout so a lost callback cannot
leak a pending promise. Responses are capped at 8 MB in Java.

### D4 — Polling, not WebSocket

The provider offers `/ws` (≈70 ms latency) but limits it to 2 connections per IP
and forcibly disconnects the sandbox every 10 minutes. On Android, holding a
socket across doze requires a foreground service (with a persistent notification)
— out of scope for v0.1 and arguably hostile for a viewer. Polling `/history`
costs ~0.5–1 s extra and is documented as a limitation instead of hidden. The
`Feed` interface is the seam for a future WebSocket transport.

### D5 — Recency gating is a first-class feature

`/history` is a history endpoint. During development, a routine poll surfaced a
six-day-old EEW that the app briefly rendered as an active warning. Fixed by
`partitionEews()` (10 min) + `pickCurrentTsunami()` (12 h, newest only), with
tests both for the pure helpers and for the feed path. This is the single most
important safety property in the data layer.

### D6 — The EEW panel cannot overstate

The panel renders `state`, and `state` is derived from what the message actually
contains:

- `areas.length > 0` → **警報**; otherwise → **予報**. The public relay forwards
  警報, so an area-less message means prediction-grade content.
- Cancellation keeps its own visual identity and wording; the map crosshair is
  removed (a red crosshair after a cancellation reads as "shaking is coming").
- Test transmissions get a badge and never adopt the warning skin.
- Simulated alerts cannot look official: `alert--sim` styles the panel, the
  header says `DEMO`, and the map carries a SIMULATION banner.
- Arrival times are only rendered when the source supplies them per area, with
  the literal caveat "現在地の到達時刻ではありません".

### D7 — Canvas map with compiled geometry

Geometry (6,059 points, 47 prefectures + 4 neighbouring countries) is projected to
Web-Mercator world units once and compiled to `Path2D`. Each frame changes only
the transform; overlays are drawn in screen space so strokes and text stay crisp.
No map SDK, no API key, no tile requests: the app renders offline, in an APK, with
no attribution-injection requirements beyond crediting Natural Earth.

The initial camera refits to Japan on layout changes **until the operator pans or
zooms** (`userAdjusted`). Without this, an EEW arriving (which resizes the panel
above the map) left the map stale-sized and Japan off-centre.

### D8 — Demo engine reuses production parsers

`DemoFeed` emits the *same wire payloads* the API returns, through
`parseBatch(..., DEMO_SOURCE)`. That single parameter sets `simulated: true` and
`source.official: false` everywhere, which is what the UI keys off. Benefits: the
demo exercises real parsing, the flag cannot be forgotten per-component, and
`tests/demo.test.ts` can assert that *every* produced object is marked simulated.

Timeline steps are stamped as offsets from scenario start, so playback is
deterministic (tested twice against fake timers and compared).

### D9 — Audio is opt-in, synthesised, and refuses simulations

Browsers block audio before a gesture, and an alarm for a fake earthquake would be
actively harmful. The alert tone is enabled by a footer toggle (or `?sound=1`),
is synthesised with WebAudio (no redistributable broadcast audio), and is skipped
for: simulated alerts (unless `?demoAudio=1`), test transmissions, and forecast
downgrades (a single soft tone instead of the double warning tone).

### D10 — Gradle-free Android build

Two Java classes and one asset do not justify a Gradle wrapper, plugin cache and
network fetch of a build system. `tools/build-apk.sh` runs aapt2 → javac → d8 →
zip → zipalign → apksigner and finishes with `apksigner verify` and
`aapt2 dump badging`, so a broken artefact fails the build rather than being
uploaded. Trade-off: no incremental builds (the whole APK takes ~5 s), and
dependency changes (if any are ever added) mean adding jars by hand.

Also documented: build-tools 34.0.0's d8 crashes on anonymous inner classes; the
script prefers 35+.

### D11 — Lifecycle and back navigation

| Event | Behaviour |
| --- | --- |
| `onPause` / `visibilitychange` | Feed paused (no polling, no timers). `WebView.pauseTimers()` too. |
| `onResume` / visible | Resume + immediate poll, so returning to the app does not show up-to-20 s stale data. |
| Network restored (`online`) | Immediate poll; backoff resets. |
| `offline` | Connection state set to offline; the panel stops claiming "no alert in force". |
| Back press | JS first: clear selection → leave demo mode → else `super.onBackPressed()`. Bounded to terminate (verified: `true → false`). |
| Rotation/config change | `configChanges` keeps the WebView alive; `saveState`/`restoreState` covers process death. |
| Cutout / gesture nav | Edge-to-edge with `layoutInDisplayCutoutMode=shortEdges`; CSS honours `env(safe-area-inset-*)`. |

### D12 — Accessibility and mobile ergonomics

- All interactive elements are real `<button>`s with `aria-label`/`aria-pressed`;
  the alert panel is a live region (`aria-live="polite"`), disclosures use
  `aria-expanded`.
- Contrast-checked intensity colours (text colour is picked per fill), minimum
  marker size 6 px and ≥42 px touch targets for controls.
- `prefers-reduced-motion` disables the EEW pulse (canvas animation gate).
- Iconography is inline SVG: emoji/symbol glyphs (`⌖`, `＋`) render as tofu on
  some Android system fonts — found in a screenshot review and replaced.
- Layout: three-column on desktop, one rail + map + tab bar on phones
  (≤1120 px), with the alert panel always above the fold so a warning is never
  behind a menu.
