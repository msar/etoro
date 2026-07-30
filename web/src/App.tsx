import { useCallback, useEffect, useState } from 'react';
import { api, type Bootstrap, type SyncResult } from './api';
import { AllocationChart } from './components/AllocationChart';
import { EquityChart } from './components/EquityChart';
import { GainHeatmap } from './components/GainHeatmap';
import { HoldingsTable } from './components/HoldingsTable';
import { IncomePanel } from './components/IncomePanel';
import { InstrumentPerformanceTable } from './components/InstrumentPerformanceTable';
import { LoginForm } from './components/LoginForm';
import { PerformanceChart } from './components/PerformanceChart';
import { StatsPanel } from './components/StatsPanel';
import { SummaryCards } from './components/SummaryCards';

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

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

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
        if (!status.configured) {
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
      <LoginForm
        onSuccess={() => {
          setSessionKey((k) => k + 1);
        }}
      />
    );
  }

  if (phase === 'error') {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Portfolio Evolution</h1>
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
      <header className="app-header">
        <div>
          <h1>
            Portfolio Evolution
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
          <button type="button" className="ghost-btn" onClick={onLogout}>
            Change credentials
          </button>
        </div>
      </header>

      {syncError && (
        <div className="notice" style={{ marginBottom: 16 }}>
          {syncError}
        </div>
      )}

      <SummaryCards />
      <StatsPanel />
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
