import { logger } from './logger.js';
import { captureException } from './sentry.js';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  retryOnStatus?: (status: number) => boolean;
  isRetryable?: (err: unknown) => boolean;
  tag?: string;
}

const DEFAULTS = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: 0.3,
};

export function defaultRetryOnStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function defaultIsRetryable(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED') {
    return true;
  }
  const name = (err as { name?: string }).name;
  if (name === 'AbortError' || name === 'FetchError' || name === 'TypeError') return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitteredDelay(attempt: number, opts: Required<Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'jitter'>>): number {
  const expo = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
  const jitter = expo * opts.jitter * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(expo + jitter));
}

export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = {
    maxAttempts: options?.maxAttempts ?? DEFAULTS.maxAttempts,
    baseDelayMs: options?.baseDelayMs ?? DEFAULTS.baseDelayMs,
    maxDelayMs: options?.maxDelayMs ?? DEFAULTS.maxDelayMs,
    jitter: options?.jitter ?? DEFAULTS.jitter,
    retryOnStatus: options?.retryOnStatus ?? defaultRetryOnStatus,
    isRetryable: options?.isRetryable ?? defaultIsRetryable,
    tag: options?.tag,
  };
  let lastErr: unknown;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      const shouldRetry =
        (typeof status === 'number' && opts.retryOnStatus(status)) || opts.isRetryable(err);
      if (!shouldRetry || attempt === opts.maxAttempts - 1) break;
      const retryAfterSec = (err as { retryAfter?: number }).retryAfter;
      const delay = typeof retryAfterSec === 'number' && retryAfterSec > 0
        ? Math.min(opts.maxDelayMs, retryAfterSec * 1000)
        : jitteredDelay(attempt, opts);
      logger.warn(
        { tag: opts.tag, attempt: attempt + 1, delay_ms: delay, status, err: err instanceof Error ? err.message : String(err) },
        'retry: backing off',
      );
      await sleep(delay);
    }
  }
  captureException(lastErr, { tags: { retry_tag: opts.tag ?? 'unknown', exhausted: true } });
  throw lastErr;
}

export class HttpStatusError extends Error {
  readonly status: number;
  readonly retryAfter?: number;
  readonly body: string;
  constructor(status: number, body: string, retryAfter?: number) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'HttpStatusError';
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const delta = (date - Date.now()) / 1000;
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

export interface FetchRetryOptions extends RetryOptions {
  retryOnStatus?: (status: number) => boolean;
  acceptStatus?: (status: number) => boolean;
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  const accept = options?.acceptStatus ?? ((s: number) => s < 400);
  return retryWithBackoff(async () => {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw err;
    }
    if (accept(res.status)) return res;
    const body = await res.text().catch(() => '');
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
    throw new HttpStatusError(res.status, body, retryAfter);
  }, options);
}
