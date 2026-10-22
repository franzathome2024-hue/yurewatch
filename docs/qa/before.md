# Map QA — before

Build: `dist/yurewatch.html` · 8 viewport cases

## Desktop landscape

- viewport `1920x1080` @1x
- map host x12 y136 1464x932 · canvas 1464x932
- camera centre (0.88000, 0.39106) scale 13136.8
- projected coverage x398 y27 664x959 → fill x 45.3% / y 102.9%; margins L398 R403 T27 B-54
- profile: **not declared**

- **FAIL** intended coverage fully on canvas — 3 feature(s) entirely off-canvas: 東京都@24.7N, 東京都@25.4N, 東京都@24.2N
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 102.9% of the inset box (x 45.3%, y 102.9%; raw canvas x 45.3%, y 102.9%)
- **FAIL** map is centred in its inset box — offset -3px, 41px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 1464x932 vs 1464x932
- PASS renderer painted land — 10.7% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 10.7%
- PASS predicted land is actually painted (>=95% of visible samples) — 63/63 visible land samples lit (71 sub-pixel islets skipped)
- PASS open ocean stays water (corners unpainted) — 0 of 4 ocean corners lit
- PASS no overlay covers the map centre — controls at x1423 y919 44x140

## Laptop landscape

- viewport `1366x768` @1x
- map host x12 y136 958x620 · canvas 958x620
- camera centre (0.88000, 0.39106) scale 8562.4
- projected coverage x261 y24 433x625 → fill x 45.2% / y 100.8%; margins L261 R264 T24 B-29
- profile: **not declared**

- **FAIL** intended coverage fully on canvas — 2 feature(s) entirely off-canvas: 東京都@24.7N, 東京都@24.2N
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 100.8% of the inset box (x 45.2%, y 100.8%; raw canvas x 45.2%, y 100.8%)
- **FAIL** map is centred in its inset box — offset -2px, 27px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 958x620 vs 958x620
- PASS renderer painted land — 11.0% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 11.0%
- PASS predicted land is actually painted (>=95% of visible samples) — 52/53 visible land samples lit (81 sub-pixel islets skipped)
- PASS open ocean stays water (corners unpainted) — 0 of 4 ocean corners lit
- PASS no overlay covers the map centre — controls at x917 y607 44x140

## Tablet landscape

- viewport `1024x768` @1x
- map host x12 y136 668x620 · canvas 668x620
- camera centre (0.88000, 0.39106) scale 8562.4
- projected coverage x116 y24 433x625 → fill x 64.8% / y 100.8%; margins L116 R119 T24 B-29
- profile: **not declared**

- **FAIL** intended coverage fully on canvas — 2 feature(s) entirely off-canvas: 東京都@24.7N, 東京都@24.2N
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 100.8% of the inset box (x 64.8%, y 100.8%; raw canvas x 64.8%, y 100.8%)
- **FAIL** map is centred in its inset box — offset -2px, 27px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 668x620 vs 668x620
- PASS renderer painted land — 15.6% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 15.6%
- PASS predicted land is actually painted (>=95% of visible samples) — 52/53 visible land samples lit (81 sub-pixel islets skipped)
- PASS open ocean stays water (corners unpainted) — 0 of 4 ocean corners lit
- PASS no overlay covers the map centre — controls at x627 y607 44x140

## Tablet portrait

- viewport `820x1180` @1x
- map host x8 y126 804x974 · canvas 804x974
- camera centre (0.88000, 0.39106) scale 13752.6
- projected coverage x52 y28 695x1004 → fill x 86.4% / y 103.0%; margins L52 R57 T28 B-57
- profile: **not declared**

- **FAIL** intended coverage fully on canvas — 3 feature(s) entirely off-canvas: 東京都@24.7N, 東京都@25.4N, 東京都@24.2N
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 103.0% of the inset box (x 86.4%, y 103.0%; raw canvas x 86.4%, y 103.0%)
- **FAIL** map is centred in its inset box — offset -3px, 43px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 804x974 vs 804x974
- PASS renderer painted land — 20.0% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 20.0%
- PASS predicted land is actually painted (>=95% of visible samples) — 64/64 visible land samples lit (69 sub-pixel islets skipped)
- PASS open ocean stays water (corners unpainted) — 0 of 3 ocean corners lit
- PASS no overlay covers the map centre — controls at x757 y945 46x146

## Narrow Android portrait

- viewport `360x740` @2x
- map host x8 y126 344x534 · canvas 344x534
- camera centre (0.88000, 0.39106) scale 5657.1
- projected coverage x28 y78 286x413 → fill x 83.1% / y 77.3%; margins L28 R30 T78 B43
- profile: **not declared**

- PASS intended coverage fully on canvas — none
- PASS no feature half-cut at an edge — 0 partially cut
- **FAIL** map fills the space left for it (dominant axis >=97%) — 83.1% of the inset box (x 83.1%, y 77.3%; raw canvas x 83.1%, y 77.3%)
- **FAIL** map is centred in its inset box — offset -1px, 18px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 688x1068 vs 688x1068
- PASS renderer painted land — 16.9% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 16.9%
- PASS predicted land is actually painted (>=95% of visible samples) — 45/46 visible land samples lit (88 sub-pixel islets skipped)
- PASS open ocean stays water (corners unpainted) — 0 of 3 ocean corners lit
- PASS no overlay covers the map centre — controls at x297 y505 46x146

## Android landscape

- viewport `740x360` @2x
- map host x8 y126 724x154 · canvas 724x154
- camera centre (0.88000, 0.39106) scale 1730.1
- projected coverage x318 y19 87x126 → fill x 12.1% / y 82.0%; margins L318 R319 T19 B9
- profile: **not declared**

- PASS intended coverage fully on canvas — none
- PASS no feature half-cut at an edge — 0 partially cut
- **FAIL** map fills the space left for it (dominant axis >=97%) — 82.0% of the inset box (x 12.1%, y 82.0%; raw canvas x 12.1%, y 82.0%)
- **FAIL** map is centred in its inset box — offset 0px, 5px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 1448x308 vs 1448x308
- PASS renderer painted land — 7.1% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 7.1%
- **FAIL** predicted land is actually painted (>=95% of visible samples) — 18/19 visible land samples lit (117 sub-pixel islets skipped)
- PASS open ocean stays water (corners unpainted) — 0 of 4 ocean corners lit
- PASS no overlay covers the map centre — controls at x677 y125 46x146

## Resize after launch (1440x900 -> 900x1200)

- viewport `1440x900` @1x → resized to `900x1200`
- map host x8 y126 884x994 · canvas 884x994
- camera centre (0.88000, 0.39106) scale 14045.9
- projected coverage x84 y28 710x1025 → fill x 80.3% / y 103.1%; margins L84 R90 T28 B-59
- profile: **not declared**

- **FAIL** intended coverage fully on canvas — 3 feature(s) entirely off-canvas: 東京都@24.7N, 東京都@25.4N, 東京都@24.2N
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 103.1% of the inset box (x 80.3%, y 103.1%; raw canvas x 80.3%, y 103.1%)
- **FAIL** map is centred in its inset box — offset -3px, 44px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 884x994 vs 884x994
- PASS renderer painted land — 18.5% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 18.5%
- PASS predicted land is actually painted (>=95% of visible samples) — 64/64 visible land samples lit (69 sub-pixel islets skipped)
- PASS open ocean stays water (corners unpainted) — 0 of 3 ocean corners lit
- PASS no overlay covers the map centre — controls at x837 y965 46x146

## Alert strip changes height (EEW warning)

- viewport `1366x768` @1x
- map host x12 y286 958x470 · canvas 958x470
- camera centre (0.88000, 0.39106) scale 6363.2
- projected coverage x317 y23 321x464 → fill x 33.6% / y 98.8%; margins L317 R319 T23 B-17
- profile: **not declared**
- alert strip: map host 620px → 470px

- **FAIL** intended coverage fully on canvas — 2 feature(s) entirely off-canvas: 東京都@24.7N, 東京都@24.2N
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 98.8% of the inset box (x 33.6%, y 98.8%; raw canvas x 33.6%, y 98.8%)
- **FAIL** map is centred in its inset box — offset -1px, 20px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 958x470 vs 958x470
- PASS renderer painted land — 9.5% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 9.5%
- PASS predicted land is actually painted (>=95% of visible samples) — 48/48 visible land samples lit (86 sub-pixel islets skipped)
- PASS open ocean stays water (corners unpainted) — 0 of 4 ocean corners lit
- PASS no overlay covers the map centre — controls at x917 y607 44x140

**71/88 checks passed** across 8 viewports.

Screenshots: `docs/qa/before/`
