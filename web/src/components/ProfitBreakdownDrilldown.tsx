import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, fmtMoney, type ProfitBreakdown, type ProfitContributor } from '../api';
import { isPrivacyMasked, usePrivacy } from '../privacy';

interface WaterfallPoint {
  name: string;
  /** invisible offset so the visible bar floats at the running total */
  base: number;
  height: number;
  amount: number;
  kind: 'component' | 'total';
  description?: string;
}

function buildWaterfall(b: ProfitBreakdown): WaterfallPoint[] {
  const points: WaterfallPoint[] = [];
  let cum = 0;
  for (const c of b.components) {
    const next = cum + c.amount;
    points.push({
      name: c.label,
      base: Math.min(cum, next),
      height: Math.abs(c.amount),
      amount: c.amount,
      kind: 'component',
      description: c.description,
    });
    cum = next;
  }
  points.push({
    name: 'All-time profit',
    base: Math.min(0, cum),
    height: Math.abs(cum),
    amount: cum,
    kind: 'total',
  });
  return points;
}

function WaterfallTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: { payload: WaterfallPoint }[];
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tooltip" style={{ maxWidth: 260 }}>
      <div className="t-date">{p.name}</div>
      <div className="t-row">
        <span className="t-key">Amount</span>
        <span className={p.amount >= 0 ? 'pos' : 'neg'}>{fmtMoney(p.amount, currency)}</span>
      </div>
      {p.description && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)', whiteSpace: 'normal' }}>
          {p.description}
        </div>
      )}
    </div>
  );
}

function ContributorList({
  title,
  items,
  currency,
  tone,
}: {
  title: string;
  items: ProfitContributor[];
  currency: string;
  tone: 'pos' | 'neg';
}) {
  if (!items.length) return null;
  return (
    <div className="contrib-col">
      <h4>{title}</h4>
      {items.map((c) => (
        <div className="contrib-row" key={c.key}>
          <div className="instr">
            {c.imageUrl ? (
              <img src={c.imageUrl} alt="" loading="lazy" />
            ) : (
              <div className="logo-fallback">{(c.symbol ?? '?').slice(0, 3)}</div>
            )}
            <div>
              <div className="sym">
                {c.symbol ?? `#${c.instrumentId}`}
                {c.open && <span className="copy-tag">OPEN</span>}
              </div>
              <div className="nm">
                {fmtMoney(c.realized, currency)} realized · {fmtMoney(c.unrealized, currency)} open
              </div>
            </div>
          </div>
          <div className={`contrib-total ${tone}`}>{fmtMoney(c.total, currency)}</div>
        </div>
      ))}
    </div>
  );
}

export function ProfitBreakdownDrilldown({ onClose }: { onClose: () => void }) {
  usePrivacy();
  const [data, setData] = useState<ProfitBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .profitBreakdown()
      .then((d) => !cancelled && setData(d))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const masked = isPrivacyMasked();

  return (
    <div className="drilldown metric-drilldown">
      <button className="close-btn" onClick={onClose}>
        Close
      </button>
      <h3>Where your all-time profit comes from</h3>

      {error ? (
        <div className="error-box">{error}</div>
      ) : !data ? (
        <div className="loading">
          <div className="spinner" />
          Building profit breakdown…
        </div>
      ) : !data.available ? (
        <div className="empty">{data.reason ?? 'Not enough data yet.'}</div>
      ) : (
        <>
          <p className="drilldown-copy">
            All-time profit is simply <strong>what the account is worth today</strong> (
            {fmtMoney(data.currentEquity ?? 0, data.currency)}) minus{' '}
            <strong>the money you put in</strong> ({fmtMoney(data.netDeposits, data.currency)} net
            deposits: {fmtMoney(data.totalDeposits, data.currency)} in,{' '}
            {fmtMoney(data.totalWithdrawals, data.currency)} out). The chart splits that difference
            into its sources — closed trades, dividends, and paper gains on positions still open.
          </p>

          {!masked && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={buildWaterfall(data)}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid stroke="#232e3e" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#8698ad', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#232e3e' }}
                  interval={0}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v.toFixed(0)}`
                  }
                  tick={{ fill: '#8698ad', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <Tooltip
                  content={<WaterfallTooltip currency={data.currency} />}
                  cursor={{ fill: 'rgba(79,157,255,0.06)' }}
                />
                <ReferenceLine y={0} stroke="#3a4a60" />
                <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="height" stackId="wf" radius={[3, 3, 0, 0]}>
                  {buildWaterfall(data).map((p) => (
                    <Cell
                      key={p.name}
                      fill={p.kind === 'total' ? '#4f9dff' : p.amount >= 0 ? '#2ecc8f' : '#ff5c72'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}

          <div className="breakdown-grid">
            {data.components.map((c) => (
              <div className="stat" key={c.key}>
                <div className="label">{c.label}</div>
                <div className={`value ${c.amount >= 0 ? 'pos' : 'neg'}`}>
                  {fmtMoney(c.amount, data.currency)}
                </div>
                <div className="hint">{c.description}</div>
              </div>
            ))}
          </div>

          {data.feesTotal > 0 && (
            <div className="chart-note">
              Lifetime trading fees of {fmtMoney(data.feesTotal, data.currency)} are already
              deducted inside realized P&L — they are shown for awareness, not added again.
            </div>
          )}

          {(data.winners.length > 0 || data.losers.length > 0) && (
            <div className="contrib-grid">
              <ContributorList
                title="Top contributors"
                items={data.winners}
                currency={data.currency}
                tone="pos"
              />
              <ContributorList
                title="Top detractors"
                items={data.losers}
                currency={data.currency}
                tone="neg"
              />
            </div>
          )}

          {data.years.length > 0 && (
            <>
              <h4 className="drilldown-subtitle">Realized profit by year</h4>
              <table className="trades-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Realized P&L</th>
                    <th>Dividends (net)</th>
                    <th>Fees</th>
                  </tr>
                </thead>
                <tbody>
                  {data.years.map((y) => (
                    <tr key={y.year}>
                      <td>{y.year}</td>
                      <td className={y.realizedProfit >= 0 ? 'pos' : 'neg'}>
                        {fmtMoney(y.realizedProfit, data.currency)}
                      </td>
                      <td>{fmtMoney(y.dividendsNet, data.currency)}</td>
                      <td>{fmtMoney(y.fees, data.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}
