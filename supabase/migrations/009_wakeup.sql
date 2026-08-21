-- Wakeup configuration and trigger logs.
-- Phase 14: Wakeup Configuration UI & Storage.

CREATE TABLE public.wakeup_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  selected_models TEXT[] DEFAULT '{claude-sonnet-4-5,gemini-3-flash,gemini-3-pro-low}',
  selected_account_ids UUID[] DEFAULT '{}',
  schedule_mode TEXT DEFAULT 'interval'
    CHECK (schedule_mode IN ('interval', 'daily', 'custom')),
  interval_hours INTEGER DEFAULT 6
    CHECK (interval_hours >= 1 AND interval_hours <= 168),
  daily_times TEXT[] DEFAULT '{09:00,15:00,21:00}',
  cron_expression TEXT,
  custom_prompt TEXT DEFAULT 'hi',
  max_output_tokens INTEGER DEFAULT 1
    CHECK (max_output_tokens >= 1 AND max_output_tokens <= 8192),
  cooldown_minutes INTEGER DEFAULT 60
    CHECK (cooldown_minutes >= 0 AND cooldown_minutes <= 1440),
  wake_on_reset BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One config row per Clerk user; convenience index for cron scans by enabled flag.
CREATE INDEX idx_wakeup_configs_enabled
  ON public.wakeup_configs (enabled, clerk_user_id);

CREATE TABLE public.wakeup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  account_id UUID REFERENCES public.google_accounts(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  trigger_source TEXT NOT NULL
    CHECK (trigger_source IN ('manual', 'scheduled', 'quota_reset')),
  success BOOLEAN NOT NULL,
  duration_ms INTEGER,
  error TEXT,
  response_preview TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wakeup_logs_time
  ON public.wakeup_logs (clerk_user_id, created_at DESC);

-- Foreign-keyed column used for cascade deletes and joins should be indexed.
CREATE INDEX idx_wakeup_logs_account_id
  ON public.wakeup_logs (account_id);

-- Row Level Security. Every row is scoped to the owning Clerk user.
--
-- Config is user-managed (read / insert / update); logs are append-only audit
-- records (read / insert). This mirrors the granular, least-privilege policies
-- used for quota_cache / quota_snapshots (migrations 004 / 007). No DELETE policy
-- is created, so users can never delete their config or forge/delete logs, and no
-- UPDATE policy exists for logs so they stay immutable once written.
ALTER TABLE public.wakeup_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own wakeup config"
  ON public.wakeup_configs
  FOR SELECT TO authenticated
  USING (requesting_user_id() = clerk_user_id);
CREATE POLICY "Users can insert their own wakeup config"
  ON public.wakeup_configs
  FOR INSERT TO authenticated
  WITH CHECK (requesting_user_id() = clerk_user_id);
CREATE POLICY "Users can update their own wakeup config"
  ON public.wakeup_configs
  FOR UPDATE TO authenticated
  USING (requesting_user_id() = clerk_user_id)
  WITH CHECK (requesting_user_id() = clerk_user_id);

-- Defense in depth: drop DELETE for users (no DELETE route exists; the absence of
-- a DELETE policy already denies it, this just makes intent explicit).
REVOKE DELETE ON public.wakeup_configs FROM authenticated;

ALTER TABLE public.wakeup_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own wakeup logs"
  ON public.wakeup_logs
  FOR SELECT TO authenticated
  USING (requesting_user_id() = clerk_user_id);
-- Logs may only be written for an account the user actually owns. A NULL
-- account_id is allowed (config-level / account-agnostic triggers); a non-NULL one
-- must reference one of the caller's own google_accounts rows, otherwise a user
-- could forge audit entries against another account.
CREATE POLICY "Users can insert their own wakeup logs"
  ON public.wakeup_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    requesting_user_id() = clerk_user_id
    AND (
      account_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.google_accounts ga
        WHERE ga.id = wakeup_logs.account_id
          AND ga.clerk_user_id = requesting_user_id()
      )
    )
  );

-- Logs are append-only: users can read and insert, never update or delete.
REVOKE UPDATE, DELETE ON public.wakeup_logs FROM authenticated;
