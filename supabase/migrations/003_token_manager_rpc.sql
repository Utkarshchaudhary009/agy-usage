-- supabase/migrations/003_token_manager_rpc.sql

-- RPC to retrieve both access token and expiry securely in a single round-trip
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
  -- Verify user owns this account unless called by service_role
  IF current_setting('request.jwt.claims', true)::json->>'role' != 'service_role' THEN
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