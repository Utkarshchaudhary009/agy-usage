-- Supabase Realtime: expose the tables the dashboard subscribes to.
--
-- quota_cache drives live quota updates (written by user-facing requests and,
-- since Phase 18, by the Inngest polling path); wakeup_logs drives live
-- trigger notifications. Both tables already carry per-user SELECT RLS
-- policies, so postgres_changes payloads are only delivered to the owning
-- user's subscribed channels.
--
-- Default replica identity (primary key) is sufficient: quota_cache's PK is
-- account_id and wakeup_logs' PK is id, which are the only old-row fields the
-- clients filter on.

ALTER PUBLICATION supabase_realtime ADD TABLE public.quota_cache;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wakeup_logs;
