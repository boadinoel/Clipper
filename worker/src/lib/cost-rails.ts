import { config } from '../config.js';
import { logger } from './logger.js';
import { supabase } from './supabase.js';

export type CostService = 'anthropic' | 'groq';

export class SpendCapError extends Error {
  readonly service: CostService;
  readonly capCents: number;
  readonly usedCents: number;
  constructor(service: CostService, capCents: number, usedCents: number) {
    super(`spend cap reached for ${service}: ${usedCents}¢ used, cap ${capCents}¢`);
    this.name = 'SpendCapError';
    this.service = service;
    this.capCents = capCents;
    this.usedCents = usedCents;
  }
}

export function isSpendCapError(err: unknown): err is SpendCapError {
  return err instanceof SpendCapError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'SpendCapError');
}

function capFor(service: CostService): number {
  switch (service) {
    case 'anthropic':
      return config.ANTHROPIC_DAILY_CAP_CENTS;
    case 'groq':
      return config.GROQ_DAILY_CAP_CENTS;
  }
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function checkAndReserveSpend(
  service: CostService,
  estimateCents: number,
): Promise<{ ok: true; usedCents: number; capCents: number } | { ok: false; usedCents: number; capCents: number }> {
  const cap = capFor(service);
  if (!config.COST_RAILS_ENFORCEMENT) {
    return { ok: true, usedCents: 0, capCents: cap };
  }
  const reserved = Math.max(0, Math.ceil(estimateCents));
  const date = todayUtc();

  const { data, error } = await supabase().rpc('cost_rails_reserve', {
    p_date: date,
    p_service: service,
    p_cents: reserved,
  });

  if (error) {
    logger.warn(
      { err: error.message, service, reserved },
      'cost-rails: reserve RPC failed; allowing call (fail-open)',
    );
    return { ok: true, usedCents: 0, capCents: cap };
  }

  const newTotal = typeof data === 'number' ? data : Number(data ?? 0);
  if (newTotal > cap) {
    await supabase()
      .rpc('cost_rails_adjust', { p_date: date, p_service: service, p_delta: -reserved })
      .then(({ error: adjustErr }) => {
        if (adjustErr) {
          logger.warn(
            { err: adjustErr.message, service, reserved },
            'cost-rails: refund after cap-hit failed; ledger may be inflated',
          );
        }
      });
    return { ok: false, usedCents: newTotal, capCents: cap };
  }
  return { ok: true, usedCents: newTotal, capCents: cap };
}

export async function recordActualSpend(
  service: CostService,
  actualCents: number,
  estimatedCents: number,
): Promise<void> {
  const delta = Math.round(actualCents - estimatedCents);
  if (delta === 0) return;
  if (!config.COST_RAILS_ENFORCEMENT) return;
  const date = todayUtc();
  const { error } = await supabase().rpc('cost_rails_adjust', {
    p_date: date,
    p_service: service,
    p_delta: delta,
  });
  if (error) {
    logger.warn(
      { err: error.message, service, delta },
      'cost-rails: adjust failed; estimate-actual drift not recorded',
    );
  }
}

export async function reserveOrThrow(service: CostService, estimateCents: number): Promise<void> {
  const result = await checkAndReserveSpend(service, estimateCents);
  if (!result.ok) {
    throw new SpendCapError(service, result.capCents, result.usedCents);
  }
}

const ANTHROPIC_PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 300, output: 1500 },
  'claude-haiku-4-5-20251001': { input: 80, output: 400 },
};

export function estimateAnthropicCents(opts: {
  model: string;
  inputChars: number;
  maxTokens: number;
}): number {
  const pricing = ANTHROPIC_PRICES_PER_MTOK[opts.model] ?? ANTHROPIC_PRICES_PER_MTOK['claude-sonnet-4-6']!;
  const inputTokens = Math.ceil(opts.inputChars / 4);
  const inputCents = (inputTokens / 1_000_000) * pricing.input;
  const outputCents = (opts.maxTokens / 1_000_000) * pricing.output;
  return Math.ceil(inputCents + outputCents);
}

export function actualAnthropicCents(opts: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const pricing = ANTHROPIC_PRICES_PER_MTOK[opts.model] ?? ANTHROPIC_PRICES_PER_MTOK['claude-sonnet-4-6']!;
  const inputCents = (opts.inputTokens / 1_000_000) * pricing.input;
  const outputCents = (opts.outputTokens / 1_000_000) * pricing.output;
  return Math.ceil(inputCents + outputCents);
}

const GROQ_WHISPER_CENTS_PER_HOUR = 11.1;

export function estimateGroqWhisperCents(audioSeconds: number): number {
  return Math.ceil((audioSeconds / 3600) * GROQ_WHISPER_CENTS_PER_HOUR);
}
