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

-- Row Level Security: every row is scoped to the owning Clerk user.
ALTER TABLE public.wakeup_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own wakeup config"
  ON public.wakeup_configs
  FOR ALL TO authenticated
  USING (requesting_user_id() = clerk_user_id);

ALTER TABLE public.wakeup_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own wakeup logs"
  ON public.wakeup_logs
  FOR ALL TO authenticated
  USING (requesting_user_id() = clerk_user_id);
