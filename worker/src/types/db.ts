// Hand-written shape matching the production Supabase schema documented in
// the Frontend Handoff. Replace with output of `npm run gen:db-types` once
// the Supabase CLI is linked to the project.

export type StreamSource = 'twitch' | 'kick';
export type ClipTrigger = 'manual' | 'auto';
export type ClipStatus = 'pending_edit' | 'editing' | 'ready' | 'failed';
export type DraftStatus = 'rendering' | 'ready' | 'approved' | 'rejected' | 'failed';
export type PostStatus = 'scheduled' | 'posting' | 'posted' | 'failed';
export type UserTier = 'free' | 'pro';
export type Platform = 'tiktok' | 'youtube_shorts' | 'instagram_reels' | 'x';
export type VariantLabel = 'A' | 'B' | 'C';

export interface UserRow {
  id: string;
  email: string;
  tier: UserTier;
  onboarding_complete: boolean;
  primary_stream_source: StreamSource;

  twitch_user_id: string | null;
  twitch_login: string | null;
  twitch_display_name: string | null;
  twitch_access_token_encrypted: string | null;
  twitch_refresh_token_encrypted: string | null;
  twitch_token_expires_at: string | null;
  profile_image_url: string | null;

  kick_user_id: string | null;
  kick_login: string | null;
  kick_display_name: string | null;
  kick_access_token_encrypted: string | null;
  kick_refresh_token_encrypted: string | null;
  kick_token_expires_at: string | null;
  kick_profile_image_url: string | null;

  created_at: string;
  updated_at: string;
}

export interface StreamRow {
  id: string;
  user_id: string;
  source: StreamSource;
  twitch_stream_id: string | null;
  kick_stream_id: string | null;
  title: string | null;
  game_name: string | null;
  started_at: string;
  ended_at: string | null;
  peak_viewers: number | null;
  created_at: string;
}

export interface ChatContextEntry {
  ts: string;
  user: string;
  message: string;
  emotes?: string[];
}

export interface ClipRow {
  id: string;
  user_id: string;
  stream_id: string | null;
  source: StreamSource;
  trigger_type: ClipTrigger;
  trigger_metadata: Record<string, unknown> | null;
  status: ClipStatus;
  twitch_clip_id: string | null;
  twitch_clip_url: string | null;
  raw_mp4_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  vod_offset_seconds: number | null;
  transcript: string | null;
  transcript_segments: TranscriptSegment[] | null;
  chat_context: ChatContextEntry[] | null;
  created_at: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: Array<{ start: number; end: number; word: string }>;
}

export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface ZoomMoment {
  at: number;
  duration: number;
  intensity: number;
}

export interface EditConfig {
  template: 'BoldCaption' | 'MemePop' | 'MinimalBottom';
  trim_start: number;
  trim_end: number;
  zoom_moments: ZoomMoment[];
  caption_segments: CaptionSegment[];
  reasoning?: string;
}

export interface DraftRow {
  id: string;
  clip_id: string;
  user_id: string;
  variant_label: VariantLabel;
  status: DraftStatus;
  edit_config: EditConfig | null;
  caption_data: CaptionSegment[] | null;
  hook_text: string | null;
  output_mp4_url: string | null;
  output_thumbnail_url: string | null;
  output_duration_seconds: number | null;
  approved_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export interface PostRow {
  id: string;
  draft_id: string;
  user_id: string;
  platform: Platform;
  caption: string | null;
  scheduled_for: string | null;
  posted_at: string | null;
  external_post_id: string | null;
  external_url: string | null;
  status: PostStatus;
  error_message: string | null;
  metrics: Record<string, unknown> | null;
  created_at: string;
}

export interface PlatformConnectionRow {
  id: string;
  user_id: string;
  platform: Platform;
  account_id: string;
  account_username: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  user_agent: string | null;
  created_at: string;
}

export interface ChatEventRow {
  id: string;
  user_id: string;
  stream_id: string | null;
  source: StreamSource;
  channel: string;
  sender: string;
  message: string;
  emotes: string[] | null;
  sent_at: string;
  created_at: string;
}

export interface LearnedPreferences {
  template_weights?: Record<string, number>;
  caption_length_preference?: 'short' | 'medium' | 'long';
  hook_patterns_liked?: string[];
  hook_patterns_disliked?: string[];
  updated_at?: string;
}

export interface StyleProfileRow {
  id: string;
  user_id: string;
  brand_primary_color: string | null;
  brand_accent_color: string | null;
  brand_font: string | null;
  caption_style_preset: string | null;
  voice_descriptor: string | null;
  humor_quiz: Record<string, unknown> | null;
  reference_clip_urls: string[] | null;
  reference_clip_analysis: Record<string, unknown> | null;
  learned_preferences: LearnedPreferences | null;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      users: { Row: UserRow; Insert: Partial<UserRow>; Update: Partial<UserRow> };
      streams: { Row: StreamRow; Insert: Partial<StreamRow>; Update: Partial<StreamRow> };
      clips: { Row: ClipRow; Insert: Partial<ClipRow>; Update: Partial<ClipRow> };
      drafts: { Row: DraftRow; Insert: Partial<DraftRow>; Update: Partial<DraftRow> };
      posts: { Row: PostRow; Insert: Partial<PostRow>; Update: Partial<PostRow> };
      platform_connections: {
        Row: PlatformConnectionRow;
        Insert: Partial<PlatformConnectionRow>;
        Update: Partial<PlatformConnectionRow>;
      };
      push_subscriptions: {
        Row: PushSubscriptionRow;
        Insert: Partial<PushSubscriptionRow>;
        Update: Partial<PushSubscriptionRow>;
      };
      chat_events: {
        Row: ChatEventRow;
        Insert: Partial<ChatEventRow>;
        Update: Partial<ChatEventRow>;
      };
      style_profiles: {
        Row: StyleProfileRow;
        Insert: Partial<StyleProfileRow>;
        Update: Partial<StyleProfileRow>;
      };
    };
  };
}
