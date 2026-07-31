# Portfolio Evolution

Multi-broker portfolio tracker — **eToro** (live API), **ABN AMRO Guided Investing** (PDF statements), **E\*TRADE** (statements + G&L), and **Kraken** (REST API). Aggregated Overview in EUR. Runs entirely on your machine.

## Quick start

### macOS app (recommended for non-engineers)

1. Get **`Portfolio-Evolution.dmg`** from whoever maintains this project (built with `npm run build:macos-dmg`).
2. Open the DMG and drag **Portfolio Evolution** into **Applications**.
3. Double-click the app. The first time, macOS Gatekeeper may block it (the app is not notarized) — **right-click → Open → Open**.
4. Wait while it downloads the latest code from GitHub (and Node.js if needed). A Terminal window starts the servers; your browser opens to **http://localhost:5173**.

Later launches check GitHub for updates automatically. Credentials stay on this Mac under `~/Library/Application Support/Portfolio Evolution/` and are kept across updates.

### Developers (from source)

**Prerequisites:** Node.js 20+

```bash
./start.sh
# or: npm install && npm start
```

Then open **http://localhost:5173**.

| Route | Page |
|---|---|
| `/` | Overview — net worth across **enabled** brokers (EUR) |
| `/etoro` | eToro dashboard (API sync) |
| `/abnamro` | ABN AMRO Guided Investing (PDF upload) |
| `/etrade` | E*TRADE Client Statements + Gains & Losses |
| `/kraken` | Kraken spot balances (API key + private key) |

On Overview, use **Add broker** / **Remove** to choose which integrations appear — the app no longer lists every broker by default. Nav links follow the same enabled set.

### First-time credentials

Connecting **eToro** or **Kraken** asks for that broker’s API keys plus (once) your Supabase project for history storage:

| Field | Where to get it |
|---|---|
| eToro public API key / user key | [eToro Settings → Data API](https://www.etoro.com/settings/data-api) |
| Kraken API key / private key | [Kraken → Security → API](https://www.kraken.com/u/security/api) — enable **Query funds** |
| Supabase project URL | Supabase → Project Settings → API |
| Supabase service role key | Same page — use **service_role**, not anon |

Keys are validated, then saved only on this computer at `server/data/credentials.json` (mode `0600`). Enabled-broker preferences live in `server/data/preferences.json`.

### One-time Supabase schema

In the [Supabase SQL Editor](https://supabase.com/dashboard), run every file in [`server/supabase/migrations/`](server/supabase/migrations/) in order (**001**–**004**) — or print them with `npm run print-migration --workspace server`. Migration **003** adds multi-broker tables; **004** adds `broker_lots` for E*TRADE G&L imports.

### Kraken

1. Overview → **Add broker** → Kraken (or open `/kraken`).
2. Paste API key + private key (Query funds). Supabase is required on first connect if not already configured.
3. **Sync now** pulls balances, prices them in USD (TradeBalance + tickers), and stores a daily equity snapshot.

### ABN AMRO Guided Investing

1. Apply migration 003 (above).
2. Add the broker on Overview, then upload quarterly *Portfolio summary* / *Portefeuille Overzicht* PDFs.
3. Or bulk-import:

```bash
npm run import:abnamro --workspace server
# parser-only check (no DB write):
npm run verify:abnamro --workspace server
```

### E*TRADE

1. Apply migration 004.
2. Upload Client Statement PDFs and/or *Gains & Losses Expanded* `.xlsx`.
3. Or:

```bash
npm run verify:etrade --workspace server
npm run import:etrade --workspace server
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

- **Overview**: add/remove brokers, combined net worth in EUR (ECB FX), stacked equity chart, combined TWR
- **eToro**: deposit-adjusted performance, equity, allocation, holdings, income
- **ABN AMRO**: PDF import, quarterly value/performance, asset-class allocation, costs
- **E\*TRADE**: statement equity and/or realized G&L
- **Kraken**: API sync of spot balances, USD equity history, holdings table

## Sharing / GitHub

### Share the macOS app

Maintainers build a DMG to send to friends (no git clone required):

```bash
npm run build:macos-dmg
# → dist/Portfolio-Evolution.dmg
```

Recipients only need the DMG. The `.app` pulls the latest `main` branch from this public GitHub repo on each launch.

### Secrets

**Do not commit secrets.** This repo is set up so the following stay local:

- `server/.env`
- `server/data/` (includes `credentials.json`, `preferences.json`)
- any `credentials.json`

On the macOS app install, the same files live under `~/Library/Application Support/Portfolio Evolution/app/server/data/`.

Safe to commit: source code, `server/.env.example` (empty placeholders), and the SQL migration.

Before pushing, you can double-check:

```bash
git check-ignore -v server/data/credentials.json server/.env
git status   # should not list credentials.json or .env with secrets
```

## Reset credentials

On the eToro or Kraken page, use **Change credentials** / **Disconnect**, or delete `server/data/credentials.json` (and optionally `preferences.json`) and restart.

If you use the macOS app, that file is at `~/Library/Application Support/Portfolio Evolution/app/server/data/credentials.json`.

## Scripts

| Command | What it does |
|---|---|
| `npm start` / `./start.sh` | API + web together |
| `npm run dev:server` | API only → http://localhost:4000 |
| `npm run dev:web` | Vite only → http://localhost:5173 |
| `npm run build:macos-dmg` | Build `dist/Portfolio-Evolution.dmg` for sharing |

## Notes

- eToro key environment (real vs demo) is auto-detected.
- Instrument names/logos need the eToro market-data scope on your user key.
- Kraken keys need **Query funds**; ledger history improves deposit/withdrawal net-flow estimates.
- Never put the Supabase service role key in frontend code or public repos.
