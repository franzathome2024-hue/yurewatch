import { getLocale } from '../i18n';

/**
 * Speech output.
 *
 * Engine: the platform's own speech synthesiser — `window.speechSynthesis` in the
 * WebView, which on Android is backed by the system TTS service (Google TTS or
 * whatever the user has installed). There is no remote speech API and no
 * prerecorded audio, so speaking works offline as long as a voice for the
 * language is installed.
 *
 * What this module does NOT claim:
 *  - that a Japanese voice exists (it asks the engine),
 *  - that the device is audible (silent mode/volume is outside the page's reach),
 *  - that audio focus is ours (a WebView cannot request it; see docs/AUDIO.md).
 */

export type SpeechStatus =
  | 'ready'
  /** No `speechSynthesis` at all in this engine. */
  | 'unsupported'
  /** Voices not loaded yet — the list arrives asynchronously. */
  | 'pending'
  /** Engine exists but has no voice for the active language. */
  | 'no-voice';

export interface SpeakResult {
  ok: boolean;
  /** Why it did not speak, in a form the UI can localise. */
  reason?: Exclude<SpeechStatus, 'ready'> | 'disabled' | 'cancelled-in-flight';
}

const LANG_TAG: Record<string, string> = { ja: 'ja-JP', en: 'en-US' };

export class Speech {
  private voices: SpeechSynthesisVoice[] = [];
  private loaded = false;
  private current: SpeechSynthesisUtterance | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    if (!this.supported()) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      if (!list.length) return;
      this.voices = list;
      this.loaded = true;
      for (const fn of this.listeners) fn();
    };
    load();
    // Chrome populates the voice list asynchronously; Android WebView may fire
    // `voiceschanged` more than once, or not at all if voices are already cached.
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
  }

  supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Voice for the active UI language, preferring a regional match. */
  voiceFor(locale = getLocale()): SpeechSynthesisVoice | null {
    if (!this.supported()) return null;
    if (!this.loaded) {
      const list = window.speechSynthesis.getVoices();
      if (list.length) {
        this.voices = list;
        this.loaded = true;
      }
    }
    const want = LANG_TAG[locale] ?? 'ja-JP';
    const exact = this.voices.find((v) => v.lang?.replace('_', '-').toLowerCase() === want.toLowerCase());
    if (exact) return exact;
    const prefix = want.slice(0, 2).toLowerCase();
    return this.voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ?? null;
  }

  status(locale = getLocale()): SpeechStatus {
    if (!this.supported()) return 'unsupported';
    if (!this.loaded && this.voices.length === 0) {
      return window.speechSynthesis.getVoices().length ? 'ready' : 'pending';
    }
    return this.voiceFor(locale) ? 'ready' : 'no-voice';
  }

  /**
   * Speak now. Any in-flight utterance is cancelled first: two overlapping
   * announcements ("…magnitude 6.1" over "…warning cancelled") are worse than
   * one, and the newest alert is always the one that matters.
   */
  speak(text: string, locale = getLocale()): SpeakResult {
    const status = this.status(locale);
    if (status !== 'ready') return { ok: false, reason: status };
    const voice = this.voiceFor(locale);
    if (!voice) return { ok: false, reason: 'no-voice' };

    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    // Slightly slower than default: these sentences carry numbers that matter.
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onend = () => {
      if (this.current === utterance) this.current = null;
    };
    utterance.onerror = () => {
      if (this.current === utterance) this.current = null;
    };
    this.current = utterance;
    synth.speak(utterance);
    return { ok: true };
  }

  cancel(): void {
    if (!this.supported()) return;
    this.current = null;
    window.speechSynthesis.cancel();
  }

  isSpeaking(): boolean {
    return this.supported() && window.speechSynthesis.speaking;
  }
}
