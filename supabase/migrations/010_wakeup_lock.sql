-- supabase/migrations/010_wakeup_lock.sql
--
-- Fixes a check-then-act race in the wakeup engine. `executeWakeup` (and a
-- manual single-model trigger) reads the most recent `wakeup_logs` row to
-- decide cooldown, then only *later* writes a new log once the triggers
-- finish. The cooldown check and the trigger run are several network round
-- trips apart, so they cannot be held inside one Postgres transaction.
--
-- Under the Inngest fan-out design (per-user events, concurrency shared across
-- all users — not per user) two runs for the SAME user can be in flight at once:
-- both pass the cooldown check before either has written a log, and both go on
-- to call Google's API, defeating the cooldown that is meant to stop us from
-- hammering it. A manual trigger fired from the UI at the same moment has the
-- same effect.
--
-- The fix is the same shape already used by the token-refresh lease (migration
-- 008): a database-backed per-user lease that spans the whole
-- cooldown-check -> trigger sequence. Only one execution per user may hold the
-- lease, so concurrent callers observe the lease and back off instead of
-- double-triggering.
--
-- Design notes (mirrors 008):
--   * `pg_advisory_xact_lock` serializes the "reap expired + read + grant" step
--     so two queued callers can never both believe the lease is free.
--   * The lease row carries an expiry so a crashed/timed-out holder cannot wedge
--     a user's wakeups forever. `executeWakeup` also renews it to cover the
--     actual work, and releases it in a `finally`.
--   * Service-role only: the lease is a global concurrency primitive, not row
--     data a user should ever see or grant themselves.

CREATE TABLE IF NOT EXISTS public.wakeup_locks (
  clerk_user_id TEXT PRIMARY KEY,
  lock_token UUID NOT NULL,
  locked_until TIMESTAMPTZ NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wakeup_locks_locked_until
  ON public.wakeup_locks (locked_until);

-- RLS on with no policies: nothing but service_role (which bypasses RLS) can
-- see or touch lease rows.
ALTER TABLE public.wakeup_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wakeup_locks FROM anon, authenticated;

-- Acquire (or observe) the per-user wakeup lease.
--
-- Returns a json with one of two outcomes:
--   { outcome: 'granted', lock_token: <uuid> }
--       - the caller owns the lease until `locked_until` and must call
--         release_wakeup_lock with the returned lock_token when done.
--   { outcome: 'locked' }
--       - another execution holds an unexpired lease. The caller should skip
--         (a concurrent wakeup is already running for this user).

CREATE OR REPLACE FUNCTION public.acquire_wakeup_lock(
  p_user_id TEXT,
  p_ttl_seconds INT DEFAULT 120
) RETURNS json
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked_until TIMESTAMPTZ;
  v_lock_token UUID;
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SET LOCAL lock_timeout = '10s';
  PERFORM pg_advisory_xact_lock(hashtextextended('wakeup:' || p_user_id, 0));

  -- Reap an expired lease so a crashed holder cannot block the user past TTL.
  DELETE FROM public.wakeup_locks
  WHERE clerk_user_id = p_user_id AND locked_until <= NOW();

  SELECT locked_until INTO v_locked_until
  FROM public.wakeup_locks
  WHERE clerk_user_id = p_user_id;

  IF v_locked_until IS NOT NULL THEN
    RETURN json_build_object('outcome', 'locked');
  END IF;

  v_lock_token := gen_random_uuid();

  INSERT INTO public.wakeup_locks (clerk_user_id, lock_token, locked_until, acquired_at)
  VALUES (p_user_id, v_lock_token, NOW() + make_interval(secs => p_ttl_seconds), NOW());

  RETURN json_build_object('outcome', 'granted', 'lock_token', v_lock_token);
END;
$$ LANGUAGE plpgsql;

-- Extend an owned lease to cover the actual work (account x model fan-out can
-- take longer than the initial TTL). Returns true when this caller holds the
-- lease; false if it has already expired / been re-granted to someone else, in
-- which case the caller must stop.
CREATE OR REPLACE FUNCTION public.renew_wakeup_lock(
  p_user_id TEXT,
  p_lock_token UUID,
  p_ttl_seconds INT DEFAULT 120
) RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.wakeup_locks
  SET locked_until = NOW() + make_interval(secs => p_ttl_seconds)
  WHERE clerk_user_id = p_user_id
    AND lock_token = p_lock_token
    AND locked_until > NOW();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql;

-- Release a lease. Returns true when this caller actually held it; a false
-- result means the lease had already expired and possibly been re-granted, so
-- the caller must not assume its trigger was the authoritative one.
CREATE OR REPLACE FUNCTION public.release_wakeup_lock(
  p_user_id TEXT,
  p_lock_token UUID
) RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.wakeup_locks
  WHERE clerk_user_id = p_user_id AND lock_token = p_lock_token;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$ LANGUAGE plpgsql;

-- These RPCs are never callable from a user-scoped (anon/authenticated) client.
REVOKE ALL ON FUNCTION public.acquire_wakeup_lock(TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_wakeup_lock(TEXT, UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_wakeup_lock(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_wakeup_lock(TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_wakeup_lock(TEXT, UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_wakeup_lock(TEXT, UUID) TO service_role;
