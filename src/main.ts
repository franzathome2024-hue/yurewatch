import './styles.css';
import { DemoFeed } from './demo/engine';
import { getScenario } from './demo/scenarios';
import { detectTransport } from './net/transport';
import { LiveFeed, type FeedEvent } from './net/liveFeed';
import { Store, initialState, type AppMode, type AppState } from './state/store';
import { loadHistory, saveHistory } from './state/historyCache';
import { initLocale, normalizeLocale, onLocaleChange, setLocale, t } from './i18n';
import { App } from './ui/app';
import { Speech } from './ui/speech';
import { planAnnouncement, planTsunamiAnnouncement } from './core/announce';
import { AlertAudio } from './ui/audio';
import type { EewAlert } from './core/models';

/**
 * Bootstrap.
 *
 * Mode is chosen by URL parameter so the same bundle serves both purposes:
 *   (default)             live mode, public P2P地震情報 feed
 *   ?demo=warning         demo mode, starts the `warning` scenario
 *   ?demo=1               demo mode, shows the scenario picker
 *   ?demoAudio=1          developer flag: allow demo alerts to make a sound
 *   ?sound=1              start with the alert tone enabled
 */

function showFatal(message: string): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.dataset.error = 'true';
  boot.setAttribute('data-stalled', 'true');
  boot.textContent = t('boot.fatal', { message });
}

/*
 * Restore the saved language before anything renders, so the first paint is
 * already in the right language. Japanese is the default for a fresh install;
 * the preference is never taken from the device locale.
 */
initLocale();

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('error', (event) => {
    if (event.error) showFatal(String((event.error as Error).message ?? event.message));
  });
  window.addEventListener('unhandledrejection', (event) => {
    showFatal(String(event.reason));
  });
}

const params = new URLSearchParams(window.location.search);
// `?lang=en` / `?lang=ja` forces a language for screenshots and tests. It is a
// convenience for developers: the switch in the header is the normal control.
const langParam = normalizeLocale(params.get('lang'));
if (langParam) setLocale(langParam);
const demoParam = params.get('demo');
const demoAudio = params.get('demoAudio') === '1';
const soundParam = params.get('sound') === '1';
const mode: AppMode = demoParam !== null ? 'demo' : 'live';

const prefersReducedMotion =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = new Store(initialState(mode, Date.now()));

// Cold start: show the previous session's recent earthquakes as saved
// history until the first fetch succeeds. Events only — the snapshot
// cannot resurrect an EEW or tsunami bulletin (they are never stored),
// and freshness stays "no data" until a real fetch lands.
if (mode === 'live') {
  const snapshot = loadHistory();
  if (snapshot) {
    store.dispatch({ type: 'history-restored', events: snapshot.events, at: snapshot.savedAt });
  }
}
store.dispatch({ type: 'preferences', patch: { soundEnabled: soundParam, demoAudio, reduceMotion: prefersReducedMotion } });

const speech = new Speech();
const spokenKeys = new Set<string>();
const audio = new AlertAudio(() => store.get().preferences.soundEnabled);

/* ------------------------------------------------------------------ *
 * Feed wiring
 * ------------------------------------------------------------------ */

const demoFeed = new DemoFeed({
  onProgress: ({ scenario, progress, finished }) => {
    store.dispatch({
      type: 'demo',
      status: {
        scenarioId: scenario.id,
        label: scenario.label,
        progress,
        status: finished ? 'finished' : 'running',
        startedAt: Date.now(),
      },
    });
  },
});

const liveFeed = new LiveFeed({ transport: detectTransport() });

let activeFeed: 'live' | 'demo' = mode;

function handleFeedEvent(event: FeedEvent): void {
  if (event.type === 'connection') {
    if (activeFeed === 'demo' && event.state !== 'live') {
      store.dispatch({ type: 'connection', state: event.state, at: event.at, detail: event.detail ?? null });
    } else {
      store.dispatch({ type: 'connection', state: event.state, at: event.at, detail: event.detail ?? null });
    }
    if (event.state === 'offline') {
      // Surface the failure in the diagnostics panel, not as a modal: the map
      // and last-known data stay usable and clearly labelled as stale.
      store.dispatch({ type: 'error', message: event.detail ?? '接続できません', at: event.at });
    }
    return;
  }

  const before = store.get().alert;
  store.dispatch({
    type: 'batch',
    events: event.events,
    eews: event.eews,
    tsunami: event.tsunami,
    at: event.at,
    rejected: event.rejected,
  });
  // Persist the recent-event history (live data only; best-effort).
  if (activeFeed === 'live') saveHistory(store.get().events, event.at);
  const after = store.get().alert;

  // Audio policy: only for genuine warnings, never for tests, never for
  // simulated alerts unless the developer opted in.
  const isNewRevision = after && (!before || before.eventId !== after.eventId || before.serial !== after.serial);
  if (isNewRevision && after) {
    const audibleState = after.state === 'warning' || after.state === 'updated' || after.state === 'forecast';
    const simulatedBlocked = after.simulated && !store.get().preferences.demoAudio;
    if (audibleState && !after.isTest && !simulatedBlocked) {
      audio.play(after.state === 'forecast' ? 'info' : 'warning');
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && after.state !== 'forecast') {
        navigator.vibrate([180, 80, 180]);
      }
    }
  }

  // Speech is a separate, user-enabled channel: it is gated on the *voice*
  // preference, dedupes by alert revision, and never speaks for a test or a
  // simulated alert unless the developer flag is on. Cancellations are spoken
  // even though they are not audible alerts above, because a cancellation is a
  // state change the user needs to hear about.
  announce(after);
  announceTsunami();
}

let speechFailed: string | null = null;

function announce(alert: EewAlert | null): void {
  const prefs = store.get().preferences;
  const ctx = { enabled: prefs.voiceEnabled, demoAllowed: prefs.demoAudio };
  const plan = planAnnouncement(alert, spokenKeys, ctx);
  if (!plan) return;
  spokenKeys.add(plan.key);
  speech.speak(plan.text);
}

function announceTsunami(): void {
  const prefs = store.get().preferences;
  const ctx = { enabled: prefs.voiceEnabled, demoAllowed: prefs.demoAudio };
  const info = store.get().tsunami;
  if (info && store.get().mode === 'demo') return;
  const plan = planTsunamiAnnouncement(info, spokenKeys, ctx);
  if (!plan) return;
  spokenKeys.add(plan.key);
  speech.speak(plan.text);
}

liveFeed.on(handleFeedEvent);
demoFeed.on(handleFeedEvent);

function startLive(): void {
  demoFeed.stop();
  activeFeed = 'live';
  store.dispatch({ type: 'mode', mode: 'live' });
  store.dispatch({ type: 'demo', status: null });
  store.dispatch({ type: 'reset-data' });
  liveFeed.start();
}

function startDemo(id: string): void {
  liveFeed.stop();
  activeFeed = 'demo';
  store.dispatch({ type: 'mode', mode: 'demo' });
  store.dispatch({ type: 'reset-data' });
  const scenario = getScenario(id);
  if (!scenario) return;
  demoFeed.start(id);
  ui?.setView('list');
}

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */

let ui: App | null = null;

function downloadState(state: AppState): void {
  const json = App.snapshot(state);
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yurewatch-state-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  } catch {
    // file:// origins in the Android shell may block downloads: fall back to text.
    const w = window.open('', '_blank');
    w?.document.write(`<pre>${json.replace(/</g, '&lt;')}</pre>`);
  }
}

ui = new App(store, {
  onSelectEvent: (id) => {
    store.dispatch({ type: 'select', id });
    const state = store.get();
    const ev = state.events.find((e) => e.id === id);
    if (ev?.epicenter) ui?.focusMapOn(ev.epicenter.longitude, ev.epicenter.latitude);
    if (id) ui?.focusDetail();
  },
  onDemoStart: (id) => startDemo(id),
  onDemoStop: () => startLive(),
  onExportState: () => downloadState(store.get()),
  onToggleTsunamiLayer: () => {
    const next = !store.get().preferences.tsunamiLayer;
    store.dispatch({ type: 'preferences', patch: { tsunamiLayer: next } });
  },
  describeVoice: () => {
    if (!store.get().preferences.voiceEnabled) {
      const status = speech.status();
      if (status === 'ready') return '';
      if (status === 'no-voice') return t('voice.unavailable');
      if (status === 'pending') return t('voice.pending');
      return t('voice.unsupported');
    }
    if (speechFailed === 'no-voice') return t('voice.unavailable');
    if (speechFailed === 'unsupported') return t('voice.unsupported');
    return '';
  },
  onToggleVoice: () => {
    const next = !store.get().preferences.voiceEnabled;
    store.dispatch({ type: 'preferences', patch: { voiceEnabled: next } });
    if (!next) speech.cancel();
    else {
      // Speaking the preview doubles as the permission/voice check the user needs.
      const result = speech.speak(t('voice.previewText'));
      if (!result.ok) speechFailed = result.reason ?? 'unsupported';
      else speechFailed = null;
    }
  },
  onToggleSound: () => {
    const next = !store.get().preferences.soundEnabled;
    store.dispatch({ type: 'preferences', patch: { soundEnabled: next } });
    if (next) audio.prime();
  },
  onRecenter: () => ui?.recenterMap(),
  onZoom: (factor) => ui?.zoomMap(factor),
  onFrameToggle: () => ui?.toggleFrame(),
});

const mountTarget = document.getElementById('app') ?? document.body ?? document.documentElement;
ui.mount(mountTarget);

// `?frame=mainland|archipelago` pins the coverage profile. Used by the map QA
// harness so both framings are testable at every viewport, and handy for anyone
// comparing them by hand.
const frameParam = params.get('frame');
if (frameParam === 'mainland' || frameParam === 'archipelago') {
  ui.setFrame(frameParam);
}
document.getElementById('boot')?.remove();
ui.setReduceMotion(prefersReducedMotion);

let lastRendered = store.get();
function render(): void {
  const state = store.get();
  lastRendered = state;
  ui?.update(state);
}

store.subscribe(() => render());
onLocaleChange(() => render());
render();

/* 1 Hz clock for relative times and alert expiry. */
setInterval(() => {
  store.dispatch({ type: 'tick', now: Date.now() });
}, 1_000);

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

function onHidden(): void {
  if (activeFeed === 'live') liveFeed.pause();
  else demoFeed.pause();
}

function onVisible(): void {
  // Foregrounded: refresh immediately rather than waiting for the next tick,
  // and mark the data as potentially stale until the fetch succeeds.
  store.dispatch({ type: 'tick', now: Date.now() });
  if (activeFeed === 'live') liveFeed.resume();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHidden();
    else onVisible();
  });
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => {
    if (activeFeed === 'live') liveFeed.resume();
  });
  window.addEventListener('offline', () => {
    store.dispatch({ type: 'connection', state: 'offline', at: Date.now(), detail: '端末がオフラインです' });
  });
}

/* Android shell hooks (no-ops on the web). */
declare global {
  interface Window {
    YureWatchOnPause?: () => void;
    YureWatchOnResume?: () => void;
    YureWatchBack?: () => boolean;
    YureWatchInfo?: () => string;
  }
}

window.YureWatchOnPause = () => onHidden();
window.YureWatchOnResume = () => onVisible();
window.YureWatchBack = () => {
  const state = store.get();
  if (state.selectedEventId) {
    store.dispatch({ type: 'select', id: null });
    return true;
  }
  if (activeFeed === 'demo') {
    startLive();
    return true;
  }
  if (ui && store.get().mode === 'demo') {
    startLive();
    return true;
  }
  return false;
};
// Exposed for the QA harness: framing/diagnostic facts, no user data.
(window as unknown as { __yurewatch?: unknown }).__yurewatch = {
  map: () => ui?.debugState() ?? null,
  store: () => store.get(),
  // QA harness only: drive the camera to a named view so coastline/overlay
  // alignment can be inspected at real zoom levels without a device.
  focus: (lon: number, lat: number) => ui?.focusMapOn(lon, lat),
  zoom: (factor: number) => ui?.zoomMap(factor),
  recenter: () => ui?.recenterMap(),
  frame: () => ui?.toggleFrame(),
};

window.YureWatchInfo = () =>
  JSON.stringify({ mode: activeFeed, health: store.get().health.state, events: store.get().events.length });

/* Start the feed. */
if (mode === 'demo') {
  const scenarioId = demoParam && demoParam !== '1' ? demoParam : 'normal';
  startDemo(getScenario(scenarioId) ? scenarioId : 'normal');
} else {
  liveFeed.start();
}

// Exported for the smoke test harness (jsdom) and debugging.
export { store, App, lastRendered };
