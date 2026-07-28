<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — agy-usage

## What This Project Is

A cloud-based web dashboard that shows Antigravity coding agent quota/usage for all Google accounts. Users link their Google accounts via OAuth, and the dashboard fetches quota data from Google's private Cloud Code API (`cloudcode-pa.googleapis.com`). No laptop needed — just open a website.

## Source of Truth

`docs/plans/implementation-plan.md` is the single source of truth. It contains the full 20-phase plan, database schemas, API contracts, architecture diagrams, and every task checklist. **Before starting any phase**, read the corresponding section in that file.

Track progress by checking off tasks directly in the plan: turn `- [ ]` into `- [x]` as each task is completed. That file is the only place progress is recorded.

## Tech Stack

- **Next.js 16** (App Router) — Frontend + API routes
- **Clerk** — App login (sign up, sign in, sessions, middleware)
- **Custom Google OAuth** — cloud-platform scope tokens for Cloud Code API
- **Supabase** (Postgres) — Database. Uses **Clerk Native Third-Party Auth** (JWKS integration) for secure Row Level Security (RLS) without Supabase Auth.
- **Inngest** — Background jobs, cron, fan-out, retries. Use the **coordinator pattern** (emit events per item) for bulk processing to maximize parallel execution and isolate failures.
- **Tailwind CSS 4** — Styling
- **TypeScript 5** (strict) — Everything
- **Bun** — Package manager (`bun install`, `bun dev`)
- **Biome** — Linting + formatting (`bun run lint`, `bun run format`)

## Reference Repos

Two reference CLI tools are vendored under `reference-repo/` as read-only implementation references:

- `reference-repo/antigravity-usage/` — TypeScript CLI for quota checking. Port its `token-manager.ts`, `cloudcode.ts`, and `parser.ts` logic to server-side modules.
- `reference-repo/ccusage/` — Rust CLI with pricing data. Use its `models-dev-pricing.json` for cost estimation.

**Rules:**
- Prefer patterns from vendored source code over generated guesses or web search
- Do not edit files under `reference-repo/`
- Do not import from `reference-repo/` — application code uses its own modules
- When porting logic, adapt for server-side Next.js (async, `server-only`, Supabase storage) rather than copying CLI patterns verbatim

## Project Structure

```
src/
  app/                              # Next.js App Router pages + API routes
    (dashboard)/                    # Authenticated dashboard route group
    sign-in/[[...sign-in]]/page.tsx # Clerk sign-in
    sign-up/[[...sign-up]]/page.tsx # Clerk sign-up
    api/                            # API routes (auth, accounts, quota, wakeup, inngest)
  components/
    ui/                             # Reusable primitives (card, button, badge, etc.)
    layout/                         # Sidebar, header, mobile nav
    quota/                          # Quota display components
    accounts/                       # Account management components
    wakeup/                         # Wakeup config components
    charts/                         # Recharts visualizations
  lib/
    supabase/                       # Supabase client utilities
    google/                         # OAuth, token manager, Cloud Code client, parser
    quota/                          # Quota service, caching, history
    wakeup/                         # Trigger service, cooldown, schedule evaluator
    inngest/                        # Inngest client + function definitions
    pricing/                        # Cost estimation (ported from ccusage)
    types/                          # Shared TypeScript types
  hooks/                            # Client-side React hooks
  middleware.ts                     # Clerk auth middleware

docs/plans/                         # Implementation plan (source of truth)
reference-repo/                      # Vendored reference CLIs (read-only)
supabase/migrations/                # SQL migration files
```

## Environment Variables

Keep `.env.local.example` in sync with the codebase. Whenever you add a new env var in code, add it to `.env.local.example` immediately in the same commit. Developers create `.env.local` from this template.

## Phase Workflow

Each of the 20 phases follows this exact workflow. Do not skip steps.

### 1. Create Branch

```
git checkout main
git pull origin main
git checkout -b phase-{N}-{short-description}
```

### 2. Write Code

- Read the phase section in `docs/plans/implementation-plan.md` first
- Implement all tasks listed for that phase
- Check off `- [ ]` → `- [x]` in the plan as each task is completed
- Update `.env.local.example` if any new env vars are introduced

### 3. Verify

- Run `bun run lint` and fix all errors
- Run `npx tsc --noEmit` for type checking
- Do **not** run `bun build` or `bun dev` (slow machine). If either command is run and times out, ignore the timeout error and move on.

### 4. Self-Review

Before creating a PR, launch review subagents to check the work. Run these in parallel:

- **Code consistency review** — Verify naming conventions, file structure, import patterns, and code style are consistent across all files in the phase.
- **Security review** — Check for leaked secrets, missing auth guards, unencrypted tokens, exposed internal IDs, missing `server-only` imports, and unsafe data flows to the browser.
- **Best practices review** — Verify React Server Component boundaries, proper error handling, TypeScript strict compliance, no `any` types, proper `Suspense` usage, and accessible markup.
- **Performance review** — Check for unnecessary re-renders, missing memoization, N+1 queries, unbounded data fetching, missing indexes, and oversized client bundles.

Fix all issues found. Iterate until reviews pass clean.

### 5. Create PR

```
git add -A
git commit -m "phase {N}: {description}"
git push origin phase-{N}-{short-description}
gh pr create --base main --title "Phase {N}: {Title}" --body "..."
```

### 6. Wait for GitHub Review

- Run `Write-Host "Waiting 10 minutes for code review..."; Start-Sleep -Seconds 600` in the terminal (Note: this is a PowerShell command).
- Check for reviews from AI agents or developers on GitHub: `gh pr view --comments`
- Address all review feedback, push fixes, and iterate until approved

### 7. Merge and Move On

```
gh pr merge --squash
git checkout main
git pull origin main
```

Then start the next phase from step 1.

## Coding Standards

### TypeScript
- Strict mode. No `any` types unless absolutely necessary with a comment explaining why.
- Use `interface` for object shapes, `type` for unions/intersections.
- Mark server-only modules with `import 'server-only'` at the top.

### React / Next.js
- Default to Server Components. Only add `'use client'` when the component needs browser APIs, event handlers, or hooks.
- Use Clerk's `auth()` in Server Components and API routes to get `userId`.
- Use `<Suspense>` boundaries with skeleton loading states.
- Co-locate component-specific types in the same file.

### API Routes & Database Access
- Use Clerk Native Third-Party Auth: Initialize the Supabase client with the standard Clerk session token (`await auth().getToken()`). Do not use old "JWT Templates".
- Rely on Supabase Row Level Security (RLS) policies using a custom `requesting_user_id()` Postgres function rather than just application-level filtering.
- Return consistent error format: `{ error: string, code: string, message: string }`.
- Never expose sensitive data (tokens, internal IDs) in error responses.

### Styling
- Tailwind CSS 4 utility classes only. No custom CSS files except `globals.css`.
- Use `clsx` + `tailwind-merge` for conditional class composition.
- Dark mode support via Tailwind's `dark:` variant.
- Mobile-first responsive design.

### Biome
- Formatter: spaces, indent width 2.
- Linter: recommended rules + Next.js and React domains enabled.
- `noUnknownAtRules` is off (for Tailwind's `@apply`, `@theme`, etc.).
