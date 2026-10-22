# Audio and spoken alerts

Two separate channels, both off by default and both gated behind an explicit
user action. This document records what each one actually does, what it cannot
do, and how it was tested.

## 1. Alert tone (`src/ui/audio.ts`)

| Property | Value |
| --- | --- |
| Engine | WebAudio oscillators synthesised at runtime |
| Content | Two tones (880 Hz → 1174 Hz → 880 Hz) for a warning, one soft tone for a forecast |
| Assets | None. No audio file is bundled, so there is no third-party jingle licence to inherit |
| Enabled by | `preferences.soundEnabled` (header/settings toggle), off by default |
| Requires a gesture | Yes — browsers and Android WebViews keep an AudioContext suspended until the user has interacted. The first pointer/key event unlocks it |
| Fires for | `warning`, `updated`, `forecast` states, once per accepted revision |
| Never fires for | test (訓練/試験) transmissions, simulated alerts unless `?demoAudio=1` is set by a developer |
| Cancellation | Plays **no** tone (a cancellation is not an emergency), but is spoken if voice is on — see below |
| Also does | `navigator.vibrate([180, 80, 180])` on warnings when the device supports it |

## 2. Spoken alerts (`src/ui/speech.ts` + `src/core/announce.ts`)

### Engine

`window.speechSynthesis` + `SpeechSynthesisUtterance` — the platform's own
speech synthesiser. Inside the Android WebView that is the **system TTS service**
(usually Google Speech Services, or the user's default engine), so:

- there is **no remote speech API**, no key, and no network dependency;
- Japanese speech requires a **Japanese voice installed on the device**
  (Android: Settings → System → Languages & input → Text-to-speech output →
  install the Japanese voice data). The app checks for this rather than assuming
  it — see "Failure states" below.

### Voice selection

The voice is chosen for the **active interface language** (`ja-JP`, else any
`ja-*`; `en-US`, else any `en-*`), not the device locale, so the announcement
matches what is on screen. `rate = 0.95` — slightly slower than default, because
these sentences carry numbers that matter.

### Announcement policy (pure, tested)

`src/core/announce.ts` decides whether and what to speak; `src/ui/speech.ts` only
talks to the engine. Rules:

| Rule | Rationale |
| --- | --- |
| One announcement per alert revision (`eventId:serial:state`) | A revision that the reducer rejects as duplicate/out-of-order never re-announces |
| New alert pre-empts the old one (`synth.cancel()` before speaking) | Overlapping sentences ("…magnitude 6.1" over "…cancelled") are worse than one clear sentence |
| Cancellations are always spoken, at `state-change` priority, but never with the urgent tone | "Cancelled" is a real state change people must hear, and it must not sound like an all-clear — the sentence says so explicitly |
| Forecast → `notify`, warning/update → `urgent` | Priority is data, so a future channel (notification, TTS queue) can use it |
| Test transmissions (`isTest`) are never spoken | 訓練/試験 must not be announced as a warning |
| Simulated alerts are spoken only with `?demoAudio=1` | Demo data must never be mistaken for a real alert |
| Missing fields are omitted from the sentence | The voice never states a magnitude, depth or intensity that JMA did not issue. A `—` would be read as "dash"; silence is correct |
| Tsunami bulletins are spoken at `notify`, leading with the strongest grade | Separate from EEW: a tsunami bulletin is not an early warning |

Example (Japanese, warning with all fields):

> 緊急地震速報 緊急地震速報（警報） 茨城県南部で地震。 予測最大震度6弱。 マグニチュード6.1。 深さ40キロ。 強い揺れに警戒してください。

Example (cancelled):

> 緊急地震速報は取り消されました。 揺れが無かったことを意味するものではありません。各地の震度情報を確認してください。

### Failure states

`Speech.status()` returns:

| Status | Meaning | What the user sees |
| --- | --- | --- |
| `ready` | A voice for the active language exists | Toggle works, no note |
| `pending` | The engine has not published its voice list yet (Chrome populates it asynchronously; `voiceschanged` is handled) | "音声エンジンを確認しています…" |
| `no-voice` | Engine present, no voice for the language | "日本語の音声が利用できません" — the toggle stays off rather than pretending to work |
| `unsupported` | No `speechSynthesis` in this engine | "この環境では音声合成が利用できません" |

Silent mode / media volume and audio focus are **outside the page's control**: a
WebView cannot request `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`, so a phone on silent
stays silent. The app does not claim otherwise.

## 3. What was tested, and what was not

| Check | How | Result |
| --- | --- | --- |
| Dedupe, priority, cancellation wording, test/simulated gating, missing-field omission, EN/JA localisation | `tests/announce.test.ts` (10 tests, real p2pquake fixtures through the real parser) | pass |
| Tone synthesis | Not asserted in tests (WebAudio is not implemented in jsdom); the code path is exercised in `tools/verify-web.mjs` indirectly by the alert scenarios | not measured |
| Test sound button reaches `running` | Real mouse click on 音声テスト in headless Chromium (v0.5.0 evidence probe): the result line reported `音声の状態: running` — the context is created/resumed inside the click gesture and the observed state is shown, never assumed | pass (browser) |
| Test voice button reports the engine verdict | Same probe: headless Chromium has no TTS voices, so the result honestly stayed at 音声エンジンを確認しています… (pending) instead of claiming success | pass (browser, pending state) |
| **Audible output on a device** | **Not performed** — no emulator (`/dev/kvm` absent) and no physical device in this environment | **unverified** |
| Japanese voice availability | Not verified on a device; the code asks the engine at runtime and degrades to a visible message | **unverified** |

Since v0.5.0 the info panel carries explicit 音声テスト / 読み上げテスト
buttons beside the sound and voice toggles. Each press is the user gesture
autoplay policies require; the sound test bypasses the alert-sound
preference (the press is the consent) but never the platform, and reports
the AudioContext state observed (`running` / `suspended` / `unsupported`).
The voice test speaks the preview sentence even while alert voice is off
and reports the engine's verdict. Neither test changes a preference, and
the two preferences stay independent and take effect immediately.

Anyone testing on hardware should check: (1) the toggle in Settings → 音声読み上げ
turns on and speaks the preview sentence; (2) a real EEW (or `?demo=warning&demoAudio=1`)
speaks once, not twice, when two telegrams arrive; (3) cancelling mid-sentence
does not leave the engine stuck (the code calls `cancel()` before each speak).
