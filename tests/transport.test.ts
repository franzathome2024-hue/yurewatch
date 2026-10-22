import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchTransport, HttpError, NativeTransport } from '../src/net/transport';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('FetchTransport', () => {
  it('returns status and body for a completed request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200, text: async () => '{"ok":true}' })),
    );
    const t = new FetchTransport();
    await expect(t.getText('https://example.invalid/x')).resolves.toEqual({
      status: 200,
      body: '{"ok":true}',
    });
  });

  it('times out a request that never answers (bounded wait)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const t = new FetchTransport();
    await expect(t.getText('https://example.invalid/slow', { timeoutMs: 10 })).rejects.toBeInstanceOf(
      HttpError,
    );
  });

  it('wraps network failures in HttpError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const t = new FetchTransport();
    await expect(t.getText('https://example.invalid/x')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('NativeTransport (Android bridge)', () => {
  it('resolves when the shell calls back', async () => {
    const bridge = {
      request: (id: string, _url: string, _timeoutMs: number) => {
        setTimeout(
          () => window.__yurewatchNativeResolve!(id, JSON.stringify({ status: 200, body: '[]' })),
          5,
        );
      },
    };
    const t = new NativeTransport(bridge);
    await expect(t.getText('https://example.invalid/x')).resolves.toEqual({ status: 200, body: '[]' });
  });

  it('times out when the shell never calls back (bounded wait)', async () => {
    vi.useFakeTimers();
    const t = new NativeTransport({ request: () => {} });
    const p = t.getText('https://example.invalid/x', { timeoutMs: 50 });
    const assertion = expect(p).rejects.toBeInstanceOf(HttpError);
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it('rejects on a shell-reported error', async () => {
    const bridge = {
      request: (id: string) => {
        window.__yurewatchNativeResolve!(id, JSON.stringify({ error: '接続できません' }));
      },
    };
    const t = new NativeTransport(bridge);
    await expect(t.getText('https://example.invalid/x')).rejects.toBeInstanceOf(HttpError);
  });
});
