/**
 * Alert tone.
 *
 * Synthesised with WebAudio rather than shipping a broadcast jingle: the
 * reference project's sounds come from OtoLogic under a different licence and
 * are not ours to redistribute. A two-tone chime is enough to draw attention and
 * carries no licensing obligations.
 *
 * Audio never starts on its own: browsers block it until a user gesture, and
 * more importantly an alarm on a simulated event would be actively misleading.
 */
export class AlertAudio {
  private ctx: AudioContext | null = null;
  private unlocked = false;

  constructor(private enabled: () => boolean) {
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.unlocked = true;
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }
  }

  private ensure(): AudioContext | null {
    if (!this.unlocked) return null;
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    return this.ctx;
  }

  /** kind: `warning` = urgent double tone, `info` = single soft tone. */
  play(kind: 'warning' | 'info', force = false): void {
    if (!force && !this.enabled()) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state === 'suspended') return;
    const now = ctx.currentTime;
    const tone = (freq: number, start: number, duration: number, gainValue: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(gainValue, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.05);
    };
    if (kind === 'warning') {
      tone(880, 0, 0.18, 0.16);
      tone(1174, 0.22, 0.22, 0.16);
      tone(880, 0.5, 0.18, 0.12);
    } else {
      tone(660, 0, 0.16, 0.08);
    }
  }

  /** Called by the app when preference toggles, to satisfy autoplay policies. */
  prime(): void {
    this.ensure();
  }

  /** AudioContext state for diagnostics ('not-created' until first unlock). */
  contextState(): string {
    return this.ctx?.state ?? 'not-created';
  }

  /**
   * User-gesture test tone. The button press is itself the consent, so the
   * alert-enabled preference is bypassed — but the platform is not: a
   * suspended context is resumed explicitly and the state observed *before*
   * the attempt is returned, so the UI can report honestly (e.g. a WebView
   * that keeps the context suspended) instead of claiming success. The tone
   * itself is the same synthesized `info` chime alerts use — no audio files.
   */
  testTone(): string {
    // This runs inside the test button's click handler — itself a user
    // gesture — so it counts as the unlock even where no earlier pointer or
    // key event reached the window listeners (notably some WebViews).
    this.unlocked = true;
    const ctx = this.ensure();
    if (!ctx) return 'unsupported';
    const observed = ctx.state;
    if (observed === 'suspended') {
      void ctx.resume().then(() => this.play('info', true)).catch(() => undefined);
    } else {
      this.play('info', true);
    }
    return observed;
  }
}
