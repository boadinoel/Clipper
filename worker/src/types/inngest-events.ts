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

export type InngestEvents = {
  'clip/manual.requested': { data: ClipManualRequestedData; user: { id: string } };
  'clip/created': { data: ClipCreatedData };
  'clip/edit.complete': { data: ClipEditCompleteData };
  'draft/approved': { data: DraftApprovedData; user: { id: string } };
  'draft/rejected': { data: DraftRejectedData; user: { id: string } };
  'post/publish.now': { data: PostPublishNowData; user: { id: string } };
  'post/scheduled': { data: PostScheduledData; user: { id: string } };
  'style_profile/updated': { data: StyleProfileUpdatedData };
};
