import { useEffect, useMemo, useState } from 'react';
import { api, fmtMoney, fmtPct, type InstrumentPerformanceReport } from '../api';

type SortKey =
  | 'realizedProfit'
  | 'trades'
  | 'totalInvested'
  | 'winRate'
  | 'returnOnInvested'
  | 'avgHoldingDays'
  | 'totalFees';

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: 'realizedProfit', label: 'Realized P&L' },
  { key: 'returnOnInvested', label: 'Return', title: 'Realized P&L ÷ total invested' },
  { key: 'trades', label: 'Trades' },
  { key: 'winRate', label: 'Win rate' },
  { key: 'totalInvested', label: 'Invested (cum.)' },
  { key: 'totalFees', label: 'Fees' },
  { key: 'avgHoldingDays', label: 'Avg hold' },
];

function fmtHold(days: number): string {
  if (days >= 365) return `${(days / 365.25).toFixed(1)}y`;
  if (days >= 30) return `${(days / 30.44).toFixed(1)}mo`;
  return `${days.toFixed(0)}d`;
}

export function InstrumentPerformanceTable() {
  const [report, setReport] = useState<InstrumentPerformanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('realizedProfit');
  const [sortDesc, setSortDesc] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .instrumentPerformance()
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

  const rows = useMemo(() => {
    if (!report) return [];
    const q = filter.trim().toUpperCase();
    const filtered = q
      ? report.items.filter(
          (i) =>
            i.key.toUpperCase().includes(q) || (i.name ?? '').toUpperCase().includes(q),
        )
      : report.items;
    const sorted = [...filtered].sort((a, b) =>
      sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey],
    );
    return showAll ? sorted : sorted.slice(0, 25);
  }, [report, sortKey, sortDesc, showAll, filter]);

  function onSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Instrument performance</h2>
          <div className="desc">
            All-time realized results per instrument from stored closed trades
            {report?.since ? ` (since ${report.since})` : ''}.
            {report && (
              <>
                {' '}
                {report.totalTrades.toLocaleString()} trades, total realized{' '}
                <strong className={report.totalRealizedProfit >= 0 ? 'pos' : 'neg'}>
                  {fmtMoney(report.totalRealizedProfit)}
                </strong>
                .
              </>
            )}
          </div>
        </div>
        <div className="controls">
          <input
            type="search"
            className="table-filter"
            placeholder="Filter symbol…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div className="error-box">{error}</div>
      ) : !report ? (
        <div className="loading">
          <div className="spinner" />
          Aggregating trades…
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">No closed trades stored yet.</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="holdings-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      title={c.title}
                      onClick={() => onSort(c.key)}
                      style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {c.label}
                      {sortKey === c.key ? (sortDesc ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <div className="instr">
                        <div className="logo-fallback">{r.key.replace('#', '').slice(0, 3)}</div>
                        <div>
                          <div className="sym">{r.key}</div>
                          <div className="nm">{r.name ?? ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className={r.realizedProfit >= 0 ? 'pos' : 'neg'}>
                      {fmtMoney(r.realizedProfit)}
                    </td>
                    <td className={r.returnOnInvested >= 0 ? 'pos' : 'neg'}>
                      {fmtPct(r.returnOnInvested)}
                    </td>
                    <td>{r.trades.toLocaleString()}</td>
                    <td>{(r.winRate * 100).toFixed(0)}%</td>
                    <td>{fmtMoney(r.totalInvested)}</td>
                    <td>{fmtMoney(r.totalFees)}</td>
                    <td>{fmtHold(r.avgHoldingDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.items.length > 25 && (
            <button type="button" className="ghost-btn" style={{ marginTop: 10 }} onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show top 25' : `Show all ${report.items.length} instruments`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
