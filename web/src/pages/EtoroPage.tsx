import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Bootstrap, type EtoroHistoryImportResult, type SyncResult } from '../api';
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
  const [uploadingHistory, setUploadingHistory] = useState(false);
  const [historyDragOver, setHistoryDragOver] = useState(false);
  const [historyImportResult, setHistoryImportResult] =
    useState<EtoroHistoryImportResult | null>(null);
  const [historyImportError, setHistoryImportError] = useState<string | null>(null);
  const historyInputRef = useRef<HTMLInputElement>(null);

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

  async function handleHistoryFiles(files: FileList | File[]) {
    const csvs = [...files].filter(
      (f) =>
        f.type === 'text/csv' ||
        f.type === 'application/vnd.ms-excel' ||
        f.name.toLowerCase().endsWith('.csv'),
    );
    if (!csvs.length) {
      setHistoryImportError('Please select Account Statement CSV files (.csv)');
      return;
    }
    setUploadingHistory(true);
    setHistoryImportError(null);
    setHistoryImportResult(null);
    try {
      const result = await api.etoroImportHistory(csvs);
      setHistoryImportResult(result);
      const status = await api.syncStatus();
      setBoot((b) => (b ? { ...b, sync: status } : b));
    } catch (err) {
      setHistoryImportError(err instanceof Error ? err.message : 'History import failed');
    } finally {
      setUploadingHistory(false);
    }
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
        description="The live API keeps ~12 months of mark-to-market history. Older equity, closed trades, and dividends come from your Account Statement export."
        wide
      >
        <div className="notice">
          <strong>How to export from eToro</strong>
          <ol className="import-steps">
            <li>
              In eToro, open <strong>Account Statement</strong> and download the full period you care
              about (XLS).
            </li>
            <li>
              Save each sheet as CSV. Keep recognizable names, for example:
              <ul>
                <li>
                  <code>actividaddelacuenta.csv</code> / Account Activity — balance history
                </li>
                <li>
                  <code>posicionescerradas.csv</code> / Closed Positions — realized trades
                </li>
                <li>
                  <code>dividendos.csv</code> / Dividends — optional, powers the income panel
                </li>
              </ul>
            </li>
            <li>
              Upload the CSVs below. Balances older than ~360 days are imported; the recent year stays
              owned by live API sync.
            </li>
          </ol>
        </div>

        <section
          className={`upload-zone ${historyDragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setHistoryDragOver(true);
          }}
          onDragLeave={() => setHistoryDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setHistoryDragOver(false);
            if (e.dataTransfer.files.length) void handleHistoryFiles(e.dataTransfer.files);
          }}
          onClick={() => historyInputRef.current?.click()}
        >
          <input
            ref={historyInputRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void handleHistoryFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {uploadingHistory ? (
            <div className="loading">
              <div className="spinner" />
              Importing Account Statement…
            </div>
          ) : (
            <>
              <div className="upload-title">Drop Account Statement CSVs here</div>
              <div className="upload-hint">
                Account Activity · Closed Positions · Dividends (optional) — multiple files supported
              </div>
            </>
          )}
        </section>

        {historyImportError && <div className="error-box">{historyImportError}</div>}

        {historyImportResult && (
          <div className="panel">
            <div className="panel-header">
              <h2>Import result</h2>
              <div className="desc">
                {historyImportResult.balancesImported} balance days ·{' '}
                {historyImportResult.tradesImported} closed trades ·{' '}
                {historyImportResult.dividendsImported} dividends
              </div>
            </div>
            <ul className="import-log">
              {Object.entries(historyImportResult.classified).map(([name, kind]) => (
                <li key={name} className="status-imported">
                  <strong>{name}</strong>
                  <span className="badge">{kind}</span>
                </li>
              ))}
              {historyImportResult.balanceDateRange && (
                <li>
                  <strong>Balance range</strong>
                  <span>
                    {historyImportResult.balanceDateRange.from} →{' '}
                    {historyImportResult.balanceDateRange.to}
                  </span>
                  <span className="muted">before {historyImportResult.balanceCutoff}</span>
                </li>
              )}
              {historyImportResult.warnings.map((w) => (
                <li key={w} className="status-duplicate">
                  <span className="neg">{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {boot.sync?.configured && (
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Sync status</h2>
                <div className="desc">Imported history + live API window</div>
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
