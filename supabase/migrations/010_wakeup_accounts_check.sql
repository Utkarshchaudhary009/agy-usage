-- Phase 14 (follow-up): atomically enforce that every id in
-- wakeup_configs.selected_account_ids belongs to the requesting user.
--
-- selected_account_ids is a UUID[] with no foreign key, so nothing in the
-- schema prevents a row from referencing an account the user does not own (or
-- one that has since been deleted). The application layer in
-- PUT /api/wakeup/config checks ownership with a SELECT before upserting, but
-- that is a TOCTOU: a concurrent account deletion between the SELECT and the
-- upsert would let a stale id land in the stored array. The browser can also
-- reach PostgREST directly and skip the route entirely, so the database must
-- enforce the invariant. This BEFORE trigger validates membership inside the
-- same write transaction, closing the race window.

CREATE OR REPLACE FUNCTION public.wakeup_configs_validate_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_invalid uuid;
BEGIN
  -- service_role (background jobs, migrations) bypasses ownership checks,
  -- matching the convention used by the token-manager RPCs.
  IF current_setting('request.jwt.claims', true)::json->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.selected_account_ids IS NULL
     OR array_length(NEW.selected_account_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sel.id INTO v_invalid
  FROM unnest(NEW.selected_account_ids) AS sel(id)
  LEFT JOIN public.google_accounts ga
    ON ga.id = sel.id
   AND ga.clerk_user_id = public.requesting_user_id()
  WHERE ga.id IS NULL
  LIMIT 1;

  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'selected account % does not belong to the requesting user', v_invalid
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wakeup_configs_validate_accounts
  ON public.wakeup_configs;
CREATE TRIGGER wakeup_configs_validate_accounts
  BEFORE INSERT OR UPDATE ON public.wakeup_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.wakeup_configs_validate_accounts();
