-- supabase/migrations/009_wakeup.sql
--
-- Wakeup configuration + execution logs
-- Phase 14: Wakeup Configuration UI & Storage
--
-- Design notes:
--   * Every column that carries a DEFAULT is also NOT NULL. The generated
--     Database["public"]["Tables"] Row types declare these fields non-nullable,
--     and `cooldown_minutes` in particular is read by claim_wakeup_run(): a NULL
--     there would make the cooldown predicate evaluate to NULL and wedge the
--     user's wakeup permanently.
--   * The app validates ranges in src/lib/wakeup/config.ts, but the service-role
--     client bypasses that path entirely and the anon key + a Clerk token can
--     reach PostgREST straight from the browser (src/lib/supabase/client.ts).
--     The CHECK constraints below are the authoritative bound.
--   * Policies are per-command rather than FOR ALL, matching the hardening done
--     in migration 006. Neither table may be UPDATEd or DELETEd freely by the
--     owner: wakeup_logs is an append-only audit trail, and wakeup_configs has
--     cooldown state (added in 010) that a user must not be able to clear.

CREATE TABLE public.wakeup_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  selected_models TEXT[] NOT NULL
    DEFAULT '{claude-sonnet-4-5,gemini-3-flash,gemini-3-pro-low}',
  selected_account_ids UUID[] NOT NULL DEFAULT '{}',
  schedule_mode TEXT NOT NULL DEFAULT 'interval'
    CHECK (schedule_mode IN ('interval', 'daily', 'custom')),
  interval_hours INTEGER NOT NULL DEFAULT 6
    CHECK (interval_hours BETWEEN 1 AND 24),
  daily_times TEXT[] NOT NULL DEFAULT '{09:00,15:00,21:00}',
  cron_expression TEXT
    CHECK (cron_expression IS NULL OR char_length(cron_expression) <= 120),
  custom_prompt TEXT NOT NULL DEFAULT 'hi'
    CHECK (char_length(custom_prompt) BETWEEN 1 AND 1000),
  max_output_tokens INTEGER NOT NULL DEFAULT 1
    CHECK (max_output_tokens BETWEEN 1 AND 8192),
  cooldown_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (cooldown_minutes BETWEEN 1 AND 1440),
  wake_on_reset BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Each (account x model) pair becomes a sequential upstream request, so the
  -- cardinality of these arrays is a work-amplification bound, not just storage.
  CONSTRAINT wakeup_configs_models_bounded
    CHECK (cardinality(selected_models) BETWEEN 1 AND 20),
  CONSTRAINT wakeup_configs_accounts_bounded
    CHECK (cardinality(selected_account_ids) <= 50),
  CONSTRAINT wakeup_configs_daily_times_bounded
    CHECK (cardinality(daily_times) <= 48),
  -- Cheap whole-array format check: no subqueries are allowed in CHECK, so the
  -- elements are validated as one joined string.
  CONSTRAINT wakeup_configs_daily_times_format
    CHECK (
      cardinality(daily_times) = 0
      OR array_to_string(daily_times, ',') ~
         '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$'
    ),
  -- 'custom' mode is meaningless without an expression to evaluate.
  CONSTRAINT wakeup_configs_custom_requires_cron
    CHECK (schedule_mode <> 'custom' OR cron_expression IS NOT NULL)
);

CREATE TABLE public.wakeup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  account_id UUID REFERENCES public.google_accounts(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  trigger_source TEXT NOT NULL
    CHECK (trigger_source IN ('manual', 'scheduled', 'quota_reset')),
  success BOOLEAN NOT NULL,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  -- Upstream failures can carry a whole HTML error body; bound what an
  -- append-only, user-writable table can be made to store per row.
  error TEXT CHECK (error IS NULL OR char_length(error) <= 2000),
  response_preview TEXT
    CHECK (response_preview IS NULL OR char_length(response_preview) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leading column matches the RLS predicate (clerk_user_id) so policy filtering
-- and the "recent runs" listing share one index.
CREATE INDEX idx_wakeup_logs_time
  ON public.wakeup_logs (clerk_user_id, created_at DESC);
-- Indexes the FK: required for a fast ON DELETE CASCADE from google_accounts.
CREATE INDEX idx_wakeup_logs_account
  ON public.wakeup_logs (account_id, created_at DESC);

-- updated_at is owned by the database, not the caller: an app-supplied
-- timestamp is subject to client clock skew and can be forged by anyone
-- holding the anon key.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER wakeup_configs_set_updated_at
  BEFORE INSERT OR UPDATE ON public.wakeup_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Row Level Security: every row is owned by a single Clerk user.
ALTER TABLE public.wakeup_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wakeup_logs ENABLE ROW LEVEL SECURITY;

-- requesting_user_id() is wrapped in a scalar subquery so Postgres evaluates it
-- once per statement (initplan) instead of once per candidate row.
CREATE POLICY "Users can read their own wakeup config"
  ON public.wakeup_configs
  FOR SELECT TO authenticated
  USING ((SELECT public.requesting_user_id()) = clerk_user_id);

CREATE POLICY "Users can insert their own wakeup config"
  ON public.wakeup_configs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.requesting_user_id()) = clerk_user_id);

CREATE POLICY "Users can update their own wakeup config"
  ON public.wakeup_configs
  FOR UPDATE TO authenticated
  USING ((SELECT public.requesting_user_id()) = clerk_user_id)
  WITH CHECK ((SELECT public.requesting_user_id()) = clerk_user_id);

-- No DELETE policy: the config row is a per-user singleton kept in sync by
-- upsert, and dropping it would also drop the cooldown state added in 010.
--
-- Column-level UPDATE grants restrict which fields a user may write directly.
-- A column-level REVOKE does not override a table-level GRANT, so the
-- table-level privilege is revoked first (same technique as migration 006).
-- Columns deliberately omitted: id, updated_at (trigger-owned) and, once
-- migration 010 adds it, last_run_started_at — a user who could zero that
-- column would clear their own cooldown and re-fire wakeups at will.
REVOKE UPDATE, DELETE ON public.wakeup_configs FROM authenticated;
GRANT UPDATE (
  clerk_user_id,
  enabled,
  selected_models,
  selected_account_ids,
  schedule_mode,
  interval_hours,
  daily_times,
  cron_expression,
  custom_prompt,
  max_output_tokens,
  cooldown_minutes,
  wake_on_reset
) ON public.wakeup_configs TO authenticated;

-- wakeup_logs is an append-only audit trail: readable and insertable by its
-- owner, never mutable or removable (rows only disappear via the FK cascade
-- when the underlying Google account is deleted).
CREATE POLICY "Users can read their own wakeup logs"
  ON public.wakeup_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.requesting_user_id()) = clerk_user_id);

CREATE POLICY "Users can insert their own wakeup logs"
  ON public.wakeup_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.requesting_user_id()) = clerk_user_id
    AND (
      account_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.google_accounts
        WHERE google_accounts.id = wakeup_logs.account_id
          AND google_accounts.clerk_user_id = (SELECT public.requesting_user_id())
      )
    )
  );

REVOKE UPDATE, DELETE ON public.wakeup_logs FROM authenticated;

-- Neither table has an anon-facing policy; drop the default grants too so an
-- unauthenticated anon key cannot even probe them.
REVOKE ALL ON public.wakeup_configs FROM anon;
REVOKE ALL ON public.wakeup_logs FROM anon;
