import { useEffect, useState } from 'react';
import { api, fmtMoney, fmtPct, type AccountStats } from '../api';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`);
  if (iso.length === 4) return iso;
  if (iso.length === 7) {
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'pos' | 'neg' | null;
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ''}`}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function StatsPanel() {
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .stats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Risk &amp; return</h2>
        </div>
        <div className="error-box">{error}</div>
      </section>
    );
  }

  if (!stats) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Risk &amp; return</h2>
        </div>
        <div className="loading">
          <div className="spinner" />
          Computing statistics…
        </div>
      </section>
    );
  }

  const dd = stats.maxDrawdown;
  const years = stats.days / 365.25;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Risk &amp; return</h2>
          <div className="desc">
            Computed from the full stored history
            {stats.since ? ` — since ${fmtDate(stats.since)} (${years.toFixed(1)} years)` : ''}.
            All returns are time-weighted and deposit-adjusted.
          </div>
        </div>
      </div>
      <div className="stats-grid">
        <Stat
          label="Total gain"
          value={stats.totalGain !== null ? fmtPct(stats.totalGain) : '—'}
          tone={stats.totalGain !== null ? (stats.totalGain >= 0 ? 'pos' : 'neg') : null}
          hint="Compounded over the whole history"
        />
        <Stat
          label="CAGR"
          value={stats.cagr !== null ? fmtPct(stats.cagr) : '—'}
          tone={stats.cagr !== null ? (stats.cagr >= 0 ? 'pos' : 'neg') : null}
          hint="Annualized compound growth"
        />
        <Stat
          label="Volatility"
          value={
            stats.volatilityAnnualized !== null
              ? `${(stats.volatilityAnnualized * 100).toFixed(1)}%`
              : '—'
          }
          hint="Annualized stdev of daily returns"
        />
        <Stat
          label="Sharpe (rf=0)"
          value={stats.sharpe !== null ? stats.sharpe.toFixed(2) : '—'}
          tone={stats.sharpe !== null ? (stats.sharpe >= 1 ? 'pos' : null) : null}
          hint="CAGR ÷ volatility"
        />
        <Stat
          label="Max drawdown"
          value={dd ? fmtPct(dd.depth) : '—'}
          tone={dd ? 'neg' : null}
          hint={
            dd
              ? `${fmtDate(dd.peakDate)} → ${fmtDate(dd.troughDate)}${
                  dd.recoveryDate
                    ? `, recovered ${fmtDate(dd.recoveryDate)}`
                    : ', not yet recovered'
                }`
              : undefined
          }
        />
        <Stat
          label="Current drawdown"
          value={stats.currentDrawdown !== null ? fmtPct(stats.currentDrawdown) : '—'}
          tone={stats.currentDrawdown !== null && stats.currentDrawdown < -0.005 ? 'neg' : 'pos'}
          hint="Distance from all-time performance peak"
        />
        <Stat
          label="Best month"
          value={stats.bestMonth ? fmtPct(stats.bestMonth.gain) : '—'}
          tone="pos"
          hint={stats.bestMonth ? fmtDate(stats.bestMonth.date) : undefined}
        />
        <Stat
          label="Worst month"
          value={stats.worstMonth ? fmtPct(stats.worstMonth.gain) : '—'}
          tone="neg"
          hint={stats.worstMonth ? fmtDate(stats.worstMonth.date) : undefined}
        />
        <Stat
          label="Best year"
          value={stats.bestYear ? fmtPct(stats.bestYear.gain) : '—'}
          tone="pos"
          hint={stats.bestYear?.date}
        />
        <Stat
          label="Worst year"
          value={stats.worstYear ? fmtPct(stats.worstYear.gain) : '—'}
          tone="neg"
          hint={stats.worstYear?.date}
        />
        <Stat
          label="Net deposits"
          value={fmtMoney(stats.netDeposits)}
          hint={`${fmtMoney(stats.totalDeposits)} in, ${fmtMoney(stats.totalWithdrawals)} out`}
        />
        <Stat
          label="All-time profit"
          value={stats.allTimeProfit !== null ? fmtMoney(stats.allTimeProfit) : '—'}
          tone={
            stats.allTimeProfit !== null ? (stats.allTimeProfit >= 0 ? 'pos' : 'neg') : null
          }
          hint={
            stats.positiveDaysPct !== null
              ? `${(stats.positiveDaysPct * 100).toFixed(0)}% of active days positive`
              : undefined
          }
        />
      </div>
    </section>
  );
}
