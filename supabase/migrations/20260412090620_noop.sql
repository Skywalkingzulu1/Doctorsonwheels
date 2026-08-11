-- No-op: this migration was applied directly on the remote database before
-- local version tracking was restored. It is declared locally so that
-- `supabase db push` sees a matching migration history and only applies
-- pending migrations.
SELECT 1;
