import type {
  ConnectionState,
  EarthquakeEvent,
  EewAlert,
  FeedHealth,
  Freshness,
  TsunamiInfo,
} from '../core/models';
import { DEFAULT_ALERT_POLICY, expireAlert, ingestEew, type AlertPolicy } from './alert';
import { t } from '../i18n';
import { ingestEvents, sortEvents } from './events';

export type AppMode = 'live' | 'demo';

export interface DemoStatus {
  scenarioId: string;
  label: string;
  /** Position in the scripted timeline (0..1). */
  progress: number;
  status: 'running' | 'finished';
  startedAt: number;
}

export interface AppPreferences {
  /** Audible alert on new official warnings. Off by default. */
  soundEnabled: boolean;
  /** Developer flag: allow the demo engine to make noise. Off by default. */
  demoAudio: boolean;
  /** Reduce motion (also honoured via prefers-reduced-motion). */
  reduceMotion: boolean;
  /** Draw the JMA tsunami forecast-region layer when a bulletin names areas. */
  tsunamiLayer: boolean;
  /** Speak alerts with the platform voice. Off until the user turns it on. */
  voiceEnabled: boolean;
}

export interface AppState {
  mode: AppMode;
  health: FeedHealth;
  events: EarthquakeEvent[];
  selectedEventId: string | null;
  alert: EewAlert | null;
  alertHistory: EewAlert[];
  tsunami: TsunamiInfo | null;
  /**
   * When the currently shown events came from the on-device history snapshot
   * rather than a fetch this session (ms epoch of that fetch), else null.
   * Purely a display marker: freshness is still governed by
   * `health.lastSuccessAt`, which a restore never sets.
   */
  historySnapshotAt: number | null;
  demo: DemoStatus | null;
  preferences: AppPreferences;
  /** Diag counters surfaced in the diagnostics panel. */
  diagnostics: {
    batches: number;
    rejectedRecords: number;
    lastError: string | null;
    lastBatchAt: number | null;
    sourceRecords: number;
    duplicateAlertsIgnored: number;
  };
  /** Monotonic clock used by the UI ticker. */
  now: number;
}

export const ALERT_HISTORY_LIMIT = 12;

export const initialState = (mode: AppMode = 'live', now = Date.now()): AppState => ({
  mode,
  health: {
    state: 'idle',
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastError: null,
    consecutiveFailures: 0,
  },
  events: [],
  selectedEventId: null,
  alert: null,
  alertHistory: [],
  tsunami: null,
  historySnapshotAt: null,
  demo: null,
  preferences: { soundEnabled: false, demoAudio: false, reduceMotion: false, tsunamiLayer: true, voiceEnabled: false },
  diagnostics: {
    batches: 0,
    rejectedRecords: 0,
    lastError: null,
    lastBatchAt: null,
    sourceRecords: 0,
    duplicateAlertsIgnored: 0,
  },
  now,
});

export type Action =
  | { type: 'connection'; state: ConnectionState; at: number; detail?: string | null }
  | { type: 'batch'; events: EarthquakeEvent[]; eews: EewAlert[]; tsunami: TsunamiInfo | null; at: number; rejected: number }
  | { type: 'history-restored'; events: EarthquakeEvent[]; at: number }
  | { type: 'error'; message: string; at: number; fatal?: boolean }
  | { type: 'select'; id: string | null }
  | { type: 'mode'; mode: AppMode }
  | { type: 'demo'; status: DemoStatus | null }
  | { type: 'preferences'; patch: Partial<AppPreferences> }
  | { type: 'tick'; now: number }
  | { type: 'reset-data' }
  | { type: 'dismiss-alert' };

export interface ReduceContext {
  alertPolicy?: AlertPolicy;
  sound: (alert: EewAlert) => void;
}

/**
 * Pure reducer. Everything the app renders is a function of this state, which
 * is what makes the UI testable and the demo/live split auditable.
 */
export function reduce(state: AppState, action: Action, ctx: ReduceContext = { sound: () => {} }): AppState {
  switch (action.type) {
    case 'history-restored': {
      // Saved history from a previous session. Events only — never an alert
      // or tsunami bulletin — and `health` is untouched, so nothing about
      // this can be mistaken for fresh data.
      const events = sortEvents(action.events).slice(0, 80);
      return {
        ...state,
        events,
        selectedEventId: state.selectedEventId ?? events[0]?.id ?? null,
        historySnapshotAt: action.at,
      };
    }

    case 'connection': {
      const health: FeedHealth = {
        ...state.health,
        state: action.state,
        lastAttemptAt: action.at,
        lastError: action.detail ?? state.health.lastError,
      };
      if (action.state === 'live' || action.state === 'degraded' || action.state === 'demo') {
        health.lastSuccessAt = action.at;
        health.consecutiveFailures = 0;
      }
      if (action.state === 'offline' || action.state === 'stale') {
        health.consecutiveFailures = state.health.consecutiveFailures + 1;
      }
      return { ...state, health };
    }

    case 'batch': {
      const { events, changed } = ingestEvents(state.events, action.events);
      let acceptedEews = 0;
      let alert = state.alert;
      let alertHistory = state.alertHistory;
      let ignored = state.diagnostics.duplicateAlertsIgnored;

      for (const incoming of action.eews) {
        const res = ingestEew(alert, incoming, { allowTest: true });
        if (res.accepted) {
          acceptedEews += 1;
          alert = res.alert;
          // Keep a short trail so the panel can show "previous alert" context.
          if (alert) alertHistory = [alert, ...alertHistory.filter((a) => a.eventId !== alert!.eventId)].slice(0, ALERT_HISTORY_LIMIT);
        } else if (res.outcome === 'duplicate' || res.outcome === 'out-of-order') {
          ignored += 1;
        }
      }

      const nextTsunami =
        action.tsunami && (!state.tsunami || action.tsunami.receivedAt >= state.tsunami.receivedAt)
          ? action.tsunami
          : state.tsunami;

      // Auto-select the newest event on the *first* load only, so a cold start
      // never faces an empty inspector. After that, an explicit deselection is
      // respected: re-selecting on every batch would keep yanking the detail
      // panel open (and swallow the Android back gesture while data streams in).
      const wasEmpty = state.events.length === 0;
      let selectedEventId = state.selectedEventId;
      if (!selectedEventId && wasEmpty && changed && events.length) selectedEventId = events[0]!.id;
      if (selectedEventId && !events.some((e) => e.id === selectedEventId)) selectedEventId = events[0]?.id ?? null;

      return {
        ...state,
        events,
        selectedEventId,
        historySnapshotAt: null,
        alert: expireAlert(alert, action.at, ctx.alertPolicy ?? DEFAULT_ALERT_POLICY),
        alertHistory,
        tsunami: nextTsunami ?? null,
        health: {
          ...state.health,
          // Keep the *real* transport state even in demo mode: the disconnect
          // and stale scenarios must be able to show their own connection
          // failures. `mode` is what marks the data as simulated.
          state: 'live',
          lastSuccessAt: action.at,
          lastAttemptAt: action.at,
          lastError: null,
          consecutiveFailures: 0,
        },
        diagnostics: {
          ...state.diagnostics,
          batches: state.diagnostics.batches + 1,
          rejectedRecords: state.diagnostics.rejectedRecords + action.rejected,
          lastBatchAt: action.at,
          sourceRecords: state.diagnostics.sourceRecords + action.events.length + action.eews.length,
          duplicateAlertsIgnored: ignored,
        },
      };
    }

    case 'error':
      return {
        ...state,
        health: {
          ...state.health,
          state: action.fatal ? 'offline' : state.health.state === 'idle' ? 'degraded' : state.health.state,
          lastError: action.message,
          lastAttemptAt: action.at,
          consecutiveFailures: state.health.consecutiveFailures + 1,
        },
        diagnostics: { ...state.diagnostics, lastError: action.message },
      };

    case 'select':
      if (action.id === state.selectedEventId) return state;
      return { ...state, selectedEventId: action.id };

    case 'mode':
      return { ...state, mode: action.mode, health: { ...state.health, state: 'connecting' } };

    case 'demo':
      return { ...state, demo: action.status };

    case 'preferences': {
      const entries = Object.entries(action.patch) as Array<[keyof AppPreferences, boolean]>;
      if (entries.every(([k, v]) => state.preferences[k] === v)) return state;
      return { ...state, preferences: { ...state.preferences, ...action.patch } };
    }

    case 'tick': {
      const expired = expireAlert(state.alert, action.now, ctx.alertPolicy ?? DEFAULT_ALERT_POLICY);
      if (expired === state.alert && action.now === state.now) return state;
      return { ...state, now: action.now, alert: expired };
    }

    case 'dismiss-alert':
      return { ...state, alert: null };

    case 'reset-data':
      return {
        ...state,
        events: [],
        alert: null,
        alertHistory: [],
        tsunami: null,
        historySnapshotAt: null,
        selectedEventId: null,
        diagnostics: { ...state.diagnostics, batches: 0, rejectedRecords: 0, sourceRecords: 0, lastError: null, lastBatchAt: null },
      };

    default:
      return state;
  }
}

/* ------------------------------------------------------------------ *
 * Selectors
 * ------------------------------------------------------------------ */

export function selectEvent(state: AppState): EarthquakeEvent | null {
  if (!state.selectedEventId) return null;
  return state.events.find((e) => e.id === state.selectedEventId) ?? null;
}

/**
 * Freshness of the newest data we hold. Thresholds are deliberately visible in
 * the UI (see the status chip) — a viewer that silently shows 20-minute-old
 * "live" data is worse than one that says it is stale.
 */
export function freshnessOf(at: number | null, now: number): Freshness {
  if (at === null) return 'no-data';
  if (!Number.isFinite(at)) return 'unknown';
  const age = now - at;
  if (age < 60_000) return 'fresh';
  if (age < 180_000) return 'aging';
  return 'stale';
}

/**
 * Freshness as the user should read it.
 *
 * `freshnessOf()` only knows the timestamp. If the transport has already told us
 * updates have stopped, the data must not be labelled "up to date" just because
 * it arrived less than a minute ago — a live-looking indicator on a stalled feed
 * is exactly the kind of misleading status this app must not show.
 */
export function effectiveFreshness(state: AppState): Freshness {
  const byAge = freshnessOf(state.health.lastSuccessAt, state.now);
  const conn = state.health.state;
  if (conn === 'stale' && (byAge === 'fresh' || byAge === 'aging' || byAge === 'unknown')) return 'stale';
  if (conn === 'offline' && byAge === 'fresh') return 'stale';
  return byAge;
}

export function freshnessLabel(f: Freshness): string {
  switch (f) {
    case 'fresh':
      return t('fresh.fresh');
    case 'aging':
      return t('fresh.aging');
    case 'stale':
      return t('fresh.stale');
    case 'no-data':
      return t('fresh.nodata');
    default:
      return t('fresh.unknown');
  }
}

export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'live':
      return t('conn.live');
    case 'degraded':
      return t('conn.degraded');
    case 'stale':
      return t('conn.stale');
    case 'offline':
      return t('conn.offline');
    case 'connecting':
      return t('conn.connecting');
    case 'demo':
      return t('conn.demo');
    default:
      return t('conn.none');
  }
}

/** True when the app cannot currently vouch for the data on screen. */
export function isDataUntrustworthy(state: AppState): boolean {
  return state.health.state === 'offline' || state.health.state === 'stale';
}

/* ------------------------------------------------------------------ *
 * Tiny observable store
 * ------------------------------------------------------------------ */

export class Store {
  private state: AppState;
  private listeners = new Set<(s: AppState, prev: AppState) => void>();
  private soundHandler: (a: EewAlert) => void = () => {};

  constructor(initial: AppState, private policy: AlertPolicy = DEFAULT_ALERT_POLICY) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  onSound(handler: (a: EewAlert) => void): void {
    this.soundHandler = handler;
  }

  subscribe(fn: (s: AppState, prev: AppState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispatch(action: Action, opts: { silent?: boolean } = {}): AppState {
    const prev = this.state;
    const next = reduce(prev, action, {
      alertPolicy: this.policy,
      sound: (a) => this.soundHandler(a),
    });
    if (next === prev) return prev;
    this.state = next;
    if (!opts.silent) this.emit(prev);
    return next;
  }

  replace(next: AppState): void {
    const prev = this.state;
    this.state = next;
    this.emit(prev);
  }

  emit(prev: AppState): void {
    for (const fn of this.listeners) fn(this.state, prev);
  }
}
