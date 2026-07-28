-- supabase/migrations/001_core_schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Google accounts linked to a Clerk user
-- user_id is Clerk's user ID (string like "user_2x...")
CREATE TABLE public.google_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  is_active BOOLEAN DEFAULT false,
  token_status TEXT DEFAULT 'active' CHECK (token_status IN ('active', 'expired', 'revoked')),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clerk_user_id, email)
);

-- Only one active account per user
CREATE UNIQUE INDEX idx_one_active_account
  ON public.google_accounts (clerk_user_id) WHERE is_active = true;

-- Encrypted token storage
CREATE TABLE public.google_tokens (
  account_id UUID REFERENCES public.google_accounts(id) ON DELETE CASCADE PRIMARY KEY,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  project_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_google_accounts_clerk ON public.google_accounts (clerk_user_id);
CREATE INDEX idx_google_tokens_expires ON public.google_tokens (expires_at);

-- PostgreSQL helper for Clerk Native Auth
CREATE OR REPLACE FUNCTION requesting_user_id()
RETURNS TEXT AS $$
  SELECT auth.jwt() ->> 'sub';
$$ LANGUAGE sql STABLE;

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE public.google_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own accounts" ON public.google_accounts
  FOR ALL TO authenticated USING (requesting_user_id() = clerk_user_id);

ALTER TABLE public.google_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own tokens" ON public.google_tokens
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.google_accounts WHERE id = google_tokens.account_id AND clerk_user_id = requesting_user_id())
  );
