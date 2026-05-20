import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpStatusError, fetchWithRetry, retryWithBackoff } from './retry.js';

describe('retryWithBackoff', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValueOnce('ok');
    const result = await retryWithBackoff(fn, { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a transient HttpStatusError(503) and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpStatusError(503, 'busy'))
      .mockRejectedValueOnce(new HttpStatusError(503, 'busy'))
      .mockResolvedValueOnce('hello');
    const out = await retryWithBackoff(fn, { baseDelayMs: 1, jitter: 0, maxAttempts: 4 });
    expect(out).toBe('hello');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('exhausts retries on persistent 500', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpStatusError(500, 'down'));
    await expect(
      retryWithBackoff(fn, { baseDelayMs: 1, jitter: 0, maxAttempts: 3 }),
    ).rejects.toBeInstanceOf(HttpStatusError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on a 4xx other than 429', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpStatusError(404, 'no'));
    await expect(retryWithBackoff(fn, { baseDelayMs: 1, maxAttempts: 4 })).rejects.toBeInstanceOf(
      HttpStatusError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects Retry-After when present', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpStatusError(429, 'limited', 1))
      .mockResolvedValueOnce('done');
    const out = await retryWithBackoff(fn, { baseDelayMs: 10_000, jitter: 0, maxAttempts: 2 });
    expect(out).toBe('done');
  });
});

describe('fetchWithRetry', () => {
  const originalFetch = globalThis.fetch;
  let calls: Array<[string, RequestInit | undefined]>;

  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns Response on 2xx without retry', async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    const res = await fetchWithRetry('https://example.com', undefined, { baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('retries on 5xx and throws HttpStatusError when exhausted', async () => {
    globalThis.fetch = vi.fn(async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    await expect(
      fetchWithRetry('https://example.com', undefined, {
        baseDelayMs: 1,
        jitter: 0,
        maxAttempts: 2,
      }),
    ).rejects.toMatchObject({ name: 'HttpStatusError', status: 503 });
  });
});
