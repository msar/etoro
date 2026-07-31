import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
import {
  api,
  fmtMoney,
  fmtPct,
  type AggregateOverview,
  type BrokerId,
  type BrokerMeta,
  type BrokersStatus,
  type Granularity,
} from '../api';
import { AppNav, notifyBrokersChanged } from '../components/AppNav';
import { PerformanceChart } from '../components/PerformanceChart';
import { usePrivacy } from '../privacy';

const BROKER_COLORS: Record<string, string> = {
  etoro: '#4f9dff',
  abnamro: '#2ecc8f',
  revolut: '#9b7bff',
  kraken: '#ffb84d',
  etrade: '#ff5c72',
};

export function OverviewPage() {
  usePrivacy();
  const navigate = useNavigate();
  const [data, setData] = useState<AggregateOverview | null>(null);
  const [brokersStatus, setBrokersStatus] = useState<BrokersStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agg, brokers] = await Promise.all([api.aggregate('monthly'), api.brokers()]);
      setData(agg);
      setBrokersStatus(brokers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const perfFetcher = useCallback(async (granularity: Granularity) => {
    const agg = await api.aggregate(granularity);
    return agg.performance;
  }, []);

  const chartData = useMemo(() => {
    if (!data?.equity.length) return [];
    return data.equity.map((e) => ({
      date: e.date,
      label: new Date(`${e.date}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }),
      total: e.totalEur,
      ...e.byBroker,
    }));
  }, [data]);

  const activeBrokers = useMemo(
    () => (data?.brokers ?? []).filter((b) => b.available && !b.placeholder),
    [data],
  );

  const equityBrokers = useMemo(
    () => activeBrokers.filter((b) => b.kind !== 'realized'),
    [activeBrokers],
  );

  const availableToAdd = useMemo(() => {
    if (!brokersStatus) return [];
    const enabled = new Set(brokersStatus.enabled);
    return brokersStatus.catalog.filter((b) => !enabled.has(b.id));
  }, [brokersStatus]);

  async function onAdd(meta: BrokerMeta) {
    setBusyId(meta.id);
    setError(null);
    try {
      const next = await api.enableBroker(meta.id);
      setBrokersStatus(next);
      notifyBrokersChanged();
      setAdding(false);
      navigate(meta.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add broker');
    } finally {
      setBusyId(null);
    }
  }

  async function onRemove(id: BrokerId) {
    const label =
      brokersStatus?.catalog.find((c) => c.id === id)?.displayName ?? id;
    if (!confirm(`Remove ${label} from Overview?`)) return;
    setBusyId(id);
    setError(null);
    try {
      const next = await api.disableBroker(id);
      setBrokersStatus(next);
      notifyBrokersChanged();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove broker');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="app">
      <AppNav />
      <header className="app-header">
        <div>
          <h1>Portfolio Overview</h1>
          <div className="sub">
            Aggregated net worth across brokers · displayed in EUR (ECB FX rates)
          </div>
        </div>
      </header>

      {loading ? (
        <div className="loading" style={{ paddingTop: 80 }}>
          <div className="spinner" />
          Loading aggregated portfolio…
        </div>
      ) : error && !data ? (
        <div className="error-box">{error}</div>
      ) : (
        <>
          {error && <div className="error-box">{error}</div>}

          {data && (
            <div className="cards">
              <div className="card highlight">
                <div className="label">Total net worth</div>
                <div className="value">{fmtMoney(data.totalValueEur, 'EUR')}</div>
                <div className="hint">
                  {activeBrokers.length} broker{activeBrokers.length === 1 ? '' : 's'} connected
                </div>
              </div>
              {activeBrokers.map((b) => (
                <div className="card" key={b.broker}>
                  <div className="label">{b.displayName}</div>
                  <div className="value">
                    {b.kind === 'realized'
                      ? b.realizedGainEur != null
                        ? fmtMoney(b.realizedGainEur, 'EUR')
                        : b.realizedGainNative != null
                          ? fmtMoney(b.realizedGainNative, b.currency)
                          : '—'
                      : b.valueEur != null
                        ? fmtMoney(b.valueEur, 'EUR')
                        : '—'}
                  </div>
                  <div className="hint">
                    {b.kind === 'realized'
                      ? `Realized G/L${b.realizedGainNative != null && b.currency !== 'EUR' ? ` · ${fmtMoney(b.realizedGainNative, b.currency)}` : ''}`
                      : b.valueNative != null && b.currency !== 'EUR'
                        ? `${fmtMoney(b.valueNative, b.currency)} native`
                        : b.currency}
                    {b.gainPct != null ? ` · ${fmtPct(b.gainPct)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Brokers</h2>
                <div className="desc">Add or remove brokers from this overview</div>
              </div>
              {availableToAdd.length > 0 && (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setAdding((v) => !v)}
                >
                  {adding ? 'Cancel' : 'Add broker'}
                </button>
              )}
            </div>

            {adding && availableToAdd.length > 0 && (
              <div className="broker-add-list">
                {availableToAdd.map((meta) => (
                  <button
                    key={meta.id}
                    type="button"
                    className="broker-add-item"
                    disabled={busyId === meta.id}
                    onClick={() => void onAdd(meta)}
                  >
                    <span
                      className="swatch"
                      style={{ background: BROKER_COLORS[meta.id] ?? '#8698ad' }}
                    />
                    <span className="broker-add-text">
                      <strong>{meta.displayName}</strong>
                      <span className="muted">{meta.description}</span>
                    </span>
                    <span className="broker-add-cta">
                      {busyId === meta.id ? 'Adding…' : 'Add'}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="broker-grid">
              {(data?.brokers ?? []).length === 0 && !adding ? (
                <div className="empty-state broker-empty">
                  <p>No brokers yet. Add one to start tracking your portfolio.</p>
                  {availableToAdd.length > 0 && (
                    <button type="button" className="login-submit" onClick={() => setAdding(true)}>
                      Add broker
                    </button>
                  )}
                </div>
              ) : (
                (data?.brokers ?? []).map((b) => {
                  const body = (
                    <>
                      <div className="broker-name">
                        <span
                          className="swatch"
                          style={{ background: BROKER_COLORS[b.broker] ?? '#8698ad' }}
                        />
                        {b.displayName}
                      </div>
                      {b.available ? (
                        <>
                          <div className="broker-value">
                            {b.kind === 'realized'
                              ? b.realizedGainEur != null
                                ? fmtMoney(b.realizedGainEur, 'EUR')
                                : b.realizedGainNative != null
                                  ? fmtMoney(b.realizedGainNative, b.currency)
                                  : '—'
                              : b.valueEur != null
                                ? fmtMoney(b.valueEur, 'EUR')
                                : '—'}
                          </div>
                          <div className="broker-meta">
                            {b.kind === 'realized' && (
                              <span className="muted">Realized G/L · </span>
                            )}
                            {b.gainPct != null ? (
                              <span className={b.gainPct >= 0 ? 'pos' : 'neg'}>
                                {fmtPct(b.gainPct)}
                              </span>
                            ) : (
                              <span className="muted">Connected</span>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="broker-meta muted">Not connected — open to set up</div>
                      )}
                    </>
                  );
                  return (
                    <div key={b.broker} className="broker-card-wrap">
                      <Link to={b.href} className="broker-card">
                        {body}
                      </Link>
                      <button
                        type="button"
                        className="broker-remove"
                        disabled={busyId === b.broker}
                        onClick={() => void onRemove(b.broker as BrokerId)}
                        title="Remove from Overview"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {data && chartData.length > 0 && (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Net worth over time</h2>
                  <div className="desc">
                    EUR · statement brokers forward-filled between snapshots; live APIs where available
                  </div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={340}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#232e3e" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#8698ad', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#232e3e' }}
                    minTickGap={40}
                  />
                  <YAxis
                    tickFormatter={(v: number) => fmtMoney(v, 'EUR')}
                    tick={{ fill: '#8698ad', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={72}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as (typeof chartData)[0];
                      return (
                        <div className="tooltip">
                          <div className="t-date">{p.date}</div>
                          <div className="t-row">
                            <span className="t-key">Total</span>
                            <span>{fmtMoney(p.total, 'EUR')}</span>
                          </div>
                          {equityBrokers.map((b) => {
                            const row = p as Record<string, unknown>;
                            const v = row[b.broker];
                            if (typeof v !== 'number') return null;
                            return (
                              <div className="t-row" key={b.broker}>
                                <span className="t-key">{b.displayName}</span>
                                <span>{fmtMoney(v, 'EUR')}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }}
                  />
                  <Legend />
                  {equityBrokers.map((b) => (
                    <Area
                      key={b.broker}
                      type="stepAfter"
                      dataKey={b.broker}
                      stackId="1"
                      stroke={BROKER_COLORS[b.broker]}
                      fill={BROKER_COLORS[b.broker]}
                      fillOpacity={0.35}
                      name={b.displayName}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </section>
          )}

          {data && (
            <PerformanceChart
              title="Combined performance"
              description="Deposit-adjusted time-weighted return across all connected brokers (EUR)."
              fetcher={perfFetcher}
              derivedNote="Combined TWR from each broker’s equity series converted to EUR. Sparse brokers are forward-filled between snapshots."
            />
          )}
        </>
      )}
    </div>
  );
}
