import { useEffect, useState } from 'react';
import { api, fmtMoney, fmtPct, type EquityHistory, type PerformanceSeries, type PortfolioSummary } from '../api';
import { usePrivacy } from '../privacy';

export type BreakdownKind = 'profit' | 'gain';

interface SummaryCardsProps {
  openBreakdown?: BreakdownKind | null;
  onOpenBreakdown?: (kind: BreakdownKind | null) => void;
}

export function SummaryCards({ openBreakdown = null, onOpenBreakdown }: SummaryCardsProps) {
  usePrivacy(); // re-render when amounts are masked
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [equity, setEquity] = useState<EquityHistory | null>(null);
  const [yearly, setYearly] = useState<PerformanceSeries | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.portfolio().then((p) => !cancelled && setPortfolio(p)).catch(() => undefined);
    api.balanceHistory().then((h) => !cancelled && setEquity(h)).catch(() => undefined);
    api.performance('yearly').then((s) => !cancelled && setYearly(s)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const currency = portfolio?.accountCurrency ?? 'USD';
  const last = equity?.points.at(-1);
  const invested = last?.cumulativeNetDeposits ?? null;
  const earned = last && invested !== null ? last.total - invested : null;
  const allTimeGain = yearly?.totalGain ?? null;

  function toggle(kind: BreakdownKind) {
    if (!onOpenBreakdown) return;
    onOpenBreakdown(openBreakdown === kind ? null : kind);
  }

  return (
    <div className="cards">
      <div className="card">
        <div className="label">Total value</div>
        <div className="value">
          {portfolio ? fmtMoney(portfolio.totalValue, currency) : '—'}
        </div>
        <div className="hint">
          {portfolio ? `${fmtMoney(portfolio.availableCash, currency)} available cash` : ''}
        </div>
      </div>
      <div className="card">
        <div className="label">Cumulative investment</div>
        <div className="value">{invested !== null ? fmtMoney(invested, currency) : '—'}</div>
        <div className="hint">Net deposits basis (full stored history)</div>
      </div>
      <button
        type="button"
        className={`card clickable${openBreakdown === 'profit' ? ' active' : ''}`}
        onClick={() => toggle('profit')}
        title="See where this profit comes from"
      >
        <div className="label">
          Earned vs deposits
          <span className="card-affordance">Details</span>
        </div>
        <div className={`value ${earned !== null && earned < 0 ? 'neg' : 'pos'}`}>
          {earned !== null ? fmtMoney(earned, currency) : '—'}
        </div>
        <div className="hint">Value above money you put in — click for breakdown</div>
      </button>
      <div className="card">
        <div className="label">Open P&L</div>
        <div className={`value ${portfolio && portfolio.currentPnl < 0 ? 'neg' : 'pos'}`}>
          {portfolio ? fmtMoney(portfolio.currentPnl, currency) : '—'}
        </div>
        <div className="hint">Unrealized, all open positions</div>
      </div>
      <button
        type="button"
        className={`card clickable${openBreakdown === 'gain' ? ' active' : ''}`}
        onClick={() => toggle('gain')}
        title="See how this gain percentage is built"
      >
        <div className="label">
          All-time gain
          <span className="card-affordance">Details</span>
        </div>
        <div className={`value ${allTimeGain !== null && allTimeGain < 0 ? 'neg' : 'pos'}`}>
          {allTimeGain !== null ? fmtPct(allTimeGain) : '—'}
        </div>
        <div className="hint">Compounded, deposit-adjusted — click for breakdown</div>
      </button>
    </div>
  );
}
