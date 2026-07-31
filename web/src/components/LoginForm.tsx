import { useState, type FormEvent } from 'react';
import { api, type CredentialsInput, type HistoryBackend } from '../api';

interface LoginFormProps {
  onSuccess: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [form, setForm] = useState<CredentialsInput>({
    etoroApiKey: '',
    etoroUserKey: '',
    historyBackend: 'local',
    supabaseUrl: '',
    supabaseServiceRoleKey: '',
  });
  const [showSupabase, setShowSupabase] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof CredentialsInput>(key: K, value: CredentialsInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setBackend(backend: HistoryBackend) {
    update('historyBackend', backend);
    setShowSupabase(backend === 'supabase');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.saveCredentials(form);
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
              <strong>Supabase</strong> — optional remote Postgres if you already use it.
            </span>
          </label>

          {(showSupabase || form.historyBackend === 'supabase') && (
            <>
              <label>
                Project URL
                <input
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.supabaseUrl ?? ''}
                  onChange={(e) => update('supabaseUrl', e.target.value)}
                  placeholder="https://xxxx.supabase.co"
                  required={form.historyBackend === 'supabase'}
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
                  required={form.historyBackend === 'supabase'}
                />
              </label>
              <p className="field-hint">
                Project Settings → API. Use the <strong>service_role</strong> secret (not the anon
                key). Run <code>server/supabase/migrations/</code> 001–004 once in the SQL editor.
              </p>
            </>
          )}
        </fieldset>

        {error && <div className="error-box login-error">{error}</div>}

        <button type="submit" className="login-submit" disabled={saving}>
          {saving ? 'Validating…' : 'Save & continue'}
        </button>
      </form>
    </div>
  );
}
