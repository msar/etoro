import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  api,
  fmtAbs,
  fmtMoney,
  fmtPct,
  type Granularity,
  type KrakenOverview,
} from '../api';
import { AppNav } from '../components/AppNav';
import { Modal } from '../components/Modal';
import { PerformanceChart } from '../components/PerformanceChart';
import { usePrivacy } from '../privacy';

export function KrakenPage() {
  usePrivacy();
  const [overview, setOverview] = useState<KrakenOverview | null>(null);
  const [credStatus, setCredStatus] = useState<{
    krakenConfigured: boolean;
    supabaseConfigured: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState({
    apiKey: '',
    apiSecret: '',
    supabaseUrl: '',
    supabaseServiceRoleKey: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, status] = await Promise.all([api.krakenOverview(), api.credentialsStatus()]);
      setOverview(ov);
      setCredStatus({
        krakenConfigured: status.krakenConfigured,
        supabaseConfigured: status.supabaseConfigured,
      });
      if (!status.krakenConfigured) setImportOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const perfFetcher = useCallback(
    (granularity: Granularity, from?: string) => api.krakenPerformance(granularity, from),
    [],
  );

  async function onSaveCredentials(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: {
        apiKey: string;
        apiSecret: string;
        supabaseUrl?: string;
        supabaseServiceRoleKey?: string;
      } = {
        apiKey: form.apiKey,
        apiSecret: form.apiSecret,
      };
      if (!credStatus?.supabaseConfigured) {
        payload.supabaseUrl = form.supabaseUrl;
        payload.supabaseServiceRoleKey = form.supabaseServiceRoleKey;
      }
      await api.saveKrakenCredentials(payload);
      setImportOpen(false);
      setForm((f) => ({ ...f, apiKey: '', apiSecret: '', supabaseServiceRoleKey: '' }));
      await api.krakenSync();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Kraken credentials');
    } finally {
      setSaving(false);
    }
  }

  async function onSync() {
    setSyncing(true);
    setError(null);
    try {
      await api.krakenSync();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function onDisconnect() {
    if (!confirm('Remove Kraken API keys from this machine?')) return;
    setError(null);
    try {
      await api.clearKrakenCredentials();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    }
  }

  const chartData = useMemo(() => {
    if (!overview?.snapshots.length) return [];
    return overview.snapshots.map((s) => ({
      date: s.date,
      label: new Date(`${s.date}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }),
      total: s.total,
      deposits: s.cumulativeNetDeposits,
    }));
  }, [overview]);

  const needsSupabase = credStatus != null && !credStatus.supabaseConfigured;

  return (
    <div className="app">
      <AppNav />
      <header className="app-header">
        <div>
          <h1>Kraken</h1>
          <div className="sub">Spot balances via REST API · values in USD</div>
        </div>
        <div className="header-actions">
          <div className="header-actions-row">
            <button
              type="button"
              className="ghost-btn primary"
              onClick={() => setImportOpen(true)}
            >
              Import statements
            </button>
            {credStatus?.krakenConfigured && (
              <>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void onSync()}
                  disabled={syncing}
                >
                  {syncing ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  type="button"
                  className="ghost-btn danger"
                  onClick={() => void onDisconnect()}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        closable={Boolean(credStatus?.krakenConfigured)}
        title="Import statements"
        description="Kraken does not use statement PDFs. Connect an API key to sync spot balances and deposits from the ledger."
      >
        <div className="notice">
          Create a key with <strong>Query funds</strong> (and Query ledger if available) at{' '}
          <a href="https://www.kraken.com/u/security/api" target="_blank" rel="noreferrer">
            Kraken → Security → API
          </a>
          . Keys are stored only in <code>server/data/credentials.json</code>.
        </div>
        <form className="login-card inline-form" onSubmit={onSaveCredentials}>
          <fieldset>
            <legend>Kraken API</legend>
            <label>
              API key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                required
              />
            </label>
            <label>
              Private key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={form.apiSecret}
                onChange={(e) => setForm((f) => ({ ...f, apiSecret: e.target.value }))}
                required
              />
            </label>
          </fieldset>
          {needsSupabase && (
            <fieldset>
              <legend>Supabase (history storage)</legend>
              <label>
                Project URL
                <input
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.supabaseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, supabaseUrl: e.target.value }))}
                  placeholder="https://xxxx.supabase.co"
                  required
                />
              </label>
              <label>
                Service role key
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.supabaseServiceRoleKey}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, supabaseServiceRoleKey: e.target.value }))
                  }
                  required
                />
              </label>
              <p className="field-hint">
                Run <code>server/supabase/migrations/</code> 001–003 once in the SQL editor.
              </p>
            </fieldset>
          )}
          <button type="submit" className="login-submit" disabled={saving}>
            {saving ? 'Validating…' : 'Save & sync'}
          </button>
        </form>
      </Modal>

      {error && <div className="error-box">{error}</div>}

      {loading ? (
        <div className="loading" style={{ paddingTop: 60 }}>
          <div className="spinner" />
          Loading Kraken…
        </div>
      ) : overview?.available ? (
        <>
          <div className="cards">
            <div className="card highlight">
              <div className="label">Equity</div>
              <div className="value">{fmtMoney(overview.currentValue ?? 0, 'USD')}</div>
              <div className="hint">
                As of {overview.statementDate}
                {overview.lastSyncedAt
                  ? ` · synced ${new Date(overview.lastSyncedAt).toLocaleString()}`
                  : ''}
              </div>
            </div>
            <div className="card">
              <div className="label">All-time gain</div>
              <div className="value">
                {overview.allTimeGain != null ? fmtMoney(overview.allTimeGain, 'USD') : '—'}
              </div>
              <div className="hint">
                {overview.allTimeGainPct != null ? fmtPct(overview.allTimeGainPct) : 'vs net deposits'}
              </div>
            </div>
            <div className="card">
              <div className="label">Net deposits</div>
              <div className="value">
                {fmtMoney(overview.totalDeposits - overview.totalWithdrawals, 'USD')}
              </div>
              <div className="hint">
                In {fmtMoney(overview.totalDeposits, 'USD')} · Out{' '}
                {fmtMoney(overview.totalWithdrawals, 'USD')}
              </div>
            </div>
          </div>

          {chartData.length > 0 && (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Equity over time</h2>
                  <div className="desc">USD · one point per sync day</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#232e3e" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#8698ad', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#232e3e' }}
                    minTickGap={40}
                  />
                  <YAxis
                    tickFormatter={(v: number) => fmtMoney(v, 'USD')}
                    tick={{ fill: '#8698ad', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={72}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as (typeof chartData)[0];
                      return (
                        <div className="tooltip">
                          <div className="t-date">{p.date}</div>
                          <div className="t-row">
                            <span className="t-key">Equity</span>
                            <span>{fmtMoney(p.total, 'USD')}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="stepAfter"
                    dataKey="total"
                    stroke="#ffb84d"
                    fill="#ffb84d"
                    fillOpacity={0.25}
                    name="Equity"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </section>
          )}

          <PerformanceChart
            title="Performance"
            description="Deposit-adjusted time-weighted return from synced equity snapshots."
            fetcher={perfFetcher}
            derivedNote="Derived TWR from Kraken sync snapshots (USD)."
          />

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Holdings</h2>
                <div className="desc">Latest balances priced in USD where tickers are available</div>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="num">Quantity</th>
                    <th className="num">Price</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.holdings.map((h) => (
                    <tr key={h.asset}>
                      <td>
                        <strong>{h.displayAsset}</strong>
                        {h.asset !== h.displayAsset && (
                          <span className="muted"> · {h.asset}</span>
                        )}
                      </td>
                      <td className="num">{fmtAbs(h.quantity, h.quantity >= 1 ? 4 : 8)}</td>
                      <td className="num">
                        {h.priceUsd > 0 ? fmtMoney(h.priceUsd, 'USD') : '—'}
                      </td>
                      <td className="num">
                        {h.valueUsd > 0 ? fmtMoney(h.valueUsd, 'USD') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : credStatus?.krakenConfigured ? (
        <div className="empty-state">
          <p>{overview?.reason ?? 'No snapshots yet.'}</p>
          <button type="button" className="login-submit" onClick={() => void onSync()} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync balances'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
