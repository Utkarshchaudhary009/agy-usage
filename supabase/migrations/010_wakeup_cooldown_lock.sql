-- supabase/migrations/010_wakeup_cooldown_lock.sql
--
-- Addresses a race condition in the wakeup cooldown gate (found in review):
-- executeWakeup() and the manual trigger route both performed a read-check
-- (isOnCooldown / getCooldownRemainingMs against wakeup_logs) and only *later*
-- wrote a wakeup_logs row. Because that read and the eventual write were not
-- atomic, two concurrent wakeups for the same user (e.g. a scheduled Inngest
-- job racing a manual click, or two Inngest workers) could both observe
-- "not on cooldown" and both stampede the Cloud Code API -- exactly what the
-- cooldown exists to prevent.
--
-- Fix: persist the cooldown boundary in a dedicated lock row and make the
-- "check cooldown + claim the slot" step atomic with a per-user advisory lock
-- *inside* an RPC. This mirrors the token-refresh lease in 008_*: PostgREST runs
-- each RPC in its own transaction on a pooled connection, so the advisory lock
-- alone would vanish on return; recording a lock row inside the same locked
-- transaction is what makes the claim visible to the next concurrent caller.

CREATE TABLE IF NOT EXISTS public.wakeup_cooldown_locks (
  clerk_user_id   TEXT PRIMARY KEY,
  last_trigger_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wakeup_cooldown_locks_time
  ON public.wakeup_cooldown_locks (clerk_user_id, last_trigger_at DESC);

ALTER TABLE public.wakeup_cooldown_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own wakeup cooldown lock"
  ON public.wakeup_cooldown_locks
  FOR ALL TO authenticated
  USING (requesting_user_id() = clerk_user_id);

-- Milliseconds remaining until the cooldown clears (0 when not on cooldown).
-- The boundary is the lock row's last_trigger_at, so it reflects the moment a
-- wakeup was *initiated*, not when it finished -- a deliberately stricter view.
CREATE OR REPLACE FUNCTION public.get_wakeup_cooldown_remaining_ms(
  p_clerk_user_id    TEXT,
  p_cooldown_minutes INTEGER
) RETURNS INTEGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last      TIMESTAMPTZ;
  v_remaining NUMERIC;
BEGIN
  -- Verify ownership unless called by the trusted backend (Inngest workers).
  -- IS DISTINCT FROM: a missing/NULL role claim must NOT bypass the check.
  IF current_setting('request.jwt.claims', true)::json->>'role'
     IS DISTINCT FROM 'service_role' THEN
    IF public.requesting_user_id() IS DISTINCT FROM p_clerk_user_id THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  SELECT last_trigger_at INTO v_last
  FROM public.wakeup_cooldown_locks
  WHERE clerk_user_id = p_clerk_user_id;

  IF v_last IS NULL THEN
    RETURN 0;
  END IF;

  v_remaining := extract(epoch FROM (
    v_last + make_interval(mins => p_cooldown_minutes) - NOW()
  )) * 1000;

  RETURN GREATEST(0, v_remaining::INTEGER);
END;
$$ LANGUAGE plpgsql;

-- Atomically check the cooldown and, if clear, claim the slot by stamping
-- last_trigger_at = now(). Returns true when the wakeup may proceed and false
-- when it is still on cooldown. A false return means the caller MUST NOT fire.
CREATE OR REPLACE FUNCTION public.begin_wakeup(
  p_clerk_user_id    TEXT,
  p_cooldown_minutes INTEGER
) RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last TIMESTAMPTZ;
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role'
     IS DISTINCT FROM 'service_role' THEN
    IF public.requesting_user_id() IS DISTINCT FROM p_clerk_user_id THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  -- Serialize the cooldown check + claim for this user. Never held while the
  -- (slow) external Cloud Code call runs -- only across the read + stamp below.
  SET LOCAL lock_timeout = '10s';
  PERFORM pg_advisory_xact_lock(
    hashtextextended('wakeup_cooldown:' || p_clerk_user_id, 0)
  );

  SELECT last_trigger_at INTO v_last
  FROM public.wakeup_cooldown_locks
  WHERE clerk_user_id = p_clerk_user_id;

  IF v_last IS NOT NULL
     AND v_last + make_interval(mins => p_cooldown_minutes) > NOW() THEN
    RETURN false;
  END IF;

  INSERT INTO public.wakeup_cooldown_locks (clerk_user_id, last_trigger_at)
  VALUES (p_clerk_user_id, NOW())
  ON CONFLICT (clerk_user_id)
  DO UPDATE SET last_trigger_at = NOW();

  RETURN true;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.get_wakeup_cooldown_remaining_ms(TEXT, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_wakeup_cooldown_remaining_ms(TEXT, INTEGER)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.begin_wakeup(TEXT, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_wakeup(TEXT, INTEGER)
  TO authenticated, service_role;
