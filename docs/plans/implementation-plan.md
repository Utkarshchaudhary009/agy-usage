# Antigravity Usage - Web Dashboard Implementation Plan

> **Goal**: Build a cloud-based web dashboard (Next.js + Supabase + Vercel) that shows Antigravity coding agent quota/usage for all accounts. No laptop needed -- just open a website and get all details.

> **Reference Repos**: `reference-repo/antigravity-usage/` (TypeScript CLI), `reference-repo/ccusage/` (Rust CLI)

> **Tech Stack**:
> - **Next.js 16** (App Router) -- Frontend + API routes
> - **Clerk** -- User authentication (sign up / sign in / session management)
> - **Supabase** -- Database (Postgres) + Realtime subscriptions. Uses Clerk Native Third-Party Auth (JWKS) for RLS.
> - **Inngest** -- Background jobs, cron jobs, event-driven workflows
> - **Vercel** -- Hosting + Edge network
> - **Tailwind CSS 4** + **TypeScript 5**

---

## Why Google OAuth is Mandatory (Can't Work Without It)

### The Problem
The quota data lives behind Google's **private Cloud Code API** (`cloudcode-pa.googleapis.com`). Every request requires:
```
Authorization: Bearer <google_access_token>
```

There are only **two ways** to get quota data:

| Method | How | Works on Web? |
|--------|-----|---------------|
| **Local Mode** | Connect to IDE language server on `127.0.0.1` | **No** -- can't access user's localhost from cloud |
| **Cloud Mode** | Call Google's API with OAuth token | **Yes** -- this is what we use |

**Without Google OAuth tokens, the dashboard has zero data to show.** There is no public API key, no alternative authentication method. OAuth is the only mechanism Google provides for third-party access to Cloud Code data.

### Two Separate Auth Layers (Both Required)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Auth Layer 1: CLERK                          │
│                                                                 │
│  Purpose: "Who is visiting our website?"                        │
│  Method:  Email/password, Google social login, etc.             │
│  Scopes:  email, profile (standard)                             │
│  Result:  Clerk userId, session management, protected routes    │
│                                                                 │
│  CAN we skip this? No -- need user identity for multi-tenant    │
│  CAN Clerk replace Google OAuth? NO -- wrong scopes             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                Auth Layer 2: CUSTOM GOOGLE OAUTH                │
│                                                                 │
│  Purpose: "Can we call Google's Cloud Code API on their behalf?"│
│  Method:  Custom OAuth flow with specific scopes                │
│  Scopes:  cloud-platform, userinfo.email                        │
│  Result:  access_token + refresh_token stored in Supabase       │
│                                                                 │
│  CAN we skip this? **NO** -- mandatory for ALL core features    │
│  WHY can't Clerk do this? Clerk's Google sign-in only gives     │
│  email+profile scopes. Cloud Code API requires cloud-platform   │
│  scope which is a privileged GCP scope Clerk cannot provide.    │
└─────────────────────────────────────────────────────────────────┘
```

### What Each OAuth Token Does

| Token | Lifetime | Purpose | Storage |
|-------|----------|---------|---------|
| Clerk session | ~7 days (configurable) | Protect dashboard routes, identify user | Clerk manages (cookies) |
| Google access_token | ~1 hour | Call Cloud Code API (`Bearer` header) | Supabase (encrypted) |
| Google refresh_token | Until revoked | Get new access_tokens without re-login | Supabase (encrypted) |

### Flow: How a User Gets Quota Data

```
1. User signs up/in via Clerk (app login)
2. User clicks "Link Google Account" in dashboard
3. Custom OAuth flow → Google consent screen (cloud-platform scope)
4. Google redirects back with auth code
5. Server exchanges code for access_token + refresh_token
6. Tokens stored encrypted in Supabase
7. Server uses tokens to call Cloud Code API → quota data
8. Dashboard displays quota
9. When access_token expires (~1hr), server auto-refreshes using refresh_token
```

**Bottom line**: Clerk handles "who is this person on our site." Custom Google OAuth handles "can we read their Cloud Code quota from Google." Both are required, neither can replace the other.

---

## Architecture Overview

```
                        +------------------+
                        |   User Browser   |
                        |  (Any Device)    |
                        +--------+---------+
                                 |
                                 | HTTPS
                                 v
                    +------------+-------------+
                    |       Vercel (CDN)        |
                    |  Next.js App Router       |
                    |                           |
                    |  +---------------------+  |
                    |  | Clerk Middleware     |  |
                    |  | (Auth gate)         |  |
                    |  +---------------------+  |
                    |                           |
                    |  +---------------------+  |
                    |  | Server Components   |  |
                    |  | + API Routes        |  |
                    |  +----------+----------+  |
                    +---+---------+--------+----+
                        |         |        |
               +--------+    +---+---+    ++-----------+
               |              |       |    |            |
               v              v       v    v            v
    +----------+--+    +------+--+ +--+----+---+ +------+-------+
    | Google OAuth |    | Clerk   | | Supabase  | | Google Cloud |
    | (Account    |    |         | | (Postgres)| | Code API     |
    |  Linking)   |    | Users   | |           | |              |
    |             |    | Sessions| | accounts  | | loadCodeAss  |
    | consent     |    | SSO     | | tokens    | | fetchModels  |
    | tokens      |    |         | | cache     | | streamGen    |
    | refresh     |    |         | | history   | | onboardUser  |
    +-------------+    +---------+ | wakeup    | +--------------+
                                   +-----+-----+
                                         |
                                   +-----+-----+
                                   |  Inngest   |
                                   |            |
                                   | Cron jobs  |
                                   | Wakeup     |
                                   | Background |
                                   | Retries    |
                                   +------------+
```

---

## Phase 1: Project Foundation & Tooling

**Feature**: Dev environment, linting, formatting, project config

**Tasks**:
- [x] Clean the default Next.js scaffold (remove boilerplate from `page.tsx`, `globals.css`)
- [x] Install core dependencies:
  - `@clerk/nextjs` -- Authentication
  - `@supabase/supabase-js` -- Database client
  - `inngest` -- Background jobs & cron
  - `server-only` -- Prevent server code from leaking to client
- [x] Install UI dependencies: `lucide-react` (icons), `clsx`, `tailwind-merge`
- [x] Configure `biome.json` with strict TypeScript rules
- [x] Create `.env.local.example` with all required env vars:
  ```
  # Clerk
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
  CLERK_SECRET_KEY=
  NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
  NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

  # Supabase (database only, no auth)
  NEXT_PUBLIC_SUPABASE_URL=
  SUPABASE_SERVICE_ROLE_KEY=

  # Google OAuth (for Cloud Code account linking)
  GOOGLE_CLIENT_ID=
  GOOGLE_CLIENT_SECRET=
  NEXT_PUBLIC_APP_URL=http://localhost:3000

  # Token encryption (for state cookies)
  COOKIE_ENCRYPTION_KEY=

  # Inngest
  INNGEST_EVENT_KEY=
  INNGEST_SIGNING_KEY=
  ```
- [x] Set up `src/lib/` directory structure
- [x] Create `tsconfig.json` path aliases (`@/` for `src/`)

**Deliverable**: Clean project scaffold with all tooling configured, `bun dev` runs without errors.

**Files**:
```
src/lib/                    # Created empty
.env.local.example          # Template
package.json                # Updated deps
biome.json                  # Updated rules
```

---

## Phase 2: Supabase Database Schema

**Feature**: Database schema for accounts, tokens, cache (Supabase is database-only -- Clerk handles auth)

**Tasks**:
- [x] Create Supabase project (or configure existing one)
- [x] Create Supabase client utilities:
  - `src/lib/supabase/client.ts` -- Browser client (for Realtime subscriptions only)
  - `src/lib/supabase/server.ts` -- Server-side client (service role, for API routes + Inngest)
- [x] Create migration for core tables:

```sql
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
```

- [x] Create PostgreSQL helper for Clerk Native Auth:
  ```sql
  CREATE OR REPLACE FUNCTION requesting_user_id()
  RETURNS TEXT AS $$
    SELECT auth.jwt() ->> 'sub';
  $$ LANGUAGE sql STABLE;
  ```
- [x] Enable Row Level Security (RLS) on all tables:
  ```sql
  ALTER TABLE public.google_accounts ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users can manage their own accounts" ON public.google_accounts
    FOR ALL TO authenticated USING (requesting_user_id() = clerk_user_id);

  ALTER TABLE public.google_tokens ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users can manage their own tokens" ON public.google_tokens
    FOR ALL TO authenticated USING (
      EXISTS (SELECT 1 FROM public.google_accounts WHERE id = google_tokens.account_id AND clerk_user_id = requesting_user_id())
    );
  ```
- [x] Configure Supabase External OAuth Provider to use Clerk's JWKS endpoint (no JWT Templates needed).
- [x] Update `src/lib/supabase/server.ts` to initialize using the standard Clerk session token (`await auth().getToken()`) in the `Authorization` header.
- [x] Create TypeScript types for all tables in `src/lib/types/database.ts`

**Deliverable**: Supabase project with core schema, native third-party Clerk integration for RLS, and TypeScript types ready.

**Files**:
```
src/lib/supabase/client.ts
src/lib/supabase/server.ts
src/lib/types/database.ts
supabase/migrations/001_core_schema.sql
```

---

## Phase 3: Clerk Auth & App Login

**Feature**: User authentication via Clerk (sign up / sign in / session management)

**Tasks**:
- [x] Configure Clerk project at clerk.com:
  - Enable Email/password sign-in
  - Enable Google social connection (this is for APP login only, NOT Cloud Code)
  - Set redirect URLs
- [x] Create Clerk middleware `src/middleware.ts`:
  ```typescript
  import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

  const isPublicRoute = createRouteMatcher([
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/',                              // Landing page
    '/api/inngest(.*)',               // Inngest webhook endpoint
  ])

  export default clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect()
    }
  })

  export const config = {
    matcher: [
      '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
      '/(api|trpc)(.*)',
    ],
  }
  ```
- [x] Create sign-in page `src/app/sign-in/[[...sign-in]]/page.tsx`:
  ```typescript
  import { SignIn } from '@clerk/nextjs'
  export default function SignInPage() {
    return <SignIn />
  }
  ```
- [x] Create sign-up page `src/app/sign-up/[[...sign-up]]/page.tsx`:
  ```typescript
  import { SignUp } from '@clerk/nextjs'
  export default function SignUpPage() {
    return <SignUp />
  }
  ```
- [x] Wrap app with `ClerkProvider` in `src/app/layout.tsx`
- [x] Add `<UserButton />` to header for profile/logout

**Deliverable**: Users can create accounts and log in. All dashboard routes are protected. Clerk handles sessions, tokens, and UI components.

**Files**:
```
src/middleware.ts
src/app/layout.tsx                              # ClerkProvider wrapper
src/app/sign-in/[[...sign-in]]/page.tsx
src/app/sign-up/[[...sign-up]]/page.tsx
```

---

## Phase 4: Dashboard Layout & Shell

**Feature**: Main dashboard layout with navigation, sidebar, and responsive shell

**Tasks**:
- [x] Create the dashboard layout `src/app/(dashboard)/layout.tsx`:
  - Sidebar navigation (collapsible on mobile)
  - Top header with Clerk `<UserButton />`, `MobileNav`, and `ThemeToggle`
  - Main content area
- [x] Navigation items:
  - Dashboard (home) -- quota overview
  - Accounts -- manage linked Google accounts
  - Wakeup -- auto-trigger config
  - History -- quota history & charts
  - Settings -- preferences
- [x] Build reusable UI components:
  - `src/components/ui/card.tsx`
  - `src/components/ui/button.tsx`
  - `src/components/ui/badge.tsx`
  - `src/components/ui/progress.tsx`
  - `src/components/ui/skeleton.tsx` (loading states)
  - `src/components/ui/sonner.tsx` (notifications)
- [x] Create dashboard home page placeholder `src/app/(dashboard)/page.tsx`
- [x] Mobile-responsive design (hamburger menu, stacked cards)
- [x] Dark mode support via Tailwind
- [x] Use Clerk's `auth()` in Server Components to get `userId`

**Deliverable**: Authenticated users see a polished dashboard shell with navigation. All pages are placeholders.

**Files**:
```
src/app/(dashboard)/layout.tsx
src/app/(dashboard)/page.tsx
src/components/layout/sidebar.tsx
src/components/layout/header.tsx
src/components/layout/mobile-nav.tsx
src/components/ui/card.tsx
src/components/ui/button.tsx
src/components/ui/badge.tsx
src/components/ui/progress-bar.tsx
src/components/ui/skeleton.tsx
src/components/ui/toast.tsx
```

---

## Phase 5: Google OAuth Account Linking

**Feature**: Link Google Cloud Code accounts to fetch quota data (this is the custom OAuth, NOT Clerk)

**Why this exists**: Clerk authenticates users into our app. But to read quota from Google's Cloud Code API, we need Google OAuth tokens with `cloud-platform` scope. Clerk's Google sign-in doesn't provide this scope. So we build a separate "Link Account" flow.

**Tasks**:
- [x] Create Google Cloud Console OAuth 2.0 credentials:
  - Application type: Web application
  - Authorized redirect URI: `{APP_URL}/api/auth/google/callback`
  - Note `client_id` and `client_secret` → env vars
- [x] Create Google OAuth configuration (server-only):
  - `src/lib/google/oauth-config.ts`:
  ```typescript
  // server-only
  export const GOOGLE_OAUTH = {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`,
  }
  ```
- [x] Build "Link Account" API route `src/app/api/auth/google/link/route.ts`:
  - Verify Clerk session via `auth()` -- must be logged in
  - Generate PKCE code verifier + challenge
  - Generate random `state` token
  - Store `{ verifier, state, clerkUserId }` in encrypted httpOnly cookie
  - Redirect to Google consent screen with `access_type=offline`, `prompt=consent`
- [x] Build OAuth callback handler `src/app/api/auth/google/callback/route.ts`:
  - Verify `state` matches cookie (CSRF protection)
  - Exchange auth code for tokens via `POST https://oauth2.googleapis.com/token`
  - Fetch user email via `GET https://www.googleapis.com/oauth2/v2/userinfo`
  - Encrypt access_token + refresh_token using Supabase Vault RPC
  - Upsert into `google_accounts` + `google_tokens` using Clerk userId from cookie
  - Clear OAuth cookie
  - Redirect to `/accounts` with success flash
- [x] Create token encryption utilities `src/lib/google/state-crypto.ts`:
  - `encryptToken(plaintext: string): string` -- AES-256-GCM for state cookie
  - `decryptToken(ciphertext: string): string` -- decrypt
  - Key from `COOKIE_ENCRYPTION_KEY` env var (32-byte hex string)
- [x] Handle edge cases:
  - Account already linked → update tokens silently
  - Google consent denied → redirect with error message
  - Token exchange failure → redirect with error message
  - User not logged in → redirect to sign-in

**Deliverable**: Users can click "Link Google Account", complete Google OAuth, and see the account appear in their dashboard.

**Files**:
```
src/lib/google/oauth-config.ts
src/lib/google/token-crypto.ts
src/app/api/auth/google/link/route.ts
src/app/api/auth/google/callback/route.ts
```

---

## Phase 6: Token Manager & Auto-Refresh

**Feature**: Server-side token management with automatic refresh (ported from CLI's `token-manager.ts`)

**Tasks**:
- [x] Create `src/lib/google/token-manager.ts` (server-only):
  ```typescript
  import 'server-only'

  export async function getValidAccessToken(accountId: string): Promise<string> {
    // 1. Load encrypted tokens from google_tokens table
    // 2. Decrypt access_token
    // 3. Check if expires_at > now + 5min buffer
    // 4. If valid → return access_token
    // 5. If expired → refresh:
    //    POST https://oauth2.googleapis.com/token
    //    { refresh_token, client_id, client_secret, grant_type: 'refresh_token' }
    // 6. Encrypt new access_token, update DB
    // 7. Return fresh access_token
    // 8. If refresh fails (401) → mark token_status = 'revoked'
  }

  export async function isTokenValid(accountId: string): Promise<boolean>
  export async function revokeAccount(accountId: string): Promise<void>
  ```
- [x] Handle refresh failures:
  - `invalid_grant` → refresh token revoked by user → set `token_status = 'revoked'`
  - Network errors → retry once, then throw
  - Unknown errors → log and throw
- [x] Token status transitions:
  - `active` → tokens work normally
  - `expired` → access_token expired, auto-refresh will fix
  - `revoked` → refresh_token invalid, user must re-link via OAuth

**Deliverable**: Any server-side code can call `getValidAccessToken(accountId)` and get a fresh token, with transparent auto-refresh.

**Files**:
```
src/lib/google/token-manager.ts
```

---

## Phase 7: Cloud Code API Client

**Feature**: Server-side Google Cloud Code API client (ported from CLI's `cloudcode.ts`)

**Tasks**:
- [x] Create `src/lib/google/cloudcode-client.ts`:
  - `loadCodeAssist(accessToken: string): Promise<LoadCodeAssistResponse>`
    - POST `https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`
    - Body: `{ metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" } }`
    - Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`, `User-Agent: antigravity`
  - `fetchAvailableModels(accessToken: string, projectId?: string): Promise<FetchModelsResponse>`
    - POST `https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`
    - Body: `{ project: "<projectId>" }` (optional)
  - `onboardUser(accessToken: string): Promise<OnboardResponse>`
    - POST `https://cloudcode-pa.googleapis.com/v1internal:onboardUser`
    - Used when user has no projectId yet
  - `streamGenerateContent(accessToken, projectId, modelId, prompt): Promise<GenerateResponse>`
    - POST `https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`
    - Used for wakeup triggers
    - Reads first SSE chunk, aborts connection (minimal token usage)
- [x] Create response types `src/lib/types/cloudcode.ts` (ported from CLI's types)
- [x] Add error handling:
  - 401/403 → mark account `token_status = 'revoked'`
  - 429 → rate limited, return retry-after header value
  - 5xx → server error, throw retryable error
- [x] Create `src/lib/google/errors.ts` with typed error classes:
  ```typescript
  export class CloudCodeAuthError extends Error { accountId: string }
  export class CloudCodeRateLimitError extends Error { retryAfterMs: number }
  export class CloudCodeServerError extends Error { statusCode: number }
  ```

**Deliverable**: Full Cloud Code API client callable from any server-side code. Matches CLI behavior exactly.

**Files**:
```
src/lib/google/cloudcode-client.ts
src/lib/google/errors.ts
src/lib/types/cloudcode.ts
```

---

## Phase 8: Quota Parser & Data Types

**Feature**: Parse Cloud Code API responses into normalized quota data (ported from CLI's `parser.ts`)

**Tasks**:
- [x] Create quota types `src/lib/types/quota.ts`:
  ```typescript
  export interface QuotaSnapshot {
    timestamp: string
    method: 'google'
    email: string
    accountId: string
    promptCredits?: PromptCreditsInfo
    models: ModelQuotaInfo[]
    planType?: string
  }

  export interface ModelQuotaInfo {
    modelId: string
    label: string
    displayName: string
    remainingPercentage: number      // 0.0 to 1.0
    isExhausted: boolean
    resetTime?: string               // ISO date
    timeUntilResetMs?: number
    isAutocompleteOnly?: boolean
    modelProvider?: string           // 'ANTHROPIC' | 'GOOGLE' etc.
    supportsThinking?: boolean
  }

  export interface PromptCreditsInfo {
    available: number
    monthly: number
    usedPercentage: number
    remainingPercentage: number
  }
  ```
- [x] Create parser `src/lib/google/parser.ts`:
  - `parseQuotaSnapshot(codeAssist, models, email, accountId): QuotaSnapshot`
  - Filter autocomplete models by default (same logic as CLI `--all-models` flag)
  - Calculate `timeUntilResetMs` from `resetTime`
  - Handle missing/null fields gracefully
  - Normalize model names (strip prefixes, apply aliases)
- [x] Create project ID resolver `src/lib/google/project-resolver.ts`:
  - `resolveProjectId(accountId): Promise<string>`
  - Check `google_tokens.project_id` first (cached)
  - If missing → call `loadCodeAssist` → extract `cloudaicompanionProject`
  - If still missing → call `onboardUser` to provision
  - Save resolved projectId to DB for next time

**Deliverable**: Raw API responses are parsed into clean `QuotaSnapshot` objects ready for display.

**Files**:
```
src/lib/types/quota.ts
src/lib/google/parser.ts
src/lib/google/project-resolver.ts
```

---

## Phase 9: Quota API Route & Caching

**Feature**: API endpoint to fetch quota data with 5-minute cache layer

**Tasks**:
- [x] Create quota cache table migration `004_quota_cache.sql`:
  ```sql
  CREATE TABLE public.quota_cache (
    account_id UUID REFERENCES public.google_accounts(id) ON DELETE CASCADE PRIMARY KEY,
    snapshot JSONB NOT NULL,
    cached_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX idx_quota_cache_time ON public.quota_cache (cached_at);
  ```
- [x] Create quota service `src/lib/quota/service.ts`:
  - `fetchQuotaForAccount(accountId): Promise<QuotaSnapshot>` -- fresh from API
  - `getCachedQuota(accountId): Promise<{ snapshot: QuotaSnapshot; fresh: boolean } | null>` -- check cache (5 min TTL)
  - `getQuota(accountId, forceRefresh): Promise<QuotaSnapshot>` -- cache-first, fetch if stale
  - `getQuotaAllAccounts(clerkUserId, forceRefresh): Promise<QuotaSnapshot[]>` -- parallel fetch all accounts
- [x] Create API route `src/app/api/quota/route.ts`:
  - Verify Clerk auth via `auth()` → get `userId`
  - `GET /api/quota` → all accounts for current user
  - `GET /api/quota?account=<id>` → specific account
  - `GET /api/quota?refresh=true` → force refresh (skip cache)
  - Returns `{ snapshots: QuotaSnapshot[], cachedAt: string }`
  - Validates that requested account belongs to the authenticated user
- [x] Add rate limiting: max 10 force-refreshes per minute per user using Upstash Redis (`@upstash/ratelimit`)

**Deliverable**: Frontend can fetch quota data via API. Data is cached for 5 minutes. Parallel multi-account fetching works.

**Files**:
```
src/lib/quota/service.ts
src/app/api/quota/route.ts
supabase/migrations/002_quota_cache.sql
```

---

## Phase 10: Quota Dashboard UI

**Feature**: Main dashboard displaying quota for all linked accounts

**Tasks**:
- [x] Build quota dashboard page `src/app/(dashboard)/page.tsx`:
  - Server Component using Clerk `auth()` to get userId
  - Fetches initial quota data server-side
  - Passes to client components for interactivity
- [x] Build model quota card `src/components/quota/model-card.tsx`:
  - Model name + provider badge (Claude / Gemini)
  - Circular progress gauge or horizontal bar showing remaining %
  - Color coding: green (>=75%), yellow (>=50%), orange (>=25%), red (<25%), gray (exhausted)
  - Reset countdown timer (live updating)
  - "Exhausted" badge when 0%
- [x] Build quota grid `src/components/quota/quota-grid.tsx`:
  - Responsive grid of model cards
  - Filter: All / Claude / Gemini
  - Toggle: Hide/show autocomplete models
- [x] Build prompt credits card `src/components/quota/credits-card.tsx`:
  - Available / Monthly credits
  - Usage percentage bar
  - Plan type badge
- [x] Build account summary header `src/components/quota/account-header.tsx`:
  - Account email
  - Last refreshed timestamp
  - "Refresh" button
  - Account switcher (if multiple accounts)
- [x] Build multi-account view `src/components/quota/multi-account-view.tsx`:
  - Tabs or accordion for each account
  - "Refresh All" button
  - Side-by-side comparison mode
- [x] Add loading skeletons for all components
- [x] Add error states (account needs re-auth, API error, no accounts linked)
- [x] Add SWR or React Query for data fetching with auto-revalidation (5 min)

**Deliverable**: Beautiful, responsive quota dashboard showing all models across all accounts with live countdown timers.

**Files**:
```
src/app/(dashboard)/page.tsx
src/components/quota/model-card.tsx
src/components/quota/quota-grid.tsx
src/components/quota/credits-card.tsx
src/components/quota/account-header.tsx
src/components/quota/multi-account-view.tsx
src/components/quota/countdown-timer.tsx
src/hooks/use-quota.ts
```

---

## Phase 11: Account Management UI

**Feature**: Full account management page (list, add, switch, remove accounts)

**Tasks**:
- [x] Build accounts page `src/app/(dashboard)/accounts/page.tsx`
- [x] Build account list `src/components/accounts/account-list.tsx`:
  - All linked Google accounts
  - Active account highlighted with badge
  - Token status indicator: green (active) / yellow (expired) / red (revoked)
  - Last used timestamp
- [x] "Link New Account" button → redirects to `/api/auth/google/link`
- [x] Account actions:
  - "Set as Active" → PATCH `/api/accounts/[id]`
  - "Re-authenticate" → redirect to Google OAuth (for revoked accounts)
  - "Remove Account" → confirmation dialog → DELETE `/api/accounts/[id]`
- [x] Create account management API routes:
  - `DELETE /api/accounts/[id]/route.ts` → remove account + tokens
  - `PATCH /api/accounts/[id]/route.ts` → update is_active
  - `POST /api/accounts/[id]/refresh-token/route.ts` → force token refresh
  - All routes verify Clerk auth + account ownership
- [x] Build account card `src/components/accounts/account-card.tsx`:
  - Email, display name
  - Added date, token status
  - Quick quota summary (total models, exhausted count)

**Deliverable**: Users can manage all their linked Google accounts from a single page.

**Files**:
```
src/app/(dashboard)/accounts/page.tsx
src/components/accounts/account-list.tsx
src/components/accounts/account-card.tsx
src/components/accounts/remove-dialog.tsx
src/app/api/accounts/[id]/route.ts
src/app/api/accounts/[id]/refresh-token/route.ts
```

---

## Phase 12: Inngest Setup & Quota History Schema

**Feature**: Inngest integration + historical quota snapshot storage

**Tasks**:
- [x] Install and configure Inngest:
  - `src/lib/inngest/client.ts` → Inngest client instance
  ```typescript
  import { Inngest } from 'inngest'
  export const inngest = new Inngest({ id: 'agy-usage' })
  ```
  - `src/app/api/inngest/route.ts` → Inngest webhook handler
  ```typescript
  import { serve } from 'inngest/next'
  import { inngest } from '@/lib/inngest/client'
  import { functions } from '@/lib/inngest/functions'
  export const { GET, POST, PUT } = serve({ client: inngest, functions })
  ```
- [x] Create migration `007_quota_history.sql`:
  ```sql
  CREATE TABLE public.quota_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES public.google_accounts(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    plan_type TEXT,
    prompt_credits_available INTEGER,
    prompt_credits_monthly INTEGER,
    snapshot_data JSONB NOT NULL
  );

  CREATE TABLE public.model_quota_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID REFERENCES public.quota_snapshots(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    label TEXT NOT NULL,
    remaining_percentage NUMERIC(5,4),
    is_exhausted BOOLEAN,
    reset_time TIMESTAMPTZ
  );

  CREATE INDEX idx_snapshots_time
    ON public.quota_snapshots (account_id, timestamp DESC);
  ```
- [x] Create quota history service `src/lib/quota/history.ts`:
  - `saveSnapshot(accountId, snapshot)` → insert into both tables
  - `getHistory(accountId, from, to)` → time-range query
  - `getModelHistory(accountId, modelId, from, to)` → per-model history
- [x] Create Inngest function for periodic quota polling `src/lib/inngest/functions/poll-quota.ts`:
  ```typescript
  export const pollQuota = inngest.createFunction(
    { id: 'poll-quota-all-users', name: 'Poll Quota for All Users' },
    { cron: '*/30 * * * *' },  // Every 30 minutes
    async ({ step }) => {
      const accounts = await step.run('get-all-active-accounts', async () => {
        // Query all accounts with active tokens
      })

      // Fan out: Use coordinator pattern to emit events for parallel execution
      const events = accounts.map(account => ({
        name: 'quota/fetch.requested',
        data: { accountId: account.id }
      }))
      
      if (events.length > 0) {
        await step.sendEvent('dispatch-quota-fetches', events)
      }
    }
  )

  export const fetchQuotaHandler = inngest.createFunction(
    { id: 'fetch-account-quota', name: 'Fetch Quota for Account', retries: 3 },
    { event: 'quota/fetch.requested' },
    async ({ event, step }) => {
      const { accountId } = event.data
      const snapshot = await step.run('fetch-api', () => fetchQuotaForAccount(accountId))
      await step.run('save-db', () => saveSnapshot(accountId, snapshot))
    }
  )
  ```
- [x] Update quota service to also save snapshot on every fresh user-initiated fetch
- [x] Create `src/lib/inngest/functions/index.ts` → export all functions

**Deliverable**: Inngest connected. Every quota fetch (user-initiated or cron) is recorded as a historical snapshot. Inngest polls every 30 min to build history even when user isn't on the site.

**Files**:
```
src/lib/inngest/client.ts
src/lib/inngest/functions/index.ts
src/lib/inngest/functions/poll-quota.ts
src/app/api/inngest/route.ts
src/lib/quota/history.ts
src/lib/types/history.ts
supabase/migrations/007_quota_history.sql
```

---

## Phase 13: Quota History Charts & Analytics

**Feature**: Visual charts showing quota usage trends over time

**Tasks**:
- [ ] Install charting library: `recharts`
- [ ] Build history page `src/app/(dashboard)/history/page.tsx`
- [ ] Build quota burndown chart `src/components/charts/burndown-chart.tsx`:
  - Line chart showing remaining % over time for each model
  - Time range selector: 24h, 7d, 30d
  - Color-coded lines per model
- [ ] Build prompt credits chart `src/components/charts/credits-chart.tsx`:
  - Area chart showing credits usage over time
  - Available vs used overlay
- [ ] Build model comparison chart `src/components/charts/model-comparison.tsx`:
  - Bar chart comparing current quota across all models
  - Group by provider (Claude vs Gemini)
- [ ] Build account comparison chart `src/components/charts/account-comparison.tsx`:
  - Side-by-side bars for each account's models
- [ ] Create history API route `src/app/api/quota/history/route.ts`:
  - `GET /api/quota/history?account=<id>&from=<iso>&to=<iso>&model=<id>`
  - Returns time-series data optimized for charts
  - Clerk auth + ownership verification
- [ ] Add date range picker component
- [ ] Add export as CSV/JSON button for raw data

**Deliverable**: Rich analytics dashboard with burndown charts, comparisons, and trend visualization.

**Files**:
```
src/app/(dashboard)/history/page.tsx
src/components/charts/burndown-chart.tsx
src/components/charts/credits-chart.tsx
src/components/charts/model-comparison.tsx
src/components/charts/account-comparison.tsx
src/components/charts/date-range-picker.tsx
src/app/api/quota/history/route.ts
```

---

## Phase 14: Wakeup Configuration UI & Storage

**Feature**: Configure auto-wakeup schedules (replaces CLI's `wakeup config`)

**Tasks**:
- [ ] Create migration `004_wakeup.sql`:
  ```sql
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
  ```
- [ ] Build wakeup config page `src/app/(dashboard)/wakeup/page.tsx`
- [ ] Build config form `src/components/wakeup/config-form.tsx`:
  - Enable/disable toggle
  - Model selector (checkboxes: claude-sonnet-4-5, gemini-3-flash, gemini-3-pro-low)
  - Account selector (which linked accounts to trigger)
  - Schedule mode selector (interval / daily times / custom cron)
  - Interval slider (every N hours)
  - Daily time picker (add/remove times)
  - Custom cron expression input with human-readable preview
  - Save button → PUT `/api/wakeup/config`
- [ ] Create wakeup config API routes:
  - `GET /api/wakeup/config` → get current config
  - `PUT /api/wakeup/config` → update config (validates, then saves)
  - Both verify Clerk auth
- [ ] Show "next trigger" preview based on schedule
- [ ] Validate cron expressions server-side

**Deliverable**: Users can configure their wakeup schedule through a polished UI. Config saved to Supabase.

**Files**:
```
supabase/migrations/004_wakeup.sql
src/app/(dashboard)/wakeup/page.tsx
src/components/wakeup/config-form.tsx
src/components/wakeup/model-selector.tsx
src/components/wakeup/schedule-picker.tsx
src/app/api/wakeup/config/route.ts
src/lib/types/wakeup.ts
```

---

## Phase 15: Wakeup Trigger Engine

**Feature**: Server-side wakeup trigger service (ported from CLI's `trigger-service.ts`)

**Tasks**:
- [ ] Create trigger service `src/lib/wakeup/trigger-service.ts`:
  - `triggerSingleModel(accountId, modelId, prompt, maxTokens): Promise<TriggerResult>`
    - Get valid token via token-manager
    - Resolve project ID
    - Call `streamGenerateContent` endpoint
    - Read first SSE chunk, abort connection (minimal token usage)
    - Return `{ success, durationMs, error? }`
  - `triggerAllModels(accountId, models, prompt): Promise<TriggerResult[]>`
    - Sequential trigger for each model (avoid rate limits)
    - Log each result to `wakeup_logs`
  - `executeWakeup(clerkUserId): Promise<WakeupResult>`
    - Load wakeup config
    - Check cooldown (skip if triggered within cooldown period)
    - For each selected account → trigger all selected models
    - Return aggregate result
- [ ] Create cooldown checker `src/lib/wakeup/cooldown.ts`:
  - `isOnCooldown(clerkUserId): Promise<boolean>`
  - Query last trigger from `wakeup_logs`, compare with `cooldown_minutes`
- [ ] Create manual trigger API route `src/app/api/wakeup/trigger/route.ts`:
  - `POST /api/wakeup/trigger` → trigger now for current user
  - `POST /api/wakeup/trigger` with body `{ accountId, modelId }` → specific trigger
  - Clerk auth required
  - Returns result synchronously (each model takes 3-15s)

**Deliverable**: Wakeup triggers can be executed server-side, either manually from UI or programmatically by Inngest.

**Files**:
```
src/lib/wakeup/trigger-service.ts
src/lib/wakeup/cooldown.ts
src/app/api/wakeup/trigger/route.ts
```

---

## Phase 16: Wakeup Scheduled Jobs (Inngest)

**Feature**: Automated scheduled wakeup via Inngest cron + event-driven fan-out

**Why Inngest over Vercel Cron**: Inngest provides built-in retries, idempotency, fan-out to multiple users, per-step timeouts, observability dashboard, and graceful error handling. Vercel Cron has a hard 60s timeout and no retry logic.

**Tasks**:
- [ ] Create Inngest cron function `src/lib/inngest/functions/scheduled-wakeup.ts`:
  ```typescript
  export const scheduledWakeup = inngest.createFunction(
    {
      id: 'scheduled-wakeup',
      name: 'Scheduled Wakeup Check',
      concurrency: { limit: 5 },   // max 5 concurrent executions
    },
    { cron: '0 * * * *' },         // Every hour
    async ({ step }) => {
      // Step 1: Get all users with enabled wakeup configs
      const configs = await step.run('get-enabled-configs', async () => {
        return supabase
          .from('wakeup_configs')
          .select('*, google_accounts(*)')
          .eq('enabled', true)
      })

      // Step 2: For each user, check if it's time to trigger
      for (const config of configs) {
        const shouldTrigger = await step.run(
          `check-schedule-${config.clerk_user_id}`,
          async () => shouldTriggerNow(config)
        )

        if (shouldTrigger) {
          // Step 3: Fan out — send event per user to trigger in parallel
          await step.sendEvent(`trigger-wakeup-${config.clerk_user_id}`, {
            name: 'wakeup/trigger.requested',
            data: { clerkUserId: config.clerk_user_id },
          })
        }
      }
    }
  )
  ```
- [ ] Create Inngest event handler `src/lib/inngest/functions/execute-wakeup.ts`:
  ```typescript
  export const executeWakeupHandler = inngest.createFunction(
    {
      id: 'execute-wakeup',
      name: 'Execute Wakeup for User',
      retries: 2,
      concurrency: { limit: 10 },
    },
    { event: 'wakeup/trigger.requested' },
    async ({ event, step }) => {
      const { clerkUserId } = event.data

      // Step 1: Check cooldown
      const onCooldown = await step.run('check-cooldown', () =>
        isOnCooldown(clerkUserId)
      )
      if (onCooldown) return { skipped: true, reason: 'cooldown' }

      // Step 2: Execute wakeup (triggers all models for all accounts)
      const result = await step.run('execute', () =>
        executeWakeup(clerkUserId)
      )

      return result
    }
  )
  ```
- [ ] Create schedule evaluator `src/lib/wakeup/schedule-evaluator.ts`:
  - `shouldTriggerNow(config, lastTriggerTime): boolean`
  - Interval mode: check if N hours passed since last trigger
  - Daily mode: check if current hour:minute matches any daily_times (±5 min window)
  - Custom cron: evaluate cron expression against current time
- [ ] Register all Inngest functions in `src/lib/inngest/functions/index.ts`
- [ ] Add Inngest dev server to dev workflow: `npx inngest-cli dev`

**Deliverable**: Wakeup triggers run automatically via Inngest. Hourly cron checks schedules, fans out to per-user event handlers with retries and concurrency control.

**Files**:
```
src/lib/inngest/functions/scheduled-wakeup.ts
src/lib/inngest/functions/execute-wakeup.ts
src/lib/wakeup/schedule-evaluator.ts
src/lib/inngest/functions/index.ts    # Updated
```

---

## Phase 17: Wakeup History & Manual Trigger UI

**Feature**: View trigger history and manually trigger from dashboard

**Tasks**:
- [ ] Build wakeup history section on wakeup page:
  - Table showing recent triggers
  - Columns: Timestamp, Account, Model, Status (success/fail), Duration, Error
  - Filter by account, model, status
  - Pagination (show last 50)
- [ ] Build `src/components/wakeup/trigger-button.tsx`:
  - "Trigger Now" button with loading spinner
  - Shows progress as each model triggers
  - Success/failure toast notifications
- [ ] Build `src/components/wakeup/history-table.tsx`:
  - Sortable, filterable table
  - Color-coded status badges (green success, red failed)
  - Expandable rows for error details
- [ ] Build wakeup status widget `src/components/wakeup/status-widget.tsx`:
  - Show on main dashboard as a small card
  - Last trigger result + timestamp
  - Next scheduled trigger time
  - Quick "Trigger Now" button
- [ ] Create history API route `src/app/api/wakeup/history/route.ts`:
  - `GET /api/wakeup/history?limit=50&offset=0&account=<id>&status=success|failed`
  - Clerk auth + ownership check
- [ ] Calculate success rate stats (last 24h, last 7d)

**Deliverable**: Full wakeup management with history view and one-click manual trigger.

**Files**:
```
src/components/wakeup/trigger-button.tsx
src/components/wakeup/history-table.tsx
src/components/wakeup/status-widget.tsx
src/app/api/wakeup/history/route.ts
```

---

## Phase 18: Real-Time Updates & Live Data

**Feature**: Live quota updates and real-time notifications

**Tasks**:
- [ ] Configure Supabase Realtime for relevant tables:
  - `quota_cache` → live quota updates when Inngest background poll completes
  - `wakeup_logs` → live trigger results
- [ ] Create Realtime hook `src/hooks/use-realtime-quota.ts`:
  - Subscribe to `quota_cache` changes for user's account IDs
  - Auto-update UI when new data arrives (from Inngest polling or other tabs)
  - Show "Updated just now" indicator
- [ ] Add auto-refresh polling as fallback:
  - SWR with 5-minute revalidation interval
  - Supabase Realtime for instant updates when available
- [ ] Create live countdown timer `src/components/quota/countdown-timer.tsx`:
  - Client-side timer that counts down to model reset
  - Recalculates from `resetTime` on each data refresh
  - Shows "Resetting..." animation at zero
  - Uses `requestAnimationFrame` or `setInterval(1000)` for smooth updates
- [ ] Add browser notifications (with permission):
  - Notify when a model becomes exhausted
  - Notify when quota resets (back to 100%)
  - Notify when wakeup trigger completes
- [ ] Create Inngest function for quota-reset detection `src/lib/inngest/functions/detect-reset.ts`:
  ```typescript
  // Triggers when a quota snapshot shows 100% after previously being lower
  // Can auto-trigger wakeup for users with wake_on_reset enabled
  ```

**Deliverable**: Dashboard updates in real-time without page refresh. Live countdown timers. Browser notifications for key events.

**Files**:
```
src/hooks/use-realtime-quota.ts
src/hooks/use-realtime-wakeup.ts
src/components/quota/countdown-timer.tsx
src/components/providers/realtime-provider.tsx
src/lib/inngest/functions/detect-reset.ts
src/lib/notifications.ts
```

---

## Phase 19: Cost Estimation & ccusage Integration

**Feature**: Estimate monetary value of quota using ccusage's pricing data

**Tasks**:
- [ ] Port pricing data from ccusage's `models-dev-pricing.json`:
  - Create `src/lib/pricing/models-pricing.json` with per-model pricing
  - Input/output token rates per model
  - Cache creation/read rates (Anthropic prompt caching)
  - Speed multiplier overrides
  - Long context threshold pricing
- [ ] Create pricing calculator `src/lib/pricing/calculator.ts`:
  - `estimateRemainingValue(models: ModelQuotaInfo[]): CostEstimate`
  - `estimateModelValue(model, remainingPercentage): number`
  - Based on model type, remaining quota, and pricing tiers
- [ ] Create model aliases mapping `src/lib/pricing/model-aliases.ts`:
  - Map Cloud Code model IDs to ccusage/litellm pricing model IDs
- [ ] Build cost estimation widget `src/components/quota/cost-estimate.tsx`:
  - "Estimated remaining value: ~$XX.XX"
  - Breakdown by model
  - Daily/weekly/monthly projected spend
- [ ] Build wakeup cost tracker `src/components/wakeup/cost-tracker.tsx`:
  - How much "compute" was used to keep models warm
  - Based on trigger history + token counts
- [ ] Add "Cost" column to quota grid (optional toggle)
- [ ] Add cost trends to history charts

**Deliverable**: Users see estimated dollar value of their remaining quota and wakeup costs.

**Files**:
```
src/lib/pricing/models-pricing.json
src/lib/pricing/calculator.ts
src/lib/pricing/model-aliases.ts
src/lib/types/pricing.ts
src/components/quota/cost-estimate.tsx
src/components/wakeup/cost-tracker.tsx
```

---

## Phase 20: Production Hardening & Deployment

**Feature**: Security, performance, error handling, and deployment

**Tasks**:
- [ ] Security audit:
  - All API routes verify Clerk `auth()` before any DB access
  - All DB queries filter by `clerk_user_id` (application-level access control)
  - Google tokens encrypted at rest via Supabase Vault (`pgsodium`)
  - `GOOGLE_CLIENT_SECRET` and `COOKIE_ENCRYPTION_KEY` are server-only env vars
  - `server-only` package imported in all sensitive modules
  - CSRF protection on mutation endpoints (state parameter in OAuth, SameSite cookies)
  - Rate limiting on API routes (custom middleware or library)
  - No sensitive data in client-side logs or error messages
- [ ] Error handling:
  - Global error boundary `src/app/error.tsx`
  - Per-page error boundaries for graceful degradation
  - API route error standardization (consistent `{ error, code, message }` format)
  - Sentry or similar error tracking integration
- [ ] Performance:
  - Suspense boundaries for streaming SSR
  - Optimized Supabase queries (proper indexes, EXPLAIN ANALYZE)
  - Connection pooling via Supabase's built-in pooler
  - Stale-while-revalidate caching pattern in SWR
  - Test with 10+ accounts per user
- [ ] Inngest production setup:
  - Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Vercel env vars
  - Verify cron functions appear in Inngest Cloud dashboard
  - Monitor function execution times and failure rates
  - Set up alerts for consecutive failures
- [ ] SEO & Meta:
  - Dashboard pages: `noindex` (private data)
  - Landing page `/`: proper meta tags, OG image
- [ ] Monitoring:
  - Vercel Analytics integration
  - Inngest dashboard for background job monitoring
  - Token refresh failure tracking
  - API latency tracking
- [ ] Data retention:
  - Create Inngest function for cleanup: delete quota_snapshots older than 90 days
  - Aggregate old data into daily summaries before deletion
- [ ] Documentation:
  - Update `README.md` with setup instructions
  - Document all environment variables
  - Supabase + Clerk + Inngest setup guide
- [ ] Deploy to Vercel:
  - Connect GitHub repo
  - Set all environment variables (Clerk, Supabase, Google, Inngest, encryption key)
  - Verify Clerk redirect URLs match production domain
  - Verify Google OAuth redirect URI matches production domain
  - Verify Inngest webhook endpoint is accessible
  - Test full OAuth flow end-to-end in production
  - Test wakeup cron execution in Inngest Cloud

**Deliverable**: Production-ready, secure, performant web dashboard deployed to Vercel with Clerk auth, Inngest background jobs, and Supabase database.

**Files**:
```
src/app/error.tsx
src/app/not-found.tsx
src/middleware.ts                    # Final with rate limiting
README.md                           # Updated
```

---

## Phase Summary Table

| Phase | Feature | Key Tech |
|-------|---------|----------|
| 1 | Project Foundation | Next.js + deps setup |
| 2 | Database Schema | Supabase (Postgres only) |
| 3 | App Authentication | **Clerk** (sign in/up, sessions) |
| 4 | Dashboard Layout | Tailwind responsive shell |
| 5 | Google OAuth Linking | Custom OAuth (cloud-platform scope) |
| 6 | Token Manager | Auto-refresh, AES-256 encryption |
| 7 | Cloud Code API Client | Port of CLI's cloudcode.ts |
| 8 | Quota Parser | Port of CLI's parser.ts |
| 9 | Quota API + Cache | API route + 5-min cache |
| 10 | Quota Dashboard UI | Model cards, progress bars |
| 11 | Account Management UI | Link/switch/remove accounts |
| 12 | Inngest + History Schema | **Inngest** setup + quota snapshots |
| 13 | History Charts | Recharts burndown/trends |
| 14 | Wakeup Config UI | Schedule config form |
| 15 | Wakeup Trigger Engine | Server-side model triggering |
| 16 | Wakeup Cron Jobs | **Inngest** cron + fan-out |
| 17 | Wakeup History UI | Trigger logs + manual trigger |
| 18 | Real-Time Updates | Supabase Realtime + Inngest events |
| 19 | Cost Estimation | ccusage pricing integration |
| 20 | Production Hardening | Security audit + deploy |

---

## Key Technical Decisions

1. **Clerk for app auth**: Pre-built UI components, session management, middleware protection. No custom auth code needed.
2. **Custom Google OAuth for account linking**: Clerk can't provide `cloud-platform` scope needed for Cloud Code API. Separate OAuth flow stores tokens in Supabase.
3. **Clerk Native Third-Party Auth with Supabase**: Supabase Auth is completely bypassed. Instead, Supabase directly verifies Clerk session tokens via JWKS. Access control uses true PostgreSQL Row Level Security (RLS) via a custom `requesting_user_id()` function reading the `sub` claim.
4. **Inngest for all background work**: Cron jobs (quota polling, wakeup scheduling), event-driven fan-out (per-user triggers), built-in retries, concurrency control, observability dashboard. Replaces Vercel Cron's limited 60s timeout and no-retry model. Employs the **coordinator pattern** to maximize parallel execution and isolate failures.
5. **Server-side only tokens**: Google tokens never sent to browser. All API calls proxied through Next.js API routes.
6. **Supabase Vault token encryption**: Tokens encrypted at database level securely using pgsodium, linked via secret IDs.
7. **JSONB for quota snapshots**: Flexible schema for evolving API responses without migrations.
8. **5-min cache TTL**: Matches CLI behavior, prevents API abuse.
9. **No Local Mode**: Cloud Mode is sufficient for "no laptop" goal. Local Mode requires OS-level access impossible from web.
