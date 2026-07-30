import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { getBootstrap } from './bootstrap.js';
import {
  configureCredentials,
  getCredentialsStatus,
  logoutCredentials,
  requireEtoroCredentials,
} from './credentialsService.js';
import { EtoroApiError } from './errors.js';
import { isSupabaseConfigured } from './supabase.js';
import { getAllocationHistory } from './services/allocation.js';
import { getEquityHistory } from './services/balances.js';
import { getDerivedPerformance, getPerformance, type Granularity } from './services/performance.js';
import { getPortfolio } from './services/portfolio.js';
import { getSyncStatus, runSync } from './services/sync.js';
import { getTrades } from './services/trades.js';

const app = express();
app.use(express.json({ limit: '64kb' }));

const PORT = Number(process.env.PORT ?? 4000);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GRANULARITIES: Granularity[] = ['daily', 'weekly', 'monthly', 'yearly'];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateParam(req: Request, name: string): string | undefined {
  const v = req.query[name];
  if (typeof v !== 'string' || v === '') return undefined;
  if (!DATE_RE.test(v)) throw new EtoroApiError(`Invalid ${name}, expected YYYY-MM-DD`, 400);
  return v;
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: unknown) => {
      const status = err instanceof EtoroApiError ? err.statusCode : 500;
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[${req.path}]`, message);
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
    });
  };
}

app.get(
  '/api/credentials/status',
  handle(async (_req, res) => {
    res.json(getCredentialsStatus());
  }),
);

app.post(
  '/api/credentials',
  handle(async (req, res) => {
    const body = req.body ?? {};
    const status = await configureCredentials({
      etoroApiKey: String(body.etoroApiKey ?? ''),
      etoroUserKey: String(body.etoroUserKey ?? ''),
      supabaseUrl: String(body.supabaseUrl ?? ''),
      supabaseServiceRoleKey: String(body.supabaseServiceRoleKey ?? ''),
    });
    res.json({ ok: true, ...status });
  }),
);

app.delete(
  '/api/credentials',
  handle(async (_req, res) => {
    res.json({ ok: true, ...logoutCredentials() });
  }),
);

app.get(
  '/api/bootstrap',
  handle(async (_req, res) => {
    requireEtoroCredentials();
    const boot = await getBootstrap();
    const sync = isSupabaseConfigured() ? await getSyncStatus() : null;
    res.json({ ...boot, sync });
  }),
);

app.post(
  '/api/sync',
  handle(async (_req, res) => {
    requireEtoroCredentials();
    const result = await runSync();
    res.json(result);
  }),
);

app.get(
  '/api/sync/status',
  handle(async (_req, res) => {
    requireEtoroCredentials();
    res.json(await getSyncStatus());
  }),
);

app.get(
  '/api/performance',
  handle(async (req, res) => {
    requireEtoroCredentials();
    const boot = await getBootstrap();
    const g = (req.query.granularity as Granularity) ?? 'monthly';
    if (!GRANULARITIES.includes(g)) {
      res.status(400).json({ error: 'granularity must be daily, weekly, monthly or yearly' });
      return;
    }
    const from = dateParam(req, 'from');
    const to = dateParam(req, 'to');

    if (g !== 'weekly' && boot.username) {
      try {
        res.json(await getPerformance(boot.username, g, from, to));
        return;
      } catch (err) {
        console.warn('Official gain series unavailable, deriving from balances:', (err as Error).message);
      }
    }
    res.json(await getDerivedPerformance(boot.environment, g, from, to));
  }),
);

app.get(
  '/api/balance-history',
  handle(async (req, res) => {
    requireEtoroCredentials();
    const boot = await getBootstrap();
    res.json(await getEquityHistory(boot.environment, dateParam(req, 'from'), dateParam(req, 'to')));
  }),
);

app.get(
  '/api/allocation-history',
  handle(async (req, res) => {
    requireEtoroCredentials();
    const boot = await getBootstrap();
    if (!boot.username) {
      res.json({
        available: false,
        reason:
          'your eToro user key lacks the user-info scope, so the username required for per-instrument history could not be resolved. Re-create the key with user-info read permission to enable this view.',
        days: [],
        symbols: [],
      });
      return;
    }
    const from = dateParam(req, 'from') ?? isoDaysAgo(364);
    const to = dateParam(req, 'to') ?? today();
    res.json(await getAllocationHistory(boot.username, from, to));
  }),
);

app.get(
  '/api/portfolio',
  handle(async (_req, res) => {
    requireEtoroCredentials();
    const boot = await getBootstrap();
    res.json(await getPortfolio(boot.environment));
  }),
);

app.get(
  '/api/trades',
  handle(async (req, res) => {
    requireEtoroCredentials();
    const boot = await getBootstrap();
    const from = dateParam(req, 'from') ?? isoDaysAgo(364);
    res.json({ items: await getTrades(boot.environment, from) });
  }),
);

app.listen(PORT, () => {
  console.log(`eToro portfolio server listening on http://localhost:${PORT}`);
  const status = getCredentialsStatus();
  if (!status.configured) {
    console.log('No credentials yet — open the web app and complete the login screen.');
    return;
  }
  console.log(`Credentials loaded from local store (etoro=${status.etoroConfigured}, supabase=${status.supabaseConfigured})`);

  void getBootstrap()
    .then((b) =>
      console.log(
        `Bootstrap: env=${b.environment} gcid=${b.gcid} username=${b.username} tradingAccount=${b.tradingAccountId}`,
      ),
    )
    .catch((err) => console.warn('Bootstrap warmup failed:', err.message));

  if (isSupabaseConfigured()) {
    void runSync()
      .then((r) =>
        console.log(
          `Startup sync: seeded=${r.seeded} balances=${r.balanceRowsUpserted} trades=${r.tradeRowsUpserted} range=${r.earliestSnapshot}→${r.latestSnapshot}`,
        ),
      )
      .catch((err) =>
        console.warn(
          'Startup sync failed (run server/supabase/migrations/001_init.sql in the Supabase SQL editor if tables are missing):',
          err.message,
        ),
      );
  }
});
