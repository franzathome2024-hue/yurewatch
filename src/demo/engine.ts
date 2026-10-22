import type { EarthquakeEvent, EewAlert, TsunamiInfo } from '../core/models';
import { parseBatch, DEMO_SOURCE } from '../sources/p2pquake/parse';
import { getScenario, type DemoScenario, type DemoStep } from './scenarios';
import type { FeedEvent } from '../net/liveFeed';

/**
 * Demo feed engine.
 *
 * Plays a scenario against a virtual clock. Items are wire payloads, so they go
 * through `parseBatch` exactly like live data — the only difference is the
 * `DEMO_SOURCE` tag, which marks everything `simulated: true`. That single flag
 * is what the UI uses to paint the SIMULATION banner and to mute alarms.
 */
export interface DemoFeedOptions {
  now?: () => number;
  setTimeoutImpl?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutImpl?: (id: ReturnType<typeof setTimeout>) => void;
  /** Playback speed multiplier (1 = real time, 10 = 10× faster). */
  speed?: number;
  /** Called whenever progress changes, for the HUD. */
  onProgress?: (p: { scenario: DemoScenario; elapsed: number; progress: number; step: number; finished: boolean }) => void;
}

export class DemoFeed {
  private scenario: DemoScenario | null = null;
  private startedAt = 0;
  private cursor = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private listeners = new Set<(e: FeedEvent) => void>();
  private now: () => number;
  private setT: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private clearT: (id: ReturnType<typeof setTimeout>) => void;
  private speed: number;

  constructor(private options: DemoFeedOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.setT =
      options.setTimeoutImpl ??
      ((fn, ms) => setTimeout(fn, ms));
    this.clearT = options.clearTimeoutImpl ?? ((id) => clearTimeout(id));
    this.speed = options.speed ?? 1;
  }

  on(fn: (e: FeedEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: FeedEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get current(): DemoScenario | null {
    return this.scenario;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(scenarioId: string): DemoScenario {
    const scenario = getScenario(scenarioId);
    if (!scenario) throw new Error(`unknown demo scenario: ${scenarioId}`);
    this.stop();
    this.scenario = scenario;
    this.startedAt = this.now();
    this.cursor = 0;
    this.running = true;
    this.emit({ type: 'connection', state: 'connecting', at: this.startedAt, detail: 'デモシナリオ開始' });
    this.loop();
    return scenario;
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
  }

  /** Live/demo switches need the same surface as LiveFeed. */
  pause(): void {
    this.stop();
  }

  resume(): void {
    if (!this.running && this.scenario) this.start(this.scenario.id);
  }

  async refreshNow(): Promise<void> {
    // Demo timelines are scripted; a manual refresh must not inject data.
    return;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(20, speed));
  }

  private loop(): void {
    if (!this.running) return;
    const elapsed = this.now() - this.startedAt;
    const scenario = this.scenario;
    if (!scenario) return;

    while (this.cursor < scenario.steps.length) {
      const step = scenario.steps[this.cursor]!;
      if (step.at > elapsed) break;
      this.dispatch(step);
      this.cursor += 1;
    }

    const finished = this.cursor >= scenario.steps.length;
    this.options.onProgress?.({
      scenario,
      elapsed,
      progress: Math.min(1, elapsed / scenario.durationMs),
      step: this.cursor,
      finished,
    });

    if (finished) {
      this.running = false;
      return;
    }
    this.timer = this.setT(() => this.loop(), Math.max(80, 250 / this.speed));
  }

  private dispatch(step: DemoStep): void {
    const at = this.now();
    if (step.connection) {
      this.emit({ type: 'connection', state: step.connection, at, detail: step.error ?? step.label });
    } else if (step.error) {
      this.emit({ type: 'connection', state: 'offline', at, detail: step.error });
    }

    if (step.items && step.items.length === 0) {
      // Empty response: publish an empty batch so the UI can prove it keeps
      // previous data and does not blank out on "no news".
      this.emit({ type: 'batch', at, events: [], eews: [], tsunami: null, rejected: 0 });
      return;
    }

    if (step.items && step.items.length) {
      const parsed = parseBatch(step.items, at, DEMO_SOURCE);
      const tsunami: TsunamiInfo | null = parsed.tsunamis[0] ?? null;
      this.emit({
        type: 'batch',
        at,
        events: parsed.quakes as EarthquakeEvent[],
        eews: parsed.eews as EewAlert[],
        tsunami,
        rejected: parsed.rejected.length,
      });
    }
  }
}

/** Feed surface shared by LiveFeed and DemoFeed. */
export interface Feed {
  on(fn: (e: FeedEvent) => void): () => void;
  start(...args: never[]): unknown;
  stop(): void;
  pause(): void;
  resume(): void;
  refreshNow(): Promise<void>;
}
