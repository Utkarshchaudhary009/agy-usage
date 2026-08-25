-- supabase/migrations/002_use_vault.sql

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.google_tokens
  DROP COLUMN IF EXISTS access_token_encrypted,
  DROP COLUMN IF EXISTS refresh_token_encrypted,
  ADD COLUMN access_token_secret_id UUID REFERENCES vault.secrets(id) ON DELETE CASCADE,
  ADD COLUMN refresh_token_secret_id UUID REFERENCES vault.secrets(id) ON DELETE CASCADE;

-- RPC to upsert tokens securely via Vault
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
  v_access_id UUID;
  v_refresh_id UUID;
  v_old_access_id UUID;
  v_old_refresh_id UUID;
BEGIN
  -- Verify user owns this account unless called by service_role
  IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
    IF NOT EXISTS (SELECT 1 FROM public.google_accounts WHERE id = p_account_id AND clerk_user_id = public.requesting_user_id()) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  SELECT access_token_secret_id, refresh_token_secret_id INTO v_old_access_id, v_old_refresh_id
  FROM public.google_tokens WHERE account_id = p_account_id;

  v_access_id := vault.create_secret(p_access_token, 'access_token_' || p_account_id);
  v_refresh_id := vault.create_secret(p_refresh_token, 'refresh_token_' || p_account_id);

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

-- RPC to retrieve refresh token securely via Vault
CREATE OR REPLACE FUNCTION public.get_decrypted_refresh_token(p_account_id UUID)
RETURNS TEXT
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id UUID;
  v_token TEXT;
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
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

-- RPC to retrieve access token securely via Vault
CREATE OR REPLACE FUNCTION public.get_decrypted_access_token(p_account_id UUID)
RETURNS TEXT
SECURITY DEFINER
SET search_path = public, vault
AS $body$
DECLARE
  v_secret_id UUID;
  v_token TEXT;
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
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
$body$ LANGUAGE plpgsql;

-- Restrict access to these sensitive RPCs to service_role only
REVOKE EXECUTE ON FUNCTION public.get_decrypted_refresh_token(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_decrypted_refresh_token(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_decrypted_access_token(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_decrypted_access_token(UUID) TO service_role;
