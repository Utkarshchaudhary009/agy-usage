-- supabase/migrations/008_token_refresh_lease.sql
--
-- Addresses PR #30 review: the in-process Map used to serialize Google token
-- refreshes only dedupes within a single Node instance. On Vercel (and under
-- Inngest fan-out) concurrent invocations land on *different* instances, so two
-- of them could read the same refresh token, exchange it in parallel, and have
-- Google reject the loser with `invalid_grant` — which the app then mistakes
-- for a revoked account.
--
-- The fix is a database-backed lease that spans the whole read -> exchange ->
-- persist sequence, since that sequence is made of several separate round
-- trips and therefore cannot be held inside one Postgres transaction.
--
-- Design notes:
--   * `pg_advisory_xact_lock` alone is not enough: PostgREST runs every request
--     in its own transaction on a pooled connection, so the lock would be
--     released the moment `acquire_token_refresh_lease` returns. It *is* used
--     inside the RPC to make the "read state + decide + grant" step atomic.
--   * The lease row carries an expiry so a crashed or timed-out holder cannot
--     wedge an account forever.
--   * The lease is service-role only. It hands back the decrypted refresh
--     token, so callers must have verified account ownership beforehand
--     (same contract as `get_decrypted_refresh_token`).

CREATE TABLE IF NOT EXISTS public.token_refresh_leases (
  account_id UUID PRIMARY KEY REFERENCES public.google_accounts(id) ON DELETE CASCADE,
  lock_token UUID NOT NULL,
  locked_until TIMESTAMPTZ NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_refresh_leases_locked_until
  ON public.token_refresh_leases (locked_until);

-- RLS on with no policies: nothing but service_role (which bypasses RLS) can
-- see or touch lease rows.
ALTER TABLE public.token_refresh_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.token_refresh_leases FROM anon, authenticated;

-- Acquire (or observe) the refresh lease for an account.
--
-- Returns one of three outcomes:
--   'fresh'   - a valid access token is already persisted (another instance
--               finished refreshing while this caller was queued). No lease is
--               taken and none needs releasing.
--   'locked'  - another instance holds an unexpired lease. The caller should
--               back off and retry.
--   'granted' - the caller owns the lease until `locked_until` and receives the
--               decrypted refresh token to exchange. It MUST call
--               release_token_refresh_lease with the returned lock_token.
--
-- Pass p_force = true to skip the 'fresh' short-circuit when the caller must
-- mint a brand new token regardless of the persisted token's remaining life.
CREATE OR REPLACE FUNCTION public.acquire_token_refresh_lease(
  p_account_id UUID,
  p_ttl_seconds INT DEFAULT 30,
  p_expiry_buffer_seconds INT DEFAULT 300,
  p_force BOOLEAN DEFAULT false
) RETURNS json
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_owner TEXT;
  v_access_secret_id UUID;
  v_refresh_secret_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_access_token TEXT;
  v_refresh_token TEXT;
  v_locked_until TIMESTAMPTZ;
  v_lock_token UUID;
BEGIN
  -- service_role only: this returns decrypted secrets and performs no
  -- ownership check of its own.
  IF current_setting('request.jwt.claims', true)::json->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT clerk_user_id INTO v_owner
  FROM public.google_accounts WHERE id = p_account_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Not found';
  END IF;

  -- Serialize lease bookkeeping for this account so the freshness check and
  -- the grant below can never disagree with a concurrent caller. This is a
  -- different key space from the per-user lock taken by upsert_google_tokens /
  -- delete_account_with_tokens, and it is never held at the same time as that
  -- lock, so no lock-ordering deadlock is possible.
  SET LOCAL lock_timeout = '10s';
  PERFORM pg_advisory_xact_lock(hashtextextended('token_refresh:' || p_account_id::text, 0));

  SELECT access_token_secret_id, refresh_token_secret_id, expires_at
    INTO v_access_secret_id, v_refresh_secret_id, v_expires_at
  FROM public.google_tokens
  WHERE account_id = p_account_id;

  IF v_access_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_access_token
    FROM vault.decrypted_secrets WHERE id = v_access_secret_id;
  END IF;

  -- Re-read of the token state *inside* the lock: a caller that queued behind
  -- an in-flight refresh must not issue a duplicate Google exchange once that
  -- refresh has landed.
  IF NOT p_force
     AND v_access_token IS NOT NULL
     AND v_expires_at IS NOT NULL
     AND v_expires_at - make_interval(secs => p_expiry_buffer_seconds) > NOW()
  THEN
    RETURN json_build_object(
      'outcome', 'fresh',
      'access_token', v_access_token,
      'expires_at', v_expires_at
    );
  END IF;

  -- Reap an expired lease: a holder that crashed mid-refresh must not block
  -- the account past the TTL.
  DELETE FROM public.token_refresh_leases
  WHERE account_id = p_account_id AND locked_until <= NOW();

  SELECT locked_until INTO v_locked_until
  FROM public.token_refresh_leases
  WHERE account_id = p_account_id;

  IF v_locked_until IS NOT NULL THEN
    RETURN json_build_object(
      'outcome', 'locked',
      'locked_until', v_locked_until,
      'expires_at', v_expires_at
    );
  END IF;

  v_lock_token := gen_random_uuid();

  INSERT INTO public.token_refresh_leases (account_id, lock_token, locked_until, acquired_at)
  VALUES (p_account_id, v_lock_token, NOW() + make_interval(secs => p_ttl_seconds), NOW());

  -- Decrypted only for the lease holder, and only once the lease is recorded,
  -- so a rotated refresh token can never be handed to two exchangers at once.
  IF v_refresh_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_refresh_token
    FROM vault.decrypted_secrets WHERE id = v_refresh_secret_id;
  END IF;

  RETURN json_build_object(
    'outcome', 'granted',
    'lock_token', v_lock_token,
    'refresh_token', v_refresh_token,
    'access_token', v_access_token,
    'expires_at', v_expires_at
  );
END;
$$ LANGUAGE plpgsql;

-- Release a lease. Returns true when this caller actually held it; a false
-- result means the lease had already expired and possibly been re-granted, so
-- the caller must not assume its own write won.
CREATE OR REPLACE FUNCTION public.release_token_refresh_lease(
  p_account_id UUID,
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

  DELETE FROM public.token_refresh_leases
  WHERE account_id = p_account_id AND lock_token = p_lock_token;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$ LANGUAGE plpgsql;

-- Belt and braces on top of the in-function role check: these RPCs are never
-- callable from a user-scoped (anon/authenticated) client.
REVOKE ALL ON FUNCTION public.acquire_token_refresh_lease(UUID, INT, INT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_token_refresh_lease(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_token_refresh_lease(UUID, INT, INT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_token_refresh_lease(UUID, UUID) TO service_role;
