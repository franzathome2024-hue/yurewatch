import type { EewAlert, TsunamiInfo, EarthquakeEvent } from '../core/models';
import { parseBatch } from '../sources/p2pquake/parse';
import type { HttpTransport } from './transport';
import { HttpError } from './transport';

/**
 * Live feed: polls the public P2P地震情報 JSON API v2.
 *
 * Why polling and not WebSocket: the WebSocket endpoint allows 2 concurrent
 * connections per IP and forcibly disconnects after 10 minutes on the sandbox;
 * polling /history keeps a single code path across web and Android (the Android
 * shell cannot hold a socket across doze/suspend without a foreground service,
 * which v0.1 does not ship). Polling /history costs ~0.5–1 s extra latency,
 * which is documented in the README rather than hidden.
 *
 * Rate limits published by the provider: 60 req/min per IP for /history. We use
 * 3 requests per tick, so the idle cadence (20 s) and the active cadence (6 s)
 * both stay well inside the limit.
 */

export const P2PQUAKE_BASE = 'https://api.p2pquake.net/v2';

/**
 * `/history` is a *history* endpoint: one poll returns every telegram of the
 * requested code that the relay still holds, which for 556 (EEW) routinely
 * spans several days. Presenting a week-old EEW as a live alert would be the
 * worst possible failure mode for this app, so telegrams are gated by age
 * before they reach application state.
 */
export const EEW_MAX_AGE_MS = 10 * 60_000;
export const TSUNAMI_MAX_AGE_MS = 12 * 60 * 60_000;

export interface RecencySplit<T> {
  fresh: T[];
  stale: T[];
}

/**
 * Split EEW telegrams into live-relevant and historical ones.
 *
 * The age anchor is source-supplied time only: bulletin issue time, falling
 * back to the earthquake origin time. It is *never* the local receive time —
 * `receivedAt` is "now" by construction, so anchoring on it would wave
 * through any telegram whose timestamps are missing or unparseable,
 * including days-old warnings held by the relay. A telegram that cannot be
 * dated from source fields is treated as historical, not as fresh.
 */
export function partitionEews<
  T extends { issuedAt: number | null; originTime?: number | null; receivedAt: number },
>(eews: T[], now: number, maxAgeMs: number = EEW_MAX_AGE_MS): RecencySplit<T> {
  const fresh: T[] = [];
  const stale: T[] = [];
  for (const eew of eews) {
    const at = eew.issuedAt ?? eew.originTime ?? null;
    if (at !== null && now - at <= maxAgeMs) fresh.push(eew);
    else stale.push(eew);
  }
  return { fresh, stale };
}

/**
 * Keep only the most recent tsunami bulletin, and only if it is still current.
 * Same anchoring rule as EEW: source issue time only, never receive time.
 * Undated bulletins sort last and are never picked as current.
 */
export function pickCurrentTsunami<T extends { issuedAt: number | null; receivedAt: number }>(
  bulletins: T[],
  now: number,
  maxAgeMs: number = TSUNAMI_MAX_AGE_MS,
): T | null {
  const sorted = [...bulletins].sort((a, b) => (b.issuedAt ?? -Infinity) - (a.issuedAt ?? -Infinity));
  const latest = sorted[0];
  if (!latest || latest.issuedAt === null) return null;
  return now - latest.issuedAt <= maxAgeMs ? latest : null;
}

export interface LiveFeedOptions {
  transport: HttpTransport;
  baseUrl?: string;
  /** Poll cadence when nothing is happening. */
  idleIntervalMs?: number;
  /** Poll cadence while an EEW is in force. */
  activeIntervalMs?: number;
  /** After this long without a successful poll we call the feed stale. */
  staleAfterMs?: number;
  /** How long an EEW keeps the feed in the fast cadence. */
  activeHoldMs?: number;
  now?: () => number;
  setTimeoutImpl?: (fn: () => void, ms: number) => number;
  clearTimeoutImpl?: (id: number) => void;
  fetchImpl?: typeof fetch;
}

export type FeedEvent =
  | { type: 'connection'; state: 'connecting' | 'live' | 'degraded' | 'stale' | 'offline'; at: number; detail?: string }
  | {
      type: 'batch';
      at: number;
      events: EarthquakeEvent[];
      eews: EewAlert[];
      tsunami: TsunamiInfo | null;
      rejected: number;
    };

export const DEFAULT_LIVE_OPTIONS = {
  idleIntervalMs: 20_000,
  activeIntervalMs: 6_000,
  staleAfterMs: 150_000,
  activeHoldMs: 300_000,
};

/**
 * Exponential backoff with jitter, capped. Starting at 2 s and doubling, this
 * reaches the 60 s cap after six failures and keeps the app from hammering a
 * provider that is down (or a phone that has lost signal).
 */
export function nextBackoff(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1));
  const jitter = base * 0.2 * rand();
  return Math.round(base * 0.9 + jitter);
}

export class LiveFeed {
  private opts: Required<Omit<LiveFeedOptions, 'transport' | 'fetchImpl'>> & {
    transport: HttpTransport;
  };
  private timer: number | null = null;
  private running = false;
  private paused = false;
  private failures = 0;
  private lastSuccessAt: number | null = null;
  private lastEewAt: number | null = null;
  private ignoredEews = 0;
  private inFlight = false;
  private listeners = new Set<(e: FeedEvent) => void>();
  private onlineHandler: (() => void) | null = null;

  constructor(options: LiveFeedOptions) {
    this.opts = {
      baseUrl: options.baseUrl ?? P2PQUAKE_BASE,
      idleIntervalMs: options.idleIntervalMs ?? DEFAULT_LIVE_OPTIONS.idleIntervalMs,
      activeIntervalMs: options.activeIntervalMs ?? DEFAULT_LIVE_OPTIONS.activeIntervalMs,
      staleAfterMs: options.staleAfterMs ?? DEFAULT_LIVE_OPTIONS.staleAfterMs,
      activeHoldMs: options.activeHoldMs ?? DEFAULT_LIVE_OPTIONS.activeHoldMs,
      now: options.now ?? (() => Date.now()),
      setTimeoutImpl: options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number),
      clearTimeoutImpl: options.clearTimeoutImpl ?? ((id) => clearTimeout(id)),
      transport: options.transport,
    };
  }

  on(fn: (e: FeedEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: FeedEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit({ type: 'connection', state: 'connecting', at: this.opts.now() });
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.onlineHandler = () => {
        if (!this.running) return;
        void this.poll({ reason: 'online' });
      };
      window.addEventListener('online', this.onlineHandler);
    }
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.opts.clearTimeoutImpl(this.timer);
    this.timer = null;
    if (this.onlineHandler && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
  }

  /** Suspend polling (app backgrounded). Does not clear state. */
  pause(): void {
    this.paused = true;
    if (this.timer !== null) this.opts.clearTimeoutImpl(this.timer);
    this.timer = null;
  }

  /** Resume polling and refresh immediately (foregrounded / network regained). */
  resume(): void {
    if (!this.running) return;
    this.paused = false;
    if (this.timer !== null) this.opts.clearTimeoutImpl(this.timer);
    this.timer = null;
    void this.poll({ reason: 'resume' });
  }

  /** Fetch immediately, even if the feed is stopped or paused. */
  async refreshNow(): Promise<void> {
    await this.poll({ reason: 'manual', force: true });
  }

  private nextDelay(): number {
    const now = this.opts.now();
    if (this.failures > 0) return nextBackoff(this.failures);
    const active = this.lastEewAt !== null && now - this.lastEewAt < this.opts.activeHoldMs;
    return active ? this.opts.activeIntervalMs : this.opts.idleIntervalMs;
  }

  private schedule(): void {
    if (!this.running || this.paused) return;
    if (this.timer !== null) this.opts.clearTimeoutImpl(this.timer);
    this.timer = this.opts.setTimeoutImpl(() => void this.poll(), this.nextDelay());
  }

  private urls(): string[] {
    const b = this.opts.baseUrl;
    return [
      `${b}/history?codes=556&limit=20`, // 緊急地震速報（警報）
      `${b}/history?codes=551&limit=30`, // 地震情報
      `${b}/history?codes=552&limit=5`, // 津波予報
    ];
  }

  async poll(ctx: { reason?: string; force?: boolean } = {}): Promise<void> {
    if (this.inFlight) return;
    if (!ctx.force && (!this.running || this.paused)) return;
    this.inFlight = true;
    const at = this.opts.now();
    try {
      const results = await Promise.all(
        this.urls().map(async (url) => {
          const res = await this.opts.transport.getText(url, { timeoutMs: 15_000 });
          if (res.status < 200 || res.status >= 300) {
            throw new HttpError(`HTTP ${res.status}`, url, res.status);
          }
          return res.body;
        }),
      );

      const items: unknown[] = [];
      for (const body of results) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new HttpError('応答がJSONではありません', '');
        }
        if (Array.isArray(parsed)) items.push(...parsed);
        else if (parsed && typeof parsed === 'object') items.push(parsed);
      }

      const receivedAt = this.opts.now();
      const batch = parseBatch(items, receivedAt);
      const { fresh, stale } = partitionEews(batch.eews, receivedAt);
      this.ignoredEews += stale.length;
      const tsunami = pickCurrentTsunami(batch.tsunamis, receivedAt);
      if (fresh.length) this.lastEewAt = receivedAt;

      this.failures = 0;
      this.lastSuccessAt = receivedAt;
      this.emit({
        type: 'batch',
        at: receivedAt,
        events: batch.quakes,
        eews: fresh,
        tsunami,
        rejected: batch.rejected.length,
      });
      this.emit({ type: 'connection', state: 'live', at: receivedAt });
    } catch (err) {
      this.failures += 1;
      const message = err instanceof Error ? err.message : String(err);
      const offline =
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? true
          : /failed to fetch|network|offline|ENOTFOUND|接続/i.test(message);
      this.emit({
        type: 'connection',
        state: offline ? 'offline' : 'degraded',
        at: this.opts.now(),
        detail: message,
      });
    } finally {
      this.inFlight = false;
      // Watchdog: if we have data but it has stopped updating, say so.
      if (this.lastSuccessAt !== null && this.opts.now() - this.lastSuccessAt > this.opts.staleAfterMs) {
        this.emit({ type: 'connection', state: 'stale', at: this.opts.now(), detail: '更新が停止しています' });
      }
      this.schedule();
    }
  }

  /** Diagnostics for the panel. */
  stats() {
    return {
      failures: this.failures,
      lastSuccessAt: this.lastSuccessAt,
      lastEewAt: this.lastEewAt,
      ignoredHistoricalEews: this.ignoredEews,
      urls: this.urls(),
    };
  }
}
