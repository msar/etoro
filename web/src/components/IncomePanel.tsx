import { useEffect, useState } from 'react';
import { api, fmtMoney, type IncomeReport } from '../api';
import { usePrivacy } from '../privacy';

export function IncomePanel() {
  usePrivacy();
  const [report, setReport] = useState<IncomeReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .income()
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Dividends &amp; fees</h2>
          <div className="desc">
            Cash your portfolio produced (dividends) and what it cost (fees), per calendar year.
          </div>
        </div>
      </div>

      {error ? (
        <div className="error-box">{error}</div>
      ) : !report ? (
        <div className="loading">
          <div className="spinner" />
          Loading income…
        </div>
      ) : !report.available ? (
        <div className="empty">{report.reason ?? 'No income data stored yet.'}</div>
      ) : (
        <div className="income-grid">
          <div style={{ overflowX: 'auto' }}>
            <table className="holdings-table">
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Dividends (net)</th>
                  <th title="Tax withheld at source before payout">Withheld tax</th>
                  <th>Payouts</th>
                  <th>Trade fees</th>
                  <th>Realized P&L</th>
                </tr>
              </thead>
              <tbody>
                {report.years.map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td className="pos">{fmtMoney(y.dividendsNet)}</td>
                    <td>{fmtMoney(y.withholdingTax)}</td>
                    <td>{y.dividendCount.toLocaleString()}</td>
                    <td className={y.fees > 0 ? 'neg' : ''}>{fmtMoney(-Math.abs(y.fees))}</td>
                    <td className={y.realizedProfit >= 0 ? 'pos' : 'neg'}>
                      {fmtMoney(y.realizedProfit)}
                    </td>
                  </tr>
                ))}
                <tr className="totals-row">
                  <td>Total</td>
                  <td className="pos">{fmtMoney(report.totals.dividendsNet)}</td>
                  <td>{fmtMoney(report.totals.withholdingTax)}</td>
                  <td>{report.years.reduce((s, y) => s + y.dividendCount, 0).toLocaleString()}</td>
                  <td className="neg">{fmtMoney(-Math.abs(report.totals.fees))}</td>
                  <td className={report.totals.realizedProfit >= 0 ? 'pos' : 'neg'}>
                    {fmtMoney(report.totals.realizedProfit)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {report.topDividendPayers.length > 0 && (
            <div className="dividend-payers">
              <h3>Top dividend payers (all-time)</h3>
              <ul>
                {report.topDividendPayers.map((p) => (
                  <li key={p.name}>
                    <span className="payer-name">{p.name}</span>
                    <span className="payer-amount pos">{fmtMoney(p.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
