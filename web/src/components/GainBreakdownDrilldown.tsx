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
import { api, fmtMoney, fmtPct, type GainBreakdown } from '../api';
import { isPrivacyMasked, usePrivacy } from '../privacy';

function GainTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: {
    payload: {
      year: string;
      gain: number;
      cumulativeGain: number;
      absoluteProfit: number;
    };
  }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="t-date">{p.year}</div>
      <div className="t-row">
        <span className="t-key">Absolute profit</span>
        <span className={p.absoluteProfit >= 0 ? 'pos' : 'neg'}>
          {fmtMoney(p.absoluteProfit)}
        </span>
      </div>
      <div className="t-row">
        <span className="t-key">Year gain</span>
        <span className={p.gain >= 0 ? 'pos' : 'neg'}>{fmtPct(p.gain)}</span>
      </div>
      <div className="t-row">
        <span className="t-key">Cumulative</span>
        <span className={p.cumulativeGain >= 0 ? 'pos' : 'neg'}>{fmtPct(p.cumulativeGain)}</span>
      </div>
    </div>
  );
}

function AbsoluteProfitTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { year: string; absoluteProfit: number; netFlow: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="t-date">{p.year}</div>
      <div className="t-row">
        <span className="t-key">Absolute profit</span>
        <span className={p.absoluteProfit >= 0 ? 'pos' : 'neg'}>
          {fmtMoney(p.absoluteProfit)}
        </span>
      </div>
      <div className="t-row">
        <span className="t-key">Net deposits</span>
        <span className={p.netFlow >= 0 ? '' : 'neg'}>{fmtMoney(p.netFlow)}</span>
      </div>
    </div>
  );
}

function equityRange(start: number | null, end: number | null): string {
  if (start === null && end === null) return '—';
  if (start === null) return `— → ${fmtMoney(end!)}`;
  if (end === null) return `${fmtMoney(start)} → —`;
  return `${fmtMoney(start)} → ${fmtMoney(end)}`;
}

export function GainBreakdownDrilldown({ onClose }: { onClose: () => void }) {
  usePrivacy();
  const [data, setData] = useState<GainBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .gainBreakdown()
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
      <h3>How the all-time gain is built</h3>

      {error ? (
        <div className="error-box">{error}</div>
      ) : !data ? (
        <div className="loading">
          <div className="spinner" />
          Building gain breakdown…
        </div>
      ) : !data.available ? (
        <div className="empty">{data.reason ?? 'Not enough data yet.'}</div>
      ) : (
        <>
          <p className="drilldown-copy">
            All-time gain is a <strong>deposit-adjusted</strong> return: money you add is not counted
            as performance. Each year&apos;s gain is computed independently, then the years{' '}
            <strong>compound multiplicatively</strong> — e.g. +10% then +20% is 1.10 × 1.20 − 1 =
            +32%, not +30%. Absolute profit is what the account earned that year after removing
            deposits and withdrawals; deposits change the base that compounds next year, not the
            gain itself. Source:{' '}
            {data.source === 'etoro' ? 'eToro official gain series' : 'derived from equity history'}.
            {data.since ? ` History since ${data.since}.` : ''}
          </p>

          <div className="breakdown-grid">
            <div className="stat">
              <div className="label">All-time gain</div>
              <div className={`value ${data.totalGain !== null && data.totalGain < 0 ? 'neg' : 'pos'}`}>
                {data.totalGain !== null ? fmtPct(data.totalGain) : '—'}
              </div>
              <div className="hint">Compounded across every year</div>
            </div>
            <div className="stat">
              <div className="label">CAGR</div>
              <div className={`value ${data.cagr !== null && data.cagr < 0 ? 'neg' : 'pos'}`}>
                {data.cagr !== null ? fmtPct(data.cagr) : '—'}
              </div>
              <div className="hint">Annualized compound growth</div>
            </div>
            <div className="stat">
              <div className="label">Best year</div>
              <div className="value pos">
                {data.bestYear ? fmtPct(data.bestYear.gain) : '—'}
              </div>
              <div className="hint">{data.bestYear?.date ?? ''}</div>
            </div>
            <div className="stat">
              <div className="label">Worst year</div>
              <div className="value neg">
                {data.worstYear ? fmtPct(data.worstYear.gain) : '—'}
              </div>
              <div className="hint">{data.worstYear?.date ?? ''}</div>
            </div>
          </div>

          {!masked && data.years.length > 0 && (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.years} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#232e3e" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="year"
                  tick={{ fill: '#8698ad', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#232e3e' }}
                />
                <YAxis
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fill: '#8698ad', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip content={<GainTooltip />} cursor={{ fill: 'rgba(79,157,255,0.06)' }} />
                <ReferenceLine y={0} stroke="#3a4a60" />
                <Bar dataKey="gain" radius={[3, 3, 0, 0]}>
                  {data.years.map((y) => (
                    <Cell key={y.year} fill={y.gain >= 0 ? '#2ecc8f' : '#ff5c72'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}

          {!masked && data.years.length > 0 && (
            <>
              <h4 className="drilldown-subtitle">Absolute profit by year</h4>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.years} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#232e3e" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="year"
                    tick={{ fill: '#8698ad', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#232e3e' }}
                  />
                  <YAxis
                    tickFormatter={(v: number) => fmtMoney(v)}
                    tick={{ fill: '#8698ad', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                  />
                  <Tooltip
                    content={<AbsoluteProfitTooltip />}
                    cursor={{ fill: 'rgba(79,157,255,0.06)' }}
                  />
                  <ReferenceLine y={0} stroke="#3a4a60" />
                  <Bar dataKey="absoluteProfit" radius={[3, 3, 0, 0]}>
                    {data.years.map((y) => (
                      <Cell
                        key={y.year}
                        fill={y.absoluteProfit >= 0 ? '#2ecc8f' : '#ff5c72'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          )}

          {data.years.length > 0 && (
            <>
              <h4 className="drilldown-subtitle">Compounding ladder</h4>
              <table className="trades-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Absolute profit</th>
                    <th>Year gain</th>
                    <th>Cumulative</th>
                    <th>Net deposits</th>
                    <th>Start → End equity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.years.map((y) => (
                    <tr key={y.year}>
                      <td>{y.year}</td>
                      <td className={y.absoluteProfit >= 0 ? 'pos' : 'neg'}>
                        {fmtMoney(y.absoluteProfit)}
                      </td>
                      <td className={y.gain >= 0 ? 'pos' : 'neg'}>{fmtPct(y.gain)}</td>
                      <td className={y.cumulativeGain >= 0 ? 'pos' : 'neg'}>
                        {fmtPct(y.cumulativeGain)}
                      </td>
                      <td className={y.netFlow >= 0 ? '' : 'neg'}>{fmtMoney(y.netFlow)}</td>
                      <td>{equityRange(y.startEquity, y.endEquity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="chart-note">
                Absolute profit = end equity − start equity − net deposits. Cumulative after year N =
                (1 + g₁) × (1 + g₂) × … × (1 + gₙ) − 1. Deposits expand the capital base that
                compounds next year; they are not part of the gain.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
