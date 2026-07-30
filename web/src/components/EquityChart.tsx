import { useEffect, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, fmtMoney, type EquityHistory, type EquityPoint } from '../api';

function fmtDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

function EquityTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: { payload: EquityPoint }[];
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const earned = p.total - p.cumulativeNetDeposits;
  return (
    <div className="tooltip">
      <div className="t-date">{p.date}</div>
      <div className="t-row">
        <span className="t-key">Total value</span>
        <span>{fmtMoney(p.total, currency)}</span>
      </div>
      <div className="t-row">
        <span className="t-key">Invested</span>
        <span>{fmtMoney(p.invested, currency)}</span>
      </div>
      <div className="t-row">
        <span className="t-key">Cash</span>
        <span>{fmtMoney(p.cash, currency)}</span>
      </div>
      <div className="t-row">
        <span className="t-key">Open P&L</span>
        <span className={p.pnl >= 0 ? 'pos' : 'neg'}>{fmtMoney(p.pnl, currency)}</span>
      </div>
      <div className="t-row">
        <span className="t-key">Cumulative deposits</span>
        <span>{fmtMoney(p.cumulativeNetDeposits, currency)}</span>
      </div>
      <div className="t-row">
        <span className="t-key">Earned vs deposits</span>
        <span className={earned >= 0 ? 'pos' : 'neg'}>{fmtMoney(earned, currency)}</span>
      </div>
      {p.netFlow !== 0 && (
        <div className="t-row">
          <span className="t-key">{p.netFlow > 0 ? 'Deposit' : 'Withdrawal'} today</span>
          <span>{fmtMoney(Math.abs(p.netFlow), currency)}</span>
        </div>
      )}
    </div>
  );
}

export function EquityChart() {
  const [history, setHistory] = useState<EquityHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .balanceHistory()
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currency = history?.displayCurrency ?? 'USD';

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Equity evolution</h2>
          <div className="desc">
            Absolute account value over time. The dashed line is your cumulative net deposits —
            the gap to total value is money earned, not added.
            {history?.source === 'supabase' && history.storedSince
              ? ` Stored since ${history.storedSince} (grows beyond eToro’s 12-month API window).`
              : ' Limited to eToro’s last 12 months until Supabase history is seeded.'}
          </div>
        </div>
        {history && (
          <div className="desc">
            Window flows: <strong>{fmtMoney(history.totalDepositsInWindow, currency)}</strong>{' '}
            deposited, <strong>{fmtMoney(history.totalWithdrawalsInWindow, currency)}</strong>{' '}
            withdrawn
          </div>
        )}
      </div>

      {error ? (
        <div className="error-box">{error}</div>
      ) : !history ? (
        <div className="loading">
          <div className="spinner" />
          Loading balance history…
        </div>
      ) : history.points.length === 0 ? (
        <div className="empty">No balance history available.</div>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={history.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="investedGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#9b7bff" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#9b7bff" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="cashGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2ecc8f" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#2ecc8f" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#232e3e" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fill: '#8698ad', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#232e3e' }}
              minTickGap={50}
            />
            <YAxis
              tickFormatter={(v: number) => fmtMoney(v, currency)}
              tick={{ fill: '#8698ad', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={78}
            />
            <Tooltip content={<EquityTooltip currency={currency} />} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#8698ad' }} />
            <Area
              type="monotone"
              dataKey="invested"
              name="Invested"
              stackId="1"
              stroke="#9b7bff"
              fill="url(#investedGrad)"
            />
            <Area
              type="monotone"
              dataKey="cash"
              name="Cash"
              stackId="1"
              stroke="#2ecc8f"
              fill="url(#cashGrad)"
            />
            <Line
              type="monotone"
              dataKey="total"
              name="Total value"
              stroke="#4f9dff"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="cumulativeNetDeposits"
              name="Cumulative net deposits"
              stroke="#ffb84d"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
      <div className="chart-note">
        Deposits/withdrawals are inferred from day-over-day balance changes not explained by open
        or realized P&L.
      </div>
    </section>
  );
}
