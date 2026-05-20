import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client) return client;
  client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-clipper-service': 'worker' } },
  });
  return client;
}
