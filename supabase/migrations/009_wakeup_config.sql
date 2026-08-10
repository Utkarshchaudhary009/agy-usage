-- ============================================================================
-- Wakeup configuration + logs
-- ============================================================================

CREATE TABLE public.wakeup_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  selected_models TEXT[] DEFAULT '{claude-sonnet-4-5,gemini-3-flash,gemini-3-pro-low}'
    CHECK (array_length(selected_models, 1) IS NULL OR array_length(selected_models, 1) <= 25),
  selected_account_ids UUID[] DEFAULT '{}'
    CHECK (array_length(selected_account_ids, 1) IS NULL OR array_length(selected_account_ids, 1) <= 100),
  schedule_mode TEXT DEFAULT 'interval'
    CHECK (schedule_mode IN ('interval', 'daily', 'custom')),
  interval_hours INTEGER DEFAULT 6
    CHECK (interval_hours >= 1 AND interval_hours <= 168),
  daily_times TEXT[] DEFAULT '{09:00,15:00,21:00}'
    CHECK (array_length(daily_times, 1) IS NULL OR array_length(daily_times, 1) <= 50),
  cron_expression TEXT
    CHECK (cron_expression IS NULL OR length(cron_expression) <= 100),
  custom_prompt TEXT DEFAULT 'hi'
    CHECK (length(custom_prompt) <= 2000),
  max_output_tokens INTEGER DEFAULT 1
    CHECK (max_output_tokens >= 1 AND max_output_tokens <= 8192),
  cooldown_minutes INTEGER DEFAULT 60
    CHECK (cooldown_minutes >= 0 AND cooldown_minutes <= 1440),
  wake_on_reset BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.wakeup_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  account_id UUID REFERENCES public.google_accounts(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL
    CHECK (length(model_id) <= 100),
  trigger_source TEXT NOT NULL
    CHECK (trigger_source IN ('manual', 'scheduled', 'quota_reset')),
  success BOOLEAN NOT NULL,
  duration_ms INTEGER,
  error TEXT
    CHECK (length(error) <= 2000),
  response_preview TEXT
    CHECK (length(response_preview) <= 2000),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wakeup_configs_user
  ON public.wakeup_configs (clerk_user_id);
CREATE INDEX idx_wakeup_logs_time
  ON public.wakeup_logs (clerk_user_id, created_at DESC);
CREATE INDEX idx_wakeup_logs_account
  ON public.wakeup_logs (account_id, created_at DESC);

-- Row Level Security: both tables are keyed by clerk_user_id, so we can use the
-- native Clerk third-party auth helper directly (no join required).
ALTER TABLE public.wakeup_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own wakeup config"
  ON public.wakeup_configs
  FOR ALL TO authenticated
  USING (requesting_user_id() = clerk_user_id)
  WITH CHECK (requesting_user_id() = clerk_user_id);

ALTER TABLE public.wakeup_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own wakeup logs"
  ON public.wakeup_logs
  FOR ALL TO authenticated
  USING (requesting_user_id() = clerk_user_id)
  WITH CHECK (
    requesting_user_id() = clerk_user_id
    AND (
      account_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.google_accounts ga
        WHERE ga.id = account_id
          AND ga.clerk_user_id = requesting_user_id()
      )
    )
  );

-- Keep updated_at fresh on every write.
CREATE OR REPLACE FUNCTION public.touch_wakeup_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wakeup_configs_updated_at
  BEFORE UPDATE ON public.wakeup_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_wakeup_updated_at();
