import { useEffect, useState } from 'react';
import {
  api,
  fmtMoney,
  fmtPct,
  type AnalysisCheck,
  type CheckStatus,
  type PortfolioAnalysis as PortfolioAnalysisData,
} from '../api';
import { usePrivacy } from '../privacy';

function statusLabel(s: CheckStatus): string {
  return s === 'ok' ? 'Healthy' : s === 'watch' ? 'Watch' : 'Action';
}

function scoreTone(score: number | null): 'pos' | 'neg' | '' {
  if (score === null) return '';
  if (score >= 75) return 'pos';
  if (score < 50) return 'neg';
  return '';
}

function CheckRow({ check }: { check: AnalysisCheck }) {
  return (
    <div className={`analysis-check status-${check.status}`}>
      <div className="analysis-check-head">
        <span className={`status-pill status-${check.status}`}>{statusLabel(check.status)}</span>
        <h3>{check.title}</h3>
      </div>
      <p className="analysis-detail">{check.detail}</p>
      <p className="analysis-reco">{check.recommendation}</p>
    </div>
  );
}

export function PortfolioAnalysis() {
  usePrivacy();
  const [data, setData] = useState<PortfolioAnalysisData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .portfolioAnalysis()
      .then((d) => !cancelled && setData(d))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Portfolio analysis</h2>
        </div>
        <div className="error-box">{error}</div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Portfolio analysis</h2>
        </div>
        <div className="loading">
          <div className="spinner" />
          Running portfolio checks…
        </div>
      </section>
    );
  }

  if (!data.available) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Portfolio analysis</h2>
        </div>
        <div className="empty">{data.reason ?? 'Not enough data yet.'}</div>
      </section>
    );
  }

  const actionCount = data.checks.filter((c) => c.status === 'action').length;
  const watchCount = data.checks.filter((c) => c.status === 'watch').length;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Portfolio analysis</h2>
          <div className="desc">
            Advisor-style health checks on concentration, cash, diversification, losers, leverage,
            fees, and risk — so you can see what may need a tweak.
          </div>
        </div>
      </div>

      <div className="analysis-summary">
        <div className="analysis-score">
          <div className="label">Health score</div>
          <div className={`value ${scoreTone(data.score)}`}>
            {data.score !== null ? data.score : '—'}
            {data.score !== null && <span className="score-max">/100</span>}
          </div>
          <div className="hint">
            {actionCount > 0
              ? `${actionCount} item${actionCount === 1 ? '' : 's'} need attention`
              : watchCount > 0
                ? `${watchCount} item${watchCount === 1 ? '' : 's'} to watch`
                : 'No urgent issues flagged'}
          </div>
        </div>
        <div className="analysis-meta">
          <div className="stat">
            <div className="label">Open positions</div>
            <div className="value">{data.holdingsCount}</div>
          </div>
          <div className="stat">
            <div className="label">Cash</div>
            <div className="value">{data.cashPct !== null ? fmtPct(data.cashPct) : '—'}</div>
          </div>
          <div className="stat">
            <div className="label">Equity</div>
            <div className="value">
              {data.equity !== null ? fmtMoney(data.equity, data.currency) : '—'}
            </div>
          </div>
        </div>
      </div>

      {data.assetMix.length > 0 && (
        <div className="asset-mix">
          {data.assetMix.map((m) => (
            <div className="asset-mix-chip" key={m.bucket}>
              <span className="asset-mix-label">{m.bucket}</span>
              <span className="asset-mix-pct">{fmtPct(m.pct)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="analysis-checks">
        {data.checks.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </div>

      <div className="chart-note analysis-disclaimer">{data.disclaimer}</div>
    </section>
  );
}
