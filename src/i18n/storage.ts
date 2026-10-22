/**
 * Language preference storage.
 *
 * Priority:
 *  1. The Android shell's shared preferences (exposed as `window.YureWatchPrefs`).
 *     WebView `localStorage` is not reliably persistent for the `file://` asset
 *     origin the APK loads from, and the language must survive a restart, so the
 *     native side is authoritative on Android.
 *  2. `localStorage` — used by the web build and by tests.
 *  3. Memory — used when neither exists (private mode, sandboxed preview).
 *
 * Nothing here ever touches a credential; the preference is a single string.
 */
export const STORAGE_KEY = 'yurewatch.locale';

interface PrefBridge {
  getPref: (key: string) => string | null;
  setPref: (key: string, value: string) => void;
}

function bridge(): PrefBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { YureWatchPrefs?: PrefBridge }).YureWatchPrefs;
  if (!candidate || typeof candidate.getPref !== 'function' || typeof candidate.setPref !== 'function') {
    return null;
  }
  return candidate;
}

function webStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__yurewatch_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    // Sandboxed iframes and some WebView configurations throw on access.
    return null;
  }
}

const memory = new Map<string, string>();

export function readPreference(key: string): string | null {
  const b = bridge();
  if (b) {
    try {
      const value = b.getPref(key);
      if (value !== null && value !== undefined && value !== '') return String(value);
    } catch {
      /* fall through to the web store */
    }
  }
  const store = webStorage();
  if (store) {
    try {
      const value = store.getItem(key);
      if (value !== null) return value;
    } catch {
      /* fall through to memory */
    }
  }
  return memory.get(key) ?? null;
}

export function writePreference(key: string, value: string): void {
  memory.set(key, value);
  const b = bridge();
  if (b) {
    try {
      b.setPref(key, value);
    } catch {
      /* fall through */
    }
  }
  const store = webStorage();
  if (store) {
    try {
      store.setItem(key, value);
    } catch {
      /* memory already holds it */
    }
  }
}
