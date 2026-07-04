# ProjectSNS

AI-powered social media automation platform. Multi-workspace: connect LinkedIn,
Instagram, and TikTok via official APIs, plan and schedule content on a calendar,
let an AI agent (bring-your-own Anthropic key) suggest posts from your company
profile, goals, and real platform analytics.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js App Router UI + server actions + OAuth/AI route handlers |
| `apps/worker` | Long-running Node worker: publish queue, token refresh, analytics pulls |
| `packages/core` | Shared: platform connectors, crypto, DB helpers, zod types, AI engine |
| `supabase/migrations` | Postgres schema — source of truth |
| `ops/` | nginx vhost, systemd units, droplet runbook |

## Dev

Requires Node >= 22.13, pnpm 11, Supabase CLI.

```sh
pnpm install
supabase start          # local Postgres + Auth + Storage
pnpm dev                # web on :3000, worker in watch mode
pnpm test
```

## Deploy

Push to `main` → GitHub Actions builds and rsyncs to the droplet
(`/opt/projectsns`), restarts `projectsns-web` + `projectsns-worker` systemd
units. See `ops/README.md` for first-time droplet setup.
