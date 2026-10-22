# Testing

Three layers, all runnable locally and in CI.

```bash
npm test                    # 159 unit/integration tests (vitest + jsdom)
npm run typecheck           # strict tsc, no emit
npm run build               # tsc + vite + single-file inline + external-ref check
node tools/verify-web.mjs   # 18 browser checks in Chromium
bash tools/build-apk.sh     # signed, verified APK
```

## What is covered where

| Layer | File | Notes |
| --- | --- | --- |
| Parsing / domain | `tests/parse.test.ts` | JMA sentinels, provisional hypocentres, malformed records, revision merging, simulation tagging. |
| Alert state machine | `tests/alert.test.ts` | new / updated / duplicate / out-of-order / cancelled / test; TTL expiry; source-supplied arrival selection. |
| Feed reduction | `tests/events.test.ts` | merge across 震度速報→詳細, ordering, de-duplication, per-prefecture intensity. |
| Reducer | `tests/store.test.ts` | connection health, alert lifecycle, demo isolation, selection stability, freshness bands. |
| Projection / camera | `tests/geo.test.ts` | Mercator round-trip, fit-with-padding, zoom-anchor invariance, pan clamping. |
| Map scene | `tests/scene.test.ts` | marker projection, culling, sizing, selection order, intensity shading, EEW crosshair, hit test, label collision. |
| Demo engine | `tests/demo.test.ts` | catalogue integrity, determinism (played twice), per-scenario outcomes, "everything is simulated". |
| Live feed | `tests/liveFeed.test.ts` | cadence budget, HTTP/network/JSON failures, exponential backoff, stale watchdog, recency gating. |
| Data integrity | `tests/data.test.ts` | the 47-prefecture table and map geometry cannot drift. |
| UI rendering | `tests/ui.test.ts` | 警報 vs 予報 wording, offline wording, SIMULATION badges, provenance, empty states. |
| Browser integration | `tools/verify-web.mjs` | boot, painted canvas, Android bridge contract, demo labelling, lifecycle hooks, back-gesture sequence. |

## Bugs these tests caught during development

Recorded because they justify the coverage, not to pad the list:

1. **Week-old EEW shown as live** — `/history` returned a 2026-10-16 telegram on
   a 2026-10-22 poll. Fixed with recency gating; tests in `liveFeed.test.ts`.
2. **Cancelled alerts still drew the red crosshair** on the map.
3. **SIMULATION banner visible in live mode** — a component's `display:flex`
   outranked the `[hidden]` attribute.
4. **Android back gesture looped** — returning to live mode re-auto-selected an
   event on every batch, so back never reached the activity.
5. **Single-file build ran before `<body>` existed** — the inliner moved the
   Vite bundle into `<head>` and dropped `type="module"`; it also expanded `$'`
   inside the minified bundle as a replacement pattern, corrupting the HTML.
6. **`alert__areaKind` for PLUM areas** revealed that `kindCode: 19` must not be
   presented as an arrival time.
7. **Map did not refit** after the alert panel changed height (Japan off-centre).
8. **Recenter glyph rendered as tofu** on Android system fonts (now inline SVG).

## What is *not* tested (honest gaps)

- The Java side (`MainActivity`, `NativeNet`) is compiled, dexed and
  signature-verified, and its **JS contract** is exercised in Chromium — but it
  has not been run on a device or emulator in this environment (no KVM available).
  A device smoke test is the first thing to do on hardware.
- Canvas *pixels* are not asserted; the scene graph is. A rendering regression
  would need a visual-diff harness.
- No load/soak test: polling behaviour is verified with fake timers, not over
  hours with real network conditions.
