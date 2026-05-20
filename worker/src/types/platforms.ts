import type { Platform } from './db.js';

export interface PostVideoOpts {
  videoUrl: string;
  caption: string;
  accessToken: string;
  refreshToken?: string | null;
  accountId: string;
}

export interface PostVideoResult {
  externalPostId: string;
  externalUrl: string;
}

export interface PlatformAdapter {
  platform: Platform;
  postVideo(opts: PostVideoOpts): Promise<PostVideoResult>;
}

export interface OAuthExchangeResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  accountId: string;
  accountUsername: string;
}
