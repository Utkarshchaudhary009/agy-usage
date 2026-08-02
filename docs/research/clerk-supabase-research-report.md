# Clerk ↔ Supabase Native Third-Party Auth — Consolidated Research Report

**Research date:** 2026-08-01
**Scope:** Official Clerk docs (clerk.com), official Supabase docs (supabase.com), official Next.js docs (nextjs.org), Clerk changelog. Compiled from 12 parallel research subagents (8 returned full reports, 4 returned empty). All claims cite official URLs; inaccessible URLs are flagged.

---

## 1. Executive Summary

- **Clerk ↔ Supabase "native" third-party auth is the ONLY recommended path.** Clerk is configured as a *third-party auth provider* inside Supabase; Supabase's Data API/RLS trusts Clerk-issued session tokens by verifying them against Clerk's JWKS (asymmetric keys + OIDC issuer discovery). No custom JWT template, no shared Supabase JWT secret. ([clerk.com supabase guide](https://clerk.com/docs/guides/development/integrations/databases/supabase))
- **The Supabase JWT template was deprecated on April 1, 2025** (by both Clerk and Supabase). Do NOT use `getToken({ template: 'supabase' })` anymore. The old integration still works "in an unofficial manner" with limited support; projects on it were excluded from Supabase TP-MAU charges **until at least Jan 1, 2026**. ([supabase.com](https://supabase.com/docs/guides/auth/third-party/clerk))
- **Setup = two dashboard steps:** (1) Clerk Dashboard → [Connect with Supabase](https://dashboard.clerk.com/setup/supabase) → Activate → copy **Clerk domain**; (2) Supabase Dashboard → **Authentication > Sign In / Providers** → Add provider → **Clerk** → paste the domain. Activating the integration automatically adds the **`role: authenticated` claim** to session tokens. ([clerk.com supabase guide](https://clerk.com/docs/guides/development/integrations/databases/supabase))
- **RLS uses Supabase's built-in `auth.jwt() ->> 'sub'`** (the Clerk user ID), with policies scoped `to authenticated`. The `requesting_user_id()` Postgres function remains the required policy contract and should be implemented as `SELECT auth.jwt() ->> 'sub'`. ([clerk.com supabase guide](https://clerk.com/docs/guides/development/integrations/databases/supabase))
- **Exact client code:** `createClient(URL, PUBLISHABLE_KEY, { async accessToken() { return session?.getToken() ?? null } })` via `useSession()`. **Exact server code:** `createClient(URL, KEY, { async accessToken() { return (await auth()).getToken() } })`. **`auth()` is async** since `@clerk/nextjs` v6 (Oct 22, 2024) — `await` is mandatory. ([clerk.com supabase guide](https://clerk.com/docs/guides/development/integrations/databases/supabase), [v6 changelog](https://clerk.com/changelog/2024-10-22-clerk-nextjs-v6.md))
- **Next.js 16 renamed `middleware.ts` → `proxy.ts`** (exported function `proxy`; Node.js runtime only; `middleware.ts` deprecated with warning). Clerk: "proxy.ts on Next.js 16+, middleware.ts on 15 and below. The code itself remains the same; only the filename changes." ([clerk-middleware docs](https://clerk.com/docs/reference/nextjs/clerk-middleware.md), [Next.js proxy docs](https://nextjs.org/docs/app/api-reference/file-conventions/proxy))
- **`createRouteMatcher()` is deprecated** (runtime warning; removed next major). Clerk now says *"Middleware is not the best place to protect routes"* — protect resources with **`await auth.protect()`** in pages, Route Handlers, and Server Actions. Motivation: middleware auth-bypass vulnerabilities (incl. GHSA-vqx2-fgx2-5wq9; CVE-2025-29927 in Next.js middleware) and Server Functions being callable by ID, not path. `clerkMiddleware()` itself stays (still required). ([migrate-from-create-route-matcher](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/migrate-from-create-route-matcher.md))
- **Clerk Core 3 (March 3, 2026)** is the latest major SDK release: package renames (`@clerk/clerk-react` → `@clerk/react`, `@clerk/clerk-expo` → `@clerk/expo`), **`<SignedIn>/<SignedOut>/<Protect>` → `<Show>`**, `@clerk/types` deprecated, **Clerk Elements deprecated**, `ClerkProvider` must be inside `<body>`, `getToken()` throws `ClerkOfflineError` when offline (was `null`) + proactive background refresh, requires **Node.js 20.9.0+** and **Next.js 15.2.3+**. ([Core 3 changelog](https://clerk.com/changelog/2026-03-03-core-3.md), [Core 3 upgrade guide](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3.md))
- **Session token claims v2 (April 14, 2025):** v1 deprecated; org claims moved from `org_id`/`org_role`/`org_permissions`/`org_slug` into a compact nested **`o` claim** (`id`, `slg`, `rol`, `per`, `fpm`); new `v` (version), `sts`, `pla`, `fea`, `fva` claims. `sub` is unchanged (still the Clerk user ID), so Supabase RLS is unaffected. ([session-tokens docs](https://clerk.com/docs/guides/sessions/session-tokens.md))
- **Billing:** Clerk pricing overhaul Feb 5, 2026 — **50,000 Monthly Retained Users (MRU) free per app** (was 10k), unlimited apps, Enhanced Authentication add-on eliminated. **Supabase TP-MAU:** $0.00325/Third-Party MAU beyond quota (Free 50k, Pro/Team 100k) — applies to Clerk-integrated users on paid plans. ([Clerk pricing changelog](https://clerk.com/changelog/2026-02-05-new-plans-more-value.md), [Supabase TP-MAU](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users-third-party))
- **Webhooks are Svix-powered:** verify with `verifyWebhook()` + `CLERK_WEBHOOK_SIGNING_SECRET`; note **CVE-2025-53548** affected `verifyWebhook()` in `@clerk/backend` >= 2.0.0 < 2.4.0 (fixed July 2025). ([webhooks docs](https://clerk.com/docs/guides/development/webhooks/overview.md))
- **Env var renames:** `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`/`AFTER_SIGN_UP_URL` deprecated → `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`/`SIGN_IN_FORCE_REDIRECT_URL` family; `CLERK_JS` → `NEXT_PUBLIC_CLERK_JS_URL`; new **`CLERK_ENCRYPTION_KEY`** (required when passing `secretKey` to `clerkMiddleware`, 32-byte hex). ([env vars docs](https://clerk.com/docs/guides/development/clerk-environment-variables.md))

---

## 2. Clerk ↔ Supabase Native Integration — Step-by-Step Setup + Exact Code

> Primary source: **https://clerk.com/docs/guides/development/integrations/databases/supabase** (`.md` variant identical). Supporting: [Supabase Clerk page](https://supabase.com/docs/guides/auth/third-party/clerk), launch changelog [2025-03-31-supabase-integration.md](https://clerk.com/changelog/2025-03-31-supabase-integration.md), official example repo [clerk/clerk-supabase-nextjs](https://github.com/clerk/clerk-supabase-nextjs).

### 2.1 Step 1 — Enable the integration in both dashboards

1. **Clerk Dashboard** → [Supabase integration setup](https://dashboard.clerk.com/setup/supabase) → choose configuration options → **Activate Supabase integration**. This reveals the **Clerk domain** (e.g., `example.clerk.accounts.dev`).
2. Save the **Clerk domain**.
3. **Supabase Dashboard** → [Authentication > Sign In / Providers](https://supabase.com/dashboard/project/_/auth/third-party) → **Add provider** → select **Clerk** → paste the Clerk domain.

**What this does** (official quote): *"Requests to Supabase's APIs require that authenticated users have a `"role": "authenticated"` JWT claim. When enabled, the Clerk Supabase integration adds this claim to your instance's generated session tokens."*

**Manual fallback** (only if you can't use Clerk's dashboard page): add a `role` claim with value `authenticated` via [customize session token](https://clerk.com/docs/guides/sessions/customize-session-tokens.md), then register the Clerk provider in Supabase. ([supabase.com](https://supabase.com/docs/guides/auth/third-party/clerk))

**Local dev / self-hosted Supabase (CLI)** — `supabase/config.toml`:
```toml
[auth.third_party.clerk]
enabled = true
domain = "example.clerk.accounts.dev"
```

**Technical constraints (Supabase side):** provider must issue **asymmetrically signed JWTs** with a `kid` header + OIDC Issuer Discovery URL; rotated keys propagate within ~30 min; **Supabase Auth itself cannot be disabled**. ([supabase third-party overview](https://supabase.com/docs/guides/auth/third-party/overview))

### 2.2 Step 2 — RLS policies using Clerk session token data

Official guide example (Supabase SQL editor):

```sql
-- Create a "tasks" table with a user_id column that maps to a Clerk user ID
create table tasks(
  id serial primary key,
  name text not null,
  user_id text not null default auth.jwt()->>'sub'
);

-- Enable RLS on the table
alter table "tasks" enable row level security;

create policy "User can view their own tasks"
on "public"."tasks"
for select
to authenticated
using (
  ((select auth.jwt()->>'sub') = (user_id)::text)
);

create policy "Users must insert their own tasks"
on "public"."tasks"
as permissive
for insert
to authenticated
with check (
  ((select auth.jwt()->>'sub') = (user_id)::text)
);
```

Key points:
- `auth.jwt() ->> 'sub'` returns the **Clerk user ID** (the token's `sub` claim, e.g. `user_...`); the `->>` operator returns text, hence the `(user_id)::text` cast.
- `to authenticated` works because the integration adds the `role: authenticated` claim (Step 1).
- Supabase's docs additionally show RLS against richer claims: org checks on the `o` claim and a reverification policy checking the `fva` claim (second-factor verification age) is not `'-1'`. ([supabase.com](https://supabase.com/docs/guides/auth/third-party/clerk))

### 2.3 Step 3 — Install client + env vars

```bash
npm install @supabase/supabase-js
```

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Base project URL only (e.g. `https://your-project-ref.supabase.co`) — strip any `/rest/v1` suffix |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase **Publishable key** (formerly the `anon`/`public` key) from Project Settings → API Keys |

The `NEXT_PUBLIC_` prefix is required for client-side use.

### 2.4 Step 4 — Server-side client (SSR / Route Handlers / Server Actions)

`app/ssr/client.ts` (reusable in `page.tsx` and `'use server'` files):

```ts
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

export function createServerSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      async accessToken() {
        return (await auth()).getToken()
      },
    },
  )
}
```

Critical notes:
- `auth()` is **async** since `@clerk/nextjs` v6 — `(await auth()).getToken()`.
- `getToken()` takes **no template argument** for the native integration.
- `auth()` requires `clerkMiddleware()` to be configured and works server-side only.

### 2.5 Step 5 — Client-side client

```tsx
'use client'
import { useSession, useUser } from '@clerk/nextjs'
import { createClient } from '@supabase/supabase-js'

export default function Home() {
  const { isLoaded, user } = useUser()
  const { session } = useSession()

  function createClerkSupabaseClient() {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        async accessToken() {
          return session?.getToken() ?? null
        },
      },
    )
  }
  // ... then: const { data, error } = await client.from('tasks').select()
}
```

Notes: `useSession()` returns `{ isLoaded, isSignedIn, session }`; `session` is `undefined` while loading, `null` signed out, `Session` object signed in. `useUser()`'s `isLoaded` gates rendering until Clerk is ready. The token is the user's session token — treat it as sensitive; never log it.

### 2.6 Integration does NOT sync user records

The native integration does **not** sync user records between Clerk and Supabase — use Clerk webhooks for that if needed. ([clerk.com supabase guide](https://clerk.com/docs/guides/development/integrations/databases/supabase))

---

## 3. Migration from JWT Templates — Before/After + Deprecation Details

### 3.1 Timeline

| Date | Event |
|---|---|
| 2021–2024 | JWT-template approach standard: Clerk signs a Supabase-format JWT using a copy of **your Supabase project's JWT secret**; fetch per-request via `getToken({ template: 'supabase' })` |
| **Mar 31, 2025** | Native Supabase third-party auth support launched ("removing the need to create a custom JWT template") — [changelog](https://clerk.com/changelog/2025-03-31-supabase-integration.md) |
| **Apr 1, 2025** | **Clerk Supabase JWT template deprecated** (both vendors) — [clerk.com](https://clerk.com/docs/guides/development/integrations/databases/supabase), [supabase.com](https://supabase.com/docs/guides/auth/third-party/clerk) |
| Apr 14, 2025 | Session token JWT **v2** rollout (v1 deprecated) — [changelog](https://clerk.com/changelog/2025-04-14-session-token-jwt-v2.md) |
| ≥ Jan 1, 2026 | Old-integration **TP-MAU exemption ends** — [supabase.com](https://supabase.com/docs/guides/auth/third-party/clerk) |

### 3.2 Before vs. After

| Aspect | OLD — JWT template (deprecated) | NEW — Native third-party auth |
|---|---|---|
| Token | Custom JWT minted per request from a template, signed with Supabase's shared JWT secret, default lifetime 60s | The **standard Clerk session token** (asymmetric, JWKS-verified); refreshed in background |
| Server call | `(await auth()).getToken({ template: 'supabase' })` | `(await auth()).getToken()` |
| Client call | `session.getToken({ template: 'supabase' })` | `session.getToken()` |
| Secret sharing | Supabase JWT secret **uploaded to Clerk** | None — Supabase only stores Clerk's public JWKS |
| Verification | Symmetric (shared secret) | Asymmetric (Clerk domain JWKS via OIDC discovery) |
| Latency | New JWT generated per request (network + rate-limit cost) | Session token already available; `getToken()` pre-refreshes in background |
| `role` claim | Set inside the template claims | Auto-added when you activate the integration (or via manual session-token customization) |
| RLS | `requesting_user_id()` custom function parsing `request.jwt.claims` | `requesting_user_id()` implemented using built-in `auth.jwt() ->> 'sub'` |
| Env var | `SUPABASE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon key) | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Publishable key — renamed) |
| Status | Deprecated Apr 1, 2025; TP-MAU-exempt only until ≥ Jan 1, 2026 | Recommended, supported |

### 3.3 Official rationale for deprecation (Supabase)

1. **Security:** sharing your project's JWT secret with a third party is a problematic security practice.
2. **Ops:** rotating the project's JWT secret almost always causes significant downtime.
3. **Latency:** generating a new JWT per Supabase request instead of using the existing session token.

Clerk's summary: *"No need to fetch a new token for each Supabase request. No need to share your Supabase JWT secret key with Clerk."*

### 3.4 Migration checklist

1. Activate Supabase integration in Clerk Dashboard; copy **Clerk domain**.
2. Add Clerk as a third-party provider in Supabase Dashboard; paste the domain.
3. Replace every `getToken({ template: 'supabase' })` with plain `getToken()` (server + client).
4. Swap `accessToken()` option plumbing if you used the old `global.fetch` header-injection pattern.
5. Swap `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Publishable key).
6. Keep RLS as-is using the `requesting_user_id()` function; ensure it is implemented to delegate to `auth.jwt() ->> 'sub'`.
7. Delete the old Supabase JWT template from the Clerk Dashboard and remove the shared JWT secret from Supabase settings.

### 3.5 Nuances

- **JWT templates as a feature still exist** for other services (Hasura, Tinybird, Fauna, custom backends) — only the **Supabase** template path is deprecated. ([jwt-templates docs](https://clerk.com/docs/guides/sessions/jwt-templates.md))
- Session-bound claims (`sid`, `v`, `pla`, `fea`) **cannot** be included in custom JWT-template tokens; custom **session tokens** (Sessions → Customize session token) are the sanctioned way to add claims, with a **~1.2 KB custom-claims budget** (4 KB browser cookie cap; tokens refresh ~every 60s). ([customize-session-tokens docs](https://clerk.com/docs/guides/sessions/customize-session-tokens.md))
- **Security implication:** with the native integration, Supabase can verify Clerk tokens but **never forge them** (asymmetric verification). ([supabase third-party overview](https://supabase.com/docs/guides/auth/third-party/overview))

---

## 4. Other Recent Clerk Changes Relevant to Next.js 16 App Router Projects (Dated)

### 4.1 SDK major versions

| Version | Date | Breaking changes |
|---|---|---|
| `@clerk/nextjs` v5 (Core 2 GA) | 2024-04-19 (beta 2024-02-29) | `clerkMiddleware()` replaces `authMiddleware()`; middleware no longer protects by default |
| `@clerk/nextjs` v6 | **2024-10-22** | `auth()` **async**; `clerkClient()` now a function to await (singleton removed); `auth().protect()` → `auth.protect()`; `<ClerkProvider>` no longer opts app into dynamic rendering (use `dynamic` prop; PPR support); removed `authMiddleware()`, standalone `redirectToSignIn()`/`redirectToSignUp()` imports — [changelog](https://clerk.com/changelog/2024-10-22-clerk-nextjs-v6.md) |
| `@clerk/nextjs` v7 (Core 3) | **2026-03-03** | See §4.3 — [changelog](https://clerk.com/changelog/2026-03-03-core-3.md), [upgrade guide](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3.md) |

### 4.2 Middleware & file conventions (Next.js 16)

- **`proxy.ts` vs `middleware.ts`:** *"If you're using Next.js ≤15, name your file `middleware.ts` instead of `proxy.ts`. The code itself remains the same; only the filename changes."* Name the file by the `next` version in `package.json`. ([clerk-middleware docs](https://clerk.com/docs/reference/nextjs/clerk-middleware.md), [quickstart](https://clerk.com/docs/nextjs/getting-started/quickstart.md))
- Next.js 16 (announced Oct 21, 2025) renamed middleware → proxy; exported function is `proxy`; **Node.js runtime only** (Edge not supported); codemod `npx @next/codemod@latest upgrade 16` / `middleware-to-proxy`. ([Next.js proxy docs](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), [middleware-to-proxy](https://nextjs.org/docs/messages/middleware-to-proxy))
- **`createRouteMatcher()` is deprecated** — runtime warning, removed next major. Replace middleware gating with resource-level `await auth.protect()`. Clerk ships `@clerk/eslint-plugin` (`@clerk/next/require-auth-protection` rule, ESLint ≥ 9 flat config) + Bulk Fixer CLI (`npx clerk-next-fix-auth-protection`). **Do NOT remove `clerkMiddleware()`** — still required for Clerk to work. ([migrate-from-create-route-matcher](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/migrate-from-create-route-matcher.md))
- **Security context:** CVE-2025-29927 — critical (9.1) auth bypass in Next.js middleware via `x-middleware-subrequest` header (fixed 12.3.5/13.5.9/14.2.25/15.2.3, published Mar 21, 2025) drove the push away from middleware as an auth boundary. ([GHSA-f82v-jwr5-mffw](https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw))
- New `clerkMiddleware()` options: `frontendApiProxy` (built-in `/__clerk` Frontend API proxy; alternatives `createFrontendApiProxyHandlers()` / `clerkFrontendApiProxy()`), `organizationSyncOptions` (URL-based active-org sync), dynamic per-request keys, `audience`/`authorizedParties`/`clockSkewInMs`/`jwtKey`.

### 4.3 Clerk Core 3 (2026-03-03) — the big one for current projects

- **Requirements:** Node.js **20.9.0+**, Next.js **15.2.3+** (Next 13/14 dropped). Core 2 in LTS until **Jan 2027**; Core 1 unsupported. ([versioning docs](https://clerk.com/docs/guides/development/upgrading/versioning.md))
- **Package renames:** `@clerk/clerk-react` → `@clerk/react`; `@clerk/clerk-expo` → `@clerk/expo`. `@clerk/types` **deprecated** — import types from SDK subpaths (`@clerk/react/types`, `@clerk/shared/types`).
- **`<SignedIn>`/`<SignedOut>`/`<Protect>` → `<Show>`:** `<Show when="signed-in">`, `<Show when="signed-out">`, `<Show when={(has) => has({ role: 'admin' })}>`.
- **`ClerkProvider` must be inside `<body>`, not wrapping `<html>`** (Next.js cache components support).
- **`getToken()` behavior:** throws `ClerkOfflineError` when offline (previously returned `null`); **proactive background refresh** (returns cached token within 15s of expiry); `useAuth().getToken` no longer `undefined` during SSR — throws `clerk_runtime_not_browser` (wrap in try/catch).
- **Redirect props renamed:** `afterSignInUrl`/`afterSignUpUrl`/`redirectUrl` → `fallbackRedirectUrl`/`forceRedirectUrl` family. `appearance.layout` → `appearance.options`. `setActive({ beforeEmit })` → `navigate`.
- **`auth.protect()`** returns 404 for unauthorized, 401 for unauthenticated Server Actions (was 404), redirects to sign-in for document requests; supports `role`/`permission`/`has`/`unauthorizedUrl`/`unauthenticatedUrl` and machine-token auth via `auth({ acceptsToken })`. ([auth docs](https://clerk.com/docs/reference/nextjs/app-router/auth.md))
- **Clerk Elements deprecated** → redesigned `useSignIn`/`useSignUp`/`useCheckout` hooks + new `useWaitlist`; new `@clerk/ui` package (experimental composable profile components, July 27, 2026).
- `secretKey` passed to `clerkMiddleware()` now requires **`CLERK_ENCRYPTION_KEY`** env var (AES-encrypted Dynamic Keys handoff; generate via `openssl rand --hex 32`).
- **Upgrade tooling:** `npx @clerk/upgrade` (codemods) — run the CLI first; AST-level transforms catch re-exports/aliases.

### 4.4 Session tokens & claims

- **JWT v2 (Apr 14, 2025):** v1 deprecated same day. Org claims nested under compact `o` claim (`id`, `slg`, `rol`, `per`, `fpm`); new `v` (version), `sts` (session status), `pla` (plan), `fea` (features), `fva` (factor verification age) claims. `sub` unchanged. Requires SDKs on API version **2025-04-10**; opt-in/upgrade per instance via Dashboard **Updates** page. ([changelog](https://clerk.com/changelog/2025-04-14-session-token-jwt-v2.md), [session-tokens docs](https://clerk.com/docs/guides/sessions/session-tokens.md))
- `orgs` claim (list of all orgs) **removed** in Core 2 — tokens carry only active-org claims. Use `user.organizations` in a custom JWT template if needed. ([Core 2 upgrade guide](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-2/nextjs.md))
- **Size limits:** ~4 KB cookie total, ~1.2 KB custom claims — keep claims lean; Clerk warns "Some users are exceeding cookie size limits".

### 4.5 Organizations (B2B)

- **Personal Accounts disabled by default** for new apps since 2025-08-22; users must create/join an org. ([changelog](https://clerk.com/changelog/2025-08-22-personal-accounts-disabled.md))
- **Organization slugs disabled by default** for new apps since 2025-10-07; `hideSlug` prop removed in Core 3.
- URL-based active-org sync via `clerkMiddleware` `organizationSyncOptions`.
- Billing unit: **Monthly Retained Organizations (MROs)** — org with ≥2 members incl. ≥1 MRU; free plans 50 MROs dev / 100 prod. ([organizations docs](https://clerk.com/docs/guides/organizations/overview.md))

### 4.6 Webhooks / Svix

- Clerk webhooks delivered **via Svix**; payload `{ data, object: 'event', type, timestamp, instance_id }`; automatic retries (Svix retry schedule) + dashboard replay.
- Verify with `verifyWebhook()` from `@clerk/backend/webhooks`, signing secret env `CLERK_WEBHOOK_SIGNING_SECRET`; optionally allowlist Svix webhook IPs.
- **CVE-2025-53548 (July 9, 2025):** `verifyWebhook()` in `@clerk/backend` >= 2.0.0 < 2.4.0 accepted improperly signed webhook events — upgrade `@clerk/backend`. ([changelog](https://clerk.com/changelog/2025-07-09-cve-2025-53548.md))

### 4.7 Environment variables (current vs. deprecated)

**Current:**
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_`/`pk_live_`), `CLERK_SECRET_KEY` (`sk_test_`/`sk_live_` — never expose client-side)
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`
- `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` / `NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL` (+ `SIGN_UP_` variants)
- `CLERK_WEBHOOK_SIGNING_SECRET`
- **`CLERK_ENCRYPTION_KEY`** (new; required when `secretKey` passed to `clerkMiddleware`)
- `NEXT_PUBLIC_CLERK_JS_URL` / `NEXT_PUBLIC_CLERK_JS_VERSION` (formerly `CLERK_JS`)
- `NEXT_PUBLIC_CLERK_JWT_KEY` (networkless verification), `NEXT_PUBLIC_CLERK_PROXY_URL`, `NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED`

**Deprecated/removed:**
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` → FALLBACK/FORCE vars
- `CLERK_API_KEY` → `CLERK_SECRET_KEY`; `CLERK_FRONTEND_API` → `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (values differ — not a drop-in rename)
- `CLERK_JS` → `NEXT_PUBLIC_CLERK_JS_URL`; `CLERK_JS_VERSION` → `NEXT_PUBLIC_CLERK_JS_VERSION`

New workflow: `npx clerk@latest init --framework next`, `clerk doctor`, `npx clerk@latest env pull` (writes keys with framework-correct names). Clerk CLI released 2026-04-22 (`clerk init`, `clerk deploy`, `clerk webhooks`, `clerk impersonate`, `clerk mcp install`).

### 4.8 Billing & pricing

- **Clerk pricing overhaul — 2026-02-05:** 50,000 MRU free per app (was 10,000), unlimited apps on every plan, **Enhanced Authentication add-on eliminated** (MFA/satellite domains/simultaneous sessions → Pro $20/mo), 5 free impersonations/mo, ≥4 dashboard seats → Business ($250/mo), Enterprise Connections (SAML/OIDC) metered in Pro, SOC 2/HIPAA artifacts → Business, volume discounts, annual billing; automatic migration from April 2026 billing. ([changelog](https://clerk.com/changelog/2026-02-05-new-plans-more-value.md))
- **MRU vs MAU:** Clerk bills Monthly Retained Users (users returning ≥24h after signup; first day free). ([pricing](https://clerk.com/pricing))
- **Supabase TP-MAU:** $0.00325/Third-Party MAU beyond quota (Free 50k, Pro/Team 100k); a TP-MAU is a distinct user who logs in **or refreshes a token** via the Clerk integration during the billing cycle. ([Supabase TP-MAU docs](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users-third-party))
- **API versioning:** 2025-11-10 (Billing API `/commerce` → `/billing`; needs `@clerk/nextjs` ≥ 6.35.0); 2026-05-12 (metadata fields removed from `PATCH /v1/users/{id}` — dedicated metadata endpoints; needs ≥ 7.5.2). ([versioning docs](https://clerk.com/docs/guides/development/upgrading/versioning.md))
- **M2M/API keys:** M2M usage billing from 2026-03-16 ($0.001/creation, $0.00001/verification); API keys GA April 2026.
- CBC cipher-suite deprecation on Clerk subdomains from Jan 18, 2027.

### 4.9 Other

- Reverification GA (2025-03-31): `has({ reverification: 'strict' })` + `reverificationError()`.
- Keyless mode (Core 3 expanded to TanStack Start, Astro, React Router).
- Vercel Marketplace integration with env-var sync + unified billing (2025-07-14).
- Version compatibility verified by Clerk (2026-05-06): `next` 16.2.5, `@clerk/nextjs` 7.3.1, React 19.2.6, TypeScript 6.0.3, Turbopack.
- **Clerk MCP server** for AI agents: `clerk mcp install` (2026-07-22).

---

## 5. Common Misconceptions / Contradictions with Older Docs & Tutorials

1. **"Use a Supabase JWT template with `getToken({ template: 'supabase' })`."** — Deprecated April 1, 2025. Pass the plain session token via the `accessToken` option. ([clerk.com supabase guide](https://clerk.com/docs/guides/development/integrations/databases/supabase))
2. **"Create a `requesting_user_id()` Postgres function for RLS."** -> Still required. Implement it using Supabase's built-in `auth.jwt() ->> 'sub'` to provide the user ID in policies. (same guide)
3. **"The middleware file is always `middleware.ts`."** — On Next.js 16+ it's **`proxy.ts`** (exported function `proxy`); `middleware.ts` logs a deprecation warning in Next 16. ([clerk-middleware docs](https://clerk.com/docs/reference/nextjs/clerk-middleware.md))
4. **"`auth()` is synchronous."** — Since `@clerk/nextjs` v6 (Oct 2024) it's async: `const { userId } = await auth()`; `protect` is a property of the awaited result: `await auth.protect()`. ([v6 changelog](https://clerk.com/changelog/2024-10-22-clerk-nextjs-v6.md))
5. **"Middleware is where you protect routes."** — Clerk now explicitly says *"Middleware is not the best place to protect routes"*; `createRouteMatcher()` deprecated (bypass vectors incl. GHSA-vqx2-fgx2-5wq9, CVE-2025-29927; Server Functions callable by ID). Protect resources with `auth.protect()`. ([migrate guide](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/migrate-from-create-route-matcher.md))
6. **"`authMiddleware()` / `createMiddleware()`."** — `authMiddleware()` removed in v6; the API is `clerkMiddleware()`. `createMiddleware` is a third-party concept (e.g., next-intl), not Clerk's API.
7. **"`clerkClient` is an importable singleton."** — Removed in v6; use `const client = await clerkClient()`.
8. **"`<SignedIn>`/`<SignedOut>`/`<Protect>` are current."** — Replaced by `<Show>` in Core 3 (2026-03-03). ([Core 3 changelog](https://clerk.com/changelog/2026-03-03-core-3.md))
9. **"`@clerk/clerk-react` / `@clerk/types` are current packages."** — `@clerk/react`; types via subpath exports (`@clerk/react/types`).
10. **"Clerk Elements is the way to build custom auth UI."** — Deprecated in Core 3; use the redesigned hooks (`useSignIn`/`useSignUp`). ([elements docs](https://clerk.com/docs/elements/overview.md))
11. **"`<ClerkProvider>` wraps `<html>`."** — Must be **inside `<body>`** (Core 3). ([Core 3 upgrade guide](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3.md))
12. **"Session token org claims are `org_id`/`org_role`/`org_permissions`/`org_slug`."** — JWT v1 (deprecated Apr 14, 2025); v2 uses the compact `o` claim. ([session-tokens docs](https://clerk.com/docs/guides/sessions/session-tokens.md))
13. **"`getToken()` returns `null` when offline."** — Since Core 3 it **throws `ClerkOfflineError`**; still `null` only when signed out. ([Core 3 upgrade guide](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3.md))
14. **"`NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` is the way to redirect."** — Deprecated; use `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` / `SIGN_IN_FORCE_REDIRECT_URL`. ([env vars docs](https://clerk.com/docs/guides/development/clerk-environment-variables.md))
15. **"The Supabase env var is `NEXT_PUBLIC_SUPABASE_ANON_KEY`."** — Supabase renamed anon/public keys to **Publishable keys**; current guide uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. (Clerk's 2025-03-31 changelog snippet still shows the old name — use the current Supabase name.) ([clerk.com supabase guide](https://clerk.com/docs/guides/development/integrations/databases/supabase))
16. **"Sharing your Supabase JWT secret with Clerk is fine."** — Exactly why the template integration was deprecated (security + rotation downtime). ([supabase.com](https://supabase.com/docs/guides/auth/third-party/clerk))
17. **"Use `@supabase/ssr` cookie-based client with Clerk."** — Not needed. The official pattern is plain `@supabase/supabase-js` `createClient` + `accessToken` option; Clerk owns auth state, so there are no Supabase auth cookies to manage. ([clerk.com supabase guide](https://clerk.com/docs/guides/development/integrations/databases/supabase))
18. **"Clerk is free for unlimited users."** — Clerk: 50k MRU free since 2026-02-05; **Supabase separately bills TP-MAU** ($0.00325/MAU over quota) for Clerk-integrated users on paid plans. ([Supabase TP-MAU](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users-third-party))
19. **"JWT templates are dead."** — They remain supported for other providers (Hasura, Tinybird, Fauna, etc.); only the Supabase template is deprecated. ([jwt-templates docs](https://clerk.com/docs/guides/sessions/jwt-templates.md))
20. **"Personal accounts / org slugs work out of the box."** — Personal accounts disabled by default since 2025-08-22; org slugs off by default since 2025-10-07. ([changelog](https://clerk.com/changelog/2025-08-22-personal-accounts-disabled.md))

---

## 6. Full Source List

### Clerk — integration & code
- https://clerk.com/docs/guides/development/integrations/databases/supabase (also `.md`)
- https://clerk.com/docs/guides/development/integrations/overview.md
- https://clerk.com/docs/reference/nextjs/overview.md
- https://clerk.com/docs/reference/nextjs/clerk-middleware.md
- https://clerk.com/docs/reference/nextjs/app-router/auth.md
- https://clerk.com/docs/reference/backend/types/auth-object.md
- https://clerk.com/docs/nextjs/getting-started/quickstart.md
- https://clerk.com/docs/nextjs/reference/hooks/use-session.md
- https://clerk.com/docs/reference/nextjs/app-router/route-handlers.md
- https://clerk.com/docs/reference/nextjs/app-router/server-actions.md

### Clerk — sessions, tokens, env, webhooks, orgs, elements
- https://clerk.com/docs/guides/sessions/session-tokens.md
- https://clerk.com/docs/guides/sessions/customize-session-tokens.md
- https://clerk.com/docs/guides/sessions/jwt-templates.md
- https://clerk.com/docs/guides/development/clerk-environment-variables.md
- https://clerk.com/docs/guides/development/webhooks/overview.md
- https://clerk.com/docs/reference/backend/verify-webhook.md
- https://clerk.com/docs/guides/organizations/overview.md
- https://clerk.com/docs/elements/overview.md
- https://clerk.com/docs/guides/secure/protect-content.md
- https://clerk.com/docs/machine-auth/m2m-tokens

### Clerk — upgrade/versioning/changelog
- https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3.md
- https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-2/nextjs.md
- https://clerk.com/docs/guides/development/upgrading/upgrade-guides/migrate-from-create-route-matcher.md
- https://clerk.com/docs/guides/development/upgrading/versioning.md
- https://clerk.com/docs/upgrade-guides/nextjs/v6
- https://clerk.com/changelog (index; note: `clerk.com/docs/changelog` → 404)
- https://clerk.com/changelog/2025-03-31-supabase-integration.md
- https://clerk.com/changelog/2025-04-14-session-token-jwt-v2.md
- https://clerk.com/changelog/2024-10-22-clerk-nextjs-v6.md
- https://clerk.com/changelog/2024-02-29-core-2.md
- https://clerk.com/changelog/2024-04-19.md
- https://clerk.com/changelog/2024-07-16-dynamic-keys.md
- https://clerk.com/changelog/2026-03-03-core-3.md
- https://clerk.com/changelog/2026-02-05-new-plans-more-value.md
- https://clerk.com/changelog/2025-08-22-personal-accounts-disabled.md
- https://clerk.com/changelog/2025-10-07-enable-organization-slugs.md
- https://clerk.com/changelog/2025-07-10-top-level-features-plus-roles-and-permissions.md
- https://clerk.com/changelog/2025-07-09-cve-2025-53548.md
- https://clerk.com/changelog/2025-07-14-vercel-marketplace-integration.md
- https://clerk.com/changelog/2025-11-10-billing-new-api-version.md
- https://clerk.com/changelog/2026-04-17-api-keys-ga.md
- https://clerk.com/changelog/2026-04-22-clerk-cli.md
- https://clerk.com/changelog/2026-06-10-per-seat-plans.md
- https://clerk.com/changelog/2026-06-30-account-credits.md
- https://clerk.com/changelog/2026-07-09-clerk-cli-webhooks-and-impersonate.md
- https://clerk.com/changelog/2026-07-16-deprecating-cbc-cipher-suites.md
- https://clerk.com/changelog/2026-07-22-clerk-mcp.md
- https://clerk.com/changelog/2026-07-27-composable-profile-components.md
- https://clerk.com/changelog/2026-07-30-self-serve-sso-oidc.md

### Supabase — official
- https://supabase.com/docs/guides/auth/third-party/clerk
- https://supabase.com/docs/guides/auth/third-party/overview
- https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users-third-party
- https://supabase.com/docs/guides/auth/row-level-security
- https://supabase.com/docs/reference/javascript/initializing

### Next.js — official
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- https://nextjs.org/docs/messages/middleware-to-proxy

### Security advisories
- https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw (CVE-2025-29927)
- https://github.com/advisories/GHSA-f82v-jwr5-mffw

### Dashboards / entry points (auth-required, not fetched — content inferred from docs)
- https://dashboard.clerk.com/setup/supabase
- https://supabase.com/dashboard/project/_/auth/third-party
- https://dashboard.clerk.com/~/jwt-templates
- https://dashboard.clerk.com/~/updates

### Reference repo
- https://github.com/clerk/clerk-supabase-nextjs (official example)

### Accessibility notes (flagged)
- `https://clerk.com/docs/reference/nextjs/middleware.md` → **404** (renamed to `clerk-middleware.md`)
- `https://clerk.com/docs/reference/nextjs/elements.md` → **404** (Elements docs at `/docs/elements/overview.md`)
- `https://clerk.com/docs/changelog` → **404** (changelog lives at `https://clerk.com/changelog`)
- `https://clerk.com/docs/llms.txt` returns the docs overview (sitemap), not a raw URL list; per-page `.md` variants work
- The changelog index fetch is truncated server-side (~550 KB); key 2025–2026 entries were extracted via the fetched content
- A few dated changelog slugs (e.g., "session token claim preview") were inferred and not individually re-fetched — flagged as unverified in the source agent reports

---

## 7. Applicability to agy-usage (Actionable Deltas)

The project's planned architecture (Clerk Native Third-Party Auth, session token → Supabase, RLS via `auth.jwt() ->> 'sub'`) **matches current official guidance exactly**. Concrete deltas to verify/fix in the codebase:

1. **`src/proxy.ts` -> `proxy.ts`** if the project is on Next.js 16 (exported function `proxy`; identical contents). Current file exists as `middleware.ts` — rename per `next` version in `package.json`.
2. **Middleware auth gating is deprecated:** `createRouteMatcher()` + `auth.protect()` inside middleware should move to resource-level `await auth.protect()` in pages/route handlers/server actions. Keep `clerkMiddleware()` itself.
3. **`await auth()` everywhere** (already correct in `src/lib/supabase/server.ts`).
4. **Supabase client:** official pattern is the `accessToken()` option (server: `(await auth()).getToken()`; client: `session?.getToken() ?? null`) — the current `global.headers`/`global.fetch` wrapper works but the `accessToken` option is the documented approach.
5. **Env var naming:** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not `ANON_KEY`) is the current Supabase name; both `.env.local.example` and Vercel should use it.
6. **RLS:** the plan's `requesting_user_id()` helper is fine and the current official pattern is to have it return `auth.jwt() ->> 'sub'` directly; no migration needed if the function delegates to the `sub` claim.
7. **Clerk Core 3 (v7.x):** plan for `<Show>` (not `<SignedIn>`/`<Protect>`), `ClerkProvider` inside `<body>`, `getToken()` wrapped for `ClerkOfflineError`, `CLERK_ENCRYPTION_KEY` if `secretKey` is passed to middleware.
8. **Supabase TP-MAU billing** (~$0.00325/MAU over quota) applies to the native integration — budget accordingly.
9. **Dashboard setup required:** activate Supabase integration at `dashboard.clerk.com/setup/supabase` and register the Clerk domain as a provider in Supabase (Authentication → Sign In/Providers → Third Party Auth) — this is the likely cause of the production "No suitable key or wrong key type" error observed in Vercel runtime logs.
