-- Phase 14 fix: make saving a wakeup config atomic.
--
-- The previous PUT handler validated account ownership with a separate SELECT
-- and then upserted in a second round-trip. Between those two steps an account
-- could be removed (TOCTOU race), letting a stale, non-owned account id be
-- persisted into selected_account_ids. This RPC performs the ownership check
-- and the upsert in a single transaction so the check cannot go stale.

CREATE OR REPLACE FUNCTION public.save_wakeup_config(
  p_clerk_user_id TEXT,
  p_enabled BOOLEAN,
  p_selected_models TEXT[],
  p_selected_account_ids UUID[],
  p_schedule_mode TEXT,
  p_interval_hours INTEGER,
  p_daily_times TEXT[],
  p_cron_expression TEXT,
  p_custom_prompt TEXT,
  p_max_output_tokens INTEGER,
  p_cooldown_minutes INTEGER,
  p_wake_on_reset BOOLEAN
)
RETURNS public.wakeup_configs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owns_all BOOLEAN;
  result_row public.wakeup_configs;
BEGIN
  -- The caller may only write their own config row. Allow service_role (Inngest)
  -- to act on any user; IS DISTINCT FROM rejects a missing/NULL role claim so a
  -- crafted JWT cannot bypass the check (same convention as migration 006).
  IF current_setting('request.jwt.claims', true)::json->>'role' IS DISTINCT FROM 'service_role' THEN
    IF p_clerk_user_id IS DISTINCT FROM public.requesting_user_id() THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Atomic ownership check: every requested account id must belong to this
  -- user. Runs in the same transaction as the upsert below, so it cannot go
  -- stale if an account is removed concurrently.
  SELECT NOT EXISTS (
    SELECT 1
    FROM unnest(p_selected_account_ids) AS requested(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.google_accounts ga
      WHERE ga.id = requested.id
        AND ga.clerk_user_id = p_clerk_user_id
    )
  ) INTO v_owns_all;

  IF NOT v_owns_all THEN
    RAISE EXCEPTION 'selected account does not belong to this user'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.wakeup_configs (
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
  ) VALUES (
    p_clerk_user_id,
    p_enabled,
    p_selected_models,
    p_selected_account_ids,
    p_schedule_mode,
    p_interval_hours,
    p_daily_times,
    p_cron_expression,
    p_custom_prompt,
    p_max_output_tokens,
    p_cooldown_minutes,
    p_wake_on_reset
  )
  ON CONFLICT (clerk_user_id)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    selected_models = EXCLUDED.selected_models,
    selected_account_ids = EXCLUDED.selected_account_ids,
    schedule_mode = EXCLUDED.schedule_mode,
    interval_hours = EXCLUDED.interval_hours,
    daily_times = EXCLUDED.daily_times,
    cron_expression = EXCLUDED.cron_expression,
    custom_prompt = EXCLUDED.custom_prompt,
    max_output_tokens = EXCLUDED.max_output_tokens,
    cooldown_minutes = EXCLUDED.cooldown_minutes,
    wake_on_reset = EXCLUDED.wake_on_reset
  RETURNING * INTO result_row;

  RETURN result_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_wakeup_config(
  TEXT, BOOLEAN, TEXT[], UUID[], TEXT, INTEGER, TEXT[], TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) TO authenticated, service_role;
