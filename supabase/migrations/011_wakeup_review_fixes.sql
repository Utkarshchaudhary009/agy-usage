-- Phase 14 review fixes for the wakeup config feature.
--
-- 1. Enforce the numeric bounds that the API already validates at the database
--    level (max_output_tokens / cooldown_minutes / interval_hours) so a client
--    calling the RPC directly (or bypassing validation) cannot persist an
--    out-of-range budget.
-- 2. Make save_wakeup_config take the same per-user advisory lock used by
--    delete_account_with_tokens, closing the TOCTOU window where an account
--    deletion could commit between the ownership check and the upsert.
-- 3. Clear a deleted account's id from any wakeup config selection so a stale
--    UUID does not linger and later cause ownership-check failures.
-- 4. Distinguish the "not authorized" (P0001) and "account not owned" (OWNAC)
--    failures the API surfaces with different messages.

-- 1. Numeric bounds as database constraints.
ALTER TABLE public.wakeup_configs
  ALTER COLUMN max_output_tokens SET NOT NULL,
  ADD CONSTRAINT chk_wakeup_max_output_tokens
    CHECK (max_output_tokens BETWEEN 1 AND 4096),
  ADD CONSTRAINT chk_wakeup_cooldown_minutes
    CHECK (cooldown_minutes BETWEEN 1 AND 1440),
  ADD CONSTRAINT chk_wakeup_interval_hours
    CHECK (interval_hours BETWEEN 1 AND 168),
  ADD CONSTRAINT chk_wakeup_daily_times_count
    CHECK (daily_times IS NULL OR cardinality(daily_times) <= 100);

-- 2 + 4. Re-create save_wakeup_config with the per-user advisory lock and a
-- distinct ownership error code.
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

  -- Serialize per-user account mutations with delete_account_with_tokens: an
  -- account removal cannot commit between the ownership check (below) and the
  -- upsert, so the check cannot go stale.
  SET LOCAL lock_timeout = '10s';
  PERFORM pg_advisory_xact_lock(hashtextextended(p_clerk_user_id, 0));

  -- Atomic ownership check: every requested account id must belong to this
  -- user. Runs in the same transaction as the upsert below.
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
      USING ERRCODE = 'OWNAC';
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

-- 3. Re-create delete_account_with_tokens to drop the deleted id from any
-- wakeup config selection for the same user.
CREATE OR REPLACE FUNCTION public.delete_account_with_tokens(p_account_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_access_secret_id UUID;
  v_refresh_secret_id UUID;
  v_owner TEXT;
BEGIN
  SELECT clerk_user_id INTO v_owner
  FROM public.google_accounts WHERE id = p_account_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Not found';
  END IF;

  -- Verify user owns this account unless called by service_role.
  -- IS DISTINCT FROM: a missing/NULL role claim must NOT bypass the check.
  IF current_setting('request.jwt.claims', true)::json->>'role' IS DISTINCT FROM 'service_role' THEN
    IF v_owner IS DISTINCT FROM public.requesting_user_id() THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  -- Serialize per-user account mutations so the active-account invariant
  -- cannot be raced by concurrent requests.
  SET LOCAL lock_timeout = '10s';
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner, 0));

  IF NOT EXISTS (SELECT 1 FROM public.google_accounts WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'Not found';
  END IF;

  SELECT access_token_secret_id, refresh_token_secret_id
    INTO v_access_secret_id, v_refresh_secret_id
  FROM public.google_tokens
  WHERE account_id = p_account_id;

  -- Deleting the account row cascades to google_tokens and quota_cache.
  DELETE FROM public.google_accounts WHERE id = p_account_id;

  -- Clean up vault secrets explicitly (FK cascade does not run in reverse).
  IF v_access_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_access_secret_id;
  END IF;
  IF v_refresh_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_refresh_secret_id;
  END IF;

  -- Drop the deleted account from any wakeup config selections so a stale UUID
  -- does not linger and later fail the ownership check on save.
  UPDATE public.wakeup_configs
    SET selected_account_ids = array_remove(selected_account_ids, p_account_id)
  WHERE clerk_user_id = v_owner;

  -- If no active account remains, promote the earliest-remaining one.
  IF NOT EXISTS (
    SELECT 1 FROM public.google_accounts
    WHERE clerk_user_id = v_owner AND is_active = true
  ) THEN
    UPDATE public.google_accounts SET is_active = true
    WHERE id = (
      SELECT id FROM public.google_accounts
      WHERE clerk_user_id = v_owner
      ORDER BY added_at ASC LIMIT 1
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.delete_account_with_tokens(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_account_with_tokens(UUID) TO authenticated, service_role;
