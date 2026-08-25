-- Wakeup configuration (one row per Clerk user) and trigger history logs.
-- Config is read/written through the user-scoped Postgrest client, so RLS
-- below is the primary access control. Logs are written exclusively by
-- service-role background jobs (Inngest, manual trigger API), which bypass
-- RLS — there is deliberately no client INSERT policy so history and
-- cooldown data cannot be forged or inflated from the browser.

CREATE TABLE public.wakeup_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  selected_models TEXT[] NOT NULL DEFAULT '{claude-sonnet-4-5,gemini-3-flash,gemini-3-pro-low}',
  selected_account_ids UUID[] NOT NULL DEFAULT '{}',
  schedule_mode TEXT NOT NULL DEFAULT 'interval'
    CHECK (schedule_mode IN ('interval', 'daily', 'custom')),
  interval_hours INTEGER NOT NULL DEFAULT 6 CHECK (interval_hours BETWEEN 1 AND 168),
  daily_times TEXT[] NOT NULL DEFAULT '{09:00,15:00,21:00}'
    CHECK (array_length(daily_times, 1) IS NULL OR array_length(daily_times, 1) <= 24),
  cron_expression TEXT CHECK ((schedule_mode = 'custom') = (cron_expression IS NOT NULL)),
  custom_prompt TEXT NOT NULL DEFAULT 'hi' CHECK (char_length(custom_prompt) <= 500),
  max_output_tokens INTEGER NOT NULL DEFAULT 1 CHECK (max_output_tokens BETWEEN 1 AND 8192),
  cooldown_minutes INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 0 AND 10080),
  wake_on_reset BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At least one model must be selected ('{}' fails this check).
ALTER TABLE public.wakeup_configs
  ADD CONSTRAINT wakeup_configs_models_nonempty
  CHECK (array_length(selected_models, 1) > 0);

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wakeup_logs_time
  ON public.wakeup_logs (clerk_user_id, created_at DESC);

CREATE INDEX idx_wakeup_logs_account
  ON public.wakeup_logs (account_id);

ALTER TABLE public.wakeup_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wakeup_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own wakeup config" ON public.wakeup_configs
  FOR ALL TO authenticated
  USING (requesting_user_id() = clerk_user_id)
  WITH CHECK (requesting_user_id() = clerk_user_id);

CREATE POLICY "Users can read their own wakeup logs" ON public.wakeup_logs
  FOR SELECT TO authenticated
  USING (requesting_user_id() = clerk_user_id);
