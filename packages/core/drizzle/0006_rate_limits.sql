-- Shared rate-limit counters (fixed window). UNLOGGED: fast, and losing the
-- counters on a crash is harmless. RLS on with no policy: only the owner
-- connection (system code) can touch it; the app role and Supabase anon can't.
CREATE UNLOGGED TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);
