import { describe, expect, it } from 'vitest';
import { percentileFromSamples } from './metrics-post-scored.js';

describe('percentileFromSamples', () => {
  it('returns 0.5 when there are fewer than 3 samples', () => {
    expect(percentileFromSamples(1000, [])).toBe(0.5);
    expect(percentileFromSamples(1000, [100, 200])).toBe(0.5);
  });

  it('returns 0.5 when median is zero', () => {
    expect(percentileFromSamples(500, [0, 0, 0, 0, 0])).toBe(0.5);
  });

  it('rates a clip equal to the median as 0.5', () => {
    expect(percentileFromSamples(100, [50, 100, 150, 200, 100])).toBe(0.5);
  });

  it('rates a clip far above median into the promote zone (>=0.9)', () => {
    const p = percentileFromSamples(10_000, [100, 200, 300, 400, 500]);
    expect(p).toBeGreaterThanOrEqual(0.9);
  });

  it('rates a clip far below median into the demote zone (<=0.1)', () => {
    const p = percentileFromSamples(10, [200, 300, 400, 500, 600]);
    expect(p).toBeLessThanOrEqual(0.1);
  });

  it('clamps to [0,1]', () => {
    expect(percentileFromSamples(Number.POSITIVE_INFINITY, [10, 20, 30])).toBeLessThanOrEqual(1);
    expect(percentileFromSamples(-1000, [10, 20, 30])).toBeGreaterThanOrEqual(0);
  });
});
