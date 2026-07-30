import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
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
import { api, fmtPct, type Granularity, type PerformanceSeries } from '../api';
import { Segmented } from './Segmented';

type Range = '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'ALL';
type Mode = 'cumulative' | 'periodic';

const RANGES: { value: Range; label: string }[] = [
  { value: '1M', label: '1M' },
  { value: '6M', label: '6M' },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1Y' },
  { value: '5Y', label: '5Y' },
  { value: 'ALL', label: 'Max' },
];

function rangeStart(range: Range): string | null {
  const now = new Date();
  switch (range) {
    case '1M':
      now.setMonth(now.getMonth() - 1);
      break;
    case '6M':
      now.setMonth(now.getMonth() - 6);
      break;
    case 'YTD':
      return `${now.getFullYear()}-01-01`;
    case '1Y':
      now.setFullYear(now.getFullYear() - 1);
      break;
    case '5Y':
      now.setFullYear(now.getFullYear() - 5);
      break;
    case 'ALL':
      return null;
  }
  return now.toISOString().slice(0, 10);
}

function formatLabel(date: string, granularity: Granularity): string {
  if (granularity === 'yearly') return date.slice(0, 4);
  if (granularity === 'monthly') {
    const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  if (granularity === 'weekly') {
    return `w/e ${new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })}`;
  }
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

interface ChartPoint {
  date: string;
  label: string;
  gain: number;
  cumulativeGain: number;
}

function PerfTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
  mode: Mode;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="t-date">{p.date}</div>
      <div className="t-row">
        <span className="t-key">Period gain</span>
        <span className={p.gain >= 0 ? 'pos' : 'neg'}>{fmtPct(p.gain)}</span>
      </div>
      {mode === 'cumulative' && (
        <div className="t-row">
          <span className="t-key">Cumulative</span>
          <span className={p.cumulativeGain >= 0 ? 'pos' : 'neg'}>{fmtPct(p.cumulativeGain)}</span>
        </div>
      )}
    </div>
  );
}

export function PerformanceChart() {
  const [granularity, setGranularity] = useState<Granularity>('monthly');
  const [mode, setMode] = useState<Mode>('cumulative');
  const [range, setRange] = useState<Range>('ALL');
  const [series, setSeries] = useState<PerformanceSeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Pass the window start so the server can pick the deepest source that
    // covers it (official eToro series vs. stored-history derivation).
    api
      .performance(granularity, rangeStart(range) ?? undefined)
      .then((s) => {
        if (!cancelled) setSeries(s);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [granularity, range]);

  const data: ChartPoint[] = useMemo(() => {
    if (!series) return [];
    const start = rangeStart(range);
    const filtered = start ? series.points.filter((p) => p.date >= start) : series.points;
    // Re-base cumulative compounding to the start of the selected range so the
    // chart answers "how did I perform within this window".
    let compound = 1;
    return filtered.map((p) => {
      compound *= 1 + p.gain;
      return {
        date: p.date.slice(0, granularity === 'yearly' ? 4 : granularity === 'monthly' ? 7 : 10),
        label: formatLabel(p.date, granularity),
        gain: p.gain,
        cumulativeGain: compound - 1,
      };
    });
  }, [series, range, granularity]);

  const windowGain = data.length ? data[data.length - 1].cumulativeGain : null;
  const derived = series?.source === 'derived';

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Performance</h2>
          <div className="desc">
            Deposit-adjusted gain (eToro methodology) — adding money is an increase of investment,
            not a gain.
            {windowGain !== null && (
              <>
                {' '}
                Selected window:{' '}
                <strong className={windowGain >= 0 ? 'pos' : 'neg'}>{fmtPct(windowGain)}</strong>
              </>
            )}
          </div>
        </div>
        <div className="controls">
          <Segmented
            options={[
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'yearly', label: 'Yearly' },
            ]}
            value={granularity}
            onChange={setGranularity}
          />
          <Segmented
            options={[
              { value: 'cumulative', label: 'Cumulative' },
              { value: 'periodic', label: 'Per period' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <Segmented options={RANGES} value={range} onChange={setRange} />
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          Loading performance…
        </div>
      ) : error ? (
        <div className="error-box">{error}</div>
      ) : data.length === 0 ? (
        <div className="empty">No performance data for this window.</div>
      ) : mode === 'cumulative' ? (
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
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
              minTickGap={40}
            />
            <YAxis
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              tick={{ fill: '#8698ad', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip content={<PerfTooltip mode={mode} />} />
            <ReferenceLine y={0} stroke="#3a4a60" />
            <Area
              type="monotone"
              dataKey="cumulativeGain"
              stroke="#4f9dff"
              strokeWidth={2}
              fill="url(#perfGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#232e3e" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: '#8698ad', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#232e3e' }}
              minTickGap={40}
            />
            <YAxis
              tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
              tick={{ fill: '#8698ad', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip content={<PerfTooltip mode={mode} />} cursor={{ fill: 'rgba(79,157,255,0.06)' }} />
            <ReferenceLine y={0} stroke="#3a4a60" />
            <Bar dataKey="gain" radius={[3, 3, 0, 0]}>
              {data.map((p) => (
                <Cell key={p.date} fill={p.gain >= 0 ? '#2ecc8f' : '#ff5c72'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {derived && !loading && !error && (
        <div className="chart-note">
          Computed from stored daily balance snapshots (time-weighted, deposits excluded from
          gains) — covers imported statement history beyond eToro&apos;s 12-month API window.
        </div>
      )}
    </section>
  );
}
