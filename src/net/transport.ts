/**
 * HTTP transports.
 *
 * The web build uses `fetch`. The Android shell injects a native transport
 * (`window.YureWatchNative`) because the packaged app loads from file:// where
 * fetch() is subject to opaque-origin CORS rules. Both return `{status, body}`
 * and the rest of the app is agnostic to which one is in use.
 */

export interface HttpResult {
  status: number;
  body: string;
}

export interface HttpTransport {
  readonly kind: 'fetch' | 'native';
  getText(url: string, opts?: { timeoutMs?: number }): Promise<HttpResult>;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class FetchTransport implements HttpTransport {
  readonly kind = 'fetch' as const;

  async getText(url: string, opts: { timeoutMs?: number } = {}): Promise<HttpResult> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = opts.timeoutMs ?? 15_000;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
      const res = await fetch(url, {
        signal: controller?.signal,
        headers: { accept: 'application/json' },
        // No credentials: the API is anonymous and we never send user identity.
        credentials: 'omit',
        cache: 'no-store',
      });
      const body = await res.text();
      return { status: res.status, body };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpError(`ネットワークエラー: ${message}`, url);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

interface NativeBridge {
  /** `id` is echoed back through `window.__yurewatchNativeResolve`. */
  request(id: string, url: string, timeoutMs: number): void;
}

declare global {
  interface Window {
    YureWatchNative?: NativeBridge;
    __yurewatchNativeResolve?: (id: string, payload: string) => void;
  }
}

/**
 * Bridge to `NativeNet` in the Android shell. The Java side performs the request
 * off the UI thread and calls back into JS with `{status, body}` or `{error}`.
 */
export class NativeTransport implements HttpTransport {
  readonly kind = 'native' as const;
  private pending = new Map<string, { resolve: (v: HttpResult) => void; reject: (e: Error) => void }>();
  private seq = 0;

  constructor(private bridge: NativeBridge) {
    window.__yurewatchNativeResolve = (id, payload) => this.settle(id, payload);
  }

  getText(url: string, opts: { timeoutMs?: number } = {}): Promise<HttpResult> {
    const id = `r${++this.seq}`;
    const timeout = opts.timeoutMs ?? 15_000;
    return new Promise<HttpResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new HttpError('タイムアウト', url));
      }, timeout + 1_000);
      try {
        this.bridge.request(id, url, timeout);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new HttpError(`ネイティブ通信エラー: ${String(err)}`, url));
      }
      const settle = this.pending.get(id);
      if (settle) {
        const prev = settle.resolve;
        settle.resolve = (v) => {
          clearTimeout(timer);
          prev(v);
        };
        const prevReject = settle.reject;
        settle.reject = (e) => {
          clearTimeout(timer);
          prevReject(e);
        };
      }
    });
  }

  /** Called from Java via `evaluateJavascript`. Payload is JSON. */
  settle(id: string, payload: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    try {
      const parsed = JSON.parse(payload) as { status?: number; body?: string; error?: string };
      if (typeof parsed.error === 'string') {
        entry.reject(new HttpError(parsed.error, ''));
        return;
      }
      entry.resolve({ status: parsed.status ?? 0, body: parsed.body ?? '' });
    } catch {
      entry.reject(new HttpError('不正なネイティブ応答', ''));
    }
  }
}

export function detectTransport(): HttpTransport {
  if (typeof window !== 'undefined' && window.YureWatchNative) {
    return new NativeTransport(window.YureWatchNative);
  }
  return new FetchTransport();
}
