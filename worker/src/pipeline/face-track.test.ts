import { describe, expect, it } from 'vitest';
import { interpretRaw, type FaceTrackRaw } from './face-track.js';

function makeRaw(samples: Array<{ frame: number; cx: number; conf: number }>): FaceTrackRaw {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    frame_count: 300,
    samples: samples.map((s) => ({ frame: s.frame, t: s.frame / 30, cx: s.cx, cy: 0.5, conf: s.conf })),
  };
}

describe('face-track interpretRaw', () => {
  it('marks empty samples as not usable', () => {
    const result = interpretRaw(makeRaw([]));
    expect(result.usable).toBe(false);
    expect(result.reason).toBe('no_faces');
  });

  it('drops low-confidence samples and falls back when coverage too low', () => {
    const samples = Array.from({ length: 5 }, (_, i) => ({ frame: i * 5, cx: 0.5, conf: 0.2 }));
    const result = interpretRaw(makeRaw(samples));
    expect(result.usable).toBe(false);
  });

  it('produces smoothed center-per-second when coverage is sufficient', () => {
    const samples = Array.from({ length: 60 }, (_, i) => ({
      frame: i * 5,
      cx: 0.4 + (i % 2 === 0 ? 0.02 : -0.02),
      conf: 0.9,
    }));
    const result = interpretRaw(makeRaw(samples));
    expect(result.usable).toBe(true);
    expect(result.centerXPerSecond.length).toBeGreaterThan(0);
    for (const p of result.centerXPerSecond) {
      expect(p.cx).toBeGreaterThanOrEqual(0);
      expect(p.cx).toBeLessThanOrEqual(1);
    }
  });

  it('clamps centers into [0,1] even if raw samples drift outside', () => {
    const samples = Array.from({ length: 60 }, (_, i) => ({
      frame: i * 5,
      cx: i % 2 === 0 ? 1.5 : -0.5,
      conf: 0.9,
    }));
    const result = interpretRaw(makeRaw(samples));
    for (const p of result.centerXPerSecond) {
      expect(p.cx).toBeGreaterThanOrEqual(0);
      expect(p.cx).toBeLessThanOrEqual(1);
    }
  });
});
