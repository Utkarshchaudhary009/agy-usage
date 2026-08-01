-- supabase/migrations/006_fix_review_issues.sql
--
-- Addresses PR #14 review follow-ups:
-- 1. upsert_google_tokens: NULL-role bypass via `!=` -> IS DISTINCT FROM, and
--    per-user advisory lock so a concurrent token refresh cannot orphan Vault
--    secrets while delete_account_with_tokens reads + deletes them.
-- 2. All remaining secret-returning RPCs: NULL-role claim must not bypass the
--    ownership check (IS DISTINCT FROM, same convention as migration 005).
-- 3. Direct table DELETE on google_accounts is revoked so removals always go
--    through delete_account_with_tokens (Vault secret cleanup + active-account
--    promotion). INSERT/UPDATE stay available for the OAuth link flow.

-- 1. Serialize token upserts with account deletion + fix NULL-role bypass.
CREATE OR REPLACE FUNCTION public.upsert_google_tokens(
  p_account_id UUID,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS VOID
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_owner TEXT;
  v_access_id UUID;
  v_refresh_id UUID;
  v_old_access_id UUID;
  v_old_refresh_id UUID;
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

  -- Same per-user lock as delete_account_with_tokens / set_active_account:
  -- a concurrent upsert cannot race a delete and leave orphaned secrets.
  PERFORM pg_advisory_xact_lock(hashtext(v_owner));

  SELECT access_token_secret_id, refresh_token_secret_id INTO v_old_access_id, v_old_refresh_id
  FROM public.google_tokens WHERE account_id = p_account_id;

  SELECT id INTO v_access_id FROM vault.create_secret(p_access_token, 'access_token_' || p_account_id);
  SELECT id INTO v_refresh_id FROM vault.create_secret(p_refresh_token, 'refresh_token_' || p_account_id);

  INSERT INTO public.google_tokens (
    account_id, access_token_secret_id, refresh_token_secret_id, expires_at, updated_at
  ) VALUES (
    p_account_id, v_access_id, v_refresh_id, p_expires_at, NOW()
  )
  ON CONFLICT (account_id) DO UPDATE SET
    access_token_secret_id = EXCLUDED.access_token_secret_id,
    refresh_token_secret_id = EXCLUDED.refresh_token_secret_id,
    expires_at = EXCLUDED.expires_at,
    updated_at = EXCLUDED.updated_at;

  -- Clean up old secrets
  IF v_old_access_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_old_access_id;
  END IF;
  IF v_old_refresh_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_old_refresh_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 2. NULL-role bypass fix on the remaining secret-returning RPCs.
CREATE OR REPLACE FUNCTION public.get_decrypted_refresh_token(p_account_id UUID)
RETURNS TEXT
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id UUID;
  v_token TEXT;
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' IS DISTINCT FROM 'service_role' THEN
    IF NOT EXISTS (SELECT 1 FROM public.google_accounts WHERE id = p_account_id AND clerk_user_id = public.requesting_user_id()) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  SELECT refresh_token_secret_id INTO v_secret_id FROM public.google_tokens WHERE account_id = p_account_id;
  
  IF v_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE id = v_secret_id;
  END IF;

  RETURN v_token;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_decrypted_access_token(p_account_id UUID)
RETURNS TEXT
SECURITY DEFINER
SET search_path = public, vault
AS $body
DECLARE
  v_secret_id UUID;
  v_token TEXT;
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' IS DISTINCT FROM 'service_role' THEN
    IF NOT EXISTS (SELECT 1 FROM public.google_accounts WHERE id = p_account_id AND clerk_user_id = public.requesting_user_id()) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  SELECT access_token_secret_id INTO v_secret_id FROM public.google_tokens WHERE account_id = p_account_id;
  
  IF v_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE id = v_secret_id;
  END IF;

  RETURN v_token;
END;
$body LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_valid_token_metadata(p_account_id UUID)
RETURNS json
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id UUID;
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' IS DISTINCT FROM 'service_role' THEN
    IF NOT EXISTS (SELECT 1 FROM public.google_accounts WHERE id = p_account_id AND clerk_user_id = public.requesting_user_id()) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  SELECT access_token_secret_id, expires_at INTO v_secret_id, v_expires_at 
  FROM public.google_tokens 
  WHERE account_id = p_account_id;
  
  IF v_secret_id IS NOT NULL THEN
    SELECT decrypted_secret INTO v_token 
    FROM vault.decrypted_secrets 
    WHERE id = v_secret_id;
  END IF;

  RETURN json_build_object(
    'access_token', v_token,
    'expires_at', v_expires_at
  );
END;
$$ LANGUAGE plpgsql;

-- 3. Remove direct DELETE on google_accounts: account removal must go through
-- delete_account_with_tokens so Vault secrets are cleaned up and the
-- active-account invariant is preserved. SELECT/INSERT/UPDATE stay intact for
-- the OAuth link flow.
DROP POLICY IF EXISTS "Users can manage their own accounts" ON public.google_accounts;

CREATE POLICY "Users can read their own accounts" ON public.google_accounts
  FOR SELECT TO authenticated USING (requesting_user_id() = clerk_user_id);

CREATE POLICY "Users can insert their own accounts" ON public.google_accounts
  FOR INSERT TO authenticated WITH CHECK (requesting_user_id() = clerk_user_id);

CREATE POLICY "Users can update their own accounts" ON public.google_accounts
  FOR UPDATE TO authenticated
  USING (requesting_user_id() = clerk_user_id)
  WITH CHECK (requesting_user_id() = clerk_user_id);
