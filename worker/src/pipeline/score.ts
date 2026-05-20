import { scoreClipAndPlanVariants, type ScoringResult } from '../lib/anthropic.js';
import type {
  ChatContextEntry,
  StyleProfileRow,
  TranscriptSegment,
} from '../types/db.js';

export interface ScoreInput {
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  chatContext: ChatContextEntry[];
  styleProfile: StyleProfileRow | null;
  durationSeconds: number;
}

export async function planVariants(input: ScoreInput): Promise<ScoringResult> {
  return scoreClipAndPlanVariants(input);
}
