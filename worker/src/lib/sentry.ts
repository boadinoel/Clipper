import * as Sentry from '@sentry/node';
import { config } from '../config.js';
import { logger } from './logger.js';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  initialized = true;
  if (!config.SENTRY_DSN) {
    logger.info({}, 'sentry: DSN not set; running as no-op');
    return;
  }
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT,
    tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
    integrations: [Sentry.httpIntegration()],
  });
  logger.info({ environment: config.SENTRY_ENVIRONMENT }, 'sentry: initialized');
}

export function captureException(
  err: unknown,
  context?: { tags?: Record<string, string | number | boolean>; extra?: Record<string, unknown> },
): void {
  if (!config.SENTRY_DSN) return;
  Sentry.captureException(err, {
    tags: context?.tags,
    extra: context?.extra,
  });
}

export function captureMessage(
  message: string,
  context?: {
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
    tags?: Record<string, string | number | boolean>;
    extra?: Record<string, unknown>;
  },
): void {
  if (!config.SENTRY_DSN) return;
  Sentry.captureMessage(message, {
    level: context?.level ?? 'info',
    tags: context?.tags,
    extra: context?.extra,
  });
}

export { Sentry };
