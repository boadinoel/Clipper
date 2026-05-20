import { readFile } from 'node:fs/promises';
import { supabase } from './supabase.js';

const CLIPS_BUCKET = 'clips';
const DRAFTS_BUCKET = 'drafts';

export type Bucket = typeof CLIPS_BUCKET | typeof DRAFTS_BUCKET;

export async function uploadFile(opts: {
  bucket: Bucket;
  path: string;
  localPath?: string;
  body?: Buffer | Uint8Array;
  contentType: string;
  upsert?: boolean;
}): Promise<{ path: string }> {
  const body = opts.body ?? (await readFile(opts.localPath!));
  const { data, error } = await supabase()
    .storage.from(opts.bucket)
    .upload(opts.path, body, {
      contentType: opts.contentType,
      upsert: opts.upsert ?? true,
    });
  if (error) throw new Error(`storage.upload(${opts.bucket}/${opts.path}): ${error.message}`);
  return { path: data.path };
}

export async function getSignedUrl(opts: {
  bucket: Bucket;
  path: string;
  expiresInSeconds: number;
}): Promise<string> {
  const { data, error } = await supabase()
    .storage.from(opts.bucket)
    .createSignedUrl(opts.path, opts.expiresInSeconds);
  if (error) throw new Error(`storage.signedUrl: ${error.message}`);
  return data.signedUrl;
}

export async function getPublicUrl(opts: { bucket: Bucket; path: string }): Promise<string> {
  const { data } = supabase().storage.from(opts.bucket).getPublicUrl(opts.path);
  return data.publicUrl;
}

export async function deleteFile(opts: { bucket: Bucket; path: string }): Promise<void> {
  const { error } = await supabase().storage.from(opts.bucket).remove([opts.path]);
  if (error) throw new Error(`storage.delete: ${error.message}`);
}

export async function downloadToBuffer(opts: {
  bucket: Bucket;
  path: string;
}): Promise<Buffer> {
  const { data, error } = await supabase().storage.from(opts.bucket).download(opts.path);
  if (error) throw new Error(`storage.download: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export function clipRawPath(userId: string, clipId: string): { bucket: Bucket; path: string } {
  return { bucket: CLIPS_BUCKET, path: `${userId}/${clipId}/raw.mp4` };
}

export function clipThumbnailPath(
  userId: string,
  clipId: string,
): { bucket: Bucket; path: string } {
  return { bucket: CLIPS_BUCKET, path: `${userId}/${clipId}/thumbnail.jpg` };
}

export function draftMp4Path(
  userId: string,
  clipId: string,
  variant: string,
): { bucket: Bucket; path: string } {
  return { bucket: DRAFTS_BUCKET, path: `${userId}/${clipId}/draft-${variant}.mp4` };
}

export function draftThumbnailPath(
  userId: string,
  clipId: string,
  variant: string,
): { bucket: Bucket; path: string } {
  return { bucket: DRAFTS_BUCKET, path: `${userId}/${clipId}/draft-${variant}.jpg` };
}
