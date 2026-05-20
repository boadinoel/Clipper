import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type {
  CaptionSegment,
  ChatContextEntry,
  StyleProfileRow,
  TranscriptSegment,
  ZoomMoment,
} from '../types/db.js';

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

const SCORING_MODEL = 'claude-sonnet-4-6';
const SIGNAL_MODEL = 'claude-haiku-4-5-20251001';

export interface VariantPlan {
  label: 'A' | 'B' | 'C';
  hook_text: string;
  caption_segments: CaptionSegment[];
  zoom_moments: ZoomMoment[];
  template: 'BoldCaption' | 'MemePop' | 'MinimalBottom';
  trim_start: number;
  trim_end: number;
  reasoning: string;
}

export interface ScoringResult {
  variants: VariantPlan[];
}

export async function scoreClipAndPlanVariants(opts: {
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  chatContext: ChatContextEntry[];
  styleProfile: StyleProfileRow | null;
  durationSeconds: number;
}): Promise<ScoringResult> {
  const system = `You are a short-form video editor specialising in 9:16 clips for streamers.
You receive a transcript with word-level timestamps, chat context around the moment, and the
streamer's style profile. Return EXACTLY 3 variants in valid JSON. Each variant must select a
template, propose a hook, pick caption segments timed to the transcript, and optionally mark
zoom moments. Stay within the source clip duration. Variant A should be the safest pick, B more
playful, C more experimental.`;

  const learned = opts.styleProfile?.learned_preferences ?? {};
  const userMessage = JSON.stringify(
    {
      duration_seconds: opts.durationSeconds,
      transcript: opts.transcript,
      transcript_segments: opts.transcriptSegments,
      chat_context: opts.chatContext,
      style_profile: opts.styleProfile && {
        brand_primary_color: opts.styleProfile.brand_primary_color,
        brand_accent_color: opts.styleProfile.brand_accent_color,
        brand_font: opts.styleProfile.brand_font,
        voice_descriptor: opts.styleProfile.voice_descriptor,
        humor_quiz: opts.styleProfile.humor_quiz,
        learned_preferences: learned,
      },
      output_schema: {
        variants: [
          {
            label: 'A',
            hook_text: 'string',
            caption_segments: [{ start: 0, end: 0, text: 'string' }],
            zoom_moments: [{ at: 0, duration: 0, intensity: 1.0 }],
            template: 'BoldCaption | MemePop | MinimalBottom',
            trim_start: 0,
            trim_end: 0,
            reasoning: 'string',
          },
        ],
      },
    },
    null,
    2,
  );

  const res = await anthropic().messages.create({
    model: SCORING_MODEL,
    max_tokens: 3000,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });
  const text = res.content
    .map((b) => ('text' in b ? b.text : ''))
    .join('')
    .trim();
  const json = extractJson(text);
  const parsed = JSON.parse(json) as ScoringResult;
  if (!parsed.variants || parsed.variants.length !== 3) {
    throw new Error(`scoring returned ${parsed.variants?.length ?? 0} variants, expected 3`);
  }
  return parsed;
}

export interface RejectionSignal {
  caption_length_preference?: 'short' | 'medium' | 'long';
  template_penalty?: { template: string; delta: number };
  hook_patterns_disliked?: string[];
  notes?: string;
}

export async function extractRejectionSignal(opts: {
  reason: string;
  template: string;
  hookText: string;
  captionExcerpt: string;
}): Promise<RejectionSignal> {
  const res = await anthropic().messages.create({
    model: SIGNAL_MODEL,
    max_tokens: 400,
    system:
      'Extract a learning signal for a video-editing style model from a user rejection. Return JSON only.',
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          reason: opts.reason,
          rejected_variant: {
            template: opts.template,
            hook_text: opts.hookText,
            caption_excerpt: opts.captionExcerpt,
          },
          schema: {
            caption_length_preference: 'short | medium | long (optional)',
            template_penalty: '{ template, delta: -0.05..-0.3 } (optional)',
            hook_patterns_disliked: 'string[] (optional)',
            notes: 'string (optional)',
          },
        }),
      },
    ],
  });
  const text = res.content
    .map((b) => ('text' in b ? b.text : ''))
    .join('')
    .trim();
  return JSON.parse(extractJson(text)) as RejectionSignal;
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence?.[1]) return fence[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error(`no JSON object found in:\n${text}`);
  return text.slice(first, last + 1);
}
