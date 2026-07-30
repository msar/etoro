import { useEffect, useMemo, useState } from 'react';
import { api, fmtMoney, fmtPct, type PortfolioSummary, type Trade } from '../api';

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function Drilldown({
  instrumentId,
  symbol,
  name,
  trades,
  tradesError,
  currency,
  onClose,
}: {
  instrumentId: number;
  symbol: string | null;
  name: string | null;
  trades: Trade[] | null;
  tradesError: string | null;
  currency: string;
  onClose: () => void;
}) {
  const rows = useMemo(
    () => (trades ?? []).filter((t) => t.instrumentId === instrumentId),
    [trades, instrumentId],
  );
  const realized = rows.reduce((sum, t) => sum + t.netProfit, 0);

  return (
    <div className="drilldown">
      <button className="close-btn" onClick={onClose}>
        Close
      </button>
      <h3>
        {symbol ?? `#${instrumentId}`} — {name ?? 'Instrument'} · all stored closed trades
      </h3>
      {tradesError ? (
        <div className="error-box">{tradesError}</div>
      ) : trades === null ? (
        <div className="loading">
          <div className="spinner" />
          Loading trades…
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">No stored closed trades for this instrument.</div>
      ) : (
        <>
          <div className="chart-note" style={{ marginBottom: 8 }}>
            {rows.length} closed trade{rows.length === 1 ? '' : 's'}, realized net profit{' '}
            <strong className={realized >= 0 ? 'pos' : 'neg'}>{fmtMoney(realized, currency)}</strong>
          </div>
          <table className="trades-table">
            <thead>
              <tr>
                <th>Direction</th>
                <th>Opened</th>
                <th>Closed</th>
                <th>Invested</th>
                <th>Open rate</th>
                <th>Close rate</th>
                <th>Leverage</th>
                <th>Net profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.positionId}>
                  <td>{t.isBuy ? 'Buy' : 'Sell'}</td>
                  <td>{fmtDateTime(t.openTimestamp)}</td>
                  <td>{fmtDateTime(t.closeTimestamp)}</td>
                  <td>{fmtMoney(t.investment, currency)}</td>
                  <td>{t.openRate}</td>
                  <td>{t.closeRate}</td>
                  <td>×{t.leverage}</td>
                  <td className={t.netProfit >= 0 ? 'pos' : 'neg'}>
                    {fmtMoney(t.netProfit, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function HoldingsTable() {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [tradesError, setTradesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .portfolio()
      .then((p) => {
        if (!cancelled) setPortfolio(p);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Lazy-load trades the first time a row is expanded.
  useEffect(() => {
    if (selected === null || trades !== null || tradesError !== null) return;
    let cancelled = false;
    api
      .trades()
      .then((res) => {
        if (!cancelled) setTrades(res.items);
      })
      .catch((err: Error) => {
        if (!cancelled) setTradesError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, trades, tradesError]);

  const currency = portfolio?.accountCurrency ?? 'USD';
  const hasEquityHoldings = useMemo(
    () => portfolio?.holdings.some((h) => !h.viaCopy) ?? false,
    [portfolio],
  );
  const metadataMissing = useMemo(
    () => (portfolio?.holdings.length ?? 0) > 0 && portfolio!.holdings.every((h) => h.symbol === null),
    [portfolio],
  );

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Current holdings</h2>
          <div className="desc">Click a row to drill down into its closed trades.</div>
        </div>
      </div>

      {error ? (
        <div className="error-box">{error}</div>
      ) : !portfolio ? (
        <div className="loading">
          <div className="spinner" />
          Loading portfolio…
        </div>
      ) : portfolio.holdings.length === 0 ? (
        <div className="empty">No open positions right now.</div>
      ) : (
        <>
          {metadataMissing && (
            <div className="notice">
              Instrument names are unavailable: your eToro user key does not include the
              market-data scope. Rows show instrument IDs instead. Re-create the key with
              market-data read permission to see names and logos.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="holdings-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Invested</th>
                  <th>Value</th>
                  <th>P&L</th>
                  <th>P&L %</th>
                  <th>Units</th>
                  <th>Avg lev.</th>
                  {hasEquityHoldings && <th title="eToro reports fees net of dividends; the two are not separable">Fees − div. (net)</th>}
                </tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((h) => (
                  <tr
                    key={`${h.instrumentId}-${h.viaCopy ? 'copy' : 'direct'}`}
                    className={selected === h.instrumentId ? 'selected' : ''}
                    onClick={() => setSelected(selected === h.instrumentId ? null : h.instrumentId)}
                  >
                    <td>
                      <div className="instr">
                        {h.imageUrl ? (
                          <img src={h.imageUrl} alt="" loading="lazy" />
                        ) : (
                          <div className="logo-fallback">{(h.symbol ?? '?').slice(0, 3)}</div>
                        )}
                        <div>
                          <div className="sym">
                            {h.symbol ?? `#${h.instrumentId}`}
                            {h.viaCopy && <span className="copy-tag">COPY</span>}
                          </div>
                          <div className="nm">{h.name ?? ''}</div>
                        </div>
                      </div>
                    </td>
                    <td>{fmtMoney(h.invested, currency)}</td>
                    <td>{fmtMoney(h.value, currency)}</td>
                    <td className={h.pnl >= 0 ? 'pos' : 'neg'}>{fmtMoney(h.pnl, currency)}</td>
                    <td className={h.pnlPercent >= 0 ? 'pos' : 'neg'}>
                      {fmtPct(h.pnlPercent / 100)}
                    </td>
                    <td>{h.netUnits.toFixed(4)}</td>
                    <td>×{h.avgLeverage.toFixed(1)}</td>
                    {hasEquityHoldings && <td>{fmtMoney(h.feesNetOfDividends, currency)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected !== null && (
            <Drilldown
              instrumentId={selected}
              symbol={portfolio.holdings.find((h) => h.instrumentId === selected)?.symbol ?? null}
              name={portfolio.holdings.find((h) => h.instrumentId === selected)?.name ?? null}
              trades={trades}
              tradesError={tradesError}
              currency={currency}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </section>
  );
}
