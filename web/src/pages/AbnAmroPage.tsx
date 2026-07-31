import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
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
  type AbnImportResult,
  type AbnOverview,
  type Granularity,
} from '../api';
import { AppNav } from '../components/AppNav';
import { PerformanceChart } from '../components/PerformanceChart';
import { usePrivacy } from '../privacy';

const ASSET_COLORS: Record<string, string> = {
  Equities: '#4f9dff',
  'Fixed income': '#9b7bff',
  Alternatives: '#ffb84d',
  Liquidities: '#2ecc8f',
  Other: '#8698ad',
};

export function AbnAmroPage() {
  usePrivacy();
  const [overview, setOverview] = useState<AbnOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<AbnImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await api.abnOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const abnFetcher = useCallback(
    (granularity: Granularity, from?: string) => api.abnPerformance(granularity, from),
    [],
  );

  async function handleFiles(files: FileList | File[]) {
    const pdfs = [...files].filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    );
    if (!pdfs.length) {
      setError('Please select PDF portfolio summary files');
      return;
    }
    setUploading(true);
    setError(null);
    setImportResult(null);
    try {
      const result = await api.abnImport(pdfs);
      setImportResult(result);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
    }
  }

  const valueChart = useMemo(() => {
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

  const costsChart = useMemo(() => {
    if (!overview?.costs.length) return [];
    return overview.costs.map((c) => ({
      date: c.statementDate,
      label: c.statementDate.slice(0, 7),
      service: c.serviceCosts,
      product: c.productCosts,
      total: c.serviceCosts + c.productCosts,
    }));
  }, [overview]);

  const pieData = useMemo(
    () =>
      (overview?.allocation ?? []).map((a) => ({
        name: a.assetClass,
        value: a.value,
        pct: a.pct,
        fill: ASSET_COLORS[a.assetClass] ?? ASSET_COLORS.Other,
      })),
    [overview],
  );

  return (
    <div className="app">
      <AppNav />
      <header className="app-header">
        <div>
          <h1>
            ABN AMRO
            <span className="badge real">Guided Investing</span>
          </h1>
          <div className="sub">
            {overview?.portfolioNumber
              ? `Portfolio ${overview.portfolioNumber}`
              : 'Import quarterly portfolio summary PDFs'}
            {overview?.statementDate ? ` · latest statement ${overview.statementDate}` : ''}
          </div>
        </div>
        <div className="header-actions">
          <div className="sub">Values in EUR · quarterly snapshots from bank statements</div>
        </div>
      </header>

      <section
        className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {uploading ? (
          <div className="loading">
            <div className="spinner" />
            Parsing PDFs…
          </div>
        ) : (
          <>
            <div className="upload-title">Drop ABN AMRO portfolio summary PDFs here</div>
            <div className="upload-hint">or click to browse — multiple files supported</div>
          </>
        )}
      </section>

      {importResult && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h2>Import result</h2>
            <div className="desc">
              {importResult.imported} imported · {importResult.duplicates} duplicate ·{' '}
              {importResult.errors} error
            </div>
          </div>
          <ul className="import-log">
            {importResult.results.map((r) => (
              <li key={r.fileName + (r.statementDate ?? '')} className={`status-${r.status}`}>
                <strong>{r.fileName}</strong>
                <span className="badge">{r.status}</span>
                {r.statementDate && <span>{r.statementDate}</span>}
                {r.totalBalance != null && <span>{fmtMoney(r.totalBalance, 'EUR')}</span>}
                {r.error && <span className="neg">{r.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="error-box" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading && !overview ? (
        <div className="loading" style={{ paddingTop: 40 }}>
          <div className="spinner" />
          Loading…
        </div>
      ) : !overview?.available ? (
        <div className="panel">
          <div className="empty">
            {overview?.reason ??
              'No statements yet. Upload your ABN AMRO Guided Investing portfolio summaries to populate this page.'}
          </div>
        </div>
      ) : (
        <>
          <div className="cards">
            <div className="card">
              <div className="label">Current value</div>
              <div className="value">
                {overview.currentValue != null ? fmtMoney(overview.currentValue, 'EUR') : '—'}
              </div>
              <div className="hint">As of {overview.statementDate}</div>
            </div>
            <div className="card">
              <div className="label">All-time gain</div>
              <div className={`value ${(overview.allTimeGain ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                {overview.allTimeGain != null ? fmtMoney(overview.allTimeGain, 'EUR') : '—'}
              </div>
              <div className="hint">
                {overview.allTimeGainPct != null ? fmtPct(overview.allTimeGainPct) : ''} vs net
                deposits
              </div>
            </div>
            <div className="card">
              <div className="label">Total deposited</div>
              <div className="value">{fmtMoney(overview.totalDeposits, 'EUR')}</div>
              <div className="hint">
                {overview.totalWithdrawals > 0
                  ? `${fmtMoney(overview.totalWithdrawals, 'EUR')} withdrawn`
                  : 'Net external flows'}
              </div>
            </div>
            <div className="card">
              <div className="label">Total costs</div>
              <div className="value">
                {fmtMoney(overview.totalServiceCosts + overview.totalProductCosts, 'EUR')}
              </div>
              <div className="hint">
                Service {fmtMoney(overview.totalServiceCosts, 'EUR')} · Product{' '}
                {fmtMoney(overview.totalProductCosts, 'EUR')}
              </div>
            </div>
          </div>

          <PerformanceChart
            title="Performance"
            description="Deposit-adjusted time-weighted return from quarterly statement snapshots."
            fetcher={abnFetcher}
            derivedNote="Computed from quarterly ABN AMRO statement balances (time-weighted; deposits excluded from gains). Charts are step-wise between statement dates."
          />

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Portfolio value</h2>
                <div className="desc">Quarterly statement balances vs cumulative net deposits</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={valueChart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="abnVal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2ecc8f" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2ecc8f" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#232e3e" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#8698ad', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#232e3e' }}
                />
                <YAxis
                  tickFormatter={(v: number) => fmtMoney(v, 'EUR')}
                  tick={{ fill: '#8698ad', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as (typeof valueChart)[0];
                    return (
                      <div className="tooltip">
                        <div className="t-date">{p.date}</div>
                        <div className="t-row">
                          <span className="t-key">Value</span>
                          <span>{fmtMoney(p.total, 'EUR')}</span>
                        </div>
                        <div className="t-row">
                          <span className="t-key">Net deposits</span>
                          <span>{fmtMoney(p.deposits, 'EUR')}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Area
                  type="stepAfter"
                  dataKey="deposits"
                  stroke="#8698ad"
                  strokeDasharray="4 4"
                  fill="transparent"
                  strokeWidth={1.5}
                  name="Deposits"
                />
                <Area
                  type="stepAfter"
                  dataKey="total"
                  stroke="#2ecc8f"
                  fill="url(#abnVal)"
                  strokeWidth={2}
                  name="Value"
                />
              </AreaChart>
            </ResponsiveContainer>
          </section>

          <div className="two-col">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Asset allocation</h2>
                  <div className="desc">Latest statement breakdown</div>
                </div>
              </div>
              {pieData.length === 0 ? (
                <div className="empty">No holdings</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {pieData.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload as (typeof pieData)[0];
                        return (
                          <div className="tooltip">
                            <div className="t-date">{p.name}</div>
                            <div className="t-row">
                              <span className="t-key">Value</span>
                              <span>{fmtMoney(p.value, 'EUR')}</span>
                            </div>
                            <div className="t-row">
                              <span className="t-key">Share</span>
                              <span>{fmtPct(p.pct, 1)}</span>
                            </div>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <div className="alloc-legend">
                {pieData.map((d) => (
                  <div key={d.name} className="alloc-legend-item">
                    <span className="swatch" style={{ background: d.fill }} />
                    {d.name} · {fmtPct(d.pct, 1)}
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Costs by statement</h2>
                  <div className="desc">Service + product costs as reported (often YTD)</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={costsChart}>
                  <CartesianGrid stroke="#232e3e" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#8698ad', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#232e3e' }}
                  />
                  <YAxis
                    tick={{ fill: '#8698ad', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as (typeof costsChart)[0];
                      return (
                        <div className="tooltip">
                          <div className="t-date">{p.date}</div>
                          <div className="t-row">
                            <span className="t-key">Service</span>
                            <span>{fmtMoney(p.service, 'EUR')}</span>
                          </div>
                          <div className="t-row">
                            <span className="t-key">Product</span>
                            <span>{fmtMoney(p.product, 'EUR')}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="service" stackId="c" fill="#4f9dff" name="Service" />
                  <Bar dataKey="product" stackId="c" fill="#9b7bff" name="Product" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>
          </div>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Holdings</h2>
                <div className="desc">Positions on {overview.statementDate}</div>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Asset class</th>
                    <th>ISIN</th>
                    <th>Name</th>
                    <th className="num">Qty</th>
                    <th className="num">Price</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.latestHoldings.map((h) => (
                    <tr key={`${h.isin}-${h.assetClass}`}>
                      <td>{h.assetClass}</td>
                      <td>
                        <code>{h.isin}</code>
                      </td>
                      <td>{h.name}</td>
                      <td className="num">{fmtAbs(h.quantity, 4)}</td>
                      <td className="num">{fmtMoney(h.price, 'EUR')}</td>
                      <td className="num">{fmtMoney(h.value, 'EUR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Import log</h2>
                <div className="desc">{overview.imports.length} statement(s) stored</div>
              </div>
            </div>
            <ul className="import-log">
              {overview.imports.map((imp) => (
                <li key={imp.fileHash}>
                  <strong>{imp.fileName ?? 'statement.pdf'}</strong>
                  <span>{imp.statementDate}</span>
                  {imp.totalBalance != null && <span>{fmtMoney(imp.totalBalance, 'EUR')}</span>}
                  <span className="muted">
                    {new Date(imp.importedAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
