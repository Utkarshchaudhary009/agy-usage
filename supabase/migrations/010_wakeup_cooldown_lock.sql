-- Phase 14 (appendix): atomic cooldown claim.
--
-- The wakeup trigger used a check-then-act pattern: it read the most recent
-- wakeup_logs row to decide whether the user was on cooldown, and only *after*
-- completing the (slow, network-bound) trigger did it insert a new log row.
-- Because the insert happens at the end, two requests that overlap in time can
-- both observe "not on cooldown" and both fire — a lost-update race that lets
-- users hammer the Cloud Code endpoint despite the cooldown.
--
-- These functions close the race by combining the cooldown check and the
-- reservation into a single atomic, serialized step. `begin_wakeup_attempt`
-- takes a per-user advisory transaction lock, recomputes cooldown against the
-- latest log row, and — only if the user is clear — inserts a short-lived
-- "attempt" log row timestamped NOW before releasing the lock. Any concurrent
-- call must wait for the lock and will then see that row and be rejected. The
-- caller performs the trigger, logs the real per-model rows, then calls
-- `end_wakeup_attempt` to remove the reservation row.

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

CREATE OR REPLACE FUNCTION public.end_wakeup_attempt(
  p_attempt_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.wakeup_logs WHERE id = p_attempt_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.begin_wakeup_attempt(TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.end_wakeup_attempt(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.begin_wakeup_attempt(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_wakeup_attempt(UUID) TO service_role;
