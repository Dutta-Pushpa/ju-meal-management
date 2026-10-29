import { useEffect, useState, type FormEvent } from 'react';
import { api, asMessage } from '../../api';
import type { Location } from '../../types';
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  StatusPill,
  Textarea,
} from '../../ui';

/** Admin page — manage the vendor (food location) directory. */

/** Location names are English; Bangla belongs in the optional nameBn field. */
const ENGLISH_NAME = /^[A-Za-z][A-Za-z0-9 .&'()-]*$/;

export function AdminLocations({ token }: { token: string }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', nameBn: '', description: '' });
  const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    setError('');
    setLocations([]);
    try {
      setLocations(await api<Location[]>('/locations/manage/all', { token }));
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [token]);
  function beginEdit(location: Location) {
    setEditId(location.id);
    setForm({
      name: location.name,
      nameBn: location.nameBn ?? '',
      description: location.description ?? '',
    });
    setSuccess('');
  }
  function resetForm() {
    setEditId(null);
    setForm({ name: '', nameBn: '', description: '' });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    const name = form.name.trim();
    if (!ENGLISH_NAME.test(name)) {
      setError(
        'Location name must use English letters — put the Bangla name in the optional Bangla field.',
      );
      setBusy(false);
      return;
    }
    // Enforce allowed location names (English only). Optional Bangla name can be provided separately.
    const ALLOWED_LOCATIONS = ['Bottola', 'Chattor', 'Cafetaria', 'Dairy Farm', 'Gerua', 'Prantik'];
    const matchesAllowed = ALLOWED_LOCATIONS.some(
      (allowed) => allowed.toLowerCase() === name.toLowerCase(),
    );
    if (!matchesAllowed) {
      setError(
        `Allowed location names are: ${ALLOWED_LOCATIONS.join(', ')}. Please select one.`,
      );
      setBusy(false);
      return;
    }
    try {
      const body = {
        name,
        nameBn: form.nameBn.trim() || null,
        description: form.description.trim() || null,
      };
      if (editId) await api<Location>(`/locations/${editId}`, { token, method: 'PATCH', body });
      else await api<Location>('/locations', { token, method: 'POST', body });
      setSuccess(editId ? 'Location updated.' : 'Location created.');
      resetForm();
      await load();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggleActive(location: Location) {
    setError('');
    setSuccess('');
    try {
      const updated = await api<Location>(`/locations/${location.id}`, {
        token,
        method: 'PATCH',
        body: { isActive: !location.isActive },
      });
      setSuccess(`${updated.name} ${updated.isActive ? 'reactivated' : 'deactivated'}.`);
      await load();
    } catch (e) {
      setError(asMessage(e));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Food locations"
        description="Manage the participating campus vendors shown to teachers."
      />
      {error && <Alert>{error}</Alert>}
      {success && (
        <Alert tone="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      <div className="content-grid admin-form-grid">
        <Card>
          <div className="card-heading">
            <div>
              <h2>{editId ? 'Edit location' : 'Add a location'}</h2>
              <p>Changes are saved to the API and database.</p>
            </div>
          </div>
          <form className="form-stack" onSubmit={(e) => void save(e)}>
            <Field
              label="Location name (English)"
              hint="English letters only — the Bangla name goes in the optional field below."
            >
              <Input
                required
                maxLength={200}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Bottola"
              />
            </Field>
            <Field label="Bangla name (optional)" hint="বাংলা নাম — ইচ্ছামতো অনুবাদ">
              <Input
                value={form.nameBn}
                onChange={(e) => setForm({ ...form, nameBn: e.target.value })}
                placeholder="বাংলা নাম"
              />
            </Field>
            <Field label="Description">
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Food types or service information"
              />
            </Field>
            <div className="button-row">
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : editId ? 'Save changes' : 'Create location'}
              </Button>
              {editId && (
                <Button type="button" variant="secondary" onClick={resetForm}>
                  Cancel edit
                </Button>
              )}
            </div>
          </form>
        </Card>
        <Card>
          <div className="card-heading">
            <div>
              <h2>Location directory</h2>
              <p>
                {loading
                  ? 'Loading location records from the API…'
                  : `${locations.length} saved location(s), including inactive vendors.`}
              </p>
            </div>
            <Button variant="secondary" onClick={() => void load()}>
              ↻ Refresh
            </Button>
          </div>
          {loading ? (
            <Loading />
          ) : locations.length ? (
            <div className="management-list">
              {locations.map((location) => (
                <div className="management-row" key={location.id}>
                  <span className="location-dot">{location.name.slice(0, 1)}</span>
                  <div className="management-main">
                    <strong>{location.name}</strong>
                    <span>{location.nameBn || location.description || 'No description'}</span>
                  </div>
                  <StatusPill status={location.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  <Button variant="ghost" onClick={() => beginEdit(location)}>
                    Edit
                  </Button>
                  <Button variant="secondary" onClick={() => void toggleActive(location)}>
                    {location.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No locations yet" />
          )}
        </Card>
      </div>
    </>
  );
}

