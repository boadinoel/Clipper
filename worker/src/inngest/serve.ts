import { clipManualRequested } from './functions/clip-manual-requested.js';
import { clipEditPipeline } from './functions/clip-edit-pipeline.js';
import { draftApproved } from './functions/draft-approved.js';
import { draftRejected } from './functions/draft-rejected.js';
import { evalSampleJudge } from './functions/eval-sample-judge.js';
import { metricsPostCheck } from './functions/metrics-post-check.js';
import { metricsPostScored } from './functions/metrics-post-scored.js';
import { postPublishNow } from './functions/post-publish-now.js';
import {
  postScheduledAck,
  postScheduledCron,
} from './functions/post-scheduled-publisher.js';
import { profileIngest } from './functions/profile-ingest.js';
import { profileReferencesAdded } from './functions/profile-references-added.js';
import { pushFanOutOnEditComplete } from './functions/push-fan-out.js';
import { refreshTokensCron } from '../cron/refresh-tokens.js';
import { cleanupStorageCron } from '../cron/cleanup-storage.js';
import { evalRollupCron } from '../cron/eval-rollup.js';
import { metricsIngestCron } from '../cron/metrics-ingest.js';
import { refreshProfilesCron } from '../cron/refresh-profiles.js';

export const inngestFunctions = [
  clipManualRequested,
  clipEditPipeline,
  draftApproved,
  draftRejected,
  postPublishNow,
  postScheduledAck,
  postScheduledCron,
  pushFanOutOnEditComplete,
  refreshTokensCron,
  cleanupStorageCron,
  profileIngest,
  profileReferencesAdded,
  refreshProfilesCron,
  metricsIngestCron,
  metricsPostCheck,
  metricsPostScored,
  evalSampleJudge,
  evalRollupCron,
];
