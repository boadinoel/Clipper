import { supabase } from '../../lib/supabase.js';
import type {
  ReferencePending,
  StyleProfileRow,
} from '../../types/db.js';
import { inngest } from '../client.js';

export const profileReferencesAdded = inngest.createFunction(
  {
    id: 'profile-references-added',
    name: 'Profile — references added (queue + trigger ingest)',
    retries: 2,
  },
  { event: 'profile/references.added' },
  async ({ event, step, logger }) => {
    const { user_id, urls, handles, classification } = event.data;

    const queued = await step.run('queue-pending', async () => {
      const { data: profile } = await supabase()
        .from('style_profiles')
        .select('reference_pending')
        .eq('user_id', user_id)
        .maybeSingle();

      const current: ReferencePending =
        ((profile as Pick<StyleProfileRow, 'reference_pending'> | null)?.reference_pending ??
          {}) as ReferencePending;
      const nextUrls = mergeUrls(current.urls, urls, classification);
      const nextHandles = mergeHandles(current.handles, handles, classification);

      const pending: ReferencePending = { urls: nextUrls, handles: nextHandles };

      if (profile) {
        const { error } = await supabase()
          .from('style_profiles')
          .update({ reference_pending: pending })
          .eq('user_id', user_id);
        if (error) throw new Error(`queue pending update: ${error.message}`);
      } else {
        const { error } = await supabase()
          .from('style_profiles')
          .insert({ user_id, reference_pending: pending });
        if (error) throw new Error(`queue pending insert: ${error.message}`);
      }
      return { urlCount: nextUrls.length, handleCount: nextHandles.length };
    });

    await step.sendEvent('chain-ingest', {
      name: 'profile/ingest.requested',
      data: { user_id, source: 'full', reason: 'manual' },
    });

    logger.info({ user_id, classification, ...queued }, 'references queued, ingest chained');
    return queued;
  },
);

function mergeUrls(
  existing: ReferencePending['urls'],
  add: string[] | undefined,
  classification: 'self' | 'reference' | 'aspirational',
): NonNullable<ReferencePending['urls']> {
  const out = [...(existing ?? [])];
  const seen = new Set(out.map((u) => u.url));
  for (const url of add ?? []) {
    const clean = url.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push({ url: clean, classification });
  }
  return out;
}

function mergeHandles(
  existing: ReferencePending['handles'],
  add: Array<{ platform: 'tiktok' | 'youtube'; handle: string }> | undefined,
  classification: 'self' | 'reference' | 'aspirational',
): NonNullable<ReferencePending['handles']> {
  const out = [...(existing ?? [])];
  const key = (p: string, h: string): string => `${p}:${h.toLowerCase()}`;
  const seen = new Set(out.map((h) => key(h.platform, h.handle)));
  for (const h of add ?? []) {
    const clean = h.handle.trim().replace(/^@/, '');
    if (!clean) continue;
    if (seen.has(key(h.platform, clean))) continue;
    seen.add(key(h.platform, clean));
    out.push({ platform: h.platform, handle: clean, classification });
  }
  return out;
}
