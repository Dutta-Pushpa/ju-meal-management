import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, asMessage, hasPermission, money } from '../api';
import type {
  AppSetting,
  BudgetPeriod,
  BudgetReportRow,
  LedgerEntry,
  Location,
  MenuItem,
  Permission,
  Role,
  User,
} from '../types';
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
  StatusPill,
  TableWrap,
  Textarea,
} from '../ui';

const ALL_PERMISSIONS: Permission[] = [
  'locations:manage',
  'menu_items:manage',
  'budgets:view',
  'budgets:allocate',
  'budgets:adjust',
  'orders:cancel',
  'orders:manage_status',
  'users:create',
  'users:manage',
  'settings:manage',
];

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
    try {
      const body = {
        name: form.name.trim(),
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
            <Field label="Location name">
              <Input
                required
                maxLength={200}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Bot Tola"
              />
            </Field>
            <Field label="Bangla name (optional)">
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
        setForm((f) => ({ ...f, foodLocationId: String(locationData[0]!.id) }));
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

export function AdminUsers({ token, sessionUser }: { token: string; sessionUser: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<Role>('TEACHER');
  const [editActive, setEditActive] = useState(true);
  const [editPermissions, setEditPermissions] = useState<Permission[]>([]);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'TEACHER' as Role,
  });
  const canCreate = hasPermission(sessionUser.role, sessionUser.permissions, 'users:create');
  const canManage = hasPermission(sessionUser.role, sessionUser.permissions, 'users:manage');
  async function load() {
    setLoading(true);
    setError('');
    setUsers([]);
    try {
      setUsers(await api<User[]>('/staff/users', { token }));
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (canManage) void load();
    else setLoading(false);
  }, [token, canManage]);
  const shown = useMemo(
    () =>
      users.filter((u) =>
        `${u.fullName} ${u.email} ${u.role}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [users, search],
  );
  function beginEdit(user: User) {
    setEditUser(user);
    setEditRole(user.role);
    setEditActive(user.isActive);
    setEditPermissions([...user.permissions]);
    setError('');
  }
  async function saveUser() {
    if (!editUser) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const body =
        sessionUser.role === 'ADMIN'
          ? { role: editRole, isActive: editActive, permissions: editPermissions }
          : { isActive: editActive };
      await api(`/staff/users/${editUser.id}`, { token, method: 'PATCH', body });
      setSuccess(
        `Saved changes for ${editUser.fullName}. Their existing sessions were revoked by the server.`,
      );
      setEditUser(null);
      await load();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function createUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const role = sessionUser.role === 'ADMIN' ? createForm.role : 'TEACHER';
      await api<User>('/auth/register', {
        token,
        method: 'POST',
        body: {
          fullName: createForm.fullName.trim(),
          email: createForm.email.trim(),
          password: createForm.password,
          role,
        },
      });
      setSuccess(
        `Created account for ${createForm.fullName}. Share credentials securely and require the teacher to change the password.`,
      );
      setCreateOpen(false);
      setCreateForm({ fullName: '', email: '', password: '', role: 'TEACHER' });
      if (canManage) await load();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function quickToggle(user: User) {
    try {
      await api(`/staff/users/${user.id}`, {
        token,
        method: 'PATCH',
        body: { isActive: !user.isActive },
      });
      setSuccess(`${user.fullName} account ${user.isActive ? 'deactivated' : 'activated'}.`);
      await load();
    } catch (e) {
      setError(asMessage(e));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ACCOUNT ADMINISTRATION"
        title="Users & permissions"
        description="Manage teacher, staff and administrator accounts. Role changes revoke existing sessions."
        action={
          canCreate ? (
            <Button onClick={() => setCreateOpen((open) => !open)}>＋ Create account</Button>
          ) : undefined
        }
      />
      {error && <Alert>{error}</Alert>}
      {success && (
        <Alert tone="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      {!canManage ? (
        <Alert tone="info">
          Your account needs <code>users:manage</code> to browse the user directory.
        </Alert>
      ) : (
        <Card>
          <div className="toolbar">
            <div>
              <h2>Account directory</h2>
              <p>{users.length} users from the database</p>
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or role…"
              aria-label="Search users"
            />
          </div>
          {loading ? (
            <Loading />
          ) : shown.length ? (
            <TableWrap>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Permissions</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="user-table-cell">
                        <span className="avatar-small">{u.fullName.slice(0, 1).toUpperCase()}</span>
                        <span>
                          <strong>{u.fullName}</strong>
                          <small className="table-subtitle">
                            {u.email} · ID {u.id}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`role-tag role-${u.role.toLowerCase()}`}>{u.role}</span>
                    </td>
                    <td>
                      <StatusPill status={u.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                    <td>
                      {u.role === 'ADMIN'
                        ? 'All permissions'
                        : u.permissions.length
                          ? `${u.permissions.length} assigned`
                          : 'None assigned'}
                    </td>
                    <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="button-row table-actions">
                        {u.id !== sessionUser.id &&
                          canManage &&
                          (sessionUser.role === 'ADMIN' || u.role === 'TEACHER') && (
                            <>
                              <Button variant="ghost" onClick={() => beginEdit(u)}>
                                Edit
                              </Button>
                              <Button variant="secondary" onClick={() => void quickToggle(u)}>
                                {u.isActive ? 'Deactivate' : 'Activate'}
                              </Button>
                            </>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <Empty title="No users match this search" />
          )}
        </Card>
      )}
      {createOpen && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-heading"
          >
            <div className="modal-header">
              <h2 id="create-user-heading">Create an account</h2>
              <button
                className="icon-button"
                onClick={() => setCreateOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form className="form-stack" onSubmit={(e) => void createUser(e)}>
              <Field label="Full name">
                <Input
                  required
                  maxLength={200}
                  value={createForm.fullName}
                  onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
                />
              </Field>
              <Field label="University email">
                <Input
                  required
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                />
              </Field>
              <Field label="Temporary password" hint="At least 12 characters; keep it private.">
                <Input
                  required
                  minLength={12}
                  maxLength={72}
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                />
              </Field>
              {sessionUser.role === 'ADMIN' && (
                <Field label="Role">
                  <Select
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as Role })}
                  >
                    <option value="TEACHER">Teacher</option>
                    <option value="STAFF">Staff</option>
                    <option value="ADMIN">Administrator</option>
                  </Select>
                </Field>
              )}
              <div className="modal-actions">
                <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create account'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {editUser && (
        <div className="modal-backdrop">
          <div
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-user-heading"
          >
            <div className="modal-header">
              <h2 id="edit-user-heading">Edit {editUser.fullName}</h2>
              <button className="icon-button" onClick={() => setEditUser(null)} aria-label="Close">
                ×
              </button>
            </div>
            <p>
              {editUser.email} · account ID {editUser.id}
            </p>
            <div className="form-stack">
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={editActive}
                  onChange={(e) => setEditActive(e.target.checked)}
                />{' '}
                Account is active
              </label>
              {sessionUser.role === 'ADMIN' && (
                <>
                  <Field label="Role">
                    <Select value={editRole} onChange={(e) => setEditRole(e.target.value as Role)}>
                      <option value="TEACHER">Teacher</option>
                      <option value="STAFF">Staff</option>
                      <option value="ADMIN">Administrator</option>
                    </Select>
                  </Field>
                  <div className="permission-box">
                    <div className="card-heading">
                      <div>
                        <h3>Permissions</h3>
                        <p>Admin accounts always bypass individual permission checks.</p>
                      </div>
                    </div>
                    <div className="permission-grid">
                      {ALL_PERMISSIONS.map((permission) => (
                        <label className="check-line" key={permission}>
                          <input
                            type="checkbox"
                            checked={editPermissions.includes(permission)}
                            onChange={(e) =>
                              setEditPermissions((old) =>
                                e.target.checked
                                  ? [...old, permission]
                                  : old.filter((p) => p !== permission),
                              )
                            }
                          />
                          {permission}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div className="modal-actions">
                <Button variant="secondary" onClick={() => setEditUser(null)}>
                  Cancel
                </Button>
                <Button disabled={busy} onClick={() => void saveUser()}>
                  {busy ? 'Saving…' : 'Save account'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function AdminBudget({ token, user }: { token: string; user: User }) {
  const [periods, setPeriods] = useState<BudgetPeriod[]>([]);
  const [teachers, setTeachers] = useState<Array<{ id: number; fullName: string; email: string }>>(
    [],
  );
  const [periodId, setPeriodId] = useState('');
  const [budgetRows, setBudgetRows] = useState<BudgetReportRow[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [teacherForLedger, setTeacherForLedger] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const canAllocate = hasPermission(user.role, user.permissions, 'budgets:allocate');
  const canAdjust = hasPermission(user.role, user.permissions, 'budgets:adjust');
  const canView = hasPermission(user.role, user.permissions, 'budgets:view');
  const [periodForm, setPeriodForm] = useState({ name: '', startsOn: '', endsOn: '' });
  const [allocationForm, setAllocationForm] = useState({
    teacherId: '',
    amountTaka: '',
    reason: 'Weekly meal budget allocation',
  });
  const [adjustmentForm, setAdjustmentForm] = useState({
    teacherId: '',
    amountTaka: '',
    reason: '',
  });

  async function loadPeriodsAndTeachers() {
    setLoading(true);
    setError('');
    try {
      const periodList = await api<BudgetPeriod[]>('/teacher/budget-periods', { token });
      setPeriods(periodList);
      const active = periodList.find((p) => p.isActive) ?? periodList[0];
      if (active) {
        setPeriodId((old) => old || String(active.id));
      }
      if (canAllocate || canAdjust || canView) {
        const teacherList = await api<Array<{ id: number; fullName: string; email: string }>>(
          '/staff/teachers',
          { token },
        );
        setTeachers(teacherList);
        if (teacherList[0]) {
          setAllocationForm((f) => ({
            ...f,
            teacherId: f.teacherId || String(teacherList[0]!.id),
          }));
          setAdjustmentForm((f) => ({
            ...f,
            teacherId: f.teacherId || String(teacherList[0]!.id),
          }));
        }
      }
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadPeriodsAndTeachers();
  }, [token, canAllocate, canAdjust, canView]);
  useEffect(() => {
    if (!periodId || !canView) {
      setBudgetRows([]);
      return;
    }
    let cancelled = false;
    api<BudgetReportRow[]>(`/staff/reports/budget?period=${periodId}`, { token })
      .then((rows) => {
        if (!cancelled) setBudgetRows(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(asMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [token, periodId, canView]);
  async function createPeriod(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const created = await api<
        BudgetPeriod & { rolledOverTeachers: number; rolledOverAmountPaisa: number }
      >('/staff/budget-periods', { token, method: 'POST', body: periodForm });
      setSuccess(
        `Created ${created.name}.${created.rolledOverTeachers ? ` Rolled over balances for ${created.rolledOverTeachers} teacher(s), totalling ${money(created.rolledOverAmountPaisa)}.` : ''}`,
      );
      setPeriodForm({ name: '', startsOn: '', endsOn: '' });
      await loadPeriodsAndTeachers();
      setPeriodId(String(created.id));
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function allocate(e: FormEvent) {
    e.preventDefault();
    const amount = Number(allocationForm.amountTaka);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Allocation must be a positive amount.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api('/staff/budgets/allocations', {
        token,
        method: 'POST',
        body: {
          teacherId: Number(allocationForm.teacherId),
          budgetPeriodId: Number(periodId),
          amountPaisa: Math.round(amount * 100),
          reason: allocationForm.reason.trim(),
        },
      });
      setSuccess(
        `Allocated ${money(Math.round(amount * 100))} to the selected teacher. A ledger entry was created by the API.`,
      );
      setAllocationForm((f) => ({ ...f, amountTaka: '' }));
      await refreshReports();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function adjust(e: FormEvent) {
    e.preventDefault();
    const amount = Number(adjustmentForm.amountTaka);
    if (!Number.isFinite(amount) || amount === 0) {
      setError('Adjustment must be a non-zero amount. Use a negative number to deduct.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api('/staff/budgets/adjustments', {
        token,
        method: 'POST',
        body: {
          teacherId: Number(adjustmentForm.teacherId),
          budgetPeriodId: Number(periodId),
          amountPaisa: Math.round(amount * 100),
          reason: adjustmentForm.reason.trim(),
        },
      });
      setSuccess(`Recorded adjustment ${money(Math.round(amount * 100))}.`);
      setAdjustmentForm((f) => ({ ...f, amountTaka: '', reason: '' }));
      await refreshReports();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function refreshReports() {
    if (!periodId) return;
    setError('');
    try {
      if (canView)
        setBudgetRows(
          await api<BudgetReportRow[]>(`/staff/reports/budget?period=${periodId}`, { token }),
        );
      if (canView && teacherForLedger)
        setLedger(
          await api<LedgerEntry[]>(
            `/staff/budgets/ledger?teacherId=${teacherForLedger}&period=${periodId}&perPage=100`,
            { token },
          ),
        );
    } catch (e) {
      setError(asMessage(e));
    }
  }
  async function showLedger() {
    if (!teacherForLedger || !periodId) return;
    setError('');
    try {
      setLedger(
        await api<LedgerEntry[]>(
          `/staff/budgets/ledger?teacherId=${teacherForLedger}&period=${periodId}&perPage=100`,
          { token },
        ),
      );
    } catch (e) {
      setError(asMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="BUDGET ADMINISTRATION"
        title="Budget allocation & ledger"
        description="Create budget periods and record allocations or adjustments. All values are stored in integer paisa and written to the database ledger."
      />
      {error && <Alert>{error}</Alert>}
      {success && (
        <Alert tone="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}
      {loading ? (
        <Loading />
      ) : (
        <>
          <Card className="filter-card">
            <Field label="Selected budget period">
              <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                <option value="">Select period</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.startsOn} – {p.endsOn}
                    {p.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </Select>
            </Field>
            <span className="field-hint">{periods.length} period(s) returned by the API.</span>
          </Card>
          <div className="content-grid admin-budget-grid">
            {canAllocate && (
              <Card>
                <div className="card-heading">
                  <div>
                    <h2>Create budget period</h2>
                    <p>Overlapping date ranges and duplicate names are rejected by the backend.</p>
                  </div>
                </div>
                <form className="form-stack" onSubmit={(e) => void createPeriod(e)}>
                  <Field label="Period name">
                    <Input
                      required
                      value={periodForm.name}
                      onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })}
                      placeholder="2026-W44"
                    />
                  </Field>
                  <div className="form-row">
                    <Field label="Starts on">
                      <Input
                        required
                        type="date"
                        value={periodForm.startsOn}
                        onChange={(e) => setPeriodForm({ ...periodForm, startsOn: e.target.value })}
                      />
                    </Field>
                    <Field label="Ends on">
                      <Input
                        required
                        type="date"
                        min={periodForm.startsOn || undefined}
                        value={periodForm.endsOn}
                        onChange={(e) => setPeriodForm({ ...periodForm, endsOn: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Button type="submit" disabled={busy}>
                    {busy ? 'Creating…' : 'Create period'}
                  </Button>
                </form>
              </Card>
            )}
            {canAllocate && (
              <Card>
                <div className="card-heading">
                  <div>
                    <h2>Allocate weekly budget</h2>
                    <p>
                      Creates an allocation and matching positive ledger entry in one transaction.
                    </p>
                  </div>
                </div>
                <form className="form-stack" onSubmit={(e) => void allocate(e)}>
                  <Field label="Teacher">
                    <Select
                      required
                      value={allocationForm.teacherId}
                      onChange={(e) =>
                        setAllocationForm({ ...allocationForm, teacherId: e.target.value })
                      }
                    >
                      <option value="">Select teacher</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.fullName} · {t.email}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Amount (৳)">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={allocationForm.amountTaka}
                      onChange={(e) =>
                        setAllocationForm({ ...allocationForm, amountTaka: e.target.value })
                      }
                      placeholder="700.00"
                    />
                  </Field>
                  <Field label="Reason">
                    <Input
                      required
                      maxLength={500}
                      value={allocationForm.reason}
                      onChange={(e) =>
                        setAllocationForm({ ...allocationForm, reason: e.target.value })
                      }
                    />
                  </Field>
                  <Button type="submit" disabled={busy || !periodId || !allocationForm.teacherId}>
                    {busy ? 'Saving…' : 'Allocate budget'}
                  </Button>
                </form>
              </Card>
            )}
            {canAdjust && (
              <Card>
                <div className="card-heading">
                  <div>
                    <h2>Budget adjustment</h2>
                    <p>
                      Use a negative amount to deduct and a positive amount to credit. A reason is
                      required.
                    </p>
                  </div>
                </div>
                <form className="form-stack" onSubmit={(e) => void adjust(e)}>
                  <Field label="Teacher">
                    <Select
                      required
                      value={adjustmentForm.teacherId}
                      onChange={(e) =>
                        setAdjustmentForm({ ...adjustmentForm, teacherId: e.target.value })
                      }
                    >
                      <option value="">Select teacher</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.fullName} · {t.email}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Adjustment amount (৳)">
                    <Input
                      required
                      type="number"
                      step="0.01"
                      value={adjustmentForm.amountTaka}
                      onChange={(e) =>
                        setAdjustmentForm({ ...adjustmentForm, amountTaka: e.target.value })
                      }
                      placeholder="-50.00 or 50.00"
                    />
                  </Field>
                  <Field label="Reason">
                    <Input
                      required
                      maxLength={500}
                      value={adjustmentForm.reason}
                      onChange={(e) =>
                        setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })
                      }
                      placeholder="Correction note"
                    />
                  </Field>
                  <Button type="submit" disabled={busy || !periodId || !adjustmentForm.teacherId}>
                    {busy ? 'Saving…' : 'Record adjustment'}
                  </Button>
                </form>
              </Card>
            )}
          </div>
          {canView && (
            <Card>
              <div className="card-heading">
                <div>
                  <h2>Teacher budget report</h2>
                  <p>Current balances aggregated from ledger entries for the selected period.</p>
                </div>
                <Button variant="secondary" onClick={() => void refreshReports()}>
                  ↻ Refresh report
                </Button>
              </div>
              {!periodId ? (
                <Empty title="Select a budget period" />
              ) : budgetRows.length ? (
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Teacher</th>
                      <th>Allocated</th>
                      <th>Spent</th>
                      <th>Refunded</th>
                      <th>Adjusted</th>
                      <th className="align-right">Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budgetRows.map((row) => (
                      <tr key={row.teacher.id}>
                        <td>
                          <strong>{row.teacher.fullName}</strong>
                          <small className="table-subtitle">ID {row.teacher.id}</small>
                        </td>
                        <td>{row.allocated.amountFormatted}</td>
                        <td>{row.spent.amountFormatted}</td>
                        <td>{row.refunded.amountFormatted}</td>
                        <td>{row.adjusted.amountFormatted}</td>
                        <td className="align-right">
                          <strong>{row.available.amountFormatted}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              ) : (
                <Empty
                  title="No budget ledger entries yet"
                  detail="Allocate a budget to see teacher balances here."
                />
              )}
            </Card>
          )}
          {canView && (
            <Card>
              <div className="card-heading">
                <div>
                  <h2>Individual ledger</h2>
                  <p>Read detailed transactions for one teacher and period.</p>
                </div>
              </div>
              <div className="toolbar">
                <Select
                  value={teacherForLedger}
                  onChange={(e) => setTeacherForLedger(e.target.value)}
                  aria-label="Teacher for ledger"
                >
                  <option value="">Select teacher</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName}
                    </option>
                  ))}
                </Select>
                <Button disabled={!teacherForLedger || !periodId} onClick={() => void showLedger()}>
                  Load ledger
                </Button>
              </div>
              {ledger.length ? (
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Date</th>
                      <th>Reason</th>
                      <th>Order</th>
                      <th className="align-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.entryType}</td>
                        <td>{new Date(entry.createdAt).toLocaleString()}</td>
                        <td>{entry.reason || '—'}</td>
                        <td>{entry.orderId ? `#${entry.orderId}` : '—'}</td>
                        <td className="align-right">{entry.amount.amountFormatted}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              ) : (
                <Empty title="Choose a teacher and load their ledger" />
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}

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
        next[setting.key] = Array.isArray(setting.value)
          ? setting.value.join('\n')
          : String(setting.value);
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
    if (setting.key === 'budget_rollover') return raw === 'true';
    if (setting.key === 'ordering_disabled_dates')
      return [
        ...new Set(
          raw
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ];
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
    order_cutoff_time:
      'Orders and teacher cancellations are evaluated against this local cutoff time.',
    timezone: 'IANA timezone used to interpret order dates and the cutoff.',
    budget_rollover:
      'When enabled, positive unspent balances roll forward only when a new period is created.',
    ordering_disabled_dates:
      'One YYYY-MM-DD date per line; ordering will be disabled on these dates.',
  };
  return (
    <>
      <PageHeader
        eyebrow="SYSTEM POLICY"
        title="Ordering settings"
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
              {setting.key === 'budget_rollover' ? (
                <label className="check-line setting-toggle">
                  <input
                    type="checkbox"
                    checked={(drafts[setting.key] ?? String(setting.value)) === 'true'}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [setting.key]: String(e.target.checked) })
                    }
                  />{' '}
                  Enable budget rollover
                </label>
              ) : setting.key === 'ordering_disabled_dates' ? (
                <Field
                  label="Disabled dates"
                  hint="Use one valid YYYY-MM-DD date per line. The API accepts up to 366 dates."
                >
                  <Textarea
                    rows={5}
                    value={drafts[setting.key] ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [setting.key]: e.target.value })}
                    placeholder="2026-12-16"
                  />
                </Field>
              ) : (
                <Field
                  label={setting.key === 'order_cutoff_time' ? 'Cutoff time (24-hour)' : 'Timezone'}
                >
                  <Input
                    value={drafts[setting.key] ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [setting.key]: e.target.value })}
                    placeholder={setting.key === 'order_cutoff_time' ? '12:00' : 'Asia/Dhaka'}
                  />
                </Field>
              )}
              <div className="setting-footer">
                <small>Last updated {new Date(setting.updatedAt).toLocaleString()}</small>
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

function foodSymbol(category: string | null | undefined) {
  const value = (category || '').toLowerCase();
  return value.includes('drink') ? '◉' : value.includes('snack') ? '✦' : '◒';
}
