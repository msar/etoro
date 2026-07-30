import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, type AllocationHistory } from '../api';
import { Segmented } from './Segmented';

const PALETTE = [
  '#4f9dff',
  '#2ecc8f',
  '#9b7bff',
  '#ffb84d',
  '#ff5c72',
  '#3fd2c7',
  '#f472b6',
  '#a3e635',
  '#fb923c',
  '#38bdf8',
  '#c084fc',
  '#facc15',
];

const TOP_N = 11;
type Metric = 'valuePct' | 'investedPct';

export function AllocationChart() {
  const [history, setHistory] = useState<AllocationHistory | null>(null);
  const [metric, setMetric] = useState<Metric>('valuePct');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .allocationHistory()
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

  const { data, keys } = useMemo(() => {
    if (!history?.available || history.days.length === 0) {
      return { data: [] as Record<string, number | string>[], keys: [] as string[] };
    }
    // Rank symbols by average weight over the window; keep top N, fold the rest.
    const totals = new Map<string, number>();
    for (const day of history.days) {
      for (const a of day.assets) {
        totals.set(a.symbol, (totals.get(a.symbol) ?? 0) + a[metric]);
      }
    }
    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([sym]) => sym);
    const topSet = new Set(top);

    const rows = history.days.map((day) => {
      const row: Record<string, number | string> = { date: day.date, Cash: day.cashPct * 100 };
      for (const sym of top) row[sym] = 0;
      let other = 0;
      for (const a of day.assets) {
        const v = a[metric] * 100;
        if (topSet.has(a.symbol)) row[a.symbol] = v;
        else other += v;
      }
      if (other > 0.0001) row.Other = other;
      return row;
    });
    const hasOther = rows.some((r) => (r.Other as number) > 0);
    return { data: rows, keys: [...top, ...(hasOther ? ['Other'] : []), 'Cash'] };
  }, [history, metric]);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Allocation over time</h2>
          <div className="desc">
            Granular view: how your portfolio composition evolved, per instrument.
          </div>
        </div>
        <Segmented
          options={[
            { value: 'valuePct', label: 'By value' },
            { value: 'investedPct', label: 'By invested' },
          ]}
          value={metric}
          onChange={setMetric}
        />
      </div>

      {error ? (
        <div className="error-box">{error}</div>
      ) : !history ? (
        <div className="loading">
          <div className="spinner" />
          Loading allocation history…
        </div>
      ) : !history.available ? (
        <div className="notice">
          Per-instrument history unavailable: {history.reason ?? 'portfolio is not public.'}
        </div>
      ) : data.length === 0 ? (
        <div className="empty">No allocation history available.</div>
      ) : (
        <ResponsiveContainer width="100%" height={360}>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} stackOffset="expand">
            <CartesianGrid stroke="#232e3e" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: '#8698ad', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#232e3e' }}
              minTickGap={50}
            />
            <YAxis
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              tick={{ fill: '#8698ad', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: '#0e141d',
                border: '1px solid #232e3e',
                borderRadius: 10,
                fontSize: 12.5,
              }}
              formatter={(value) => `${Number(value).toFixed(2)}%`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {keys.map((key, idx) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId="1"
                stroke={key === 'Cash' ? '#5a6b82' : PALETTE[idx % PALETTE.length]}
                fill={key === 'Cash' ? '#5a6b82' : PALETTE[idx % PALETTE.length]}
                fillOpacity={0.55}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
