import { transcribeFile, type TranscriptionResult } from '../lib/whisper.js';

export async function transcribeClip(opts: {
  localMp4Path: string;
}): Promise<TranscriptionResult> {
  return transcribeFile({ localPath: opts.localMp4Path });
}
