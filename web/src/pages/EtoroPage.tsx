import { useCallback, useEffect, useState } from 'react';
import { api, type Bootstrap, type SyncResult } from '../api';
import { AllocationChart } from '../components/AllocationChart';
import { AppNav } from '../components/AppNav';
import { EquityChart } from '../components/EquityChart';
import { GainHeatmap } from '../components/GainHeatmap';
import { HoldingsTable } from '../components/HoldingsTable';
import { IncomePanel } from '../components/IncomePanel';
import { InstrumentPerformanceTable } from '../components/InstrumentPerformanceTable';
import { LoginForm } from '../components/LoginForm';
import { GainBreakdownDrilldown } from '../components/GainBreakdownDrilldown';
import { Modal } from '../components/Modal';
import { PerformanceChart } from '../components/PerformanceChart';
import { PortfolioAnalysis } from '../components/PortfolioAnalysis';
import { ProfitBreakdownDrilldown } from '../components/ProfitBreakdownDrilldown';
import { StatsPanel } from '../components/StatsPanel';
import { SummaryCards, type BreakdownKind } from '../components/SummaryCards';

function formatSyncedAt(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Phase = 'checking' | 'login' | 'connecting' | 'syncing' | 'ready' | 'error';

export function EtoroPage() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [openBreakdown, setOpenBreakdown] = useState<BreakdownKind | null>(null);

  const loadDashboard = useCallback(async (cancelled: () => boolean) => {
    setPhase('connecting');
    setError(null);
    setSyncError(null);
    setBoot(null);
    setSyncResult(null);

    try {
      const b = await api.bootstrap();
      if (cancelled()) return;
      setBoot(b);

      if (b.sync?.configured) {
        if (b.sync.schemaReady === false && b.sync.schemaHint) {
          setSyncError(b.sync.schemaHint);
          if (!cancelled()) setPhase('ready');
          return;
        }
        setPhase('syncing');
        try {
          const result = await api.sync();
          if (cancelled()) return;
          setSyncResult(result);
          setSyncError(null);
          const status = await api.syncStatus();
          if (!cancelled()) setBoot({ ...b, sync: status });
        } catch (syncErr) {
          const msg = syncErr instanceof Error ? syncErr.message : 'Sync failed';
          console.warn('Sync failed:', msg);
          setSyncError(msg);
        }
      }
      if (!cancelled()) setPhase('ready');
    } catch (err) {
      if (cancelled()) return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'credentials_required') {
        setPhase('login');
        return;
      }
      setError(message);
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setPhase('checking');
        const status = await api.credentialsStatus();
        if (cancelled) return;
        if (!status.etoroConfigured) {
          setPhase('login');
          return;
        }
        await loadDashboard(() => cancelled);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not reach the API server');
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDashboard, sessionKey]);

  async function onLogout() {
    if (!window.confirm('Clear saved credentials on this machine and return to login?')) return;
    try {
      await api.clearCredentials();
    } catch (err) {
      console.warn('Clear credentials failed:', err);
    }
    setBoot(null);
    setSyncResult(null);
    setSyncError(null);
    setError(null);
    setPhase('login');
  }

  if (phase === 'login') {
    return (
      <div className="app">
        <AppNav />
        <LoginForm
          onSuccess={() => {
            setSessionKey((k) => k + 1);
          }}
        />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="app">
        <AppNav />
        <header className="app-header">
          <h1>eToro</h1>
        </header>
        <div className="panel">
          <div className="error-box">
            Could not connect: {error}
            <br />
            Make sure the API server is running (<code>npm start</code>).
          </div>
          <button type="button" className="ghost-btn" style={{ marginTop: 12 }} onClick={() => setPhase('login')}>
            Enter credentials
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'checking' || phase === 'connecting' || phase === 'syncing' || !boot) {
    return (
      <div className="app">
        <AppNav />
        <div className="loading" style={{ paddingTop: 120 }}>
          <div className="spinner" />
          {phase === 'syncing'
            ? 'Updating portfolio data from eToro…'
            : phase === 'checking'
              ? 'Checking local credentials…'
              : 'Connecting to your eToro account…'}
        </div>
      </div>
    );
  }

  const storedSince = boot.sync?.earliestSnapshot ?? syncResult?.earliestSnapshot;
  const lastSynced = boot.sync?.lastSyncedAt ?? syncResult?.lastSyncedAt;

  return (
    <div className="app">
      <AppNav />
      <header className="app-header">
        <div>
          <h1>
            eToro
            <span className={`badge ${boot.environment}`}>{boot.environment}</span>
          </h1>
          <div className="sub">
            {boot.username ? `@${boot.username}` : 'eToro account'}
            {boot.fullName ? ` · ${boot.fullName}` : ''}
            {boot.agentPortfolios.length > 0
              ? ` · ${boot.agentPortfolios.length} agent portfolio(s)`
              : ''}
          </div>
          {boot.sync?.configured && (
            <div className="sub" style={{ marginTop: 4 }}>
              {storedSince ? `History stored since ${storedSince}` : 'History store ready'}
              {lastSynced ? ` · last synced ${formatSyncedAt(lastSynced)}` : ''}
              {boot.sync.balanceSnapshotCount
                ? ` · ${boot.sync.balanceSnapshotCount} daily snapshots`
                : ''}
            </div>
          )}
        </div>
        <div className="header-actions">
          <div className="sub">
            Deposits count as investment, never as gain — all percentages are deposit-adjusted.
          </div>
          <div className="header-actions-row">
            <button
              type="button"
              className="ghost-btn primary"
              onClick={() => setImportOpen(true)}
            >
              Import statements
            </button>
            <button type="button" className="ghost-btn" onClick={onLogout}>
              Change credentials
            </button>
          </div>
        </div>
      </header>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import statements"
        description="eToro does not use statement PDFs. Portfolio history is synced live via the eToro Public API."
      >
        <div className="notice">
          Connect with your API key and user key (Settings → Trading → API). Data refreshes on each
          visit; use Change credentials to rotate keys stored on this machine.
        </div>
        {boot.sync?.configured && (
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Sync status</h2>
                <div className="desc">Local history store</div>
              </div>
            </div>
            <ul className="import-log">
              <li>
                <strong>History since</strong>
                <span>{storedSince ?? '—'}</span>
              </li>
              <li>
                <strong>Last synced</strong>
                <span>{lastSynced ? formatSyncedAt(lastSynced) : '—'}</span>
              </li>
              <li>
                <strong>Daily snapshots</strong>
                <span>{boot.sync.balanceSnapshotCount ?? 0}</span>
              </li>
            </ul>
          </div>
        )}
      </Modal>

      {syncError && (
        <div className="notice" style={{ marginBottom: 16 }}>
          {syncError}
        </div>
      )}

      <SummaryCards openBreakdown={openBreakdown} onOpenBreakdown={setOpenBreakdown} />
      <StatsPanel openBreakdown={openBreakdown} onOpenBreakdown={setOpenBreakdown} />
      {openBreakdown === 'profit' && (
        <ProfitBreakdownDrilldown onClose={() => setOpenBreakdown(null)} />
      )}
      {openBreakdown === 'gain' && (
        <GainBreakdownDrilldown onClose={() => setOpenBreakdown(null)} />
      )}
      <PortfolioAnalysis />
      <PerformanceChart />
      <GainHeatmap />
      <EquityChart />
      <AllocationChart />
      <InstrumentPerformanceTable />
      <IncomePanel />
      <HoldingsTable />
    </div>
  );
}
