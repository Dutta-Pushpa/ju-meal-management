import { useEffect, useState } from 'react';
import { formatDhakaTimestamp, api, asMessage } from '../../api';
import type { AppSetting } from '../../types';
import { Alert, Button, Card, Empty, Field, Input, Loading, PageHeader } from '../../ui';

/** Admin page — application settings backed by the settings table. */

export function AdminSettings({ token }: { token: string }) {
  const [settings, setSettings] = useState<AppSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function load() {
    setLoading(true);
    setError('');
    setSettings([]);
    try {
      const values = await api<AppSetting[]>('/staff/settings', { token });
      setSettings(values);
      const next: Record<string, string> = {};
      values.forEach((setting) => {
        if (setting.key === 'max_debt_paisa') {
          const paisa = Number(setting.value);
          next[setting.key] = Number.isFinite(paisa) ? String(paisa / 100) : '0';
        } else if (setting.key === 'negative_balance_allowed') {
          next[setting.key] = setting.value === true || setting.value === 'true' ? 'true' : 'false';
        } else {
          next[setting.key] = String(setting.value);
        }
      });
      setDrafts(next);
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [token]);
  function valueFor(setting: AppSetting): unknown {
    const raw = drafts[setting.key] ?? '';
    if (setting.key === 'max_additional_orders') {
      const parsed = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (setting.key === 'max_debt_paisa') {
      const taka = Number.parseFloat(raw);
      return Number.isFinite(taka) && taka > 0 ? Math.round(taka * 100) : 0;
    }
    if (setting.key === 'negative_balance_allowed') return raw === 'true';
    return raw.trim();
  }
  async function save(setting: AppSetting) {
    setBusyKey(setting.key);
    setError('');
    setSuccess('');
    try {
      await api(`/staff/settings/${setting.key}`, {
        token,
        method: 'PATCH',
        body: { value: valueFor(setting) },
      });
      setSuccess(`Saved “${setting.key}”. The API recorded the update in the audit trail.`);
      await load();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusyKey('');
    }
  }
  const descriptions: Record<string, string> = {
    order_placement_deadline:
      'Latest clock time (Dhaka business time) a teacher may place an order.',
    order_cancellation_deadline:
      'Latest clock time (Dhaka business time) an order may be cancelled.',
    negative_balance_allowed:
      'Whether a teacher may place orders that push their remaining balance below zero.',
    max_debt_paisa: 'Maximum permitted outstanding debt when negative balance is allowed.',
    max_additional_orders:
      'Maximum number of additional orders a teacher may place beyond their balance.',
  };
  return (
    <>
      <PageHeader
        eyebrow="SYSTEM POLICY"
        title="Policy settings"
        description="Changes are saved through the protected settings API and written to the audit log."
        action={
          <Button variant="secondary" onClick={() => void load()}>
            ↻ Reload
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      {success && (
        <Alert tone="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      {loading ? (
        <Loading />
      ) : settings.length ? (
        <div className="settings-grid">
          {settings.map((setting) => (
            <Card className="setting-card" key={setting.key}>
              <div className="card-heading">
                <div>
                  <h2>{setting.key.replaceAll('_', ' ')}</h2>
                  <p>
                    {setting.description ||
                      descriptions[setting.key] ||
                      'Application policy setting.'}
                  </p>
                </div>
                <span className="setting-key">{setting.key}</span>
              </div>
              {setting.key === 'negative_balance_allowed' ? (
                <Field label="Allow negative balance (debt)">
                  <div
                    className="role-toggle"
                    role="radiogroup"
                    aria-label="Negative balance policy"
                  >
                    <button
                      type="button"
                      className={`role-toggle-option ${(drafts[setting.key] ?? 'false') === 'true' ? 'active' : ''}`}
                      onClick={() => setDrafts({ ...drafts, [setting.key]: 'true' })}
                    >
                      Allowed
                    </button>
                    <button
                      type="button"
                      className={`role-toggle-option ${(drafts[setting.key] ?? 'false') !== 'true' ? 'active' : ''}`}
                      onClick={() => setDrafts({ ...drafts, [setting.key]: 'false' })}
                    >
                      Blocked
                    </button>
                    <span />
                  </div>
                </Field>
              ) : setting.key === 'max_debt_paisa' ? (
                <Field
                  label="Maximum permitted debt (৳)"
                  hint="Outstanding debt limit in taka; 0 means no debt permitted."
                >
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={drafts[setting.key] ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [setting.key]: e.target.value })}
                    placeholder="0"
                  />
                </Field>
              ) : setting.key === 'max_additional_orders' ? (
                <Field label="Max additional orders" hint="Whole number, 0 or greater">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={drafts[setting.key] ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [setting.key]: e.target.value })}
                    placeholder="0"
                  />
                </Field>
              ) : setting.key === 'order_placement_deadline' ||
                setting.key === 'order_cancellation_deadline' ? (
                <Field
                  label={
                    setting.key === 'order_placement_deadline'
                      ? 'Order placement deadline (24-hour HH:mm)'
                      : 'Cancellation deadline (24-hour HH:mm)'
                  }
                  hint="e.g. 12:30"
                >
                  <Input
                    value={drafts[setting.key] ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [setting.key]: e.target.value })}
                    placeholder="12:30"
                  />
                </Field>
              ) : (
                <Field label="Value">
                  <Input
                    value={drafts[setting.key] ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [setting.key]: e.target.value })}
                  />
                </Field>
              )}
              <div className="setting-footer">
                <small>Last updated {formatDhakaTimestamp(setting.updatedAt)}</small>
                <Button disabled={busyKey === setting.key} onClick={() => void save(setting)}>
                  {busyKey === setting.key ? 'Saving…' : 'Save setting'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Empty title="No settings returned" detail="Check the backend seed and migration state." />
      )}
    </>
  );
}
