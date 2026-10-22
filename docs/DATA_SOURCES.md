# Data sources

Every source below was verified against its live endpoint on **2026-10-22**
(actual HTTP requests, actual response bodies). Nothing in the app is mocked to
look live: where a source is unavailable, the UI says so.

## 1. In use — P2P地震情報 JSON API v2

| Property | Value |
| --- | --- |
| Base URL | `https://api.p2pquake.net/v2` |
| Spec | <https://www.p2pquake.net/develop/json_api_v2/> · OpenAPI: `/swagger-ui/specification.yaml` (version 2.3.0) |
| Auth | None |
| Cost | Free, commercial and non-commercial ("商用・非商用問わず無償") |
| Reuse terms | <https://www.p2pquake.net/secondary_use/> — attribution for JMA-derived information |
| Rate limits | `/history` 60 req/min/IP · `/jma` 10 req/min/IP · `/ws` 2 connections/IP |
| CORS | `access-control-allow-origin: *` (verified) |
| Transport used | HTTP polling of `/history` |

### Endpoints used

```
GET /history?codes=556&limit=20   緊急地震速報（警報）      → alerts
GET /history?codes=551&limit=30   地震情報                  → event feed
GET /history?codes=552&limit=5    津波予報                  → tsunami panel
```

### Request budget

| Mode | Cadence | Requests/min |
| --- | --- | --- |
| Idle | 20 s | 9 |
| EEW in force (5 min after last EEW) | 6 s | 30 |
| Failure | exponential backoff, 1.8 s → 54 s + 20 % jitter | ≤ 3.3 |

All well inside 60 req/min. `tests/liveFeed.test.ts` asserts the cadence
arithmetic so a future change cannot silently exceed the limit.

### Verified response shapes (abridged, real bodies)

`code: 551` (地震情報):

```json
{"code":551,"id":"6ad94144e88ee598246bf40b","time":"2026/10/22 07:48:36.23",
 "issue":{"source":"気象庁","time":"2026/10/22 07:48:35","type":"DetailScale","correct":"None"},
 "earthquake":{"time":"2026/10/22 07:45:00","maxScale":10,"domesticTsunami":"None",
   "hypocenter":{"name":"熊本県熊本地方","latitude":32.4,"longitude":130.6,"depth":10,"magnitude":2.9}},
 "points":[{"addr":"五木村甲","pref":"熊本県","scale":10,"isArea":false}]}
```

`code: 556` (緊急地震速報):

```json
{"code":556,"id":"…","cancelled":false,"test":false,
 "issue":{"time":"…","eventId":"20261016123810","serial":"2"},
 "earthquake":{"originTime":"…","arrivalTime":"…","condition":null,
   "hypocenter":{"name":"…","latitude":…,"longitude":…,"depth":…,"magnitude":…}},
 "areas":[{"pref":"北海道道東","name":"根室地方北部","scaleFrom":45,"scaleTo":70,
           "kindCode":"11","arrivalTime":null}]}
```

`code: 552` (津波予報): `cancelled`, `issue{source,time,type}`, `areas[]` with
`grade` (`MajorWarning|Warning|Watch|Unknown`), `firstHeight.arrivalTime`,
`maxHeight{description,value}`.

### Documented fields the app deliberately ignores

| Field / code | Why |
| --- | --- |
| `554` EEW detection, `561` userquake, `9611` area peers, `556`-adjacent social telegrams | Not official information; presenting them would blur the official/unofficial line. |
| `test: true` telegrams | Accepted by the parser, but the alert state machine can be configured to ignore them, and the panel badges them 訓練/試験 so they never adopt warning styling. |
| `comments.freeFormComment` | Free-form, unvetted text. |

### Gotchas found while building against it (all handled in code)

1. **`/history` returns history.** One poll of `codes=556` at 07:48 JST returned
   EEW telegrams from six days earlier (2026-10-16). A naive viewer shows that as
   an active warning. `partitionEews()` gates alerts to a 10-minute window, and
   `pickCurrentTsunami()` keeps only the newest bulletin within 12 hours.
2. **JMA sentinels leak into JSON**: `latitude/longitude: -200`, `depth: -1`,
   `magnitude: -1`, `maxScale: -1`. `parseEpicenter()` converts these to
   "unknown" and never to `0`.
3. **Intensity codes arrive as floats** (`45.0`, and the spec notes "システムの都合で
   小数点が付きますが整数部のみ有効です"). `normaliseScale()` truncates and rejects
   negatives.
4. **Area intensities are ranges** (`scaleFrom`/`scaleTo`) plus a `kindCode`
   describing whether the main motion has arrived (`10`/`11`) or is PLUM-only
   (`19`). The panel shows the range and the arrival state; it does not collapse
   them into a single number.
5. **`cancelled` telegrams carry `earthquake: null`.** Parsing must not treat
   that as an error, and the map must stop drawing the crosshair (fixed after
   review: see `src/map/scene.ts`).
6. **Timestamps are JST strings without a zone** (`2026/10/22 07:45:00.123`), and
   some are unparsable. `parseJst()` is strict and returns `null`.

## 2. Not connected (and not simulated)

| Source | Status | Reason |
| --- | --- | --- |
| **Project DM-D.S.S.** (dmdata.jp) | Not used | Paid subscription with per-account API key; credentials cannot ship in an APK. Adapter path documented below. |
| **NIED 長周期地震動モニタ / リアルタイム震度** | Not used | No documented, licensed machine-readable API was identified; values are published as imagery and the source itself labels them 参考値. The UI section states this explicitly rather than substituting different data. |
| **Tsunami observations** (measured heights) | Not used | Not relayed by the chosen API. |
| **気象庁 震度データベース** | Not used | HTML search interface, not an API; scraping is out of scope. |
| **JMA XML direct** (xml.kishou.go.jp) | Not used | Requires a push endpoint ( Laboratory / 防災情報XML) — infrastructure out of scope for v0.1; documented as an option. |

## 3. Adding a source (the integration interface)

A new provider only has to satisfy two shapes:

```ts
// 1. Produce raw telegrams or parsed models.
interface Transport { getText(url: string, opts?: {timeoutMs?: number}): Promise<{status: number; body: string}> }

// 2. Emit into the app. Nothing else changes.
type FeedEvent =
  | { type: 'connection'; state: 'connecting'|'live'|'degraded'|'stale'|'offline'; at: number; detail?: string }
  | { type: 'batch'; at: number; events: EarthquakeEvent[]; eews: EewAlert[]; tsunami: TsunamiInfo | null; rejected: number };
```

The reducers (`src/state/store.ts`), alert state machine (`src/state/alert.ts`) and
all UI are source-agnostic. To wire DM-D.S.S.:

1. Implement `DmdataTransport` (WireGuard/socket or REST long-poll) behind the same
   `FeedEvent` emitter, mapping its `556`/`551`/`552` equivalents through
   `parseEew`/`parseEarthquake`/`parseTsunami` — they are pure and already handle
   the JMA XML vocabulary the service relays.
2. Keep the API key in the OS keystore / a config screen; **never** in the bundle.
   For an APK, that means either a user-supplied key stored natively, or a proxy
   server you operate — both are documented options, neither is in v0.1.
3. Add the provider to `SourceRef` (`authority: 'jma-via-dmdss'`) so the UI keeps
   distinguishing official-but-relayed from simulated.
