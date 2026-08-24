-- supabase/migrations/010_wakeup_run_lock.sql
--
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
  ADD COLUMN IF NOT EXISTS last_run_started_at TIMESTAMPTZ;

-- Cooldown state is written only by this RPC. Migration 009 revoked table-level
-- UPDATE from `authenticated` and re-granted named columns; a column added
-- afterwards inherits no column-level grant, so `authenticated` cannot write
-- last_run_started_at directly. Stated explicitly here so the invariant is not
-- lost if the grants in 009 are ever revisited.
REVOKE UPDATE (last_run_started_at) ON public.wakeup_configs FROM authenticated, anon;

-- Atomically claim the cooldown window for a user.
--
-- Returns true (and stamps last_run_started_at = NOW()) iff no run has started
-- within the row's own cooldown_minutes AND the config is still enabled. Two
-- concurrent callers serialize on the row lock, so exactly one wins; the other
-- sees the freshly stamped timestamp and returns false. Checking `enabled`
-- inside the same atomic UPDATE — rather than relying on the caller's earlier
-- `SELECT` — closes the TOCTOU where a user disables their wakeup between the
-- read and the claim and would otherwise still get a run. SECURITY DEFINER keeps
-- the claim working under the service-role client used by background jobs and
-- lets it write a column that `authenticated` has no privilege on, while the
-- ownership check below still scopes a user-scoped caller strictly to its own
-- row.
CREATE OR REPLACE FUNCTION public.claim_wakeup_run(p_clerk_user_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  updated_count integer;
BEGIN
  -- IS DISTINCT FROM, not `!=`: when `request.jwt.claims` is unset the JSON
  -- extraction yields NULL, `NULL != 'service_role'` is NULL, and an IF on NULL
  -- skips its body — which would silently bypass the ownership check entirely.
  -- Migration 006 removed exactly this bypass from the other RPCs; keep the
  -- convention here. Claiming another user's window would suppress their wakeup
  -- runs for a full cooldown period.
  IF current_setting('request.jwt.claims', true)::json->>'role' IS DISTINCT FROM 'service_role' THEN
    IF public.requesting_user_id() IS DISTINCT FROM p_clerk_user_id THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  -- make_interval() over string concatenation: `(cooldown_minutes || ' minutes')`
  -- silently produces NULL for a NULL input, and a NULL comparison would make the
  -- predicate unsatisfiable, permanently wedging the account.
  -- `enabled = true` is part of the same atomic predicate (not a separate
  -- caller-side check) so a config disabled concurrently with a dispatch is
  -- honored: the UPDATE affects zero rows and the caller is skipped instead of
  -- firing a run the user just turned off.
  UPDATE public.wakeup_configs
  SET last_run_started_at = NOW()
  WHERE clerk_user_id = p_clerk_user_id
    AND enabled = true
    AND (
      last_run_started_at IS NULL
      OR last_run_started_at <= NOW() - make_interval(mins => cooldown_minutes)
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, which would expose this
-- SECURITY DEFINER routine to anon as well. Revoke first, then grant explicitly
-- (same convention as migration 008).
REVOKE ALL ON FUNCTION public.claim_wakeup_run(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_wakeup_run(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wakeup_run(text) TO service_role;
