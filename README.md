# eToro Portfolio Evolution

Analyze your eToro portfolio over days, weeks, months, and years — deposit-adjusted performance, equity evolution, and holdings. Runs entirely on your machine.

## Quick start

**Prerequisites:** Node.js 20+

```bash
./start.sh
# or: npm install && npm start
```

Then open **http://localhost:5173**.

On first launch you will see a login screen. Paste:

| Field | Where to get it |
|---|---|
| eToro public API key | [eToro Settings → Data API](https://www.etoro.com/settings/data-api) (`x-api-key`) |
| eToro user key | Same page (`x-user-key`) |
| Supabase project URL | Supabase → Project Settings → API |
| Supabase service role key | Same page — use **service_role**, not anon |

Keys are validated, then saved only on this computer at `server/data/credentials.json`. You will not be asked again until you click **Change credentials**.

### One-time Supabase schema

In the [Supabase SQL Editor](https://supabase.com/dashboard), run the contents of [`server/supabase/migrations/001_init.sql`](server/supabase/migrations/001_init.sql). Without this, the app still works from live eToro data but cannot grow history beyond eToro’s ~12-month API window.

## What you get

- Performance: daily / weekly / monthly / yearly (deposit-adjusted)
- Equity evolution with cumulative net deposits separated from gains
- Holdings table and closed-trade drill-down
- Sync on every dashboard load into Supabase so history can grow past 12 months

## Sharing / GitHub

**Do not commit secrets.** This repo is set up so the following stay local:

- `server/.env`
- `server/data/` (includes `credentials.json`)
- any `credentials.json`

Safe to commit: source code, `server/.env.example` (empty placeholders), and the SQL migration.

Before pushing, you can double-check:

```bash
git check-ignore -v server/data/credentials.json server/.env
git status   # should not list credentials.json or .env with secrets
```

## Reset credentials

In the app header, click **Change credentials**, or delete `server/data/credentials.json` and restart.

## Scripts

| Command | What it does |
|---|---|
| `npm start` / `./start.sh` | API + web together |
| `npm run dev:server` | API only → http://localhost:4000 |
| `npm run dev:web` | Vite only → http://localhost:5173 |

## Notes

- eToro key environment (real vs demo) is auto-detected.
- Instrument names/logos need the eToro market-data scope on your user key.
- Never put the Supabase service role key in frontend code or public repos.
