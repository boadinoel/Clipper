import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type {
  CaptionSegment,
  ChatContextEntry,
  ReferenceClipAnalysis,
  ReferenceSample,
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
        reference_clip_analysis: opts.styleProfile.reference_clip_analysis,
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

export interface SynthesisInputSample {
  url: string;
  platform: ReferenceSample['platform'];
  classification: ReferenceSample['classification'];
  title?: string;
  viewCount?: number;
  durationSeconds: number;
  transcript: string;
  transcriptExcerpt: string;
}

export async function synthesizeReferenceProfile(opts: {
  samples: SynthesisInputSample[];
  styleProfile: StyleProfileRow | null;
}): Promise<ReferenceClipAnalysis> {
  const system = `You are studying a streamer's most-viewed and most-recent clips
to model their voice, humor, what their audience reacts to, and what hook patterns earned views.

Inputs include three classifications:
- "self": the streamer's own content (Twitch, Kick, or their connected social accounts).
- "reference": their public handles on other platforms (likely theirs, not verified).
- "aspirational": clips of OTHER creators they want to learn from — extract the *moves*, not the persona, into "aspirational_takeaways". Do NOT confuse aspirational style with their own voice.

Return STRICT JSON matching the provided schema. No prose, no markdown fences.`;

  const samplesForPrompt = opts.samples.map((s) => ({
    url: s.url,
    platform: s.platform,
    classification: s.classification,
    title: s.title,
    view_count: s.viewCount,
    duration_seconds: s.durationSeconds,
    transcript_excerpt: s.transcriptExcerpt,
  }));

  const userMessage = JSON.stringify(
    {
      existing_voice_descriptor: opts.styleProfile?.voice_descriptor ?? null,
      existing_humor_quiz: opts.styleProfile?.humor_quiz ?? null,
      samples: samplesForPrompt,
      output_schema: {
        voice_descriptor: 'string (1-2 sentences)',
        humor_profile: { primary: 'string', notes: 'string' },
        content_themes: 'string[]',
        hook_patterns_observed: [
          { pattern: 'string', examples: 'string[]', evidence_view_count: 'number?' },
        ],
        pacing: { preferred_clip_seconds: 'number', typical_payoff_at_pct: 'number 0..1' },
        audience_signals: { what_they_click: 'string', what_underperforms: 'string' },
        vocabulary_quirks: 'string[]',
        caption_style_inference: 'short | medium | long',
        aspirational_takeaways: 'string[]?',
      },
    },
    null,
    2,
  );

  const res = await anthropic().messages.create({
    model: SCORING_MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });
  const text = res.content
    .map((b) => ('text' in b ? b.text : ''))
    .join('')
    .trim();
  const parsed = JSON.parse(extractJson(text)) as Omit<
    ReferenceClipAnalysis,
    'samples' | 'source_clip_count' | 'last_synthesized_at'
  >;

  return {
    ...parsed,
    samples: opts.samples.map<ReferenceSample>((s) => ({
      url: s.url,
      platform: s.platform,
      title: s.title,
      view_count: s.viewCount,
      classification: s.classification,
      transcript_excerpt: s.transcriptExcerpt,
      duration_seconds: s.durationSeconds,
    })),
    source_clip_count: opts.samples.length,
    last_synthesized_at: new Date().toISOString(),
  };
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fence?.[1]) return fence[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1) throw new Error(`no JSON object found in:\n${text}`);
  return text.slice(first, last + 1);
}
