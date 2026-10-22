import type { EewAlert, EewState } from '../core/models';

/**
 * EEW alert-state machine (pure).
 *
 * Guarantees:
 *  - Out-of-order telegrams are ignored (serial must increase monotonically
 *    within an eventId). P2P relay does not guarantee ordering.
 *  - Duplicates are ignored (same eventId + serial).
 *  - A cancellation only affects the event it names.
 *  - Alerts expire; we never leave a stale warning on screen forever.
 */

export interface AlertPolicy {
  /** How long a warning/forecast stays on screen without a new telegram. */
  warningTtlMs: number;
  forecastTtlMs: number;
  cancelledTtlMs: number;
}

export const DEFAULT_ALERT_POLICY: AlertPolicy = {
  warningTtlMs: 150_000,
  forecastTtlMs: 120_000,
  cancelledTtlMs: 90_000,
};

export interface AlertIngestResult {
  /** Alert to display (null = no alert). */
  alert: EewAlert | null;
  /** Machine-readable reason; useful for diagnostics and tests. */
  outcome:
    | 'new'
    | 'updated'
    | 'duplicate'
    | 'out-of-order'
    | 'cancelled'
    | 'ignored-cancel-for-unknown-event'
    | 'ignored-test';
  accepted: boolean;
}

function isActive(state: EewState): boolean {
  return state === 'warning' || state === 'updated' || state === 'forecast';
}

/**
 * Merge an incoming EEW into the current alert.
 *
 * @param opts.allowTest when false (the default in production), test
 *   transmissions (訓練/試験) are recorded by the caller but never replace a
 *   live alert or trigger alarms.
 */
export function ingestEew(
  current: EewAlert | null,
  incoming: EewAlert,
  opts: { allowTest?: boolean } = {},
): AlertIngestResult {
  const allowTest = opts.allowTest ?? true;

  if (incoming.isTest && !allowTest) {
    return { alert: current, outcome: 'ignored-test', accepted: false };
  }

  // Even when test bulletins may be displayed, a test transmission must
  // never displace a genuine alert that is currently on screen: a 訓練/試験
  // telegram for another event leaves a live warning untouched.
  if (incoming.isTest && current && !current.isTest && isActive(current.state)) {
    return { alert: current, outcome: 'ignored-test', accepted: false };
  }

  // Cancellation of something we never saw: keep the current screen state.
  if (incoming.state === 'cancelled' && (!current || current.eventId !== incoming.eventId)) {
    return { alert: current, outcome: 'ignored-cancel-for-unknown-event', accepted: false };
  }

  if (!current || current.eventId !== incoming.eventId) {
    // A brand new event supersedes whatever is on screen — but only if the
    // thing on screen is not itself a very recent warning being superseded by
    // an older cancel. eventIds are ordered by JMA, not by us, so trust serial.
    return {
      alert: {
        ...incoming,
        state: incoming.state === 'cancelled' ? 'cancelled' : incoming.state,
        revision: 1,
      },
      outcome: incoming.state === 'cancelled' ? 'cancelled' : 'new',
      accepted: true,
    };
  }

  if (incoming.serial < current.serial) {
    return { alert: current, outcome: 'out-of-order', accepted: false };
  }
  if (incoming.serial === current.serial) {
    return { alert: current, outcome: 'duplicate', accepted: false };
  }

  // serial > current.serial → newer telegram for the same event.
  if (incoming.state === 'cancelled') {
    return {
      alert: { ...incoming, revision: current.revision + 1, areas: [] },
      outcome: 'cancelled',
      accepted: true,
    };
  }

  // Keep previously known areas/fields when the revision is sparser, so the
  // panel does not blank out between telegrams.
  const merged: EewAlert = {
    ...current,
    ...incoming,
    areas: incoming.areas.length ? incoming.areas : current.areas,
    maxScaleTo:
      incoming.maxScaleTo >= 0 ? incoming.maxScaleTo : current.maxScaleTo,
    epicenter: incoming.epicenter ?? current.epicenter,
    originTime: incoming.originTime ?? current.originTime,
    issuedAt: incoming.issuedAt ?? current.issuedAt,
    revision: current.revision + 1,
    state: 'updated',
  };
  return { alert: merged, outcome: 'updated', accepted: true };
}

/** Clear an alert once its information has aged out. */
export function expireAlert(
  alert: EewAlert | null,
  now: number,
  policy: AlertPolicy = DEFAULT_ALERT_POLICY,
): EewAlert | null {
  if (!alert) return null;
  if (alert.state === 'idle' || alert.state === 'unavailable') return alert;
  // Anchor on when *we* last received a new telegram, not on the issue time:
  // a telegram that arrives late must still be shown, and an alert must not
  // linger once the feed stops delivering updates for it.
  const anchor = alert.receivedAt;
  const ttl =
    alert.state === 'cancelled'
      ? policy.cancelledTtlMs
      : isActive(alert.state)
        ? alert.state === 'forecast'
          ? policy.forecastTtlMs
          : policy.warningTtlMs
        : policy.cancelledTtlMs;
  return now - anchor > ttl ? null : alert;
}

/** Earliest still-in-the-future predicted arrival across reported areas. */
export interface NextArrival {
  at: number;
  areaName: string;
  pref: string;
  /** True when every reported arrival time is already in the past. */
  reached: boolean;
}

export function nextArrival(alert: EewAlert | null, now: number): NextArrival | null {
  if (!alert || !alert.areas.length) return null;
  const timed = alert.areas.filter((a) => a.arrivalTime !== null) as Array<
    EewAlert['areas'][number] & { arrivalTime: number }
  >;
  if (!timed.length) return null;
  const future = timed.filter((a) => a.arrivalTime > now).sort((a, b) => a.arrivalTime - b.arrivalTime);
  if (future.length) {
    const a = future[0]!;
    return { at: a.arrivalTime, areaName: a.name, pref: a.pref, reached: false };
  }
  const past = [...timed].sort((a, b) => b.arrivalTime - a.arrivalTime)[0]!;
  return { at: past.arrivalTime, areaName: past.name, pref: past.pref, reached: true };
}

/**
 * Areas in which the source says shaking has NOT yet arrived (kindCode 10).
 * Used to phrase the alert honestly: we never guess an arrival for areas the
 * source marked as already reached (kindCode 11) or PLUM-only (19).
 */
export function pendingAreas(alert: EewAlert | null) {
  if (!alert) return [];
  return alert.areas.filter((a) => a.kindCode === '10');
}

/** Highest-intensity areas, for the panel's headline. */
export function strongestAreas(alert: EewAlert | null, limit = 4) {
  if (!alert) return [];
  const max = alert.maxScaleTo;
  return alert.areas.filter((a) => a.scaleTo >= Math.max(0, max - 5) || a.scaleTo === max).slice(0, limit);
}

/**
 * Identity under which the map may auto-frame an EEW, or null when it must
 * not move the camera at all.
 *
 * The key changes only when the *event* changes or its epicentre moves by a
 * meaningful amount (>= ~0.1° once rounded), so routine serial revisions of
 * the same bulletin never yank the camera away from a user who is looking
 * somewhere deliberately. Test/drill bulletins never move the camera (their
 * coordinates are not real), and neither do cancellations or alerts whose
 * epicentre is missing — the map must never frame on absent coordinates.
 * Simulated bulletins do qualify: a simulation is the supported way to
 * rehearse exactly this behaviour, and it is badged as simulated on screen.
 */
export function eewFocusKey(alert: EewAlert | null): string | null {
  if (!alert) return null;
  if (alert.isTest || alert.state === 'cancelled') return null;
  const epi = alert.epicenter;
  if (!epi) return null;
  if (!Number.isFinite(epi.longitude) || !Number.isFinite(epi.latitude)) return null;
  if (epi.longitude === 0 && epi.latitude === 0) return null;
  return `${alert.eventId}@${epi.longitude.toFixed(1)},${epi.latitude.toFixed(1)}`;
}
