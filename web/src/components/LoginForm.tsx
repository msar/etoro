import { useState, type FormEvent } from 'react';
import { api, type CredentialsInput, type HistoryBackend } from '../api';

interface LoginFormProps {
  onSuccess: () => void;
}

type SupabaseMode = 'restore' | 'setup';

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [form, setForm] = useState<CredentialsInput>({
    etoroApiKey: '',
    etoroUserKey: '',
    historyBackend: 'local',
    supabaseUrl: '',
    supabaseServiceRoleKey: '',
  });
  const [showSupabase, setShowSupabase] = useState(false);
  const [supabaseMode, setSupabaseMode] = useState<SupabaseMode>('restore');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usingSupabase = form.historyBackend === 'supabase';
  const restoreOnly = usingSupabase && supabaseMode === 'restore';

  function update<K extends keyof CredentialsInput>(key: K, value: CredentialsInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setBackend(backend: HistoryBackend) {
    update('historyBackend', backend);
    setShowSupabase(backend === 'supabase');
    if (backend === 'supabase') setSupabaseMode('restore');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (restoreOnly) {
        await api.restoreCredentials({
          supabaseUrl: form.supabaseUrl ?? '',
          supabaseServiceRoleKey: form.supabaseServiceRoleKey ?? '',
        });
      } else {
        await api.saveCredentials(form);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save credentials');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Connect your accounts</h1>
        <p className="login-lead">
          Paste your eToro API keys. History is stored on this machine by default — no cloud database
          required. Credentials stay in <code>server/data/</code> and are never sent to GitHub.
        </p>

        <fieldset>
          <legend>History storage</legend>
          <label className="radio-row">
            <input
              type="radio"
              name="historyBackend"
              checked={form.historyBackend !== 'supabase'}
              onChange={() => setBackend('local')}
            />
            <span>
              <strong>Local (recommended)</strong> — SQLite file on this Mac. No Supabase project.
            </span>
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="historyBackend"
              checked={form.historyBackend === 'supabase'}
              onChange={() => setBackend('supabase')}
            />
            <span>
              <strong>Supabase</strong> — remote Postgres; can restore keys and brokers after a wipe.
            </span>
          </label>

          {(showSupabase || usingSupabase) && (
            <>
              <div className="radio-row-group" style={{ marginTop: '0.75rem' }}>
                <label className="radio-row">
                  <input
                    type="radio"
                    name="supabaseMode"
                    checked={supabaseMode === 'restore'}
                    onChange={() => setSupabaseMode('restore')}
                  />
                  <span>
                    <strong>Restore from cloud</strong> — Project URL + service role only. Pulls
                    saved eToro/Kraken keys and enabled brokers.
                  </span>
                </label>
                <label className="radio-row">
                  <input
                    type="radio"
                    name="supabaseMode"
                    checked={supabaseMode === 'setup'}
                    onChange={() => setSupabaseMode('setup')}
                  />
                  <span>
                    <strong>First-time / update keys</strong> — paste eToro keys; they are backed up
                    to your Supabase project.
                  </span>
                </label>
              </div>

              <label>
                Project URL
                <input
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.supabaseUrl ?? ''}
                  onChange={(e) => update('supabaseUrl', e.target.value)}
                  placeholder="https://xxxx.supabase.co"
                  required={usingSupabase}
                />
              </label>
              <label>
                Service role key
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.supabaseServiceRoleKey ?? ''}
                  onChange={(e) => update('supabaseServiceRoleKey', e.target.value)}
                  placeholder="service_role secret"
                  required={usingSupabase}
                />
              </label>
              <p className="field-hint">
                Project Settings → API. Use the <strong>service_role</strong> secret (not the anon
                key). Run <code>001_init.sql</code> and <code>002_app_connection.sql</code> once in
                the SQL editor (existing projects only need <code>002</code>). Keys are stored in{' '}
                <em>your</em> Supabase project only.
              </p>
            </>
          )}
        </fieldset>

        {!restoreOnly && (
          <fieldset>
            <legend>eToro</legend>
            <label>
              Public API key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={form.etoroApiKey}
                onChange={(e) => update('etoroApiKey', e.target.value)}
                placeholder="x-api-key"
                required
              />
            </label>
            <label>
              User key
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={form.etoroUserKey}
                onChange={(e) => update('etoroUserKey', e.target.value)}
                placeholder="x-user-key"
                required
              />
            </label>
            <p className="field-hint">
              From{' '}
              <a href="https://www.etoro.com/settings/data-api" target="_blank" rel="noreferrer">
                eToro Settings → Data API
              </a>
            </p>
          </fieldset>
        )}

        {error && <div className="error-box login-error">{error}</div>}

        <button type="submit" className="login-submit" disabled={saving}>
          {saving
            ? restoreOnly
              ? 'Restoring…'
              : 'Validating…'
            : restoreOnly
              ? 'Restore & continue'
              : 'Save & continue'}
        </button>
      </form>
    </div>
  );
}
