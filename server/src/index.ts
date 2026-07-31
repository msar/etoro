import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { getBootstrap } from './bootstrap.js';
import {
  configureCredentials,
  configureKrakenCredentials,
  disableBroker,
  disconnectKraken,
  enableBroker,
  getBrokersStatus,
  getCredentialsStatus,
  logoutCredentials,
  requireEtoroCredentials,
  requireKrakenCredentials,
} from './credentialsService.js';
import { EtoroApiError } from './errors.js';
import { isSupabaseConfigured } from './supabase.js';
import { getAggregateOverview } from './services/aggregate.js';
import {
  getAbnOverview,
  getAbnPerformance,
  importAbnStatements,
} from './services/abnamro.js';
import {
  getEtradeEquityPerformance,
  getEtradeOverview,
  getEtradePerformance,
  importEtradeGl,
  importEtradeStatements,
} from './services/etrade.js';
import {
  getKrakenOverview,
  getKrakenPerformance,
  runKrakenSync,
} from './services/kraken.js';
import { getAllocationHistory } from './services/allocation.js';
import { getEquityHistory } from './services/balances.js';
import { getBestPerformance, type Granularity } from './services/performance.js';
import { getPortfolio } from './services/portfolio.js';
import { getIncomeReport } from './services/income.js';
import { getInstrumentPerformance } from './services/instrumentPerformance.js';
import { getAccountStats } from './services/stats.js';
import { getSyncStatus, runSync } from './services/sync.js';
import { earliestStoredTradeDate, getTrades } from './services/trades.js';

const app = express();
app.use(express.json({ limit: '64kb' }));

function pdfOnly(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) {
  if (
    file.mimetype === 'application/pdf' ||
    file.originalname.toLowerCase().endsWith('.pdf')
  ) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are accepted'));
  }
}

function spreadsheetOnly(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) {
  const name = file.originalname.toLowerCase();
  if (
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    name.endsWith('.csv') ||
    /spreadsheet|excel|csv/.test(file.mimetype)
  ) {
    cb(null, true);
  } else {
    cb(new Error('Only .xlsx, .xls, or .csv files are accepted'));
  }
}

const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 30 },
  fileFilter: pdfOnly,
});

const uploadSheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: spreadsheetOnly,
});

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

// ---------------------------------------------------------------------------
// Broker add / remove (Overview preferences)
// ---------------------------------------------------------------------------

app.get(
  '/api/brokers',
  handle(async (_req, res) => {
    res.json(await getBrokersStatus());
  }),
);

app.post(
  '/api/brokers/:id/enable',
  handle(async (req, res) => {
    res.json(await enableBroker(String(req.params.id)));
  }),
);

app.delete(
  '/api/brokers/:id/enable',
  handle(async (req, res) => {
    res.json(await disableBroker(String(req.params.id)));
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
    res.json(await getBestPerformance(boot.username, boot.environment, g, from, to));
  }),
);

app.get(
  '/api/income',
  handle(async (_req, res) => {
    requireEtoroCredentials();
    const boot = await getBootstrap();
    res.json(await getIncomeReport(boot.environment));
  }),
);

app.get(
  '/api/instrument-performance',
  handle(async (_req, res) => {
    requireEtoroCredentials();
    const boot = await getBootstrap();
    res.json(await getInstrumentPerformance(boot.environment));
  }),
);

app.get(
  '/api/stats',
  handle(async (_req, res) => {
    requireEtoroCredentials();
    const boot = await getBootstrap();
    res.json(await getAccountStats(boot.environment));
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
    // Full stored history by default; eToro's 12-month window only applies
    // when nothing has been imported/synced into Supabase yet.
    const from =
      dateParam(req, 'from') ?? (await earliestStoredTradeDate()) ?? isoDaysAgo(364);
    res.json({ items: await getTrades(boot.environment, from) });
  }),
);

// ---------------------------------------------------------------------------
// ABN AMRO Guided Investing
// ---------------------------------------------------------------------------

app.post(
  '/api/abnamro/import',
  uploadPdf.array('files', 30),
  handle(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) {
      res.status(400).json({ error: 'Upload one or more PDF portfolio summaries' });
      return;
    }
    const result = await importAbnStatements(
      files.map((f) => ({ buffer: f.buffer, fileName: f.originalname })),
    );
    await enableBroker('abnamro').catch(() => undefined);
    res.json(result);
  }),
);

app.get(
  '/api/abnamro/overview',
  handle(async (_req, res) => {
    res.json(await getAbnOverview());
  }),
);

app.get(
  '/api/abnamro/performance',
  handle(async (req, res) => {
    const g = (req.query.granularity as Granularity) ?? 'monthly';
    if (!GRANULARITIES.includes(g)) {
      res.status(400).json({ error: 'granularity must be daily, weekly, monthly or yearly' });
      return;
    }
    res.json(await getAbnPerformance(g, dateParam(req, 'from'), dateParam(req, 'to')));
  }),
);

// ---------------------------------------------------------------------------
// E*TRADE — Client Statements + Gains & Losses
// ---------------------------------------------------------------------------

app.post(
  '/api/etrade/statements/import',
  uploadPdf.array('files', 30),
  handle(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) {
      res.status(400).json({ error: 'Upload one or more E*TRADE Client Statement PDFs' });
      return;
    }
    const result = await importEtradeStatements(
      files.map((f) => ({ buffer: f.buffer, fileName: f.originalname })),
    );
    await enableBroker('etrade').catch(() => undefined);
    res.json(result);
  }),
);

app.post(
  '/api/etrade/import',
  uploadSheet.array('files', 10),
  handle(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) {
      res.status(400).json({ error: 'Upload one or more E*TRADE G&L .xlsx/.xls/.csv files' });
      return;
    }
    const result = await importEtradeGl(
      files.map((f) => ({ buffer: f.buffer, fileName: f.originalname })),
    );
    await enableBroker('etrade').catch(() => undefined);
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// Kraken
// ---------------------------------------------------------------------------

app.post(
  '/api/kraken/credentials',
  handle(async (req, res) => {
    const body = req.body ?? {};
    const status = await configureKrakenCredentials({
      apiKey: String(body.apiKey ?? ''),
      apiSecret: String(body.apiSecret ?? ''),
      supabaseUrl: body.supabaseUrl != null ? String(body.supabaseUrl) : undefined,
      supabaseServiceRoleKey:
        body.supabaseServiceRoleKey != null ? String(body.supabaseServiceRoleKey) : undefined,
    });
    res.json({ ok: true, ...status });
  }),
);

app.delete(
  '/api/kraken/credentials',
  handle(async (_req, res) => {
    res.json({ ok: true, ...disconnectKraken() });
  }),
);

app.post(
  '/api/kraken/sync',
  handle(async (_req, res) => {
    requireKrakenCredentials();
    res.json(await runKrakenSync());
  }),
);

app.get(
  '/api/kraken/overview',
  handle(async (_req, res) => {
    res.json(await getKrakenOverview());
  }),
);

app.get(
  '/api/kraken/performance',
  handle(async (req, res) => {
    const g = (req.query.granularity as Granularity) ?? 'monthly';
    if (!GRANULARITIES.includes(g)) {
      res.status(400).json({ error: 'granularity must be daily, weekly, monthly or yearly' });
      return;
    }
    res.json(await getKrakenPerformance(g, dateParam(req, 'from'), dateParam(req, 'to')));
  }),
);

app.get(
  '/api/etrade/overview',
  handle(async (_req, res) => {
    res.json(await getEtradeOverview());
  }),
);

app.get(
  '/api/etrade/equity-performance',
  handle(async (req, res) => {
    const g = (req.query.granularity as Granularity) ?? 'monthly';
    if (!GRANULARITIES.includes(g)) {
      res.status(400).json({ error: 'granularity must be daily, weekly, monthly or yearly' });
      return;
    }
    res.json(await getEtradeEquityPerformance(g, dateParam(req, 'from'), dateParam(req, 'to')));
  }),
);

app.get(
  '/api/etrade/performance',
  handle(async (req, res) => {
    const g = (req.query.granularity as Granularity) ?? 'monthly';
    if (!GRANULARITIES.includes(g)) {
      res.status(400).json({ error: 'granularity must be daily, weekly, monthly or yearly' });
      return;
    }
    res.json(await getEtradePerformance(g, dateParam(req, 'from'), dateParam(req, 'to')));
  }),
);

// ---------------------------------------------------------------------------
// Cross-broker aggregation (EUR)
// ---------------------------------------------------------------------------

app.get(
  '/api/aggregate',
  handle(async (req, res) => {
    const g = (req.query.granularity as Granularity) ?? 'monthly';
    if (!GRANULARITIES.includes(g)) {
      res.status(400).json({ error: 'granularity must be daily, weekly, monthly or yearly' });
      return;
    }
    res.json(await getAggregateOverview(g));
  }),
);

app.listen(PORT, () => {
  console.log(`Portfolio server listening on http://localhost:${PORT}`);
  const status = getCredentialsStatus();
  if (!status.configured) {
    console.log('No credentials yet — open the web app and add a broker to get started.');
    return;
  }
  console.log(
    `Credentials loaded (etoro=${status.etoroConfigured}, kraken=${status.krakenConfigured}, supabase=${status.supabaseConfigured})`,
  );

  if (status.etoroConfigured) {
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
            'Startup sync failed (run server/supabase/migrations/001_init.sql and 003_multi_broker.sql in the Supabase SQL editor if tables are missing):',
            err.message,
          ),
        );
    }
  }

  if (status.krakenConfigured && isSupabaseConfigured()) {
    void runKrakenSync()
      .then((r) =>
        console.log(
          `Kraken startup sync: equityUSD=${r.equityUsd.toFixed(2)} holdings=${r.holdingsCount} date=${r.date}`,
        ),
      )
      .catch((err) => console.warn('Kraken startup sync failed:', err.message));
  }
});
