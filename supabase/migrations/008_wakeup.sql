-- supabase/migrations/008_wakeup.sql

-- Phase 14: Wakeup configuration + trigger logs.
-- The implementation plan calls this file 004_wakeup.sql, but 004-007 are
-- already taken, so it keeps the repository's sequential numbering instead.

CREATE TABLE public.wakeup_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  selected_models TEXT[] NOT NULL
    DEFAULT '{claude-sonnet-4-5,gemini-3-flash,gemini-3-pro-low}'::TEXT[],
  selected_account_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
  schedule_mode TEXT NOT NULL DEFAULT 'interval'
    CHECK (schedule_mode IN ('interval', 'daily', 'custom')),
  interval_hours INTEGER NOT NULL DEFAULT 6,
  daily_times TEXT[] NOT NULL DEFAULT '{09:00,15:00,21:00}'::TEXT[],
  cron_expression TEXT,
  custom_prompt TEXT NOT NULL DEFAULT 'hi',
  max_output_tokens INTEGER NOT NULL DEFAULT 1,
  cooldown_minutes INTEGER NOT NULL DEFAULT 60,
  wake_on_reset BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Defence in depth: the API validates every field, these bounds keep a
  -- direct/service-role write from persisting a schedule the engine cannot run.
  CONSTRAINT wakeup_configs_interval_hours_range
    CHECK (interval_hours BETWEEN 1 AND 24),
  CONSTRAINT wakeup_configs_max_output_tokens_range
    CHECK (max_output_tokens BETWEEN 1 AND 64),
  CONSTRAINT wakeup_configs_cooldown_minutes_range
    CHECK (cooldown_minutes BETWEEN 0 AND 1440),
  CONSTRAINT wakeup_configs_custom_prompt_length
    CHECK (char_length(custom_prompt) BETWEEN 1 AND 500),
  CONSTRAINT wakeup_configs_cron_expression_length
    CHECK (cron_expression IS NULL OR char_length(cron_expression) <= 120),
  -- A custom schedule is unrunnable without an expression.
  CONSTRAINT wakeup_configs_custom_requires_cron
    CHECK (schedule_mode <> 'custom' OR cron_expression IS NOT NULL),
  -- Bound the arrays so a single row cannot fan out into unbounded work.
  CONSTRAINT wakeup_configs_selected_models_bounds
    CHECK (cardinality(selected_models) <= 20),
  CONSTRAINT wakeup_configs_selected_account_ids_bounds
    CHECK (cardinality(selected_account_ids) <= 50),
  CONSTRAINT wakeup_configs_daily_times_bounds
    CHECK (cardinality(daily_times) <= 24),
  -- An enabled schedule must actually have something to trigger.
  CONSTRAINT wakeup_configs_enabled_requires_targets
    CHECK (
      NOT enabled
      OR (
        cardinality(selected_models) > 0
        AND cardinality(selected_account_ids) > 0
        AND (schedule_mode <> 'daily' OR cardinality(daily_times) > 0)
      )
    )
);

CREATE TABLE public.wakeup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  account_id UUID REFERENCES public.google_accounts(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  trigger_source TEXT NOT NULL
    CHECK (trigger_source IN ('manual', 'scheduled', 'quota_reset')),
  success BOOLEAN NOT NULL,
  duration_ms INTEGER,
  error TEXT,
  response_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Upstream error bodies can be large; cap them so a failing provider cannot
  -- balloon this table. Writers must truncate before inserting.
  CONSTRAINT wakeup_logs_error_length
    CHECK (error IS NULL OR char_length(error) <= 2000),
  CONSTRAINT wakeup_logs_response_preview_length
    CHECK (response_preview IS NULL OR char_length(response_preview) <= 500)
);

CREATE INDEX idx_wakeup_logs_time
  ON public.wakeup_logs (clerk_user_id, created_at DESC);

-- Keeps the ON DELETE CASCADE from google_accounts from doing a sequential scan.
CREATE INDEX idx_wakeup_logs_account
  ON public.wakeup_logs (account_id, created_at DESC);

ALTER TABLE public.wakeup_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wakeup_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own wakeup config" ON public.wakeup_configs
  FOR SELECT TO authenticated USING (requesting_user_id() = clerk_user_id);

CREATE POLICY "Users can insert their own wakeup config" ON public.wakeup_configs
  FOR INSERT TO authenticated WITH CHECK (requesting_user_id() = clerk_user_id);

-- WITH CHECK mirrors USING so a row cannot be reassigned to another user.
CREATE POLICY "Users can update their own wakeup config" ON public.wakeup_configs
  FOR UPDATE TO authenticated
  USING (requesting_user_id() = clerk_user_id)
  WITH CHECK (requesting_user_id() = clerk_user_id);

CREATE POLICY "Users can delete their own wakeup config" ON public.wakeup_configs
  FOR DELETE TO authenticated USING (requesting_user_id() = clerk_user_id);

CREATE POLICY "Users can read their own wakeup logs" ON public.wakeup_logs
  FOR SELECT TO authenticated USING (requesting_user_id() = clerk_user_id);

-- Logs may only be written for an account the caller owns.
CREATE POLICY "Users can insert their own wakeup logs" ON public.wakeup_logs
  FOR INSERT TO authenticated WITH CHECK (
    requesting_user_id() = clerk_user_id
    AND (
      account_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.google_accounts
        WHERE id = wakeup_logs.account_id
        AND clerk_user_id = requesting_user_id()
      )
    )
  );

-- selected_account_ids is a plain UUID[] (no foreign key), so RLS alone cannot
-- stop a user from pointing their own config at somebody else's account id via
-- a direct PostgREST write. This trigger enforces ownership - and the element
-- level bounds that CHECK constraints cannot express - for every write path,
-- including the service role.
CREATE OR REPLACE FUNCTION public.validate_wakeup_config()
RETURNS TRIGGER
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_model TEXT;
  v_daily_time TEXT;
BEGIN
  FOREACH v_model IN ARRAY NEW.selected_models LOOP
    IF char_length(v_model) = 0 OR char_length(v_model) > 64 THEN
      RAISE EXCEPTION 'Invalid model id length'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  FOREACH v_daily_time IN ARRAY NEW.daily_times LOOP
    IF v_daily_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'Invalid daily time: %', v_daily_time
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  FOREACH v_account_id IN ARRAY NEW.selected_account_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.google_accounts
      WHERE id = v_account_id
      AND google_accounts.clerk_user_id = NEW.clerk_user_id
    ) THEN
      RAISE EXCEPTION 'Account % is not linked to this user', v_account_id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_wakeup_config_trigger
  BEFORE INSERT OR UPDATE ON public.wakeup_configs
  FOR EACH ROW EXECUTE FUNCTION public.validate_wakeup_config();

-- A UUID[] cannot cascade, so unlinking a Google account would otherwise leave
-- a dangling id behind that the UI cannot clear and the validation trigger then
-- rejects on the next save. Prune it here instead, disabling the schedule when
-- nothing is left to trigger (required by wakeup_configs_enabled_requires_targets).
-- SECURITY DEFINER so the prune always runs, scoped to the account's own owner.
CREATE OR REPLACE FUNCTION public.prune_wakeup_config_account()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.wakeup_configs
  SET selected_account_ids = array_remove(selected_account_ids, OLD.id),
      enabled = CASE
        WHEN cardinality(array_remove(selected_account_ids, OLD.id)) = 0
          THEN false
        ELSE enabled
      END,
      updated_at = NOW()
  WHERE clerk_user_id = OLD.clerk_user_id
    AND OLD.id = ANY(selected_account_ids);

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prune_wakeup_config_account_trigger
  AFTER DELETE ON public.google_accounts
  FOR EACH ROW EXECUTE FUNCTION public.prune_wakeup_config_account();
