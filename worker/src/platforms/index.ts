import type { Platform } from '../types/db.js';
import type { PlatformAdapter } from '../types/platforms.js';
import { tiktokAdapter } from './tiktok.js';
import { youtubeShortsAdapter } from './youtube-shorts.js';
import { instagramReelsAdapter } from './instagram-reels.js';
import { xAdapter } from './x.js';

export function getAdapter(platform: Platform): PlatformAdapter {
  switch (platform) {
    case 'tiktok':
      return tiktokAdapter;
    case 'youtube_shorts':
      return youtubeShortsAdapter;
    case 'instagram_reels':
      return instagramReelsAdapter;
    case 'x':
      return xAdapter;
  }
}

export type { PlatformAdapter, PostVideoOpts, PostVideoResult } from '../types/platforms.js';
