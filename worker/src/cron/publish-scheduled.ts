// Cron is implemented as an Inngest scheduled function in
// `src/inngest/functions/post-scheduled-publisher.ts` (postScheduledCron).
// This file re-exports it so the layout stays aligned with §4 of the brief.

export { postScheduledCron as publishScheduledCron } from '../inngest/functions/post-scheduled-publisher.js';
