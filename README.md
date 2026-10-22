# YureWatch — Japan Earthquake & EEW Viewer (v0.1)

A dark, map-first viewer for **Japan's earthquake information, Earthquake Early
Warnings (緊急地震速報) and tsunami bulletins**, shipping as an installable
**Android APK** and as a single-file web build.

> **YureWatch is an information viewer, not a warning system.** It does not
> predict or independently detect earthquakes, it does not guarantee an alert
> arrives before shaking, and EEW estimates change with every revision. Always
> follow JMA announcements and your local authority's instructions.

![Desktop, live mode](docs/screenshots/desktop-live.png)

---

## Contents

- [What it does](#what-it-does)
- [Screenshots](#screenshots)
- [Install / run](#install--run)
- [Build the APK](#build-the-apk)
- [Demo mode](#demo-mode)
- [Data sources & honesty rules](#data-sources--honesty-rules)
- [Architecture](#architecture)
- [Tests](#tests)
- [Limitations of v0.1](#limitations-of-v01)
- [Attribution & licensing](#attribution--licensing)
- [Relationship to the reference project](#relationship-to-the-reference-project)

---

## What it does

| Area | v0.1 behaviour |
| --- | --- |
| **Map** | Canvas-rendered Japan (47 prefectures, own projection code, Natural Earth geometry). Drag to pan, pinch/scroll/double-tap to zoom, keyboard arrows + `+`/`-`/`Home`. Tap an epicentre to select it. |
| **Epicentres** | Marker size scales with magnitude, colour and inner numeral with observed JMA intensity, dashed ring for preliminary reports, fade with age, white selection ring. Live EEW shows a pulsing red crosshair (prediction, not an observation). |
| **Event feed** | Newest-first list of JMA earthquake reports, merged across revisions (震度速報 → 震源情報 → 各地の震度), with magnitude, depth, intensity, report type, age and revision count. |
| **Event detail** | Max intensity, hypocentre, coordinates, issue/receive times, tsunami statement, per-station observations, and the telegram provenance. |
| **EEW panel** | High-contrast state machine: idle / 予報 / 警報 / 続報 / 取消 / unavailable. Shows predicted max intensity, source areas with predicted ranges and 主要動 arrival state, and source-supplied arrival times — never an invented countdown. |
| **Connection health** | Live/stale/offline/degraded chip, source timestamps, freshness label, and a diagnostics panel with batch counts, rejected records and the last error. |
| **Tsunami** | Latest 津波予報 with grades, areas and heights (progressive disclosure). |
| **Demo mode** | Nine deterministic scenarios, all visibly marked `SIMULATION`. |
| **Android** | Single APK, no local server, no localhost, back gesture, lifecycle-aware polling, HTTPS-only native bridge. |

---

## Screenshots

All screenshots are captured from the shipped build by
`tools/verify-web.mjs`'s sibling capture script; demo shots are labelled
`SIMULATION` because they are simulations.

| EEW warning (demo) | EEW updated (demo) |
| --- | --- |
| ![](docs/screenshots/desktop-eew-warning.png) | ![](docs/screenshots/desktop-eew-updated.png) |

| Historical feed (demo) | EEW cancelled (demo) |
| --- | --- |
| ![](docs/screenshots/desktop-history.png) | ![](docs/screenshots/desktop-eew-cancelled.png) |

| Phone, live | Phone, EEW warning (demo) |
| --- | --- |
| <img src="docs/screenshots/mobile-live.png" width="320" alt="Phone layout, live mode" /> | <img src="docs/screenshots/mobile-eew-warning.png" width="320" alt="Phone layout, EEW warning demo" /> |

---

## Install / run

### Android APK

```bash
# Build (produces build/yurewatch-0.1.0.apk)
npm ci
bash tools/build-apk.sh

# Install on a connected device
adb install -r build/yurewatch-0.1.0.apk
```

The app opens directly into the map. It does **not** start a local server, ask
for a URL, or need a computer. On first launch it polls the public feed; if the
network is unavailable it says so instead of showing invented data.

Releases: when a `v*` tag is pushed, `.github/workflows/android.yml` builds the
APK and attaches it to the GitHub Release. CI builds are signed with a throwaway
key generated at build time — see [Signing](#signing).

### Web build (development only)

```bash
npm ci
npm run dev          # http://localhost:5173  (dev server, for development)
npm run build        # dist/yurewatch.html — one self-contained file
npm run preview      # serve dist/ over HTTP
```

`dist/yurewatch.html` has **zero external references** (no CDN, no fonts, no
image URLs); the build fails if one appears. Open it from the filesystem or from
any static host.

---

## Build the APK

Requirements: JDK 11+ (17/21 verified), Android SDK with platform 34 and
**build-tools 35.0.0 or newer**, Node 18+.

`tools/build-apk.sh` uses the SDK build tools directly (aapt2 → javac → d8 →
zipalign → apksigner) instead of Gradle. The app is two Java classes and one
HTML asset, so there is nothing for a build system to do that a wrapped shell
script cannot, and the whole build is auditable in one file.

```bash
ANDROID_HOME=/path/to/sdk bash tools/build-apk.sh
```

| Step | Tool | Output |
| --- | --- | --- |
| Web bundle | Vite + `scripts/inline-single-file.mjs` | `android/app/assets/index.html` |
| Resources | `aapt2 compile` / `aapt2 link` | `build/base-unsigned.apk` |
| Java | `javac` against `android.jar` | `build/classes` |
| Bytecode | `d8 --min-api 24` | `build/dex/classes.dex` |
| Package | `zip`, `zipalign -p 4` | `build/app-aligned.apk` |
| Sign | `apksigner` | `build/yurewatch-<version>.apk` |

`apksigner verify --print-certs` and `aapt2 dump badging` run at the end of the
script, so a build that did not actually produce a valid, signed APK fails
loudly.

> **Known toolchain trap:** build-tools **34.0.0** ships an R8/d8 build that
> crashes with `NullPointerException: Cannot invoke "String.length()" because
> "<parameter1>" is null` on any class containing an anonymous inner class. This
> was reproduced with a two-line test class and is not caused by this project's
> code. The script therefore prefers build-tools 35+; pin `BUILD_TOOLS_OVERRIDE`
> if you need a specific version.

<a id="signing"></a>
### Signing

If `KEYSTORE` is unset, the build generates a throwaway debug keystore under
`android/keystore/` (git-ignored). For a distributable build, pass a real key:

```bash
KEYSTORE=/secure/release.jks KEYSTORE_PASS=… KEY_ALIAS=… KEY_PASS=… \
  bash tools/build-apk.sh
```

No key material, password or token is committed. `.gitignore` covers
`android/keystore/`, `*.jks`, `*.keystore` and `.env*`.

---

## Demo mode

Append `?demo=<scenario>` to the app URL (or `--es demo <scenario>` via adb, and
in-app via **デモ / テスト**):

| Scenario | Key | What it exercises |
| --- | --- | --- |
| 平常時 | `normal` | No EEW; historical events populate feed + map. |
| EEW 予報 | `forecast` | Area-less telegram → shown as **予報**, never as 警報. |
| EEW 警報 | `warning` | Warning with predicted max intensity and 4 target areas. |
| EEW 続報 | `updated` | Serials 1→3, magnitude/intensity revisions, PLUM-only area. |
| EEW 取消 | `cancelled` | Cancellation wording that does not imply safety. |
| 過去の地震情報 | `historical` | 震度速報 → 震源情報 → 各地の震度 merge; 暫定 badges. |
| 通信断 → 復旧 | `disconnect` | Offline state, then recovery. |
| 情報の停滞 | `stale` | Data stops updating → 情報が古い. |
| データ欠損 | `unavailable` | Malformed records + empty responses. |

```bash
adb shell am start -n net.yurewatch.app/.MainActivity --es demo warning
```

Demo payloads are shaped exactly like the real API's JSON and travel through the
same parsers, so the demo exercises production code. They are tagged with a
non-official source, which sets `simulated: true` on every model object; the UI
paints a `SIMULATION` banner, badges each row, and the alert panel refuses to use
the "official warning" treatment. **Audio is muted for simulated alerts unless
you explicitly add `&demoAudio=1`** (developer opt-in, also available as a source
flag). Demo data is never mixed into live state: starting either mode resets the
other.

---

## Data sources & honesty rules

Full detail, including terms review and rejected sources:
[`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

**In use — P2P地震情報 JSON API v2** (free, no key, documented, rate-limited):

- `GET https://api.p2pquake.net/v2/history?codes=556` — 緊急地震速報（警報）
- `GET …/history?codes=551` — 地震情報
- `GET …/history?codes=552` — 津波予報

Published limits: 60 req/min for `/history`, 10 req/min for `/jma`, 2 WebSocket
connections per IP. YureWatch issues 3 requests per tick at 20 s idle / 6 s
during an alert — between 9 and 30 req/min, inside the limit. The provider states
the API is free for commercial and non-commercial use.

Rules the code enforces (each has a unit test):

1. **`/history` is a history endpoint.** It returns days-old telegrams. EEW
   telegrams are gated to a 10-minute window before they can become an alert;
   tsunami bulletins are gated to 12 hours and only the newest is shown. Without
   this gate a week-old EEW would appear as an active warning — this was caught
   in testing and fixed.
2. **予報 ≠ 警報.** A telegram with no 警報対象区域 is a forecast. It gets its own
   colour, wording and (absent) intensity treatment.
3. **No invented numbers.** JMA sentinels (`-1` depth/magnitude, `-200`
   coordinates, `-1` scale) become "不明", never `0`. Missing timestamps stay
   missing ("時刻不明"), never "now".
4. **No invented countdown.** Arrival times are shown only when the source
   provides them per area, always labelled as a JMA prediction and explicitly
   *not* the user's own arrival time.
5. **Stale data is labelled stale.** A watchdog reclassifies the feed after 150 s
   without a successful poll; the header chip and the alert panel say so, and the
   panel refuses to claim "no alert is in force" while offline.
6. **Cancellations do not imply safety** — the wording says so.
7. **Preliminary estimates stay preliminary** — 震度速報-derived events carry a
   暫定 badge and a dashed marker ring until a 詳細 report arrives.

Not connected in v0.1 (and not faked): **NIED real-time intensity** (no
documented, licensed machine-readable API was identified — the panel says exactly
that) and **tsunami observations** (only 津波予報 is relayed by the source).
**DM-D.S.S.** is not used: it is a paid service with per-account credentials, and
the reference project's credentials are not transferable. A DM-D.S.S. adapter is
the documented upgrade path.

---

## Architecture

```
src/
  core/        models.ts, intensity.ts, time.ts, format.ts   ← domain types + JMA vocabulary
  sources/
    p2pquake/  wire.ts, parse.ts                             ← wire format + pure parsers
  state/       store.ts, alert.ts, events.ts                 ← reducer, EEW state machine, merges
  net/         transport.ts, liveFeed.ts                     ← HTTP bridge + polling/backoff/watchdog
  demo/        scenarios.ts, engine.ts                       ← deterministic simulation
  map/         geo.ts, mapData.ts, scene.ts, renderer.ts, view.ts, theme.ts
  ui/          app.ts, header.ts, alertPanel.ts, eventList.ts, details.ts,
               sections.ts, demoPanel.ts, audio.ts, dom.ts
  data/        japan-map.json (generated), prefectures.ts
```

Key decisions (full rationale in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

- **No UI framework.** ~200 KiB of DOM code that re-renders small panels from an
  immutable state object. It keeps the Android asset a single file and keeps
  rendering deterministic enough to unit test.
- **Pure core.** Parsers, the EEW state machine and scene construction are pure
  functions; `tests/` exercise them without a browser or a network.
- **One feed interface, two implementations.** `LiveFeed` and `DemoFeed` both
  emit `{connection,batch}` events into the same reducer, so demo and live cannot
  diverge in behaviour — only in provenance.
- **Canvas map, no tile server.** Geometry is compiled to `Path2D` once and the
  transform is animated per frame. No third-party map SDK, no API key, no tiles
  to fetch — which is also why the app works offline for everything except the
  feed.
- **Native HTTPS bridge on Android** instead of page `fetch`: a WebView loading
  from `file://` has an opaque origin, so cross-origin requests are blocked by
  CORS. The bridge also sets an honest `User-Agent` and keeps the request off the
  page's origin. No local HTTP server is started at all.

---

## Tests

```bash
npm test                  # 159 unit tests (vitest, jsdom)
npm run typecheck         # tsc --noEmit, strict
npm run build             # tsc + vite + single-file inliner (+ external-ref check)
node tools/verify-web.mjs # 18 browser integration checks (needs playwright)
bash tools/build-apk.sh   # produces a signed, verified APK
```

Coverage by area:

| File | What it pins down |
| --- | --- |
| `tests/parse.test.ts` | Wire → model: sentinels, provisional hypocentres, malformed records, simulation tagging, revision merging. |
| `tests/alert.test.ts` | State machine: new/updated/duplicate/out-of-order/cancelled/test, TTL expiry, arrival selection. |
| `tests/events.test.ts` | Feed merging, ordering, de-duplication, per-prefecture intensity reduction. |
| `tests/store.test.ts` | Reducer: connection health, alert lifecycle, demo isolation, selection stability, freshness bands. |
| `tests/geo.test.ts` | Mercator round-trips, fit-inside-viewport, zoom anchoring, pan clamping. |
| `tests/scene.test.ts` | Marker projection/culling/selection, intensity shading, EEW crosshair, hit testing, label collision. |
| `tests/demo.test.ts` | Scenario catalogue integrity, determinism, per-scenario outcomes, simulation flags. |
| `tests/liveFeed.test.ts` | Polling cadence, rate-limit budget, HTTP/network/JSON failures, backoff, stale watchdog, recency gating. |
| `tests/data.test.ts` | The 47-prefecture table and the map geometry cannot drift apart. |
| `tests/ui.test.ts` | Panel rendering: warning vs forecast wording, offline wording, SIMULATION labels, provenance. |
| `tools/verify-web.mjs` | Real Chromium: boot, painted canvas, **Android bridge contract**, demo labelling, lifecycle hooks, back gesture. |

`tools/verify-web.mjs` fakes `YureWatchNative` with the same
`request(id, url, timeoutMs)` → `__yurewatchNativeResolve(id, json)` flow as
`NativeNet.java`, so the bridge that ships in the APK is exercised without a
device. **The Java side itself was compiled, dexed and signature-verified, but
not run on a physical device or emulator in this environment (no KVM); that
remains a manual check.**

---

## Limitations of v0.1

- **Not a safety device.** No guarantee of delivery, ordering or timeliness;
  treat every estimate as provisional.
- **Polling, not push.** 6–20 s cadence via `/history`, so alerts can arrive
  later than a WebSocket client would see them. The provider's WebSocket API is
  rate-limited to 2 connections per IP and drops after 10 minutes on the sandbox;
  moving to it requires reconnect handling and (on Android) a foreground service
  to survive doze. Not in v0.1.
- **NIED real-time intensity is not connected** (see above). The section states
  this rather than substituting a different dataset silently.
- **Tsunami observations** (measured wave heights) are not available from the
  current source; only 津波予報 is shown.
- **Android build is not device-tested here.** The APK is built, aligned, signed
  and verified, and the JS bridge contract is covered by integration tests, but
  no emulator/device run was possible in this environment.
- **CI builds are debug-signed.** Publish with your own keystore for real
  distribution.
- **Japanese-language UI only.** The domain vocabulary (予報/警報, 震度, 津波) is
  JMA-specific and deliberately not machine-translated.
- **No background alerts.** The app polls only while in the foreground; there is
  no foreground service and no push notification. An EEW that arrives while the
  app is backgrounded will be seen on return if it is still within the freshness
  window — which, for a warning, it usually is not.
- Map geometry is simplified and **must not be used for navigation or
  measurement**; distances come from the scale bar only.

---

## Attribution & licensing

**Project code: MIT** (see [`LICENSE`](LICENSE)). Third-party notices:
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

| Component | Licence | Notes |
| --- | --- | --- |
| Map geometry (`src/data/japan-map.json`) | **Public domain** — Natural Earth 1:10m (admin-1, admin-0) | No attribution required; credited anyway. Regenerate with `npm run map:data`. |
| Earthquake/EEW/tsunami data | Provided via **P2P地震情報** (p2pquake.net); upstream information from 気象庁 (JMA) | Free for commercial and non-commercial use; API terms apply. JMA content is used under the Japanese government standard terms (public-data licence, attribution). This app is unaffiliated with JMA, NIED or p2pquake. |
| Alert tone | Synthesised at runtime with WebAudio | Original; no broadcast audio is redistributed. |
| App icon, UI, code | Original work, MIT | — |

No asset from the reference project is redistributed. See
[`docs/REFERENCE_INSPECTION.md`](docs/REFERENCE_INSPECTION.md).

---

## Relationship to the reference project

The visual language (dark map, intensity-coloured epicentres, intensity numeral
badges, tabbed information hierarchy, full-width alert area) is *inspired by*
[kotoho7/scratch-realtime-earthquake-viewer-page](https://github.com/kotoho7/scratch-realtime-earthquake-viewer-page).
That project is a Scratch/TurboWarp program packaged for the desktop with Tauri:
its logic lives in ~12,000 Scratch blocks and its `docs/assets` are CC BY-SA 2.0
Scratch assets. No code, artwork, map data or audio was copied. The design was
recreated from observation, with original geometry, palette, typography and
layout. Details and the licence review: `docs/REFERENCE_INSPECTION.md`.
