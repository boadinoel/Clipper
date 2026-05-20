export interface SpikeEvent {
  reason: 'emote_spike' | 'keyword_spike';
  windowMs: number;
  count: number;
  threshold: number;
  samples: string[];
}

interface MessageSample {
  ts: number;
  emoteCount: number;
  keywords: number;
  excerpt: string;
}

const WINDOW_MS = 6_000;
const COOLDOWN_MS = 30_000;
const EMOTE_THRESHOLD = 12;
const KEYWORD_THRESHOLD = 8;
const KEYWORDS = ['lmao', 'lmfao', 'omg', 'no way', 'clip it', 'clip that', 'wtf', 'pog'];

export class SpikeDetector {
  private samples: MessageSample[] = [];
  private lastSpikeAt = 0;

  ingest(opts: { ts: number; message: string; emotes: string[] }): SpikeEvent | null {
    const emoteCount = opts.emotes.length;
    const text = opts.message.toLowerCase();
    let keywords = 0;
    for (const k of KEYWORDS) if (text.includes(k)) keywords++;

    this.samples.push({ ts: opts.ts, emoteCount, keywords, excerpt: opts.message.slice(0, 80) });
    const cutoff = opts.ts - WINDOW_MS;
    while (this.samples.length > 0 && this.samples[0]!.ts < cutoff) this.samples.shift();

    if (opts.ts - this.lastSpikeAt < COOLDOWN_MS) return null;

    let emoteSum = 0;
    let keywordSum = 0;
    const samples: string[] = [];
    for (const s of this.samples) {
      emoteSum += s.emoteCount;
      keywordSum += s.keywords;
      if (samples.length < 5 && s.emoteCount + s.keywords > 0) samples.push(s.excerpt);
    }

    if (emoteSum >= EMOTE_THRESHOLD) {
      this.lastSpikeAt = opts.ts;
      return { reason: 'emote_spike', windowMs: WINDOW_MS, count: emoteSum, threshold: EMOTE_THRESHOLD, samples };
    }
    if (keywordSum >= KEYWORD_THRESHOLD) {
      this.lastSpikeAt = opts.ts;
      return { reason: 'keyword_spike', windowMs: WINDOW_MS, count: keywordSum, threshold: KEYWORD_THRESHOLD, samples };
    }
    return null;
  }
}
