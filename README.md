# Portfolio Evolution

Multi-broker portfolio tracker — start with **eToro** (live API) and **ABN AMRO Guided Investing** (PDF statements), with an aggregated Overview in EUR. Runs entirely on your machine.

## Quick start

**Prerequisites:** Node.js 20+

```bash
./start.sh
# or: npm install && npm start
```

Then open **http://localhost:5173**.

| Route | Page |
|---|---|
| `/` | Overview — net worth across brokers (EUR) |
| `/etoro` | eToro dashboard (API sync) |
| `/abnamro` | ABN AMRO Guided Investing (PDF upload) |

On first visit to **eToro** you will see a login screen. Paste:

| Field | Where to get it |
|---|---|
| eToro public API key | [eToro Settings → Data API](https://www.etoro.com/settings/data-api) (`x-api-key`) |
| eToro user key | Same page (`x-user-key`) |
| Supabase project URL | Supabase → Project Settings → API |
| Supabase service role key | Same page — use **service_role**, not anon |

Keys are validated, then saved only on this computer at `server/data/credentials.json`. You will not be asked again until you click **Change credentials**.

### One-time Supabase schema

In the [Supabase SQL Editor](https://supabase.com/dashboard), run every file in [`server/supabase/migrations/`](server/supabase/migrations/) in order (**001**, **002**, **003**) — or print them with `npm run print-migration --workspace server`. Migration **003** adds multi-broker tables required for ABN AMRO imports and the Overview page.

### ABN AMRO Guided Investing

1. Apply migration 003 (above).
2. Open **ABN AMRO** in the app and upload your quarterly *Portfolio summary* / *Portefeuille Overzicht* PDFs (drag-and-drop).
3. Or bulk-import the sample folder:

```bash
npm run import:abnamro --workspace server
# parser-only check (no DB write):
npm run verify:abnamro --workspace server
```

### Backfill older eToro history (Account Statement export)

eToro’s API only keeps ~12 months of balance history. To go further back:

1. In eToro, download your **Account Statement** (XLS) for the full period you care about.
2. Export/save the sheets as CSV into `exporteddata/` (gitignored), e.g.:
   - `actividaddelacuenta.csv` — Account Activity
   - `posicionescerradas.csv` — Closed Positions
   - `dividendos.csv` — Dividends (optional, powers the dividends panel)
3. Run:

```bash
npm run import:etoro-history
# optional: resolve ticker → instrumentId (slow, cached)
npm run import:etoro-history -- --resolve-instruments
# preview only
npm run import:etoro-history -- --dry-run
```

Balances older than ~360 days come from **Realized Equity** + cash in Account Activity (not mark-to-market). The last year stays owned by the live API sync.

## What you get

- **Overview**: combined net worth in EUR (ECB FX), per-broker cards, stacked equity chart, combined TWR
- **eToro**: deposit-adjusted performance, equity, allocation, holdings, income
- **ABN AMRO**: PDF import, quarterly value/performance, asset-class allocation, costs, import log
- Placeholders for Revolut, Kraken, and E*TRADE on the Overview page

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

In the eToro page header, click **Change credentials**, or delete `server/data/credentials.json` and restart.

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
