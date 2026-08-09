-- Phase 14: Wakeup configuration + trigger logs
--
-- Every bound enforced here mirrors WAKEUP_LIMITS in src/lib/types/wakeup.ts.
-- The API route validates the same rules, but PostgREST is reachable directly
-- from the browser with the user's Clerk token, so the route is a convenience
-- layer and the database is the actual enforcement point. A config fans out
-- into one upstream Cloud Code API call per (account x model) pair, so the
-- cardinality caps below are an abuse control, not cosmetics.

-- Element-level validation for the TEXT[] columns. CHECK constraints cannot
-- contain subqueries and reject non-IMMUTABLE expressions (which rules out
-- array_to_string / array_out casts, both only STABLE), so the per-element
-- rules live in IMMUTABLE helpers instead.
CREATE OR REPLACE FUNCTION public.is_time_of_day_array(p_values TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT p_values IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(p_values) AS t(value)
        WHERE t.value IS NULL
           OR t.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      );
$$;

COMMENT ON FUNCTION public.is_time_of_day_array(TEXT[]) IS
  'True when every element is a 24h HH:MM string. Mirrors isValidTimeOfDay() in src/lib/wakeup/time-of-day.ts.';

CREATE OR REPLACE FUNCTION public.is_bounded_text_array(
  p_values TEXT[],
  p_max_element_length INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT p_values IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(p_values) AS t(value)
        WHERE t.value IS NULL
           OR length(btrim(t.value)) = 0
           OR length(t.value) > p_max_element_length
      );
$$;

COMMENT ON FUNCTION public.is_bounded_text_array(TEXT[], INTEGER) IS
  'True when every element is non-blank and at most p_max_element_length characters.';

-- NOT NULL on every column with a default is load-bearing, not tidiness: a
-- CHECK evaluates to NULL (and therefore passes) when its column is NULL, so a
-- direct PostgREST write of {"schedule_mode": null, "interval_hours": null}
-- would slip past every constraint below and land values that the
-- `Database` TypeScript type declares non-nullable.
CREATE TABLE IF NOT EXISTS public.wakeup_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  selected_models TEXT[] NOT NULL
    DEFAULT ARRAY['claude-sonnet-4-5', 'gemini-3-flash', 'gemini-3-pro-low']::TEXT[]
    CHECK (cardinality(selected_models) <= 16)
    CHECK (public.is_bounded_text_array(selected_models, 64)),
  selected_account_ids UUID[] NOT NULL DEFAULT '{}'::UUID[]
    CHECK (cardinality(selected_account_ids) <= 50),
  schedule_mode TEXT NOT NULL DEFAULT 'interval'
    CHECK (schedule_mode IN ('interval', 'daily', 'custom')),
  interval_hours INTEGER NOT NULL DEFAULT 6
    CHECK (interval_hours BETWEEN 1 AND 168),
  daily_times TEXT[] NOT NULL DEFAULT ARRAY['09:00', '15:00', '21:00']::TEXT[]
    CHECK (cardinality(daily_times) <= 12)
    CHECK (public.is_time_of_day_array(daily_times)),
  cron_expression TEXT
    CHECK (cron_expression IS NULL OR length(cron_expression) <= 100),
  custom_prompt TEXT NOT NULL DEFAULT 'hi'
    CHECK (length(btrim(custom_prompt)) > 0 AND length(custom_prompt) <= 2000),
  max_output_tokens INTEGER NOT NULL DEFAULT 1
    CHECK (max_output_tokens BETWEEN 1 AND 8192),
  cooldown_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (cooldown_minutes BETWEEN 0 AND 1440),
  wake_on_reset BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A schedule must actually be resolvable in the mode it claims, otherwise
  -- the scheduler stores a config that can never produce a next trigger time.
  CONSTRAINT wakeup_configs_custom_needs_cron
    CHECK (schedule_mode <> 'custom' OR cron_expression IS NOT NULL),
  CONSTRAINT wakeup_configs_daily_needs_times
    CHECK (schedule_mode <> 'daily' OR cardinality(daily_times) > 0)
);

CREATE TABLE IF NOT EXISTS public.wakeup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  account_id UUID REFERENCES public.google_accounts(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  trigger_source TEXT NOT NULL
    CHECK (trigger_source IN ('manual', 'scheduled', 'quota_reset')),
  success BOOLEAN NOT NULL,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error TEXT,
  response_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No standalone index on wakeup_configs.clerk_user_id: the UNIQUE constraint
-- already provides one, and a duplicate would only add write amplification.

CREATE INDEX IF NOT EXISTS idx_wakeup_logs_time
  ON public.wakeup_logs (clerk_user_id, created_at DESC);

-- Postgres does not index foreign keys automatically. Without this, the
-- ON DELETE CASCADE fired by delete_account_with_tokens (migration 005) has to
-- sequentially scan wakeup_logs, holding locks, on every account removal.
CREATE INDEX IF NOT EXISTS idx_wakeup_logs_account
  ON public.wakeup_logs (account_id);

ALTER TABLE public.wakeup_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wakeup_logs ENABLE ROW LEVEL SECURITY;

-- Per-operation policies instead of FOR ALL, matching the least-privilege
-- convention established in migration 006. `requesting_user_id()` is wrapped
-- in a scalar SELECT so the planner hoists it into an InitPlan and evaluates it
-- once per statement rather than once per row, and it is schema-qualified so
-- the policy does not depend on the caller's search_path.
DROP POLICY IF EXISTS "Users manage own wakeup config" ON public.wakeup_configs;
DROP POLICY IF EXISTS "Users can read their own wakeup config" ON public.wakeup_configs;
DROP POLICY IF EXISTS "Users can insert their own wakeup config" ON public.wakeup_configs;
DROP POLICY IF EXISTS "Users can update their own wakeup config" ON public.wakeup_configs;

CREATE POLICY "Users can read their own wakeup config" ON public.wakeup_configs
  FOR SELECT TO authenticated
  USING ((SELECT public.requesting_user_id()) = clerk_user_id);

CREATE POLICY "Users can insert their own wakeup config" ON public.wakeup_configs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.requesting_user_id()) = clerk_user_id);

CREATE POLICY "Users can update their own wakeup config" ON public.wakeup_configs
  FOR UPDATE TO authenticated
  USING ((SELECT public.requesting_user_id()) = clerk_user_id)
  WITH CHECK ((SELECT public.requesting_user_id()) = clerk_user_id);

-- No DELETE policy: the app upserts a single config row per user and never
-- removes it. Deletion is reserved for service_role (which bypasses RLS).

-- wakeup_logs is an append-only audit trail. Users may read their own entries
-- and append new ones (the manual "trigger now" flow runs under the user's
-- token), but must not rewrite or erase history. The INSERT check also pins
-- account_id to an account the user actually owns -- checking clerk_user_id
-- alone would let a user attribute a log row to someone else's account.
DROP POLICY IF EXISTS "Users manage own wakeup logs" ON public.wakeup_logs;
DROP POLICY IF EXISTS "Users can read their own wakeup logs" ON public.wakeup_logs;
DROP POLICY IF EXISTS "Users can insert their own wakeup logs" ON public.wakeup_logs;

CREATE POLICY "Users can read their own wakeup logs" ON public.wakeup_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.requesting_user_id()) = clerk_user_id);

CREATE POLICY "Users can insert their own wakeup logs" ON public.wakeup_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.requesting_user_id()) = clerk_user_id
    AND (
      account_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.google_accounts ga
        WHERE ga.id = wakeup_logs.account_id
          AND ga.clerk_user_id = (SELECT public.requesting_user_id())
      )
    )
  );

-- A table-level GRANT is what actually exposes UPDATE/DELETE to PostgREST;
-- omitting the policies is not enough on its own to make the intent explicit.
REVOKE UPDATE, DELETE ON public.wakeup_logs FROM authenticated;
REVOKE DELETE ON public.wakeup_configs FROM authenticated;

-- search_path is pinned so the function body cannot be hijacked by a caller
-- who prepends a schema of their own (Supabase linter: function_search_path_mutable).
CREATE OR REPLACE FUNCTION public.set_wakeup_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_wakeup_updated_at ON public.wakeup_configs;
CREATE TRIGGER set_wakeup_updated_at
  BEFORE UPDATE ON public.wakeup_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_wakeup_updated_at();
