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

-- The lock table is only ever touched via the SECURITY DEFINER RPCs below, which
-- perform their own ownership check and run as the table owner (bypassing RLS).
-- Revoke all direct access from anon/authenticated so a caller can only mutate the
-- lock through begin_wakeup / get_wakeup_cooldown_remaining_ms -- mirroring the
-- service-only lease table in migration 008.
ALTER TABLE public.wakeup_cooldown_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wakeup_cooldown_locks FROM anon, authenticated;

-- Milliseconds remaining until the cooldown clears (0 when not on cooldown).
-- The boundary is the lock row's last_trigger_at, so it reflects the moment a
-- wakeup was *initiated*, not when it finished -- a deliberately stricter view.
-- The cooldown duration is read server-side from the user's `wakeup_configs`
-- row rather than accepted as a parameter. A caller-supplied value could be 0 or
-- NULL to never be placed on cooldown and defeat the throttle this gate exists
-- to enforce.
DROP FUNCTION IF EXISTS public.get_wakeup_cooldown_remaining_ms(TEXT, INTEGER);
CREATE FUNCTION public.get_wakeup_cooldown_remaining_ms(
  p_clerk_user_id    TEXT
) RETURNS INTEGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last      TIMESTAMPTZ;
  v_cooldown  INTEGER;
  v_remaining NUMERIC;
BEGIN
  IF p_clerk_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing user id';
  END IF;

  -- Verify ownership unless called by the trusted backend (Inngest workers).
  -- IS DISTINCT FROM: a missing/NULL role claim must NOT bypass the check.
  IF current_setting('request.jwt.claims', true)::json->>'role'
     IS DISTINCT FROM 'service_role' THEN
    IF public.requesting_user_id() IS DISTINCT FROM p_clerk_user_id THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  SELECT cooldown_minutes INTO v_cooldown
  FROM public.wakeup_configs
  WHERE clerk_user_id = p_clerk_user_id;
  v_cooldown := COALESCE(v_cooldown, 60);

  SELECT last_trigger_at INTO v_last
  FROM public.wakeup_cooldown_locks
  WHERE clerk_user_id = p_clerk_user_id;

  IF v_last IS NULL THEN
    RETURN 0;
  END IF;

  v_remaining := extract(epoch FROM (
    v_last + make_interval(mins => v_cooldown) - NOW()
  )) * 1000;

  RETURN GREATEST(0, v_remaining::INTEGER);
END;
$$ LANGUAGE plpgsql;

-- The cooldown duration is read server-side from the user's `wakeup_configs`
-- row (see note on get_wakeup_cooldown_remaining_ms). The function is SECURITY
-- DEFINER so it can read the authoritative value even though direct access to the
-- config is RLS-scoped; it never trusts a caller-supplied parameter.
DROP FUNCTION IF EXISTS public.begin_wakeup(TEXT, INTEGER);
CREATE FUNCTION public.begin_wakeup(
  p_clerk_user_id    TEXT
) RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last TIMESTAMPTZ;
  v_cooldown INTEGER;
BEGIN
  IF p_clerk_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing user id';
  END IF;

  IF current_setting('request.jwt.claims', true)::json->>'role'
     IS DISTINCT FROM 'service_role' THEN
    IF public.requesting_user_id() IS DISTINCT FROM p_clerk_user_id THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  SELECT cooldown_minutes INTO v_cooldown
  FROM public.wakeup_configs
  WHERE clerk_user_id = p_clerk_user_id;
  v_cooldown := COALESCE(v_cooldown, 60);

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
     AND v_last + make_interval(mins => v_cooldown) > NOW() THEN
    RETURN false;
  END IF;

  INSERT INTO public.wakeup_cooldown_locks (clerk_user_id, last_trigger_at)
  VALUES (p_clerk_user_id, NOW())
  ON CONFLICT (clerk_user_id)
  DO UPDATE SET last_trigger_at = NOW();

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Backfill the cooldown lock from each user's most recent wakeup log so the first
-- wakeup after this migration still respects any recent trigger window, instead
-- of ignoring a recent log entry and firing inside the old cooldown.
INSERT INTO public.wakeup_cooldown_locks (clerk_user_id, last_trigger_at)
SELECT clerk_user_id, MAX(created_at)
FROM public.wakeup_logs
GROUP BY clerk_user_id
ON CONFLICT (clerk_user_id) DO NOTHING;

REVOKE ALL ON FUNCTION public.get_wakeup_cooldown_remaining_ms(TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_wakeup_cooldown_remaining_ms(TEXT)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.begin_wakeup(TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_wakeup(TEXT)
  TO authenticated, service_role;
