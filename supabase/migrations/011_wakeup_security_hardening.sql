-- Phase 14 (review hardening): align wakeup RPCs/policies with the security
-- conventions established in 006_fix_review_issues.sql.
--
-- 1. SECURITY DEFINER RPCs (begin_wakeup_attempt / end_wakeup_attempt) must
--    verify the caller owns the resource when invoked with a user JWT, exactly
--    like every other state-mutating RPC in this project. EXECUTE is already
--    revoked from PUBLIC and granted only to service_role, but the guard is
--    defense-in-depth against any future path that invokes them with a user
--    token (e.g. a confused-deputy call that would let one user delete another
--    user's cooldown reservation via end_wakeup_attempt).
-- 2. The cooldown reservation is internal lock state, not a user-visible audit
--    event. Its row (model_id = '__wakeup_attempt__', success = FALSE) must not
--    surface in a user's wakeup history, so the SELECT policy excludes it.
-- 3. wakeup_configs needs only SELECT/INSERT/UPDATE from the app (no delete
--    path exists); restrict the policy to least privilege (cf. the DELETE
--    revocation on google_accounts in 006).
-- 4. Index the wakeup_logs.account_id FK for join/lookup performance.

-- 1a. Ownership-guarded begin_wakeup_attempt.
CREATE OR REPLACE FUNCTION public.begin_wakeup_attempt(
  p_clerk_user_id TEXT,
  p_cooldown_minutes INTEGER DEFAULT 60
)
RETURNS TABLE (allowed BOOLEAN, next_allowed_at TIMESTAMPTZ, attempt_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_at TIMESTAMPTZ;
  v_next_at TIMESTAMPTZ;
  v_attempt_id UUID;
BEGIN
  -- Verify ownership when not invoked by the trusted service_role (mirrors 006).
  IF current_setting('request.jwt.claims', true)::json->>'role'
     IS DISTINCT FROM 'service_role' THEN
    IF p_clerk_user_id IS DISTINCT FROM public.requesting_user_id() THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  -- Serialize attempts for a single user. The lock is held only for the
  -- duration of this function (check + reservation insert), not while the
  -- external trigger runs, so we never block the connection pool on I/O.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_clerk_user_id, 0));

  SELECT created_at INTO v_last_at
  FROM public.wakeup_logs
  WHERE clerk_user_id = p_clerk_user_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_last_at IS NOT NULL
     AND (NOW() - v_last_at) < (p_cooldown_minutes || ' minutes')::INTERVAL THEN
    v_next_at := v_last_at + (p_cooldown_minutes || ' minutes')::INTERVAL;
    RETURN QUERY SELECT FALSE, v_next_at, NULL::UUID;
    RETURN;
  END IF;

  -- Reserve the cooldown slot up front so a concurrent call is rejected while
  -- this run is in flight. The real per-model rows are written after the
  -- trigger completes and this reservation is then deleted via
  -- `end_wakeup_attempt`.
  INSERT INTO public.wakeup_logs (
    clerk_user_id,
    account_id,
    model_id,
    trigger_source,
    success,
    duration_ms,
    error
  ) VALUES (
    p_clerk_user_id,
    NULL,
    '__wakeup_attempt__',
    'manual',
    FALSE,
    0,
    'pending'
  )
  RETURNING id INTO v_attempt_id;

  RETURN QUERY SELECT TRUE, NULL::TIMESTAMPTZ, v_attempt_id;
END;
$$;

-- 1b. Ownership-guarded end_wakeup_attempt.
CREATE OR REPLACE FUNCTION public.end_wakeup_attempt(
  p_attempt_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify ownership when not invoked by the trusted service_role (mirrors 006).
  IF current_setting('request.jwt.claims', true)::json->>'role'
     IS DISTINCT FROM 'service_role' THEN
    PERFORM 1
    FROM public.wakeup_logs
    WHERE id = p_attempt_id
      AND clerk_user_id = public.requesting_user_id();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  DELETE FROM public.wakeup_logs WHERE id = p_attempt_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.begin_wakeup_attempt(TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.end_wakeup_attempt(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.begin_wakeup_attempt(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_wakeup_attempt(UUID) TO service_role;

-- 2. Keep internal cooldown-reservation rows out of the user's audit view.
DROP POLICY IF EXISTS "Users read their own wakeup logs" ON public.wakeup_logs;
CREATE POLICY "Users read their own wakeup logs"
  ON public.wakeup_logs
  FOR SELECT TO authenticated
  USING (
    requesting_user_id() = clerk_user_id
    AND model_id <> '__wakeup_attempt__'
  );

-- 3. Least privilege: configs need only SELECT/INSERT/UPDATE from the app.
DROP POLICY IF EXISTS "Users manage their own wakeup config" ON public.wakeup_configs;
CREATE POLICY "Users manage their own wakeup config"
  ON public.wakeup_configs
  FOR SELECT, INSERT, UPDATE TO authenticated
  USING (requesting_user_id() = clerk_user_id)
  WITH CHECK (requesting_user_id() = clerk_user_id);

-- 4. Index the wakeup_logs.account_id foreign key.
CREATE INDEX IF NOT EXISTS idx_wakeup_logs_account
  ON public.wakeup_logs (account_id);
