#!/usr/bin/env tsx
// Manual eval runner.
//
// Loads JSON files from `eval/golden-clips/<EVAL_GOLDEN_SET_VERSION>/`,
// calls planVariants on each, judges the variants, writes one row per
// clip to public.eval_runs (kind='manual'), and prints a Markdown diff
// vs the previous manual run.
//
// Usage:
//   npm run eval
//   EVAL_GOLDEN_SET_VERSION=v2 npm run eval

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { config } from '../src/config.js';
import { judgeVariants, EVAL_DIMENSIONS, type DimensionScores } from '../src/lib/eval-judge.js';
import { logger } from '../src/lib/logger.js';
import { supabase } from '../src/lib/supabase.js';
import { planVariants } from '../src/pipeline/score.js';
import type { ChatContextEntry, StyleProfileRow, TranscriptSegment } from '../src/types/db.js';

interface GoldenClip {
  id: string;
  transcript: string;
  transcript_segments?: TranscriptSegment[];
  chat_context?: ChatContextEntry[];
  duration_seconds: number;
  style_profile?: Partial<StyleProfileRow> | null;
  ground_truth_notes?: string;
}

async function main(): Promise<void> {
  const version = config.EVAL_GOLDEN_SET_VERSION;
  const dir = join(process.cwd(), 'eval', 'golden-clips', version);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch (err) {
    console.error(`Could not read golden set at ${dir}: ${(err as Error).message}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`No golden clips found in ${dir}`);
    process.exit(1);
  }

  const gitSha = safeGitSha();
  const perClipResults: Array<{ id: string; median: DimensionScores; notes?: string }> = [];

  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf8');
    const clip = JSON.parse(text) as GoldenClip;
    logger.info({ clip_id: clip.id }, 'eval: planning variants');
    const scoring = await planVariants({
      transcript: clip.transcript,
      transcriptSegments: clip.transcript_segments ?? [],
      chatContext: clip.chat_context ?? [],
      styleProfile: (clip.style_profile ?? null) as StyleProfileRow | null,
      durationSeconds: clip.duration_seconds,
    });

    logger.info({ clip_id: clip.id }, 'eval: judging variants');
    const result = await judgeVariants({
      transcript: clip.transcript,
      durationSeconds: clip.duration_seconds,
      styleProfile: (clip.style_profile ?? null) as Parameters<typeof judgeVariants>[0]['styleProfile'],
      variants: scoring.variants,
    });

    const { error } = await supabase()
      .from('eval_runs')
      .insert({
        kind: 'manual',
        golden_set_version: version,
        git_sha: gitSha,
        clip_id: null,
        user_id: null,
        scoring_input: {
          transcript: clip.transcript.slice(0, 2000),
          duration_seconds: clip.duration_seconds,
          chat_context_count: (clip.chat_context ?? []).length,
          style_profile_present: clip.style_profile != null,
        },
        variants: scoring.variants,
        median_scores: result.median_scores,
        per_variant_scores: result.variant_scores,
        notes: `golden:${clip.id}${result.notes ? ` | ${result.notes}` : ''}`,
      });
    if (error) {
      logger.warn({ err: error.message, clip_id: clip.id }, 'eval: insert failed');
    }

    perClipResults.push({ id: clip.id, median: result.median_scores, notes: result.notes });
  }

  const overallMedian = aggregateMedian(perClipResults.map((r) => r.median));

  const prior = await loadPriorManualMedian(version, gitSha);
  printMarkdown({ version, gitSha, perClipResults, overallMedian, prior });
}

function aggregateMedian(rows: DimensionScores[]): DimensionScores {
  const out = {
    hook_strength: 0,
    caption_timing: 0,
    variant_diversity: 0,
    style_alignment: 0,
    trim_quality: 0,
  } as DimensionScores;
  if (rows.length === 0) return out;
  for (const dim of EVAL_DIMENSIONS) {
    const values = rows.map((r) => r[dim]).sort((a, b) => a - b);
    out[dim] = values[Math.floor(values.length / 2)]!;
  }
  return out;
}

async function loadPriorManualMedian(
  version: string,
  excludeSha: string | null,
): Promise<DimensionScores | null> {
  const query = supabase()
    .from('eval_runs')
    .select('median_scores, git_sha, run_at')
    .eq('kind', 'manual')
    .eq('golden_set_version', version)
    .order('run_at', { ascending: false })
    .limit(50);
  const { data } = await query;
  if (!data || data.length === 0) return null;
  const rows = data
    .filter((r) => !excludeSha || r.git_sha !== excludeSha)
    .map((r) => r.median_scores)
    .filter((m): m is DimensionScores => m != null);
  if (rows.length === 0) return null;
  return aggregateMedian(rows);
}

function safeGitSha(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function printMarkdown(opts: {
  version: string;
  gitSha: string | null;
  perClipResults: Array<{ id: string; median: DimensionScores; notes?: string }>;
  overallMedian: DimensionScores;
  prior: DimensionScores | null;
}): void {
  const lines: string[] = [];
  lines.push(`# Eval run — ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Golden set: \`${opts.version}\`   Git: \`${opts.gitSha ?? 'unknown'}\``);
  lines.push(`Clips judged: **${opts.perClipResults.length}**`);
  lines.push('');
  lines.push('## Median across dimensions');
  lines.push('');
  lines.push('| dimension | this run | prior | delta |');
  lines.push('|---|---|---|---|');
  for (const dim of EVAL_DIMENSIONS) {
    const cur = opts.overallMedian[dim];
    const prior = opts.prior?.[dim];
    const delta = prior != null ? cur - prior : null;
    const flag = delta == null ? '—' : delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
    lines.push(`| ${dim} | ${cur} | ${prior ?? '—'} | ${flag} |`);
  }
  lines.push('');
  lines.push('## Per clip');
  lines.push('');
  for (const r of opts.perClipResults) {
    lines.push(`- **${r.id}** — ${EVAL_DIMENSIONS.map((d) => `${d}=${r.median[d]}`).join(', ')}${r.notes ? `  \n  _${r.notes}_` : ''}`);
  }
  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
