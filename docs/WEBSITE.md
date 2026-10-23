# Website & GitHub Pages deployment

## Live URL

**https://franzathome2024-hue.github.io/yurewatch/**

- Landing page: `/yurewatch/`
- Browser viewer: `/yurewatch/viewer/`

The site is a static GitHub Pages deployment. There is no backend, no database,
no API key, no analytics and no third-party CDN. The viewer talks directly from
the visitor's browser to the public P2P地震情報 API (`Access-Control-Allow-Origin: *`),
exactly as the Android WebView build does.

## What is published

One application, one build, three targets. The website reuses the existing
single-file web build verbatim — there is no second app and no second build
configuration.

| Path in artifact | Source | Notes |
| --- | --- | --- |
| `index.html` | `site/index.html` | Hand-written landing page, inline CSS, no framework |
| `assets/favicon.svg` | `site/assets/favicon.svg` | Same mark as the in-app icon |
| `assets/screenshots/*.png` | `docs/screenshots/` | Real captures of the shipped viewer; copied by the build script |
| `viewer/index.html` | `dist/yurewatch.html` | The shipped single-file app, byte-for-byte, plus one injected fixed-position "← YureWatch" back-link (CSS + anchor only; it cannot change the app's measured viewport, canvas size or framing) |

Assembly is done by `tools/build-site.mjs` (`npm run site:build`), which also
**validates** the artifact and fails the build if:

- any local `href`/`src` on any page does not resolve inside `_site/`,
- any page contains a root-absolute path (`/assets/...`), which would resolve to
  the domain root instead of under `/yurewatch/`,
- the shipped viewer references an external resource (the single-file guarantee),
- the viewer is missing the injected back-link,
- a screenshot is listed but missing, or shipped but never referenced,
- the landing page is missing `<title>`, meta description, canonical URL,
  Open Graph metadata or a favicon.

The app itself needs no changes for the subpath: the bundle contains zero
root-relative asset references, all state lives in the query string (no
History-API router), and every Android-shell API is already feature-guarded
(`detectTransport()` falls back to `fetch`, `navigator.vibrate` is
typeof-checked, `window.YureWatchPrefs` and the shell hooks are optional).

## Deployment process

`.github/workflows/pages.yml`, three jobs:

1. **build** — `npm ci`, `npm run build` (existing single-file bundle),
   `npm run site:build` (assemble + validate), upload `_site/` as the Pages
   artifact.
2. **deploy** — `actions/deploy-pages@v4`. This is the only job with elevated
   permissions (`pages: write`, `id-token: write`); the workflow default is
   `contents: read`.
3. **verify** — polls the published URLs until they serve expected content
   (the landing page marker text and the viewer's back-link), then asserts every
   asset the landing page references returns HTTP 200.

Triggers: push to `main`, or manual `workflow_dispatch`. **Tags do not trigger
it.** The Android workflow (`android.yml`) owns tag pushes and release assets, so
a website deployment can never publish, rebuild or overwrite an APK, and an APK
release can never trigger a website deploy. Deployments are serialised with
`concurrency: group: pages, cancel-in-progress: false`.

Preview locally, served from the production subpath on purpose (serving from `/`
would hide exactly the bugs that break Pages):

```bash
npm run site:build
npm run site:serve     # http://localhost:4173/yurewatch/
npm run verify:site    # headless-browser checks against that server
```

`npm run verify:site` (66 checks) covers: landing-page metadata, favicon,
canonical and social tags; every screenshot decoding with alt text; the
"Open Live Viewer" CTA resolving under the subpath; skip link, single `h1`,
landmarks, keyboard focus, no horizontal overflow at 360 px; zero console errors
and zero failed requests; the viewer booting, painting its canvas, reaching the
live connection state against the real API, and its back-link returning to the
landing page; offline stated in words (オフライン + 状態不明) on a phone viewport;
simulation mode labelled as simulation without triggering speech; and the PWA
layer — manifest/scope/icon validity, service-worker scope, shell-only caching
with proof that no API response is ever cached, broken-deployment fallback,
offline startup showing "no data" rather than "live", reconnect recovery, and
cache eviction on worker update (see [PWA.md](PWA.md)).

## Rollback

Pages deployments are immutable artifacts; there is no "edit the live site"
path. To roll back:

1. **Preferred — revert and redeploy.** `git revert <bad-commit>` on `main` and
   push. The workflow rebuilds and redeploys the previous content. (Or check out
   the last good commit and run the workflow manually via *Actions → pages →
   Run workflow*.)
2. **Fastest stop-gap — disable Pages.** Repository *Settings → Pages*, or
   `DELETE /repos/franzathome2024-hue/yurewatch/pages`. The URL then returns 404
   until Pages is re-enabled (`POST` with `{"build_type":"workflow"}`) and the
   workflow is re-run.
3. **Broken viewer only.** Because `viewer/index.html` is generated from
   `dist/yurewatch.html` at deploy time, a viewer regression is fixed by fixing
   the app build — there is no separately-versioned viewer copy to patch.

Note that the Android APK and its GitHub Releases are unaffected by any of the
above: they are produced by a different workflow from a different trigger.

## Known limitations

- **Polling, not push.** The viewer polls the provider's `/history` endpoint
  (6 s while an alert is active, 20 s idle; ≈9–30 requests/minute against the
  provider's published 60 requests/minute limit). A warning can therefore arrive
  later than it would over the provider's WebSocket.
- **Provider availability.** P2P地震情報 is an unpaid, unwarranted third-party
  relay. If it is unreachable the viewer degrades to a clearly-labelled stale /
  offline state rather than presenting old data as current.
- **Browser speech.** Voice announcements depend on the visitor's OS/browser
  providing a TTS voice for the active language; the viewer reports when none is
  available instead of failing silently.
- **No offline caching.** The site does not install a service worker; reloading
  without a network connection shows the browser's own error page.
- **Alerting is best-effort.** As everywhere else in this project: YureWatch is
  an informational viewer, not an independent detector and not a guaranteed
  early-warning service. Follow JMA announcements and local authority guidance.
