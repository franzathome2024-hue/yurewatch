# Map framing & clipping QA

`tools/map-qa.mjs` loads the **built** single-file app in Chromium, drives it through
eight viewport classes, reads the live camera out of the running app, re-projects the
shipped geometry with the same maths, and then checks the prediction against the
pixels the renderer actually produced. It exits non-zero on failure, so it can gate CI.

```bash
npm run build
node tools/map-qa.mjs --label after      # writes docs/qa/after.md + screenshots
npm run qa:map                           # same, default label
```

## What it measures per viewport

| Measurement | Source | Why |
| --- | --- | --- |
| map host + canvas box | `getBoundingClientRect` | the space actually available |
| camera centre and scale | `window.__yurewatch.map()` | what the framing decided |
| declared profile + ring list | `debugState().coverage` | what the app *claims* to show |
| projected coverage box | geometry re-projected in Node | where the country landed |
| land/ocean pixel probes | `getImageData` on the canvas | whether the pixels agree |
| label boxes | `debugState().labels` | so ocean probes don't count text |

## Checks

1. **Intended coverage fully on canvas** — every ring the active profile declares is
   inside the canvas. This is the clipping test.
2. **No feature half-cut at an edge.**
3. **Map fills the space left for it** — coverage ÷ the inset box, ≥97% on the
   dominant axis. Measured against the *inset* box, not the raw canvas, because the
   chrome (controls, scale bar) sits on top of the map.
4. **Map is centred in its inset box** — offsets are deliberately asymmetric.
5. **Canvas is not stretched** — backing-store aspect vs CSS aspect, ≤0.5% drift.
6. **Backing store matches the CSS box** — catches DPR rounding errors.
7. **Renderer painted land** and **land covers a plausible share (3–60%)**.
8. **Predicted land is actually painted** — area centroids of visible rings, ≥95%.
   Rings narrower than 6 px are counted and skipped: 1:10m carries dozens of 4–8
   point islets that no zoom can make testable.
9. **Open ocean stays water** — reference water points (Pacific, Sea of Japan, East
   China Sea) with at most one sample allowed to be covered by a marker or callout.
10. **No overlay covers the map centre.**

## Viewport matrix

| Case | Size | DPR |
| --- | --- | --- |
| Desktop landscape | 1920×1080 | 1 |
| Laptop landscape | 1366×768 | 1 |
| Tablet landscape | 1024×768 | 1 |
| Tablet portrait | 820×1180 | 1 |
| Narrow Android portrait | 360×740 | 2 |
| Android landscape | 740×360 | 2 |
| Resize after launch | 1440×900 → 900×1200 | 1 |
| Alert strip changes height | 1366×768, `?demo=warning` | 1 |

Screenshots for every case: `docs/qa/before/` (pre-fix commit `c5d51f9`) and
`docs/qa/after/` (current).

## Result

| Run | Build | Checks |
| --- | --- | --- |
| before | `c5d51f9` + camera diagnostics only | **71/88** |
| after | this release | **88/88** |

The before-run uses the identical harness. The only change made to the old build was
adding `cx`/`cy` to `debugState()`, because the old version exposed no way to recover
the camera.

## Root causes found, all reproduced

**1. Coverage was declared by a hand-written lat/lon box that excluded shipped
islands** (`src/map/geo.ts`, `PRIMARY_VIEW_BOUNDS`). The box stopped at 26.0 °N while
the dataset carries Ogasawara and the Izu volcanoes down to 24.2 °N. Those rings were
fitted *outside* the frame and fell off the bottom edge.

- Desktop 1920×1080: coverage ran to `B −54 px`; 3 rings entirely off-canvas.
- Tablet portrait: `B −57 px`. Resize case: `B −59 px`. Alert-strip case: `B −17 px`.
- Not a canvas, CSS or projection fault: aspect drift was 0.0% and the pixel probe
  confirmed the renderer agreed with the camera.

**2. Fixed pixel padding on short panes.** `fitBounds(..., 18)` spent 36 of a 154 px
Android-landscape height on padding — 23% — leaving the map at 82% of the strip.

**3. Vertical centring drifted** by 41–44 px wherever (1) applied, because the extra
southern rings pushed the measured coverage box off-centre while the camera stayed
centred on the box that excluded them.

**4. Context land was truncated at a clip box inside the view** (`127.5 °E`). China
ended in a straight vertical line partway across the map. Fixed in the generator by
clipping neighbours at `114–162 °E / 16–56 °N`, beyond the pan limits.

**5. Labels were drawn left-aligned but collision-tested as if centred**, so adjacent
prefecture names overlapped (`秋田県`/`岩手県` at fit) and names printed across
epicentre markers. Found by looking at the screenshots, not by the harness.

## What was *not* the cause

Checked and cleared: canvas sizing and DPR rounding (backing store matched CSS in all
eight cases), CSS overflow (`overflow: hidden` on `.mapPane` clips only outside the
canvas), projection (round-trip error < 1e-12, see `tests/framing.test.ts`), and
polygon winding (`fill(path, 'evenodd')` already handled holes).

## Limitations

- Browser and emulated-viewport only. No physical Android device is available in the
  build environment (no `/dev/kvm`), so GPU compositing, real touch gestures and
  vendor WebView differences are untested.
- The ocean probe tolerates one covered sample; it cannot distinguish "ocean drawn as
  land" from "ocean obscured" at the single-pixel level.
- Sub-pixel islets are counted, not asserted.
