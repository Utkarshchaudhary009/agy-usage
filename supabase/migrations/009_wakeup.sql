-- Phase 14: Wakeup configuration + trigger logs

CREATE TABLE public.wakeup_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  selected_models TEXT[] DEFAULT '{claude-sonnet-4-5,gemini-3-flash,gemini-3-pro-low}',
  selected_account_ids UUID[] DEFAULT '{}',
  schedule_mode TEXT DEFAULT 'interval'
    CHECK (schedule_mode IN ('interval', 'daily', 'custom')),
  interval_hours INTEGER DEFAULT 6,
  daily_times TEXT[] DEFAULT '{09:00,15:00,21:00}',
  cron_expression TEXT,
  custom_prompt TEXT DEFAULT 'hi',
  max_output_tokens INTEGER DEFAULT 1,
  cooldown_minutes INTEGER DEFAULT 60,
  wake_on_reset BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- Trigger keeps updated_at fresh on every write.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wakeup_configs_touch_updated_at
  BEFORE UPDATE ON public.wakeup_configs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS: configs + logs are scoped to the Clerk user via requesting_user_id().
ALTER TABLE public.wakeup_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wakeup_logs ENABLE ROW LEVEL SECURITY;

-- Config writes must go through the `save_wakeup_config` SECURITY DEFINER RPC so
-- the account-ownership check stays atomic (migration 010). A direct client
-- UPDATE/INSERT here would bypass that check, so the client gets SELECT only.
CREATE POLICY "Users can read their own wakeup config" ON public.wakeup_configs
  FOR SELECT TO authenticated USING (requesting_user_id() = clerk_user_id);

-- Logs are written only by the backend (Inngest) using the service_role, which
-- bypasses RLS. The client therefore gets no write policies — a direct INSERT
-- could otherwise attribute a row to an account it does not own.
CREATE POLICY "Users can read their own wakeup logs" ON public.wakeup_logs
  FOR SELECT TO authenticated USING (requesting_user_id() = clerk_user_id);
