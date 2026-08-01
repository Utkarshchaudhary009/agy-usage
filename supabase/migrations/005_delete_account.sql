-- supabase/migrations/005_delete_account.sql

-- Permanently removes a linked Google account together with its Vault secrets,
-- tokens, and quota cache. Vault secrets are deleted explicitly because the
-- google_tokens -> vault.secrets foreign keys only cascade one way.
CREATE OR REPLACE FUNCTION public.delete_account_with_tokens(p_account_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_access_secret_id UUID;
  v_refresh_secret_id UUID;
BEGIN
  -- Verify user owns this account unless called by service_role
  IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
    IF NOT EXISTS (SELECT 1 FROM public.google_accounts WHERE id = p_account_id AND clerk_user_id = public.requesting_user_id()) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
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
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.delete_account_with_tokens(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_account_with_tokens(UUID) TO authenticated, service_role;

-- Atomically sets exactly one account active per user (safe against
-- concurrent requests, unlike a multi-statement clear-then-activate).
CREATE OR REPLACE FUNCTION public.set_active_account(p_account_id UUID)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner TEXT;
BEGIN
  -- Verify user owns this account unless called by service_role
  SELECT clerk_user_id INTO v_owner
  FROM public.google_accounts WHERE id = p_account_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Not found';
  END IF;

  IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
    IF v_owner != public.requesting_user_id() THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  -- Single statement: activates the target account and deactivates all
  -- others for the owner in one atomic operation.
  UPDATE public.google_accounts
    SET is_active = (id = p_account_id)
  WHERE clerk_user_id = v_owner;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.set_active_account(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_account(UUID) TO authenticated, service_role;

-- The token refresh flow (token-manager, OAuth re-auth) runs as the
-- authenticated role. This RPC verifies ownership internally, so granting
-- it to authenticated is safe and required for refreshing to work.
GRANT EXECUTE ON FUNCTION public.get_decrypted_refresh_token(UUID) TO authenticated;
