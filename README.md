# Discovery Worker

Railway-hosted service that orchestrates Apify Reddit runs, scores results, and writes to Supabase.

## Flow

1. Vercel API → Railway
2. Railway starts Apify actor `alex_claw/reddit-scraper`, polls until done
3. Fetches dataset items, normalizes, scores (healthcare friction keywords)
4. Upserts to Supabase (`discovery_runs`, `discovery_communities`)
5. Returns summary JSON with `runId`, counts, communities

## Env vars (Railway)

| Var | Required | Description |
|-----|----------|-------------|
| `APIFY_TOKEN` | yes | Apify API token |
| `SUPABASE_URL` | for persistence | Supabase project URL |
| `SUPABASE_SERVICE_KEY` or `SUPABASE_ANON_KEY` | for persistence | Supabase key with insert/update on discovery tables |

## Supabase

Run `supabase-migration.sql` in Supabase SQL Editor to create `discovery_runs` and `discovery_communities`.

## Railway project

- Project ID: `823f52ff-69ac-461e-aa86-005d90f10bec`
- Service ID: `8fe97614-521a-47c8-aa14-4e60eb3ff100`
- **URL**: https://discovery-worker-production.up.railway.app

## Deploy

```bash
RAILWAY_TOKEN=<project-token> railway up --service 8fe97614-521a-47c8-aa14-4e60eb3ff100
```

## Vercel

Set `DISCOVERY_WORKER_URL` in Vercel env vars. The proxy forwards requests and returns the worker response (including `runId`).
