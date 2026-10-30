import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { formatDhakaTimestamp, api, asMessage, hasPermission } from '../../api';
import type { Role, User } from '../../types';
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
} from '../../ui';

/** Admin page — user accounts, roles and activation state. */

export function AdminUsers({ token, sessionUser }: { token: string; sessionUser: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'TEACHER' | 'STAFF' | 'ADMIN'>('ALL');
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetLink, setResetLink] = useState<{ user: User; url: string; expiresAt: string } | null>(
    null,
  );
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
      users.filter((u) => {
        if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
        return `${u.fullName} ${u.email} ${u.role}`.toLowerCase().includes(search.toLowerCase());
      }),
    [users, search, roleFilter],
  );
  function beginEdit(user: User) {
    setEditUser(user);
    setEditFullName(user.fullName);
    setEditEmail(user.email);
    setEditActive(user.isActive);
    setError('');
  }
  async function saveUser() {
    if (!editUser) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api(`/staff/users/${editUser.id}`, {
        token,
        method: 'PATCH',
        body: {
          fullName: editFullName.trim(),
          email: editEmail.trim(),
          isActive: editActive,
        },
      });
      setSuccess(
        `Saved changes for ${editFullName.trim()}. Their existing sessions were revoked by the server.`,
      );
      setEditUser(null);
      await load();
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function deleteUserAccount(user: User) {
    if (
      !window.confirm(
        `Are you sure you want to permanently delete ${user.fullName} (${user.email})?`,
      )
    ) {
      return;
    }
    setError('');
    setSuccess('');
    try {
      await api(`/staff/users/${user.id}`, { token, method: 'DELETE' });
      setSuccess(`Account for ${user.fullName} was permanently deleted.`);
      await load();
    } catch (e) {
      setError(asMessage(e));
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
  async function issueResetLink(user: User) {
    setError('');
    setSuccess('');
    try {
      const result = await api<{ token: string; expiresAt: string }>(
        `/staff/users/${user.id}/password-reset`,
        {
          token,
          method: 'POST',
        },
      );
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('resetToken', result.token);
      setResetLink({ user, url: url.toString(), expiresAt: result.expiresAt });
    } catch (e) {
      setError(asMessage(e));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ACCOUNT ADMINISTRATION"
        title="User management"
        description="Manage teacher, staff and administrator accounts. Access is role-based: admins do everything, staff run operations, teachers manage their own meals."
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
        <Alert tone="info">User management is restricted to administrator accounts.</Alert>
      ) : (
        <Card>
          <div
            className="toolbar"
            style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}
          >
            <div>
              <h2>Account directory</h2>
              <p>{users.length} users from the database</p>
            </div>
            <div
              style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginLeft: 'auto' }}
            >
              <span className="field-label" style={{ margin: 0, fontWeight: 600 }}>
                Filter:
              </span>
              <Select
                value={roleFilter}
                onChange={(e) =>
                  setRoleFilter(e.target.value as 'ALL' | 'TEACHER' | 'STAFF' | 'ADMIN')
                }
                aria-label="Filter users by role"
              >
                <option value="ALL">All roles</option>
                <option value="TEACHER">Teachers only</option>
                <option value="STAFF">Staff only</option>
                <option value="ADMIN">Admins only</option>
              </Select>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email or role…"
                aria-label="Search users"
              />
            </div>
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
                      {formatDhakaTimestamp(u.createdAt, {
                        year: 'numeric',
                        month: 'short',
                        day: '2-digit',
                      })}
                    </td>
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
                              {sessionUser.role === 'ADMIN' && (
                                <Button variant="ghost" onClick={() => void issueResetLink(u)}>
                                  Reset password
                                </Button>
                              )}
                              {sessionUser.role === 'ADMIN' && (
                                <Button
                                  variant="ghost"
                                  style={{ color: '#b91c1c' }}
                                  onClick={() => void deleteUserAccount(u)}
                                >
                                  Delete
                                </Button>
                              )}
                            </>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <Empty title="No users match this filter or search" />
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
                <>
                  <Field label="Role">
                    <Select
                      value={createForm.role}
                      onChange={(e) =>
                        setCreateForm({ ...createForm, role: e.target.value as Role })
                      }
                    >
                      <option value="TEACHER">Teacher</option>
                      <option value="STAFF">Staff</option>
                      <option value="ADMIN">Administrator</option>
                    </Select>
                  </Field>
                  {createForm.role === 'ADMIN' && (
                    <p className="field-hint">
                      You are signed in as an administrator, so no admin key is needed here. The
                      admin key is only required on the public registration page.
                    </p>
                  )}
                </>
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
              <h2 id="edit-user-heading">Edit User Account</h2>
              <button className="icon-button" onClick={() => setEditUser(null)} aria-label="Close">
                ×
              </button>
            </div>
            <p>
              Account ID #{editUser.id} · {editUser.role}
            </p>
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void saveUser();
              }}
            >
              <Field label="Full name">
                <Input
                  required
                  maxLength={200}
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  placeholder="Full name"
                />
              </Field>
              <Field label="University email">
                <Input
                  required
                  type="email"
                  maxLength={254}
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="Email"
                />
              </Field>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={editActive}
                  onChange={(e) => setEditActive(e.target.checked)}
                />{' '}
                Account is active
              </label>
              <div className="modal-actions">
                <Button type="button" variant="secondary" onClick={() => setEditUser(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save account'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {resetLink && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-link-heading"
          >
            <h2 id="reset-link-heading">Password reset / activation link</h2>
            <p>
              Share this one-time link privately with {resetLink.user.fullName}. It expires{' '}
              {formatDhakaTimestamp(resetLink.expiresAt)} and can be used once.
            </p>
            <Field label="One-time link">
              <Input readOnly value={resetLink.url} onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <div className="modal-actions">
              <Button type="button" variant="secondary" onClick={() => setResetLink(null)}>
                Close
              </Button>
              <Button
                type="button"
                onClick={() => void navigator.clipboard.writeText(resetLink.url)}
              >
                Copy link
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
