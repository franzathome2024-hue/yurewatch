# Map QA — after

Build: `dist/yurewatch.html` · 8 viewport cases

## Desktop landscape

- viewport `1920x1080` @1x
- map host x12 y136 1464x932 · canvas 1464x932
- camera centre (0.88186, 0.38604) scale 15439.7
- projected coverage x352 y28 739x850 → fill x 50.5% / y 91.2%; margins L352 R374 T28 B54
- profile: mainland

- PASS intended coverage fully on canvas — none
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 100.0% of the inset box (x 53.3%, y 100.0%; raw canvas x 50.5%, y 91.2%)
- PASS map is centred in its inset box — offset 0px, 0px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 1464x932 vs 1464x932
- PASS renderer painted land — 24.5% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 24.5%
- PASS predicted land is actually painted (>=95% of visible samples) — 64/64 visible land samples lit (43 sub-pixel islets skipped)
- PASS open ocean stays water (at most 1 overlay-covered sample) — 0/9 ocean samples lit
- PASS no overlay covers the map centre — controls at x1423 y871 44x188

## Laptop landscape

- viewport `1366x768` @1x
- map host x12 y136 958x620 · canvas 958x620
- camera centre (0.88227, 0.38653) scale 9772.4
- projected coverage x234 y28 468x538 → fill x 48.8% / y 86.8%; margins L234 R256 T28 B54
- profile: mainland

- PASS intended coverage fully on canvas — none
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 100.0% of the inset box (x 53.1%, y 100.0%; raw canvas x 48.8%, y 86.8%)
- PASS map is centred in its inset box — offset 0px, 0px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 958x620 vs 958x620
- PASS renderer painted land — 24.7% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 24.7%
- PASS predicted land is actually painted (>=95% of visible samples) — 53/53 visible land samples lit (55 sub-pixel islets skipped)
- PASS open ocean stays water (at most 1 overlay-covered sample) — 0/9 ocean samples lit
- PASS no overlay covers the map centre — controls at x917 y559 44x188

## Tablet landscape

- viewport `1024x768` @1x
- map host x12 y136 668x620 · canvas 668x620
- camera centre (0.88118, 0.39291) scale 8002.3
- projected coverage x121 y28 404x538 → fill x 60.5% / y 86.8%; margins L121 R143 T28 B54
- profile: archipelago

- PASS intended coverage fully on canvas — none
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 100.0% of the inset box (x 68.5%, y 100.0%; raw canvas x 60.5%, y 86.8%)
- PASS map is centred in its inset box — offset 0px, 0px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 668x620 vs 668x620
- PASS renderer painted land — 20.8% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 20.8%
- PASS predicted land is actually painted (>=95% of visible samples) — 50/51 visible land samples lit (78 sub-pixel islets skipped)
- PASS open ocean stays water (at most 1 overlay-covered sample) — 0/9 ocean samples lit
- PASS no overlay covers the map centre — controls at x627 y559 44x188

## Tablet portrait

- viewport `820x1180` @1x
- map host x8 y126 804x974 · canvas 804x974
- camera centre (0.88064, 0.39227) scale 13267.7
- projected coverage x56 y28 670x892 → fill x 83.4% / y 91.6%; margins L56 R78 T28 B54
- profile: archipelago

- PASS intended coverage fully on canvas — none
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 100.0% of the inset box (x 92.3%, y 100.0%; raw canvas x 83.4%, y 91.6%)
- PASS map is centred in its inset box — offset 0px, 0px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 804x974 vs 804x974
- PASS renderer painted land — 21.9% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 21.9%
- PASS predicted land is actually painted (>=95% of visible samples) — 63/63 visible land samples lit (66 sub-pixel islets skipped)
- PASS open ocean stays water (at most 1 overlay-covered sample) — 0/7 ocean samples lit
- PASS no overlay covers the map centre — controls at x757 y895 46x196

## Narrow Android portrait

- viewport `360x740` @2x
- map host x8 y126 344x534 · canvas 344x534
- camera centre (0.88176, 0.39360) scale 5621.0
- projected coverage x19 y65 284x378 → fill x 82.6% / y 70.8%; margins L19 R41 T65 B91
- profile: archipelago

- PASS intended coverage fully on canvas — none
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 100.0% of the inset box (x 100.0%, y 80.4%; raw canvas x 82.6%, y 70.8%)
- PASS map is centred in its inset box — offset 0px, 0px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 688x1068 vs 688x1068
- PASS renderer painted land — 23.2% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 23.2%
- PASS predicted land is actually painted (>=95% of visible samples) — 45/46 visible land samples lit (83 sub-pixel islets skipped)
- PASS open ocean stays water (at most 1 overlay-covered sample) — 0/8 ocean samples lit
- PASS no overlay covers the map centre — controls at x297 y455 46x196

## Android landscape

- viewport `740x360` @2x
- map host x8 y126 724x154 · canvas 724x154
- camera centre (0.88623, 0.38867) scale 2161.6
- projected coverage x299 y10 103x119 → fill x 14.3% / y 77.3%; margins L299 R321 T10 B25
- profile: mainland

- PASS intended coverage fully on canvas — none
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 100.0% of the inset box (x 15.2%, y 100.0%; raw canvas x 14.3%, y 77.3%)
- PASS map is centred in its inset box — offset 0px, 0px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 1448x308 vs 1448x308
- PASS renderer painted land — 14.0% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 14.0%
- PASS predicted land is actually painted (>=95% of visible samples) — 31/32 visible land samples lit (77 sub-pixel islets skipped)
- PASS open ocean stays water (at most 1 overlay-covered sample) — 1/6 ocean samples lit
- PASS no overlay covers the map centre — controls at x677 y75 46x196

## Resize after launch (1440x900 -> 900x1200)

- viewport `1440x900` @1x → resized to `900x1200`
- map host x8 y126 884x994 · canvas 884x994
- camera centre (0.88181, 0.38598) scale 16565.9
- projected coverage x35 y28 793x912 → fill x 89.7% / y 91.8%; margins L35 R57 T28 B54
- profile: mainland

- PASS intended coverage fully on canvas — none
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 100.0% of the inset box (x 98.3%, y 100.0%; raw canvas x 89.7%, y 91.8%)
- PASS map is centred in its inset box — offset 0px, 0px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 884x994 vs 884x994
- PASS renderer painted land — 23.8% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 23.8%
- PASS predicted land is actually painted (>=95% of visible samples) — 66/66 visible land samples lit (41 sub-pixel islets skipped)
- PASS open ocean stays water (at most 1 overlay-covered sample) — 0/7 ocean samples lit
- PASS no overlay covers the map centre — controls at x837 y915 46x196

## Alert strip changes height (EEW warning)

- viewport `1366x768` @1x
- map host x12 y286 958x470 · canvas 958x470
- camera centre (0.88269, 0.38703) scale 7120.4
- projected coverage x298 y26 341x392 → fill x 35.6% / y 83.4%; margins L298 R320 T26 B52
- profile: mainland
- alert strip: map host 620px → 470px

- PASS intended coverage fully on canvas — none
- PASS no feature half-cut at an edge — 0 partially cut
- PASS map fills the space left for it (dominant axis >=97%) — 100.0% of the inset box (x 38.5%, y 100.0%; raw canvas x 35.6%, y 83.4%)
- PASS map is centred in its inset box — offset 0px, 0px
- PASS canvas is not stretched (aspect within 0.5%) — 0.0% aspect drift
- PASS canvas backing store matches CSS box — 958x470 vs 958x470
- PASS renderer painted land — 30.5% of pixels
- PASS land covers a plausible share of the frame (3-60%) — 30.5%
- PASS predicted land is actually painted (>=95% of visible samples) — 44/46 visible land samples lit (62 sub-pixel islets skipped)
- PASS open ocean stays water (at most 1 overlay-covered sample) — 0/9 ocean samples lit
- PASS no overlay covers the map centre — controls at x917 y559 44x188

**88/88 checks passed** across 8 viewports.

Screenshots: `docs/qa/after/`
