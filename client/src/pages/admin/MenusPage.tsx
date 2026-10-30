import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, asMessage } from '../../api';
import type { Location, MenuItem } from '../../types';
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Textarea,
} from '../../ui';

/** Admin page — create and manage menu items for every vendor. */

export function AdminMenus({ token }: { token: string }) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [form, setForm] = useState({
    foodLocationId: '',
    name: '',
    description: '',
    category: 'lunch',
    priceTaka: '',
    isAvailable: true,
    isActive: true,
  });
  async function load() {
    setLoading(true);
    setError('');
    setItems([]);
    setLocations([]);
    try {
      const [menuData, locationData] = await Promise.all([
        api<MenuItem[]>('/staff/menu-items', { token }),
        api<Location[]>('/locations/manage/all', { token }),
      ]);
      setItems(menuData);
      setLocations(locationData);
      if (!form.foodLocationId && locationData[0])
        setForm((f) => ({ ...f, foodLocationId: String(locationData[0].id) }));
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [token]);
  const shown = useMemo(
    () =>
      items.filter(
        (item) => locationFilter === 'ALL' || String(item.foodLocationId) === locationFilter,
      ),
    [items, locationFilter],
  );
  function beginEdit(item: MenuItem) {
    setEditId(item.id);
    setForm({
      foodLocationId: String(item.foodLocationId),
      name: item.name,
      description: item.description ?? '',
      category: item.category ?? '',
      priceTaka: (item.price.amountPaisa / 100).toFixed(2),
      isAvailable: item.isAvailable,
      isActive: item.isActive ?? true,
    });
    setSuccess('');
  }
  function resetForm() {
    const first = locations[0]?.id;
    setEditId(null);
    setForm({
      foodLocationId: first ? String(first) : '',
      name: '',
      description: '',
      category: 'lunch',
      priceTaka: '',
      isAvailable: true,
      isActive: true,
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    const taka = Number(form.priceTaka);
    if (!Number.isFinite(taka) || taka <= 0) {
      setError('Enter a price greater than ৳0.00.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        foodLocationId: Number(form.foodLocationId),
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        pricePaisa: Math.round(taka * 100),
        isAvailable: form.isAvailable,
        ...(editId ? { isActive: form.isActive } : {}),
      };
      if (editId)
        await api<MenuItem>(`/staff/menu-items/${editId}`, { token, method: 'PATCH', body });
      else await api<MenuItem>('/staff/menu-items', { token, method: 'POST', body });
      setSuccess(editId ? 'Menu item updated.' : 'Menu item created.');
      resetForm();
      await load();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggleAvailability(item: MenuItem) {
    setError('');
    setSuccess('');
    try {
      await api(`/staff/menu-items/${item.id}`, {
        token,
        method: 'PATCH',
        body: item.isActive === false ? { isActive: true } : { isAvailable: !item.isAvailable },
      });
      setSuccess(`Updated ${item.name}.`);
      await load();
    } catch (e) {
      setError(asMessage(e));
    }
  }
  async function deactivate(item: MenuItem) {
    if (!window.confirm(`Deactivate “${item.name}”? Existing orders will keep their snapshots.`))
      return;
    try {
      await api(`/staff/menu-items/${item.id}`, { token, method: 'DELETE' });
      setSuccess(`${item.name} deactivated.`);
      await load();
    } catch (e) {
      setError(asMessage(e));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="CATALOGUE MANAGEMENT"
        title="Menus & prices"
        description="Maintain menu availability, descriptions and prices. Existing orders retain their historical item snapshots."
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
              <h2>{editId ? 'Edit menu item' : 'Create menu item'}</h2>
              <p>Prices are sent to the API in integer paisa.</p>
            </div>
          </div>
          <form className="form-stack" onSubmit={(e) => void save(e)}>
            <Field label="Food location">
              <Select
                required
                value={form.foodLocationId}
                onChange={(e) => setForm({ ...form, foodLocationId: e.target.value })}
              >
                {locations
                  .filter((l) => l.isActive)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Item name">
              <Input
                required
                maxLength={200}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Chicken meal"
              />
            </Field>
            <Field label="Description">
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What is included?"
              />
            </Field>
            <div className="form-row">
              <Field label="Category">
                <Input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="lunch"
                />
              </Field>
              <Field label="Price (৳)">
                <Input
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={form.priceTaka}
                  onChange={(e) => setForm({ ...form, priceTaka: e.target.value })}
                  placeholder="150.00"
                />
              </Field>
            </div>
            <label className="check-line">
              <input
                type="checkbox"
                checked={form.isAvailable}
                onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })}
              />{' '}
              Available for ordering
            </label>
            {editId && (
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />{' '}
                Item is active
              </label>
            )}
            <div className="button-row">
              <Button
                type="submit"
                disabled={
                  busy || !locations.some((l) => l.isActive && String(l.id) === form.foodLocationId)
                }
              >
                {busy ? 'Saving…' : editId ? 'Save changes' : 'Add menu item'}
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
              <h2>Menu catalogue</h2>
              <p>{items.length} item(s) in the database, including inactive items.</p>
            </div>
          </div>
          <div className="toolbar">
            <span className="field-label">Filter by location</span>
            <Select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <option value="ALL">All locations</option>
              {locations.map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          {loading ? (
            <Loading />
          ) : shown.length ? (
            <div className="management-list">
              {shown.map((item) => (
                <div className="management-row menu-management-row" key={item.id}>
                  <div className="food-mini">{foodSymbol(item.category)}</div>
                  <div className="management-main">
                    <strong>{item.name}</strong>
                    <span>
                      {item.location?.name ||
                        locations.find((l) => l.id === item.foodLocationId)?.name ||
                        `Location ${item.foodLocationId}`}{' '}
                      · {item.category || 'Uncategorised'}
                    </span>
                    <small>{item.description || 'No description'}</small>
                  </div>
                  <div className="menu-management-price">
                    <strong>{item.price.amountFormatted}</strong>
                    <span>
                      {item.isActive === false
                        ? 'Inactive'
                        : item.isAvailable
                          ? 'Available'
                          : 'Unavailable'}
                    </span>
                  </div>
                  <Button variant="ghost" onClick={() => beginEdit(item)}>
                    Edit
                  </Button>
                  {item.isActive === false ? (
                    <Button variant="secondary" onClick={() => void toggleAvailability(item)}>
                      Reactivate
                    </Button>
                  ) : (
                    <>
                      <Button variant="secondary" onClick={() => void toggleAvailability(item)}>
                        {item.isAvailable ? 'Mark unavailable' : 'Make available'}
                      </Button>
                      <Button variant="danger" onClick={() => void deactivate(item)}>
                        Deactivate
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="No menu items found"
              detail="Create the first menu item using the form."
            />
          )}
        </Card>
      </div>
    </>
  );
}

function foodSymbol(category: string | null | undefined) {
  const value = (category || '').toLowerCase();
  return value.includes('drink') ? '◉' : value.includes('snack') ? '✦' : '◒';
}
