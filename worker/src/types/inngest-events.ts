import type { Platform, StreamSource } from './db.js';

export interface ClipManualRequestedData {
  clip_id: string;
  source: StreamSource;
  stream_id: string | null;
  requested_at: string;
  client?: { tz?: string; ua?: string };
  trigger_metadata: {
    kind: 'button_tap' | 'chat_spike' | 'auto';
    from_lock_screen?: boolean;
    latency_target_ms?: number;
    [k: string]: unknown;
  };
}

export interface ClipCreatedData {
  clip_id: string;
}

export interface ClipEditCompleteData {
  clip_id: string;
  draft_ids: string[];
}

export interface DraftApprovedData {
  draft_id: string;
  clip_id: string;
  caption?: string;
  platforms: Platform[];
  post_ids: string[];
}

export interface DraftRejectedData {
  draft_id: string;
  clip_id: string;
  reject_reason: string;
}

export interface PostPublishNowData {
  draft_id: string;
  platforms: Platform[];
}

export interface PostScheduledData {
  draft_id: string;
  schedule_for: string;
  platforms: Platform[];
}

export interface StyleProfileUpdatedData {
  user_id: string;
  fields_changed: string[];
}

export type IngestSource = 'streaming' | 'social' | 'full';
export type IngestPlatform = Platform | 'twitch' | 'kick';
export type IngestReason = 'oauth_connect' | 'weekly_cron' | 'manual';

export interface ProfileIngestRequestedData {
  user_id: string;
  source: IngestSource;
  platform?: IngestPlatform;
  reason: IngestReason;
}

export type ReferenceClassification = 'self' | 'reference' | 'aspirational';
export type HandlePlatform = 'tiktok' | 'youtube';

export interface ProfileReferencesAddedData {
  user_id: string;
  urls?: string[];
  handles?: Array<{ platform: HandlePlatform; handle: string }>;
  classification: ReferenceClassification;
}

export interface MetricsPostCheckData {
  post_id: string;
}

export interface MetricsPostScoredData {
  post_id: string;
  user_id: string;
  draft_id: string;
  platform: Platform;
  views: number;
  performance_percentile: number;
}

export interface EvalSampleRecordedData {
  clip_id: string;
  user_id: string;
  golden_set_version: string;
  scoring_input: {
    transcript: string;
    duration_seconds: number;
    chat_context_count: number;
    style_profile_present: boolean;
  };
  variants: unknown;
}

export type InngestEvents = {
  'clip/manual.requested': { data: ClipManualRequestedData; user: { id: string } };
  'clip/created': { data: ClipCreatedData };
  'clip/edit.complete': { data: ClipEditCompleteData };
  'draft/approved': { data: DraftApprovedData; user: { id: string } };
  'draft/rejected': { data: DraftRejectedData; user: { id: string } };
  'post/publish.now': { data: PostPublishNowData; user: { id: string } };
  'post/scheduled': { data: PostScheduledData; user: { id: string } };
  'style_profile/updated': { data: StyleProfileUpdatedData };
  'profile/ingest.requested': { data: ProfileIngestRequestedData };
  'profile/references.added': { data: ProfileReferencesAddedData };
  'metrics/post.check': { data: MetricsPostCheckData };
  'metrics/post.scored': { data: MetricsPostScoredData };
  'eval/sample.recorded': { data: EvalSampleRecordedData };
};
