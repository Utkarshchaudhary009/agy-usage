-- Phase 14 (follow-up): keep wakeup_configs.selected_account_ids referentially
-- honest.
--
-- selected_account_ids is a UUID[] with no foreign key, so nothing in the
-- schema prevents a row from referencing an account the user does not own (or
-- one that has since been deleted). Two things are needed to replace what a
-- real FK would have given us:
--
--   1. A BEFORE INSERT/UPDATE trigger that rejects ids which do not belong to
--      the row's owner. The application layer in PUT /api/wakeup/config checks
--      ownership with a SELECT before upserting, but that is a TOCTOU: a
--      concurrent account deletion between the SELECT and the upsert would let
--      a stale id land in the stored array. The browser can also reach
--      PostgREST directly and skip the route entirely, so the database must
--      enforce the invariant. Validating inside the same write transaction
--      closes the race window.
--
--   2. An AFTER DELETE trigger on google_accounts that strips the removed id
--      from any config referencing it -- the ON DELETE CASCADE half of the
--      missing FK. Without it, deleting an account leaves a stale id behind
--      that (1) then rejects on *every* subsequent save, permanently wedging
--      the user's config: the deleted account is no longer rendered in the
--      form, so the UI cannot clear the entry either.

-- Ownership is validated against NEW.clerk_user_id rather than
-- requesting_user_id() so the invariant holds for every writer, including
-- service_role background jobs, instead of only for user-scoped requests.
-- SECURITY DEFINER makes the lookup authoritative over the real table contents
-- rather than the caller's RLS-filtered view; it can only ever reject a write,
-- never widen access, and it returns no data to the caller.
CREATE OR REPLACE FUNCTION public.wakeup_configs_validate_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invalid uuid;
BEGIN
  IF cardinality(NEW.selected_account_ids) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT sel.id INTO v_invalid
  FROM unnest(NEW.selected_account_ids) AS sel(id)
  LEFT JOIN public.google_accounts ga
    ON ga.id = sel.id
   AND ga.clerk_user_id = NEW.clerk_user_id
  WHERE ga.id IS NULL
  LIMIT 1;

  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'selected account % does not belong to this user', v_invalid
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

-- The cascade half. Rebuilds the array from the ids that still resolve to a
-- live account owned by the config's user, so the row is left in a state the
-- validation trigger above accepts (rather than merely dropping OLD.id and
-- hoping nothing else went stale). Scoped by clerk_user_id, which is UNIQUE,
-- so this is a single-row index lookup and not a scan of every config.
--
-- SECURITY DEFINER because this is schema maintenance that must succeed no
-- matter who performed the delete; it never reads data back to the caller.
CREATE OR REPLACE FUNCTION public.wakeup_configs_prune_deleted_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.wakeup_configs wc
  SET selected_account_ids = COALESCE(
    (
      SELECT array_agg(sel.id ORDER BY sel.ord)
      FROM unnest(wc.selected_account_ids) WITH ORDINALITY AS sel(id, ord)
      JOIN public.google_accounts ga
        ON ga.id = sel.id
       AND ga.clerk_user_id = wc.clerk_user_id
    ),
    '{}'::uuid[]
  )
  WHERE wc.clerk_user_id = OLD.clerk_user_id
    AND wc.selected_account_ids && ARRAY[OLD.id];

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS wakeup_configs_prune_deleted_account
  ON public.google_accounts;
CREATE TRIGGER wakeup_configs_prune_deleted_account
  AFTER DELETE ON public.google_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.wakeup_configs_prune_deleted_account();

-- One-time repair for rows written before the cascade trigger existed, so no
-- pre-existing config is left permanently unsaveable.
UPDATE public.wakeup_configs wc
SET selected_account_ids = COALESCE(
  (
    SELECT array_agg(sel.id ORDER BY sel.ord)
    FROM unnest(wc.selected_account_ids) WITH ORDINALITY AS sel(id, ord)
    JOIN public.google_accounts ga
      ON ga.id = sel.id
     AND ga.clerk_user_id = wc.clerk_user_id
  ),
  '{}'::uuid[]
)
WHERE EXISTS (
  SELECT 1
  FROM unnest(wc.selected_account_ids) AS sel(id)
  LEFT JOIN public.google_accounts ga
    ON ga.id = sel.id
   AND ga.clerk_user_id = wc.clerk_user_id
  WHERE ga.id IS NULL
);
