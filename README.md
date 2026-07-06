# ProjectSNS

**Open-source, AI-powered social media automation.** Connect LinkedIn,
Instagram, and TikTok via their official APIs; plan and schedule content;
publish on a queue that survives restarts; pull real per-post analytics; and
let an AI agent draft posts from your company profile, goals, and performance
data — using your own Anthropic key.

Multi-workspace and self-hostable. Built to be run by anyone.

> **Status:** early. Core pipeline (connect → compose → schedule → publish →
> analytics) works today. LinkedIn and TikTok connectors are in; Instagram and
> the AI suggestion engine are on the roadmap.

## Features

- **Official APIs only** — LinkedIn (personal + org), Instagram (feed/reel/story), TikTok (inbox + Direct Post). No scraping.
- **Reliable publishing** — a Postgres-backed job queue with retries, backoff, and crash-safe checkpoints so a post never double-fires or silently drops.
- **Per-channel approval** — auto-post or require a human to approve each channel.
- **Analytics** — daily pulls of account and per-post metrics.
- **AI suggestions (BYO key)** — content drafted from your brand profile + real analytics via the Anthropic API; you review before anything publishes.
- **Multi-workspace** — isolated tenants with row-level security; encrypted OAuth tokens and API keys at rest.

## Architecture

A pnpm-workspaces monorepo.

| Path | What |
|---|---|
| `apps/web` | Next.js (App Router, TypeScript) — UI, server actions, OAuth + AI route handlers |
| `apps/worker` | Long-running Node worker — publish queue, token refresh, analytics pulls |
| `packages/core` | Shared: platform connectors, AES-256-GCM crypto, DB helpers, zod types |
| `supabase/migrations` | Postgres schema — the source of truth (RLS, secrets lockdown) |
| `ops/` | nginx vhost, systemd units, droplet runbook |

Stack: **Next.js + Supabase (Postgres/Auth/Storage)** with a dedicated worker
process for scheduled publishing.

## Self-hosting

Requires **Node ≥ 22.13**, **pnpm 11**, and the **Supabase CLI** (Docker).

```sh
pnpm install
supabase start                     # local Postgres + Auth + Storage
cp apps/web/.env.example apps/web/.env.local   # fill in the values
pnpm --filter @projectsns/core test
pnpm dev                           # web + worker
```

You'll register your own developer apps on each platform (LinkedIn, Meta,
TikTok) and paste the client credentials into your env — the same
bring-your-own-app model every self-hosted scheduler uses. Note TikTok and
Instagram require a **public HTTPS domain** (they verify domains / fetch media
by URL), so those connect against a deployed instance, not `localhost`.

For production, see `ops/README.md` for the droplet setup (nginx, systemd, TLS)
and `.github/workflows/deploy.yml` for the build-and-deploy pipeline.

## Not affiliated

ProjectSNS is not affiliated with, endorsed by, or sponsored by LinkedIn, Meta,
Instagram, or TikTok. Your use of those platforms through it is also subject to
their terms.

## License

Copyright © 2026 PT Motekar Edukasi Indonesia.

ProjectSNS is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0) — see [`LICENSE`](./LICENSE). You may use, modify, and self-host it
freely; if you run a modified version as a network service, you must make your
source available under the same license.

A separate **commercial edition** (hosted service, billing, white-label, and
premium features) is available under a commercial license — contact
**admin@dilatih.co**.
