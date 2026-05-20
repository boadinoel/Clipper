import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

export interface FaceSample {
  frame: number;
  t: number;
  cx: number;
  cy: number;
  conf: number;
}

export interface FaceTrackRaw {
  fps: number;
  width: number;
  height: number;
  frame_count: number;
  samples: FaceSample[];
}

export interface FaceTrackResult {
  usable: boolean;
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  samples: FaceSample[];
  /** Center-x per second, smoothed + clamped to [0,1]. */
  centerXPerSecond: Array<{ t: number; cx: number }>;
  reason?: string;
}

const SMOOTH_ALPHA = 0.3;
const MIN_CONF = 0.5;
const MIN_COVERAGE_FRACTION = 0.5;

export async function detectFaces(opts: {
  inputPath: string;
  outputJsonPath: string;
}): Promise<FaceTrackResult> {
  if (!config.FACE_TRACK_ENABLED) {
    return emptyResult('disabled');
  }
  try {
    await runFaceTrackPython({
      inputPath: opts.inputPath,
      outputJsonPath: opts.outputJsonPath,
      every: config.FACE_TRACK_SAMPLE_EVERY,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'face-track: python sidecar failed; falling back to center crop',
    );
    return emptyResult('sidecar_failed');
  }

  let raw: FaceTrackRaw;
  try {
    const text = await readFile(opts.outputJsonPath, 'utf8');
    raw = JSON.parse(text) as FaceTrackRaw;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'face-track: failed to read sidecar JSON',
    );
    return emptyResult('sidecar_read_failed');
  }
  return interpretRaw(raw);
}

function emptyResult(reason: string): FaceTrackResult {
  return {
    usable: false,
    fps: 0,
    width: 0,
    height: 0,
    frameCount: 0,
    samples: [],
    centerXPerSecond: [],
    reason,
  };
}

export function interpretRaw(raw: FaceTrackRaw): FaceTrackResult {
  const fps = raw.fps || 30;
  const frameCount = raw.frame_count || 0;
  const filtered = (raw.samples ?? []).filter((s) => s.conf >= MIN_CONF);
  const expectedSamples = Math.max(1, Math.floor(frameCount / Math.max(1, Math.round(fps / 6))));
  const coverage = expectedSamples > 0 ? filtered.length / expectedSamples : 0;
  if (filtered.length === 0 || coverage < MIN_COVERAGE_FRACTION) {
    return {
      usable: false,
      fps,
      width: raw.width,
      height: raw.height,
      frameCount,
      samples: filtered,
      centerXPerSecond: [],
      reason: filtered.length === 0 ? 'no_faces' : 'low_coverage',
    };
  }

  const durationSeconds = frameCount > 0 ? frameCount / fps : (filtered.at(-1)?.t ?? 0) + 1;
  const points: Array<{ t: number; cx: number }> = [];
  let smoothed: number | null = null;
  for (let t = 0; t < durationSeconds; t += 1) {
    const cx = sampleCenterAt(filtered, t);
    smoothed = smoothed == null ? cx : smoothed + SMOOTH_ALPHA * (cx - smoothed);
    points.push({ t, cx: clamp01(smoothed) });
  }

  return {
    usable: true,
    fps,
    width: raw.width,
    height: raw.height,
    frameCount,
    samples: filtered,
    centerXPerSecond: points,
  };
}

function sampleCenterAt(samples: FaceSample[], t: number): number {
  if (samples.length === 0) return 0.5;
  if (t <= samples[0]!.t) return samples[0]!.cx;
  if (t >= samples.at(-1)!.t) return samples.at(-1)!.cx;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t || 1;
      const w = (t - a.t) / span;
      return a.cx + (b.cx - a.cx) * w;
    }
  }
  return samples.at(-1)!.cx;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function runFaceTrackPython(opts: {
  inputPath: string;
  outputJsonPath: string;
  every: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      config.FACE_TRACK_SCRIPT,
      '--input',
      opts.inputPath,
      '--out',
      opts.outputJsonPath,
      '--every',
      String(opts.every),
    ];
    const child = spawn(config.FACE_TRACK_PYTHON, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`face-track.py exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}
