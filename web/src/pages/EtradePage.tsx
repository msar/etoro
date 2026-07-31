import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type EtradeImportResult,
  type EtradeOverview,
  type Granularity,
} from '../api';
import { AppNav } from '../components/AppNav';
import { PerformanceChart } from '../components/PerformanceChart';
import { usePrivacy } from '../privacy';

export function EtradePage() {
  usePrivacy();
  const [overview, setOverview] = useState<EtradeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadingGl, setUploadingGl] = useState(false);
  const [pdfImportResult, setPdfImportResult] = useState<EtradeImportResult | null>(null);
  const [glImportResult, setGlImportResult] = useState<EtradeImportResult | null>(null);
  const [pdfDragOver, setPdfDragOver] = useState(false);
  const [glDragOver, setGlDragOver] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const glInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await api.etradeOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const equityFetcher = useCallback(
    (granularity: Granularity, from?: string) => api.etradeEquityPerformance(granularity, from),
    [],
  );

  const realizedFetcher = useCallback(
    (granularity: Granularity, from?: string) => api.etradePerformance(granularity, from),
    [],
  );

  async function handlePdfFiles(files: FileList | File[]) {
    const pdfs = [...files].filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    );
    if (!pdfs.length) {
      setError('Please select E*TRADE Client Statement PDF files');
      return;
    }
    setUploadingPdf(true);
    setError(null);
    setPdfImportResult(null);
    try {
      const result = await api.etradeImportStatements(pdfs);
      setPdfImportResult(result);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Statement import failed');
    } finally {
      setUploadingPdf(false);
    }
  }

  async function handleGlFiles(files: FileList | File[]) {
    const sheets = [...files].filter((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.csv');
    });
    if (!sheets.length) {
      setError('Please select E*TRADE G&L .xlsx / .xls / .csv files');
      return;
    }
    setUploadingGl(true);
    setError(null);
    setGlImportResult(null);
    try {
      const result = await api.etradeImport(sheets);
      setGlImportResult(result);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'G&L import failed');
    } finally {
      setUploadingGl(false);
    }
  }

  const equityChart = useMemo(() => {
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

  const cumChart = useMemo(() => {
    if (!overview?.cumulativeBySellDate.length) return [];
    return overview.cumulativeBySellDate.map((p) => ({
      date: p.date,
      label: new Date(`${p.date}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }),
      cumulativeGain: p.cumulativeGain,
      periodGain: p.periodGain,
    }));
  }, [overview]);

  const hasEquity = Boolean(overview?.hasEquity);
  const hasRealized = Boolean(overview?.hasRealized);

  return (
    <div className="app">
      <AppNav />
      <header className="app-header">
        <div>
          <h1>
            E*TRADE
            <span className="badge real">Brokerage</span>
          </h1>
          <div className="sub">
            {overview?.accountNumber
              ? `Account ${overview.accountNumber}`
              : 'Client statements + Gains & Losses'}
            {overview?.statementDate ? ` · latest statement ${overview.statementDate}` : ''}
            {overview?.lots.length ? ` · ${overview.lots.length} closed lots` : ''}
          </div>
        </div>
        <div className="header-actions">
          <div className="sub">Values in USD · unvested RSU excluded from equity</div>
        </div>
      </header>

      <div className="notice" style={{ marginBottom: 16 }}>
        Account statements provide brokerage equity (securities + cash). Gains &amp; Losses covers
        realized closed lots only. Unvested employee stock plan value is not included in equity or
        Overview.
      </div>

      <div className="upload-grid" style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
        <section
          className={`upload-zone ${pdfDragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setPdfDragOver(true);
          }}
          onDragLeave={() => setPdfDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setPdfDragOver(false);
            if (e.dataTransfer.files.length) void handlePdfFiles(e.dataTransfer.files);
          }}
          onClick={() => pdfInputRef.current?.click()}
        >
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void handlePdfFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {uploadingPdf ? (
            <div className="loading">
              <div className="spinner" />
              Parsing statements…
            </div>
          ) : (
            <>
              <div className="upload-title">Drop Client Statement PDFs here</div>
              <div className="upload-hint">Account equity · multi-quarter packs supported</div>
            </>
          )}
        </section>

        <section
          className={`upload-zone ${glDragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setGlDragOver(true);
          }}
          onDragLeave={() => setGlDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setGlDragOver(false);
            if (e.dataTransfer.files.length) void handleGlFiles(e.dataTransfer.files);
          }}
          onClick={() => glInputRef.current?.click()}
        >
          <input
            ref={glInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void handleGlFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {uploadingGl ? (
            <div className="loading">
              <div className="spinner" />
              Parsing G&amp;L file…
            </div>
          ) : (
            <>
              <div className="upload-title">Drop Gains &amp; Losses Expanded (.xlsx) here</div>
              <div className="upload-hint">Realized closed lots · re-upload replaces prior lots</div>
            </>
          )}
        </section>
      </div>

      {pdfImportResult && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h2>Statement import</h2>
            <div className="desc">
              {pdfImportResult.imported} imported · {pdfImportResult.duplicates} duplicate ·{' '}
              {pdfImportResult.errors} error
            </div>
          </div>
          <ul className="import-log">
            {pdfImportResult.results.map((r) => (
              <li key={r.fileName + (r.statementDate ?? '')} className={`status-${r.status}`}>
                <strong>{r.fileName}</strong>
                <span className="badge">{r.status}</span>
                {r.statementsImported != null && <span>{r.statementsImported} quarters</span>}
                {r.statementDate && <span>{r.statementDate}</span>}
                {r.totalBalance != null && <span>{fmtMoney(r.totalBalance, 'USD')}</span>}
                {r.error && <span className="neg">{r.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {glImportResult && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h2>G&amp;L import</h2>
            <div className="desc">
              {glImportResult.imported} imported · {glImportResult.duplicates} duplicate ·{' '}
              {glImportResult.errors} error
            </div>
          </div>
          <ul className="import-log">
            {glImportResult.results.map((r) => (
              <li key={r.fileName} className={`status-${r.status}`}>
                <strong>{r.fileName}</strong>
                <span className="badge">{r.status}</span>
                {r.lotCount != null && <span>{r.lotCount} lots</span>}
                {r.totalAdjustedGain != null && (
                  <span>{fmtMoney(r.totalAdjustedGain, 'USD')}</span>
                )}
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
              'No data yet. Upload Client Statement PDFs and/or a Gains & Losses Expanded export.'}
          </div>
        </div>
      ) : (
        <>
          {hasEquity && (
            <>
              <div className="cards">
                <div className="card">
                  <div className="label">Brokerage equity</div>
                  <div className="value">
                    {overview.currentValue != null ? fmtMoney(overview.currentValue, 'USD') : '—'}
                  </div>
                  <div className="hint">
                    {overview.statementDate
                      ? `As of ${overview.statementDate}`
                      : 'Securities + cash'}
                  </div>
                </div>
                <div className="card">
                  <div className="label">Total plan value</div>
                  <div className="value">
                    {overview.totalPlanValue != null
                      ? fmtMoney(overview.totalPlanValue, 'USD')
                      : '—'}
                  </div>
                  <div className="hint">Remaining + taken out</div>
                </div>
                <div className="card">
                  <div className="label">Investment gain</div>
                  <div
                    className={`value ${(overview.allTimeGain ?? 0) >= 0 ? 'pos' : 'neg'}`}
                  >
                    {overview.allTimeGain != null ? fmtMoney(overview.allTimeGain, 'USD') : '—'}
                  </div>
                  <div className="hint">
                    {overview.allTimeGainPct != null
                      ? `${fmtPct(overview.allTimeGainPct)} vs compensation`
                      : 'vs compensation received'}
                  </div>
                </div>
                <div className="card">
                  <div className="label">Compensation</div>
                  <div className="value">{fmtMoney(overview.totalDeposits, 'USD')}</div>
                  <div className="hint">
                    Out {fmtMoney(overview.totalWithdrawals, 'USD')} taken out
                  </div>
                </div>
              </div>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Account equity</h2>
                    <div className="desc">
                      Quarterly brokerage market value (excludes unvested RSU). Inflows are
                      stock-plan compensation; withdrawals are takeout, not losses.
                    </div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={equityChart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="etradeEquity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4f9dff" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#4f9dff" stopOpacity={0.02} />
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
                      tickFormatter={(v: number) => fmtMoney(v, 'USD')}
                      tick={{ fill: '#8698ad', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={72}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload as (typeof equityChart)[0];
                        return (
                          <div className="tooltip">
                            <div className="t-date">{p.date}</div>
                            <div className="t-row">
                              <span className="t-key">Equity</span>
                              <span>{fmtMoney(p.total, 'USD')}</span>
                            </div>
                            <div className="t-row">
                              <span className="t-key">Cum. net flow</span>
                              <span>{fmtMoney(p.deposits, 'USD')}</span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="stepAfter"
                      dataKey="total"
                      stroke="#4f9dff"
                      fill="url(#etradeEquity)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </section>

              <PerformanceChart
                title="Equity performance"
                description="Time-weighted return from quarterly statement snapshots (withdrawals treated as takeout, not losses)."
                fetcher={equityFetcher}
                derivedNote="Based on Client Statement ending portfolio values and period compensation inflows / withdrawals."
              />

              {overview.latestHoldings.length > 0 && (
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h2>Latest holdings</h2>
                      <div className="desc">From statement ending {overview.statementDate}</div>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Name</th>
                          <th className="num">Qty</th>
                          <th className="num">Price</th>
                          <th className="num">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.latestHoldings.map((h) => (
                          <tr key={h.symbol}>
                            <td>
                              <strong>{h.symbol}</strong>
                            </td>
                            <td>{h.name ?? '—'}</td>
                            <td className="num">{fmtAbs(h.quantity, 4)}</td>
                            <td className="num">{fmtMoney(h.price, 'USD')}</td>
                            <td className="num">{fmtMoney(h.value, 'USD')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}

          {hasRealized && (
            <>
              <div className="panel-header" style={{ marginTop: hasEquity ? 24 : 0 }}>
                <div>
                  <h2>Gains &amp; Losses</h2>
                  <div className="desc">Realized closed lots · adjusted cost basis</div>
                </div>
              </div>

              <div className="cards">
                <div className="card">
                  <div className="label">Adjusted G/L</div>
                  <div className={`value ${overview.totalAdjustedGain >= 0 ? 'pos' : 'neg'}`}>
                    {fmtMoney(overview.totalAdjustedGain, 'USD')}
                  </div>
                  <div className="hint">
                    Long {fmtMoney(overview.longGain, 'USD')} · Short{' '}
                    {fmtMoney(overview.shortGain, 'USD')}
                  </div>
                </div>
                <div className="card">
                  <div className="label">Return on disposed cost</div>
                  <div className={`value ${(overview.returnOnCost ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                    {overview.returnOnCost != null ? fmtPct(overview.returnOnCost) : '—'}
                  </div>
                  <div className="hint">Adjusted gain ÷ adjusted cost basis</div>
                </div>
                <div className="card">
                  <div className="label">Total proceeds</div>
                  <div className="value">{fmtMoney(overview.totalProceeds, 'USD')}</div>
                  <div className="hint">
                    Cost basis {fmtMoney(overview.totalAdjustedCost, 'USD')}
                  </div>
                </div>
                <div className="card">
                  <div className="label">Shares sold</div>
                  <div className="value">{fmtAbs(overview.totalQuantity, 3)}</div>
                  <div className="hint">
                    Long {fmtAbs(overview.longQuantity, 3)} · Short{' '}
                    {fmtAbs(overview.shortQuantity, 3)}
                  </div>
                </div>
              </div>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Cumulative realized P&amp;L</h2>
                    <div className="desc">Running adjusted gain/loss by sell date</div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={cumChart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="etradeGain" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ff5c72" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#ff5c72" stopOpacity={0.02} />
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
                      tickFormatter={(v: number) => fmtMoney(v, 'USD')}
                      tick={{ fill: '#8698ad', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={72}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload as (typeof cumChart)[0];
                        return (
                          <div className="tooltip">
                            <div className="t-date">{p.date}</div>
                            <div className="t-row">
                              <span className="t-key">Period G/L</span>
                              <span className={p.periodGain >= 0 ? 'pos' : 'neg'}>
                                {fmtMoney(p.periodGain, 'USD')}
                              </span>
                            </div>
                            <div className="t-row">
                              <span className="t-key">Cumulative</span>
                              <span className={p.cumulativeGain >= 0 ? 'pos' : 'neg'}>
                                {fmtMoney(p.cumulativeGain, 'USD')}
                              </span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="stepAfter"
                      dataKey="cumulativeGain"
                      stroke="#ff5c72"
                      fill="url(#etradeGain)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </section>

              <PerformanceChart
                title="Realized performance"
                description="Period return = adjusted G/L ÷ adjusted cost of lots sold in each bucket; compounded over time."
                fetcher={realizedFetcher}
                derivedNote="Based on closed lots only. Does not include open positions or cash."
              />

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>By symbol</h2>
                    <div className="desc">Adjusted cost, proceeds, and G/L rollup</div>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th className="num">Lots</th>
                        <th className="num">Qty</th>
                        <th className="num">Adj. cost</th>
                        <th className="num">Proceeds</th>
                        <th className="num">Adj. G/L</th>
                        <th className="num">Return</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.bySymbol.map((s) => (
                        <tr key={s.symbol}>
                          <td>
                            <strong>{s.symbol}</strong>
                          </td>
                          <td className="num">{s.lotCount}</td>
                          <td className="num">{fmtAbs(s.quantity, 3)}</td>
                          <td className="num">{fmtMoney(s.adjustedCost, 'USD')}</td>
                          <td className="num">{fmtMoney(s.proceeds, 'USD')}</td>
                          <td className={`num ${s.adjustedGain >= 0 ? 'pos' : 'neg'}`}>
                            {fmtMoney(s.adjustedGain, 'USD')}
                          </td>
                          <td className={`num ${(s.returnOnCost ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                            {s.returnOnCost != null ? fmtPct(s.returnOnCost) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Closed lots</h2>
                    <div className="desc">{overview.lots.length} lots · adjusted basis fields</div>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Acquired</th>
                        <th>Sold</th>
                        <th className="num">Qty</th>
                        <th className="num">Adj. cost</th>
                        <th className="num">Proceeds</th>
                        <th className="num">Adj. G/L</th>
                        <th>Term</th>
                        <th>Plan</th>
                        <th>Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.lots.map((l) => (
                        <tr key={l.lotKey}>
                          <td>
                            <strong>{l.symbol}</strong>
                          </td>
                          <td>{l.dateAcquired ?? '—'}</td>
                          <td>{l.dateSold}</td>
                          <td className="num">{fmtAbs(l.quantity, 3)}</td>
                          <td className="num">{fmtMoney(l.adjustedCost, 'USD')}</td>
                          <td className="num">{fmtMoney(l.proceeds, 'USD')}</td>
                          <td className={`num ${l.adjustedGain >= 0 ? 'pos' : 'neg'}`}>
                            {fmtMoney(l.adjustedGain, 'USD')}
                          </td>
                          <td>{l.capitalGainsStatus ?? '—'}</td>
                          <td>{l.planType ?? '—'}</td>
                          <td>
                            <code>{l.orderNumber ?? '—'}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {(overview.statementImports.length > 0 || overview.imports.length > 0) && (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Import log</h2>
                  <div className="desc">
                    {overview.statementImports.length} statement(s)
                    {overview.imports.length ? ` · ${overview.imports.length} G&L file(s)` : ''}
                  </div>
                </div>
              </div>
              <ul className="import-log">
                {overview.statementImports.map((imp) => (
                  <li key={imp.fileHash}>
                    <strong>{imp.fileName ?? 'statement.pdf'}</strong>
                    <span className="badge">statement</span>
                    <span>{imp.statementDate}</span>
                    {imp.totalBalance != null && (
                      <span>{fmtMoney(imp.totalBalance, 'USD')}</span>
                    )}
                    <span className="muted">
                      {new Date(imp.importedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </li>
                ))}
                {overview.imports.map((imp) => (
                  <li key={imp.fileHash}>
                    <strong>{imp.fileName ?? 'GL.xlsx'}</strong>
                    <span className="badge">G&amp;L</span>
                    <span>{imp.statementDate}</span>
                    {imp.totalBalance != null && (
                      <span>{fmtMoney(imp.totalBalance, 'USD')} adj. G/L</span>
                    )}
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
          )}
        </>
      )}
    </div>
  );
}
