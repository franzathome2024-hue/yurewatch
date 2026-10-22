# Screenshot provenance

All images in this directory are captured from `dist/yurewatch.html` — the
exact single-file build the APK embeds — by `node tools/screenshots.mjs`
(Playwright, deviceScaleFactor 2, Asia/Tokyo). They were last regenerated at
commit `3103af9`, which is tag `v0.4.0`; `git diff 3103af9..HEAD -- src/
index.html` is empty, so they depict the currently shipped interface
byte-for-byte. Regenerate after any UI change with:

```bash
npm run build && node tools/screenshots.mjs
```

## Live captures vs simulations

"Live" shots show whatever the public feed contained at capture time.
Alert-state shots cannot be captured on demand from the real feed, so they
use the app's demo scenarios (`?demo=…`) — the data is simulated, and every
such image carries the app's own SIMULATION banner in-frame, by design.

| File | Capture | Content |
| --- | --- | --- |
| `desktop-live.png` | **live** | Recent earthquakes, desktop |
| `desktop-detail.png` | **live** | Event detail panel |
| `desktop-info.png` | **live** | Diagnostics / info panel |
| `desktop-legend.png` | **live** | Map legend |
| `tablet-live.png` | **live** | Tablet portrait |
| `mobile-live.png` | **live** | Phone, map + peek sheet |
| `mobile-list.png` | **live** | Phone, panel expanded |
| `en-desktop-live.png` | **live** | English interface |
| `desktop-eew-warning.png` | simulation (`?demo=warning`) | EEW warning state |
| `desktop-eew-cancelled.png` | simulation (`?demo=cancelled`) | Cancelled EEW state |
| `desktop-tsunami.png` | simulation (`?demo=tsunami`) | Tsunami forecast regions |
| `mobile-eew-warning.png` | simulation (`?demo=warning`) | EEW warning, phone |
| `en-desktop-eew-warning.png` | simulation (`?demo=warning`) | EEW warning, English |
