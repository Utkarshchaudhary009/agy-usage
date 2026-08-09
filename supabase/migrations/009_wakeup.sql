-- Phase 14: Wakeup configuration + trigger logs

CREATE TABLE IF NOT EXISTS public.wakeup_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  selected_models TEXT[] DEFAULT '{claude-sonnet-4-5,gemini-3-flash,gemini-3-pro-low}',
  selected_account_ids UUID[] DEFAULT '{}',
  schedule_mode TEXT DEFAULT 'interval'
    CHECK (schedule_mode IN ('interval', 'daily', 'custom')),
  interval_hours INTEGER DEFAULT 6
    CHECK (interval_hours BETWEEN 1 AND 168),
  daily_times TEXT[] DEFAULT '{09:00,15:00,21:00}',
  cron_expression TEXT,
  custom_prompt TEXT DEFAULT 'hi',
  max_output_tokens INTEGER DEFAULT 1
    CHECK (max_output_tokens BETWEEN 1 AND 8192),
  cooldown_minutes INTEGER DEFAULT 60
    CHECK (cooldown_minutes BETWEEN 0 AND 1440),
  wake_on_reset BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wakeup_logs (
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

CREATE INDEX IF NOT EXISTS idx_wakeup_configs_user
  ON public.wakeup_configs (clerk_user_id);

CREATE INDEX IF NOT EXISTS idx_wakeup_logs_time
  ON public.wakeup_logs (clerk_user_id, created_at DESC);

ALTER TABLE public.wakeup_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wakeup_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own wakeup config"
  ON public.wakeup_configs
  FOR ALL TO authenticated
  USING (requesting_user_id() = clerk_user_id)
  WITH CHECK (requesting_user_id() = clerk_user_id);

CREATE POLICY "Users manage own wakeup logs"
  ON public.wakeup_logs
  FOR ALL TO authenticated
  USING (requesting_user_id() = clerk_user_id)
  WITH CHECK (requesting_user_id() = clerk_user_id);

CREATE OR REPLACE FUNCTION public.set_wakeup_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_wakeup_updated_at
  BEFORE UPDATE ON public.wakeup_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_wakeup_updated_at();
