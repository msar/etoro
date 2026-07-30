import { useEffect, useMemo, useState } from 'react';
import { api, type PerformancePoint } from '../api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function cellStyle(gain: number | undefined): React.CSSProperties {
  if (gain === undefined) return {};
  // Scale opacity with |gain|, saturating at 8% monthly move.
  const alpha = Math.min(Math.abs(gain) / 0.08, 1) * 0.75 + 0.1;
  return gain >= 0
    ? { background: `rgba(46, 204, 143, ${alpha})`, color: '#08130e' }
    : { background: `rgba(255, 92, 114, ${alpha})`, color: '#160a0d' };
}

export function GainHeatmap() {
  const [points, setPoints] = useState<PerformancePoint[] | null>(null);
  const [yearTotals, setYearTotals] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.performance('monthly'), api.performance('yearly')])
      .then(([monthly, yearly]) => {
        if (cancelled) return;
        setPoints(monthly.points);
        setYearTotals(new Map(yearly.points.map((p) => [p.date.slice(0, 4), p.gain])));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { years, byYearMonth } = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    for (const p of points ?? []) {
      const year = p.date.slice(0, 4);
      const month = Number(p.date.slice(5, 7)) - 1;
      if (!map.has(year)) map.set(year, new Map());
      map.get(year)!.set(month, p.gain);
    }
    return { years: [...map.keys()].sort().reverse(), byYearMonth: map };
  }, [points]);

  if (error) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Monthly gains heatmap</h2>
        </div>
        <div className="error-box">{error}</div>
      </section>
    );
  }
  if (!points) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Monthly gains heatmap</h2>
        </div>
        <div className="loading">
          <div className="spinner" />
          Loading…
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Monthly gains heatmap</h2>
          <div className="desc">Deposit-adjusted monthly performance by calendar year.</div>
        </div>
      </div>
      <div className="heatmap">
        <table>
          <thead>
            <tr>
              <th className="year">Year</th>
              {MONTHS.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => {
              const row = byYearMonth.get(year)!;
              const total = yearTotals.get(year);
              return (
                <tr key={year}>
                  <th className="year">{year}</th>
                  {MONTHS.map((_, idx) => {
                    const g = row.get(idx);
                    return (
                      <td key={idx} style={cellStyle(g)}>
                        {g === undefined ? '·' : `${(g * 100).toFixed(1)}%`}
                      </td>
                    );
                  })}
                  <td style={cellStyle(total)}>
                    {total === undefined ? '·' : `${(total * 100).toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
