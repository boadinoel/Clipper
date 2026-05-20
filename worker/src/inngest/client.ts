import { EventSchemas, Inngest } from 'inngest';
import { config } from '../config.js';
import type { InngestEvents } from '../types/inngest-events.js';

export const inngest = new Inngest({
  id: config.INNGEST_APP_ID,
  eventKey: config.INNGEST_EVENT_KEY,
  schemas: new EventSchemas().fromRecord<InngestEvents>(),
});
