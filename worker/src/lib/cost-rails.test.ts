import { describe, expect, it } from 'vitest';
import {
  actualAnthropicCents,
  estimateAnthropicCents,
  estimateGroqWhisperCents,
} from './cost-rails.js';

describe('cost-rails estimators', () => {
  it('estimates Sonnet 4.6 input + output cost', () => {
    const cents = estimateAnthropicCents({
      model: 'claude-sonnet-4-6',
      inputChars: 4_000_000,
      maxTokens: 1000,
    });
    expect(cents).toBeGreaterThan(0);
    expect(cents).toBeLessThan(10_000);
  });

  it('estimates Haiku as cheaper than Sonnet for identical input', () => {
    const sonnet = estimateAnthropicCents({
      model: 'claude-sonnet-4-6',
      inputChars: 100_000,
      maxTokens: 500,
    });
    const haiku = estimateAnthropicCents({
      model: 'claude-haiku-4-5-20251001',
      inputChars: 100_000,
      maxTokens: 500,
    });
    expect(haiku).toBeLessThan(sonnet);
  });

  it('reports zero cost for zero-length transcription', () => {
    expect(estimateGroqWhisperCents(0)).toBe(0);
  });

  it('grows monotonically with audio length', () => {
    const a = estimateGroqWhisperCents(60);
    const b = estimateGroqWhisperCents(600);
    expect(b).toBeGreaterThan(a);
  });

  it('actualAnthropicCents matches estimator within a few cents for the same model', () => {
    const estimate = estimateAnthropicCents({
      model: 'claude-sonnet-4-6',
      inputChars: 4000,
      maxTokens: 1000,
    });
    const actual = actualAnthropicCents({
      model: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(Math.abs(estimate - actual)).toBeLessThan(5);
  });

  it('falls back to Sonnet pricing for unknown models', () => {
    const known = estimateAnthropicCents({
      model: 'claude-sonnet-4-6',
      inputChars: 10_000,
      maxTokens: 100,
    });
    const unknown = estimateAnthropicCents({
      model: 'claude-future-99',
      inputChars: 10_000,
      maxTokens: 100,
    });
    expect(unknown).toBe(known);
  });
});
