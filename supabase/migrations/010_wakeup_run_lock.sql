-- Wakeup run mutual exclusion
-- Phase 14/16: prevent concurrent wakeup runs for the same user.
--
-- The original cooldown check read the last wakeup_logs row (written only AFTER
-- the trigger loop finished) and then performed the work. Two concurrent wakes
-- (e.g. a manual trigger racing the scheduled Inngest run) both passed the check
-- and both fired, doubling the upstream load. We now atomically claim the
-- cooldown window inside a single UPDATE before any work happens.
--
-- An advisory lock would be the usual tool, but Supabase's connection pooler runs
-- in transaction mode, so session-level advisory locks are not safe across the
-- pooled connections. A single atomic UPDATE scoped to the user's own row is
-- deterministic regardless of which connection services the statement.

ALTER TABLE public.wakeup_configs
  ADD COLUMN last_run_started_at TIMESTAMPTZ;

-- Atomically claim the cooldown window for a user.
--
-- Returns true (and stamps last_run_started_at = NOW()) iff no run has started
-- within the row's own cooldown_minutes. Two concurrent callers serialize on the
-- row lock, so exactly one wins; the other sees the freshly stamped timestamp and
-- returns false. SECURITY DEFINER keeps the claim working under the service-role
-- client used by background jobs, while the WHERE still scopes strictly to the
-- caller-supplied clerk_user_id.
CREATE OR REPLACE FUNCTION public.claim_wakeup_run(p_clerk_user_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.wakeup_configs
  SET last_run_started_at = NOW()
  WHERE clerk_user_id = p_clerk_user_id
    AND (
      last_run_started_at IS NULL
      OR last_run_started_at <= NOW() - (cooldown_minutes || ' minutes')::interval
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_wakeup_run(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wakeup_run(text) TO service_role;
