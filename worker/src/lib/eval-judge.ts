import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type { VariantPlan } from './anthropic.js';
import { extractJson } from './anthropic.js';
import {
  actualAnthropicCents,
  estimateAnthropicCents,
  recordActualSpend,
  reserveOrThrow,
} from './cost-rails.js';

const JUDGE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1500;

export const EVAL_DIMENSIONS = [
  'hook_strength',
  'caption_timing',
  'variant_diversity',
  'style_alignment',
  'trim_quality',
] as const;
export type EvalDimension = (typeof EVAL_DIMENSIONS)[number];

export type DimensionScores = Record<EvalDimension, number>;

export interface VariantScore {
  variant_label: 'A' | 'B' | 'C';
  scores: DimensionScores;
  comments: string;
}

export interface JudgeResult {
  variant_scores: VariantScore[];
  set_scores: { variant_diversity: number };
  median_scores: DimensionScores;
  notes?: string;
}

let client: Anthropic | null = null;
function anth(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 4 });
  return client;
}

export interface JudgeInput {
  transcript: string;
  durationSeconds: number;
  styleProfile: {
    voice_descriptor?: string | null;
    humor_quiz?: unknown;
    learned_preferences?: unknown;
    reference_clip_analysis?: unknown;
  } | null;
  variants: VariantPlan[];
}

export async function judgeVariants(input: JudgeInput): Promise<JudgeResult> {
  const system = `You are an evaluator scoring short-form video edit plans for streamers. Score on a 1-10 integer scale (10 = excellent, 1 = unusable).

Score each variant on these dimensions:
- hook_strength: does the hook grab attention in first 1.5s? concrete vs generic? appropriate length?
- caption_timing: do caption segments align with spoken words? reading speed OK? no overlaps?
- style_alignment: do hook/captions match voice_descriptor and humor_profile?
- trim_quality: do trim_start/trim_end land on natural beats (reaction, punchline)?

Then score the SET of 3 variants together on:
- variant_diversity: are A/B/C distinct (different templates, hook angles, pacing)?

Return STRICT JSON with no prose. Schema:
{
  "variant_scores": [{
    "variant_label": "A" | "B" | "C",
    "scores": {
      "hook_strength": 1-10,
      "caption_timing": 1-10,
      "style_alignment": 1-10,
      "trim_quality": 1-10
    },
    "comments": "string (max 200 chars)"
  }],
  "set_scores": { "variant_diversity": 1-10 },
  "notes": "string (max 300 chars, optional)"
}`;

  const userPayload = {
    transcript: input.transcript.slice(0, 4000),
    duration_seconds: input.durationSeconds,
    style_profile: input.styleProfile,
    variants: input.variants.map((v) => ({
      label: v.label,
      hook_text: v.hook_text,
      template: v.template,
      caption_segments: v.caption_segments,
      trim_start: v.trim_start,
      trim_end: v.trim_end,
      reasoning: v.reasoning,
    })),
  };
  const userMessage = JSON.stringify(userPayload);

  const estimate = estimateAnthropicCents({
    model: JUDGE_MODEL,
    inputChars: system.length + userMessage.length,
    maxTokens: MAX_TOKENS,
  });
  await reserveOrThrow('anthropic', estimate);

  const res = await anth().messages.create({
    model: JUDGE_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });
  const actual = actualAnthropicCents({
    model: JUDGE_MODEL,
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
  });
  await recordActualSpend('anthropic', actual, estimate);

  const text = res.content.map((b) => ('text' in b ? b.text : '')).join('').trim();
  const parsed = JSON.parse(extractJson(text)) as {
    variant_scores: VariantScore[];
    set_scores?: { variant_diversity?: number };
    notes?: string;
  };

  const setDiversity = parsed.set_scores?.variant_diversity ?? 5;
  const median: DimensionScores = {
    hook_strength: median1to10((parsed.variant_scores ?? []).map((v) => v.scores.hook_strength)),
    caption_timing: median1to10((parsed.variant_scores ?? []).map((v) => v.scores.caption_timing)),
    style_alignment: median1to10((parsed.variant_scores ?? []).map((v) => v.scores.style_alignment)),
    trim_quality: median1to10((parsed.variant_scores ?? []).map((v) => v.scores.trim_quality)),
    variant_diversity: setDiversity,
  };

  return {
    variant_scores: parsed.variant_scores ?? [],
    set_scores: { variant_diversity: setDiversity },
    median_scores: median,
    notes: parsed.notes,
  };
}

function median1to10(values: number[]): number {
  if (values.length === 0) return 0;
  const clamped = values.map((v) => clampScore(v));
  clamped.sort((a, b) => a - b);
  return clamped[Math.floor(clamped.length / 2)]!;
}

function clampScore(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 1) return 1;
  if (v > 10) return 10;
  return Math.round(v);
}
