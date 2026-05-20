import { createReadStream } from 'node:fs';
import Groq from 'groq-sdk';
import { config } from '../config.js';
import type { TranscriptSegment } from '../types/db.js';
import {
  estimateGroqWhisperCents,
  recordActualSpend,
  reserveOrThrow,
} from './cost-rails.js';

let client: Groq | null = null;
function groq(): Groq {
  if (!client) client = new Groq({ apiKey: config.GROQ_API_KEY, maxRetries: 4 });
  return client;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  language: string;
  duration: number;
}

const ESTIMATED_SECONDS_BEFORE_PROBE = 60;

export async function transcribeFile(opts: {
  localPath: string;
  estimatedAudioSeconds?: number;
}): Promise<TranscriptionResult> {
  const estimateSeconds = opts.estimatedAudioSeconds ?? ESTIMATED_SECONDS_BEFORE_PROBE;
  const estimateCents = estimateGroqWhisperCents(estimateSeconds);
  await reserveOrThrow('groq', estimateCents);

  const res = (await groq().audio.transcriptions.create({
    file: createReadStream(opts.localPath) as unknown as File,
    model: 'whisper-large-v3',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment', 'word'],
  })) as unknown as RawWhisperResponse;

  const actualSeconds = res.duration ?? estimateSeconds;
  const actualCents = estimateGroqWhisperCents(actualSeconds);
  await recordActualSpend('groq', actualCents, estimateCents);

  const wordsBySegmentIdx = new Map<number, Array<{ start: number; end: number; word: string }>>();
  if (res.words) {
    for (const w of res.words) {
      const idx = res.segments?.findIndex((s) => w.start >= s.start && w.end <= s.end) ?? -1;
      if (idx < 0) continue;
      const bucket = wordsBySegmentIdx.get(idx) ?? [];
      bucket.push({ start: w.start, end: w.end, word: w.word });
      wordsBySegmentIdx.set(idx, bucket);
    }
  }

  const segments: TranscriptSegment[] = (res.segments ?? []).map((s, idx) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
    words: wordsBySegmentIdx.get(idx),
  }));

  return {
    text: res.text,
    segments,
    language: res.language ?? 'en',
    duration: res.duration ?? 0,
  };
}

interface RawWhisperResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
  words?: Array<{ start: number; end: number; word: string }>;
}
