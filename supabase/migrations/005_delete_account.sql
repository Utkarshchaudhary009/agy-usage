-- supabase/migrations/005_delete_account.sql

-- Permanently removes a linked Google account together with its Vault secrets,
-- tokens, and quota cache. Vault secrets are deleted explicitly because the
-- google_tokens -> vault.secrets foreign keys only cascade one way.
-- If the removed account was the active one, the earliest-remaining account
-- is promoted so the "one active account" invariant is preserved.
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
    IF v_owner != public.requesting_user_id() THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  -- Serialize per-user account mutations so the active-account invariant
  -- cannot be raced by concurrent requests.
  PERFORM pg_advisory_xact_lock(hashtext(v_owner));

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

-- Atomically sets exactly one account active per user. Uses an advisory lock
-- plus a clear-then-activate sequence: a single multi-row UPDATE can trip the
-- immediate unique index when rows are visited in the wrong order, and
-- concurrent calls would race on the same index.
CREATE OR REPLACE FUNCTION public.set_active_account(p_account_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner TEXT;
BEGIN
  SELECT clerk_user_id INTO v_owner
  FROM public.google_accounts WHERE id = p_account_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Not found';
  END IF;

  -- Verify user owns this account unless called by service_role
  IF current_setting('request.jwt.claims', true)::json->>'role' IS DISTINCT FROM 'service_role' THEN
    IF v_owner != public.requesting_user_id() THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_owner));

  UPDATE public.google_accounts
    SET is_active = false
  WHERE clerk_user_id = v_owner AND id != p_account_id AND is_active = true;

  UPDATE public.google_accounts
    SET is_active = true
  WHERE id = p_account_id;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.set_active_account(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_account(UUID) TO authenticated, service_role;
