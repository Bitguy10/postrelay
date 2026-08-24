// Environment access. The Supabase anon key is Prompted's own public key,
// extracted from their frontend bundle — Supabase designs anon keys for
// client-side exposure, so (like Prompted itself) embedding it is safe.
// PROMPTED_SUPABASE_ANON_KEY overrides it if Prompted ever rotates the key.

export const PROMPTED_SUPABASE_URL = "https://hgzkeaicuxvqsiacqnul.supabase.co";

export const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnemtlYWljdXh2cXNpYWNxbnVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMzQ3NDcsImV4cCI6MjA4NDcxMDc0N30.V2VQe0YAfqmVJZ5V2il22b6SGtFnAi7yJDbSSUjJZ4M";

export const anonKey = (): string =>
  process.env.PROMPTED_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

// Reads the PostRelay-era name first; falls back to the original name
// so deployments from before the rename keep working.
export const encryptionKeySecret = (): string =>
  process.env.POSTRELAY_ENCRYPTION_KEY || process.env.CADENCE_ENCRYPTION_KEY || "";

export const cronSecret = (): string => process.env.CRON_SECRET || "";

export const redisConfigured = (): boolean =>
  Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
